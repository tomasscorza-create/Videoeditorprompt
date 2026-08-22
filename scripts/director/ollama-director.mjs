import { createHash } from 'node:crypto';
import path from 'node:path';
import { PipelineError } from '../stage1/errors.mjs';
import { ensureDirectory, projectRoot } from '../stage1/common.mjs';
import {
  getDirectorPlanSchema,
  listLayoutPresetIds,
  loadAuthoringCatalog,
  normalizeDirectorPlan,
} from './director-plan.mjs';
import { canonicalizeDirectorPlanV2, getDirectorPlanV2Schema, normalizeDirectorPlanV2 } from './director-plan-v2.mjs';
import { loadCreativeRecipeCatalog } from './creative-contract.mjs';
import { judgeDirectorPlans, PLAN_JUDGE_VERSION } from './plan-judge.mjs';
import { DIRECTOR_PIPELINE_VERSION } from './version.mjs';
import { resolveDirectorProvider } from './providers/index.mjs';
import { DEFAULT_DIRECTOR_MODEL, DEFAULT_OLLAMA_URL } from './providers/ollama.mjs';
import {
  buildDirectorContext,
  compactNarrativeTemplates,
  compactResourceEntries,
  DIRECTOR_CONTEXT_VERSION,
  loadNarrativeTemplates,
} from './director-context.mjs';
import {
  analyzeDirectorPlanQuality,
  candidateStrategy,
  editorialWordBudgets,
  qualityRepairFeedback,
} from './plan-quality.mjs';
import { analyzeCreativeRichness } from './richness-policy.mjs';
import { formatPersonalizedPrompt } from './clarifying-questions.mjs';
import { quarantineDirectorCache, readDirectorCache, writeDirectorCache } from './cache.mjs';
import { aggregateProviderUsage, assertWithinTokenBudget } from './providers/usage.mjs';

export { DEFAULT_DIRECTOR_MODEL, DEFAULT_OLLAMA_URL };
const MAX_PROMPT_LENGTH = 2000;
const MAX_REPAIR_ATTEMPTS = 2;
const DIRECTOR_TONES = new Set(['educational', 'ironic', 'serious', 'energetic', 'inspirational']);

export async function createDirectorProposal(options) {
  const prompt = formatPersonalizedPrompt(validatePrompt(options.prompt), options.personalization);
  emitProgress(options, 'preparing_context');
  const assetsRoot = path.resolve(options.assetsRoot || path.join(projectRoot, 'public'));
  const catalog = options.catalog || loadAuthoringCatalog(assetsRoot);
  // El proveedor concentra toda la especificidad de la IA (D1/D2). La clave de
  // caché incorpora su nombre para no mezclar resultados entre proveedores.
  const provider = resolveDirectorProvider(options.provider, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    keepAlive: options.keepAlive,
    apiKey: options.apiKey,
  });
  const model = String(options.model || provider.defaultModel || DEFAULT_DIRECTOR_MODEL);
  const modelIdentity = normalizeModelIdentity(options.modelIdentity, model);
  const temperature = numberOption(options.temperature, 0.35, 0, 1);
  const variant = integerOption(options.variant, 0, 0, 1_000_000);
  const bestOf = integerOption(options.bestOf, 1, 1, 3);
  if (variant + bestOf - 1 > 1_000_000) {
    directorError('DIRECTOR_OPTION_INVALID', 'La variante inicial no deja espacio para comparar la cantidad solicitada.');
  }
  // Modo «calidad máxima» (C3): con think:true qwen3 razona antes de responder
  // (mejor plan, más lento en CPU). Default false. Forma parte de la clave de caché.
  const think = booleanOption(options.think, false);
  const constraints = inferDirectorConstraints(prompt, validateDirectorConstraints(options.constraints));
  const templates = options.templates || loadNarrativeTemplates(options.templatesPath);
  const directorContext = buildDirectorContext({
    prompt,
    constraints,
    catalog,
    templates,
    resourceLimits: options.resourceLimits,
    templateLimit: options.templateLimit,
  });
  directorContext.summary.resolvedConstraints = structuredClone(constraints);
  const schema = buildOllamaPlanSchema(directorContext.catalog, constraints, directorContext.templates);
  const promptCacheKey = `director-plan-${hashJson({
    version: DIRECTOR_PIPELINE_VERSION,
    provider: provider.name,
    model,
    schema,
    context: directorContext.catalog,
  }).slice(0, 40)}`;
  const tokenBudget = provider.name === 'openai'
    ? integerBudget(options.maxTotalTokens ?? process.env.LOCAL_VIDEO_OPENAI_MAX_PROPOSAL_TOKENS, 60_000)
    : null;
  const cacheKey = hashJson({
    version: DIRECTOR_PIPELINE_VERSION,
    provider: provider.name,
    prompt,
    model,
    modelIdentity,
    temperature,
    variant,
    think,
    bestOf,
    judgeVersion: PLAN_JUDGE_VERSION,
    constraints,
    catalog: hashJson(directorContext.catalog),
    contextVersion: DIRECTOR_CONTEXT_VERSION,
    context: hashJson({
      recommendedTemplateId: directorContext.summary.recommendedTemplateId,
      catalog: directorContext.catalog,
      templates: directorContext.templates,
    }),
    templates: hashJson(directorContext.templates),
    schema: hashJson(schema),
  });
  const cacheRoot = ensureDirectory(path.resolve(options.cacheRoot || path.join(projectRoot, '.local-video', 'director-cache')));
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  if (options.useCache !== false) {
    const cached = readDirectorCache(cachePath);
    if (cached) {
      try {
        emitProgress(options, 'cache');
        const cachedPlan = cached.plan?.version === 2 ? canonicalizeDirectorPlanV2(cached.plan, catalog) : cached.plan;
        const normalizeCachedPlan = cachedPlan?.version === 2 ? normalizeDirectorPlanV2 : normalizeDirectorPlan;
        const normalized = normalizeCachedPlan(cachedPlan, catalog, {
          assetsRoot,
          promptHash: cacheKey,
          resourceCatalog: options.resourceCatalog,
        });
        return {
          ...cached,
          plan: cachedPlan,
          project: normalized.project,
          semanticHash: normalized.semanticHash,
          repairAttempts: cached.repairAttempts ?? 0,
          selection: cached.selection ?? defaultSelection(),
          context: cached.context ?? directorContext.summary,
          usage: aggregateProviderUsage([], { cacheHit: true, currentRequestCount: 0 }),
          cacheKey,
          cacheHit: true,
          cachePath,
        };
      } catch {
        quarantineDirectorCache(cachePath);
      }
    }
  }

  const timeoutMs = integerOption(options.timeoutMs, think ? 300_000 : 240_000, 1_000, 300_000);

  const generationStartedAt = Date.now();
  const candidates = [];
  const generationRuns = [];
  const judgeUsages = [];
  for (let candidateIndex = 0; candidateIndex < bestOf; candidateIndex += 1) {
    const consumed = aggregateProviderUsage(generationRuns.map((entry) => entry.usage)).totalTokens ?? 0;
    const candidate = await generateCandidate({
      provider,
      schema,
      signal: options.signal,
      catalog,
      directorContext,
      assetsRoot,
      resourceCatalog: options.resourceCatalog,
      prompt,
      variant: variant + candidateIndex,
      constraints,
      model,
      temperature,
      think,
      timeoutMs,
      promptHash: cacheKey,
      seedKey: hashJson({ cacheKey, candidateIndex, variant: variant + candidateIndex }),
      strategy: candidateStrategy(candidateIndex),
      onProgress: options.onProgress,
      candidateIndex: candidateIndex + 1,
      candidateCount: bestOf,
      promptCacheKey,
      tokenBudget: tokenBudget === null ? null : Math.max(1, tokenBudget - consumed),
    });
    candidates.push(candidate);
    generationRuns.push(candidate);
    assertWithinTokenBudget(aggregateProviderUsage(generationRuns.map((entry) => entry.usage)), tokenBudget);
  }

  let selection = defaultSelection();
  let qualityEscalations = 0;
  if (bestOf > 1) {
    emitProgress(options, 'comparing');
    let judged = await judgeDirectorPlans({
      provider,
      plans: candidates.map((candidate) => candidate.plan),
      prompt,
      constraints,
      templates: directorContext.templates,
      model,
      signal: options.signal,
      timeoutMs,
      seed: seedFrom(hashJson({ cacheKey, judgeVersion: PLAN_JUDGE_VERSION })),
      promptCacheKey: `${promptCacheKey}-judge`,
    });
    judgeUsages.push(judged.usage);
    assertWithinTokenBudget(aggregateProviderUsage([
      ...generationRuns.map((entry) => entry.usage),
      ...judgeUsages,
    ]), tokenBudget);
    if (!judged.qualityFloorMet) {
      qualityEscalations += 1;
      emitProgress(options, 'repairing');
      const revisionIndex = judged.winnerIndex;
      const consumedBeforeRevision = aggregateProviderUsage([
        ...generationRuns.map((entry) => entry.usage),
        ...judgeUsages,
      ]).totalTokens ?? 0;
      const revisedCandidate = await generateCandidate({
        provider,
        schema,
        signal: options.signal,
        catalog,
        directorContext,
        assetsRoot,
        resourceCatalog: options.resourceCatalog,
        prompt,
        variant: variant + revisionIndex,
        constraints,
        model,
        temperature,
        think,
        timeoutMs,
        promptHash: cacheKey,
        seedKey: hashJson({ cacheKey, revisionIndex, qualityEscalations }),
        strategy: candidateStrategy(revisionIndex),
        initialFeedback: judgeRepairFeedback(judged),
        onProgress: options.onProgress,
        candidateIndex: revisionIndex + 1,
        candidateCount: bestOf,
        promptCacheKey,
        tokenBudget: tokenBudget === null ? null : Math.max(1, tokenBudget - consumedBeforeRevision),
      });
      candidates[revisionIndex] = revisedCandidate;
      generationRuns.push(revisedCandidate);
      assertWithinTokenBudget(aggregateProviderUsage([
        ...generationRuns.map((entry) => entry.usage),
        ...judgeUsages,
      ]), tokenBudget);
      emitProgress(options, 'comparing');
      judged = await judgeDirectorPlans({
        provider,
        plans: candidates.map((candidate) => candidate.plan),
        prompt,
        constraints,
        templates: directorContext.templates,
        model,
        signal: options.signal,
        timeoutMs,
        seed: seedFrom(hashJson({ cacheKey, judgeVersion: PLAN_JUDGE_VERSION, qualityEscalations })),
        promptCacheKey: `${promptCacheKey}-judge`,
      });
      judgeUsages.push(judged.usage);
      assertWithinTokenBudget(aggregateProviderUsage([
        ...generationRuns.map((entry) => entry.usage),
        ...judgeUsages,
      ]), tokenBudget);
      if (!judged.qualityFloorMet) {
        directorError(
          'DIRECTOR_QUALITY_FLOOR_NOT_MET',
          'Las propuestas generadas no alcanzaron el umbral mínimo de calidad.',
          `score=${judged.maximumTotal}; floor=${judged.qualityFloor}`,
        );
      }
    }
    selection = {
      bestOf,
      winnerIndex: judged.winnerIndex,
      judgeVersion: PLAN_JUDGE_VERSION,
      scores: judged.scores,
      totals: judged.totals,
      qualityFloor: judged.qualityFloor,
      qualityFloorMet: judged.qualityFloorMet,
      usage: aggregateProviderUsage(judgeUsages),
    };
  }
  const selected = candidates[selection.winnerIndex];
  const repairAttempts = generationRuns.reduce((total, candidate) => total + candidate.repairAttempts, 0);
  const providerUsage = aggregateProviderUsage([
    ...generationRuns.map((entry) => entry.usage),
    ...judgeUsages,
  ]);

  const resolvedContext = {
    ...directorContext.summary,
    selectedTemplateId: selected.plan.narrativeTemplateId,
  };
  const cached = {
    version: 2,
    directorVersion: DIRECTOR_PIPELINE_VERSION,
    provider: provider.name,
    model,
    modelIdentity,
    plan: selected.plan,
    project: selected.normalized.project,
    semanticHash: selected.normalized.semanticHash,
    budget: selected.normalized.budget,
    repairAttempts,
    quality: selected.quality,
    candidateQuality: candidates.map((candidate) => candidate.quality),
    selection,
    context: resolvedContext,
    usage: {
      ...providerUsage,
      think,
      generationCount: generationRuns.length,
      qualityEscalations,
      elapsedMilliseconds: Date.now() - generationStartedAt,
      candidateElapsedMilliseconds: generationRuns.map((candidate) => candidate.elapsedMilliseconds),
      judgeRequestCount: aggregateProviderUsage(judgeUsages).requestCount,
      repairAttempts,
      cacheHit: false,
      currentRequestCount: providerUsage.requestCount,
    },
  };
  emitProgress(options, 'finalizing');
  writeDirectorCache(cachePath, cached);
  return { ...cached, cacheKey, cacheHit: false, cachePath };
}

export async function inspectOllama(options = {}) {
  const provider = resolveDirectorProvider(options.provider, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    keepAlive: options.keepAlive,
    apiKey: options.apiKey,
  });
  const timeoutMs = integerOption(options.timeoutMs, 5000, 500, 30_000);
  return provider.inspect({ model: options.model, timeoutMs });
}

export const inspectDirectorProvider = inspectOllama;

async function generateCandidate({
  provider,
  schema,
  signal,
  catalog,
  directorContext,
  assetsRoot,
  resourceCatalog,
  prompt,
  variant,
  constraints,
  model,
  temperature,
  think,
  timeoutMs,
  promptHash,
  seedKey,
  strategy,
  initialFeedback = null,
  onProgress,
  candidateIndex,
  candidateCount,
  promptCacheKey,
  tokenBudget,
}) {
  const startedAt = Date.now();
  let plan;
  let normalized;
  let usage = null;
  const usageEntries = [];
  let repairAttempts = 0;
  let feedback = initialFeedback;
  let previousOutputForRepair = null;
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    onProgress?.({
      stage: 'generating',
      candidateIndex,
      candidateCount,
      attempt: attempt + 1,
    });
    const messages = [
      { role: 'system', content: buildSystemPrompt(directorContext, constraints) },
      { role: 'user', content: buildUserPrompt(prompt, variant, constraints, strategy, null) },
      ...(previousOutputForRepair ? [
        { role: 'assistant', content: `Salida anterior inválida, solo como referencia para corregirla:\n${previousOutputForRepair}` },
      ] : []),
      ...(feedback ? [{ role: 'user', content: `Corrección obligatoria: ${feedback}` }] : []),
    ];
    const result = await generatePlanReliably({
      provider,
      schema,
      signal,
      messages,
      options: {
        model,
        temperature,
        think,
        seed: seedFrom(seedKey) + attempt,
        maxOutputTokens: 4000,
        timeoutMs,
        promptCacheKey,
      },
      constraints,
      tokenBudget,
      onProgress,
      candidateIndex,
      candidateCount,
      attempt: attempt + 1,
    });
    usageEntries.push(result.usage);
    usage = aggregateProviderUsage(usageEntries);
    assertWithinTokenBudget(usage, tokenBudget);
    onProgress?.({
      stage: 'validating',
      candidateIndex,
      candidateCount,
      attempt: attempt + 1,
    });
    if (typeof result.content !== 'string' || result.content.trim() === '') {
      directorError('OLLAMA_RESPONSE_EMPTY', 'El proveedor de IA no devolvió un plan utilizable.');
    }
    try {
      plan = JSON.parse(result.content);
    } catch (error) {
      const invalidJson = new PipelineError({
        code: 'OLLAMA_RESPONSE_JSON_INVALID',
        stage: 'directing',
        message: 'El proveedor de IA devolvió contenido que no es JSON válido.',
        technicalDetail: error instanceof Error ? error.message : String(error),
        suggestedAction: 'Reintentá la propuesta o verificá el soporte de salidas estructuradas del modelo.',
      });
      if (attempt === MAX_REPAIR_ATTEMPTS) throw invalidJson;
      repairAttempts += 1;
      feedback = 'devolvé solamente un objeto JSON que cumpla exactamente el esquema.';
      previousOutputForRepair = compactRepairOutput(result.content);
      continue;
    }
    try {
      if (plan.version === 2) plan = canonicalizeDirectorPlanV2(plan, catalog);
      if (plan.narrativeTemplateId === undefined) {
        plan.narrativeTemplateId = directorContext.summary.recommendedTemplateId;
      } else if (!directorContext.templates.some((template) => template.id === plan.narrativeTemplateId)) {
        directorError('DIRECTOR_TEMPLATE_INVALID', 'El proveedor eligió una plantilla fuera de la shortlist.');
      }
      normalized = (plan.version === 2 ? normalizeDirectorPlanV2 : normalizeDirectorPlan)(plan, catalog, {
        assetsRoot,
        promptHash,
        resourceCatalog,
      });
      const quality = analyzePlanQuality(plan, { prompt, constraints, project: normalized.project });
      if (!quality.passed) qualityError(quality);
      break;
    } catch (error) {
      if (!isRepairableDirectorError(error) || attempt === MAX_REPAIR_ATTEMPTS) throw error;
      repairAttempts += 1;
      feedback = repairFeedback(error);
      previousOutputForRepair = compactRepairOutput(plan, error);
    }
  }
  const quality = analyzePlanQuality(plan, { prompt, constraints, project: normalized?.project });
  return {
    plan,
    normalized,
    quality,
    usage,
    repairAttempts,
    strategy: strategy.id,
    elapsedMilliseconds: Date.now() - startedAt,
  };
}

async function generatePlanReliably({ provider, schema, signal, messages, options, constraints, tokenBudget, onProgress, candidateIndex, candidateCount, attempt }) {
  const sceneCount = constraints.planVersion === 2 ? Number(constraints.sceneCount || 0) : 0;
  if (sceneCount <= 3) {
    const result = await provider.generatePlan({ schema, signal, messages, options });
    assertWithinTokenBudget(result.usage, tokenBudget);
    return result;
  }
  const chunkSizes = buildSceneChunkSizes(sceneCount);
  const plans = [];
  const usages = [];
  let firstScene = 1;
  for (const [chunkIndex, chunkSize] of chunkSizes.entries()) {
    onProgress?.({
      stage: 'generating', candidateIndex, candidateCount, attempt,
      segmentIndex: chunkIndex + 1, segmentCount: chunkSizes.length,
    });
    const chunkSchema = structuredClone(schema);
    chunkSchema.properties.scenes = { ...chunkSchema.properties.scenes, minItems: chunkSize, maxItems: chunkSize };
    const lastScene = firstScene + chunkSize - 1;
    const segmentRole = chunkIndex === 0
      ? 'Este segmento debe construir el gancho y comenzar el desarrollo.'
      : chunkIndex === chunkSizes.length - 1
        ? 'Este segmento debe completar el desarrollo y reservar un cierre concluyente para la última escena.'
        : 'Este segmento debe avanzar el desarrollo sin repetir el gancho ni cerrar todavía.';
    const previousScenes = plans.flatMap((plan) => plan.scenes).map((scene) => ({
      title: scene.title,
      purpose: scene.purpose,
      lastLine: scene.speech?.at(-1)?.text ?? null,
    }));
    const chunkMessages = messages.map((message, index) => index === messages.length - 1 ? {
      ...message,
      content: `${message.content}\nSegmento obligatorio: generá solamente las escenas ${firstScene} a ${lastScene} de un total de ${sceneCount}. ${segmentRole} Mantené continuidad con el tema, pero no escribas escenas adicionales. Evitá repetir modo, composición, receta y recurso visual de las escenas previas salvo que el contenido lo justifique.${previousScenes.length ? ` Continuidad ya escrita: ${JSON.stringify(previousScenes)}` : ''}`,
    } : message);
    const result = await provider.generatePlan({
      schema: chunkSchema,
      signal,
      messages: chunkMessages,
      options: {
        ...options,
        think: false,
        seed: options.seed + chunkIndex,
        maxOutputTokens: Math.min(options.maxOutputTokens, 1400 + (chunkSize * 850)),
      },
    });
    let chunkPlan;
    try {
      chunkPlan = JSON.parse(result.content || '');
    } catch (error) {
      throw new PipelineError({
        code: 'OLLAMA_RESPONSE_JSON_INVALID', stage: 'directing',
        message: 'El proveedor devolvió un segmento que no es JSON válido.',
        technicalDetail: error instanceof Error ? error.message : String(error),
        suggestedAction: 'Reintentá la propuesta segmentada.',
      });
    }
    if (!Array.isArray(chunkPlan.scenes) || chunkPlan.scenes.length !== chunkSize) {
      directorError('DIRECTOR_PLAN_SCHEMA_INVALID', 'Un segmento no contiene la cantidad de escenas solicitada.');
    }
    plans.push(chunkPlan);
    usages.push(result.usage || {});
    assertWithinTokenBudget(aggregateProviderUsage(usages), tokenBudget);
    firstScene = lastScene + 1;
  }
  const combined = { ...plans[0], scenes: plans.flatMap((plan) => plan.scenes) };
  return {
    content: JSON.stringify(combined),
    usage: aggregateProviderUsage(usages, {
      segmented: true,
      segmentCount: chunkSizes.length,
    }),
  };
}

export function buildSceneChunkSizes(sceneCount) {
  const segmentCount = Math.ceil(sceneCount / 3);
  const baseSize = Math.floor(sceneCount / segmentCount);
  const largerSegments = sceneCount % segmentCount;
  return Array.from({ length: segmentCount }, (_unused, index) => baseSize + (index < largerSegments ? 1 : 0));
}

function defaultSelection() {
  return {
    bestOf: 1,
    winnerIndex: 0,
    judgeVersion: null,
    scores: null,
    totals: null,
    qualityFloor: null,
    qualityFloorMet: true,
    usage: null,
  };
}

function analyzePlanQuality(plan, context) {
  const quality = analyzeDirectorPlanQuality(plan, context);
  if (plan.version === 2) {
    quality.richness = analyzeCreativeRichness(plan, { ...context.constraints, prompt: context.prompt });
    if (context.project) {
      const materializedAnimatedScenes = context.project.scenes.filter((scene) => scene.elements.some((element) => (element.tracks ?? []).some((track) => track.source?.kind === 'preset'))).length;
      quality.richness.metrics.materializedAnimatedScenes = materializedAnimatedScenes;
      const required = quality.richness.policy.resolved === 'dynamic' ? Math.max(1, Math.ceil(context.project.scenes.length / 2)) : 0;
      if (materializedAnimatedScenes < required) quality.richness.issues.push('Las secuencias elegidas no pudieron materializar animaciones compatibles suficientes.');
      quality.richness.passed = quality.richness.issues.length === 0;
    }
    if (!quality.richness.passed) {
      quality.passed = false;
      quality.issues.push(...quality.richness.issues.map((instruction, index) => ({
        code: `CREATIVE_RICHNESS_${index + 1}`,
        penalty: 0,
        instruction,
      })));
    }
  }
  return quality;
}

export function inferDirectorConstraints(prompt, constraints = {}) {
  // Primero interpreta el prompt. Las decisiones explícitas de la interfaz se
  // aplican al final y por eso siempre ganan. `automatic` equivale a no fijar
  // una decisión: permite que el prompt siga mandando.
  const result = {};
  const normalized = String(prompt).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const numberWords = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8 };
  const sceneMatch = /\b(\d+|una?|dos|tres|cuatro|cinco|seis|siete|ocho)\s+escenas?\b/u.exec(normalized);
  if (sceneMatch) {
    const count = Number(sceneMatch[1]) || numberWords[sceneMatch[1]];
    if (count >= 1 && count <= 8) result.sceneCount = count;
  }
  const durationMatch = /\b(\d{1,2})\s*(?:s|segundos?)\b/u.exec(normalized);
  if (durationMatch) {
    const seconds = Number(durationMatch[1]);
    if (seconds >= 8 && seconds <= 90) result.targetDurationSeconds = seconds;
  }
  if (/\b(?:ironico|ironia|humor seco)\b/u.test(normalized)) result.tone = 'ironic';
  else if (/\b(?:inspirador|inspiracional|motivador)\b/u.test(normalized)) result.tone = 'inspirational';
  else if (/\b(?:energico|energia|ritmo rapido)\b/u.test(normalized)) result.tone = 'energetic';
  else if (/\b(?:serio|sobrio)\b/u.test(normalized)) result.tone = 'serious';
  else if (/\b(?:educativo|educacional|explicativo|tutorial)\b/u.test(normalized)) result.tone = 'educational';
  if (/\b(?:sin personajes|solo narracion|voz en off)\b/u.test(normalized)) result.structure = 'narration';
  else if (/\b(?:dialogo|dos personajes|debate|conversacion)\b/u.test(normalized)) result.structure = 'dialogue';
  else if (/\b(?:un personaje|monologo|presentador)\b/u.test(normalized)) result.structure = 'one-character';
  if (/\b(?:dinamico|alto impacto|mucha energia)\b/u.test(normalized)) result.richnessProfile = 'dynamic';
  else if (/\b(?:variado|variedad)\b/u.test(normalized)) result.richnessProfile = 'varied';
  else if (/\b(?:simple|minimalista|sobrio)\b/u.test(normalized)) result.richnessProfile = 'simple';
  for (const [key, value] of Object.entries(constraints)) {
    if (value !== undefined && value !== null && value !== '' && value !== 'automatic') result[key] = value;
  }
  if (constraints.planVersion !== undefined) result.planVersion = constraints.planVersion;
  return result;
}

export function buildOllamaPlanSchema(catalog, constraints = {}, templates = loadNarrativeTemplates().templates) {
  if (constraints.planVersion === 2) return buildOllamaPlanV2Schema(catalog, constraints, templates);
  const schema = getDirectorPlanSchema();
  const characters = catalog.entries.filter((entry) => entry.type === 'character').map((entry) => entry.id);
  const voices = catalog.entries.filter((entry) => entry.type === 'voice').map((entry) => entry.id);
  const backgrounds = catalog.entries.filter((entry) => entry.type === 'background').map((entry) => entry.id);
  const music = catalog.entries.filter((entry) => entry.type === 'music').map((entry) => entry.id);
  if (characters.length < 2 || voices.length < 2 || backgrounds.length < 1) {
    directorError('DIRECTOR_CATALOG_INSUFFICIENT', 'El catálogo no tiene recursos suficientes para dirigir un video.');
  }
  schema.$defs.castMember.properties.characterResourceId = { type: 'string', enum: characters };
  schema.$defs.castMember.properties.voiceId = { type: 'string', enum: voices };
  schema.$defs.scene.properties.backgroundResourceId = { type: 'string', enum: backgrounds };
  if (music.length > 0) schema.properties.musicResourceId = { type: 'string', enum: music };
  schema.properties.narrativeTemplateId = { type: 'string', enum: templates.map((template) => template.id) };
  if (!schema.required.includes('narrativeTemplateId')) schema.required.push('narrativeTemplateId');
  const animationPresets = [...new Set(catalog.entries
    .filter((entry) => entry.type === 'character')
    .flatMap((entry) => entry.capabilities.animationPresets))];
  // El runtime v2 solo conserva neutral como pose inicial. `point` sigue
  // disponible como gesto de diálogo, pero no debe llegar a elements[].poseId.
  schema.$defs.castMember.properties.poseId = { const: 'neutral' };
  schema.$defs.castMember.properties.animationPreset = { type: 'string', enum: animationPresets };
  schema.$defs.scene.properties.transitionDurationSeconds = { type: 'number', minimum: 0, maximum: 1 };
  schema.$defs.scene.properties.layoutPreset = { type: 'string', enum: listLayoutPresetIds() };
  schema.$defs.dialogueTurn.properties.layoutPreset = { type: 'string', enum: listLayoutPresetIds() };
  const gestures = [...new Set(catalog.entries
    .filter((entry) => entry.type === 'character')
    .flatMap((entry) => entry.capabilities.poses))];
  schema.$defs.dialogueTurn.properties.gestureId = { type: 'string', enum: gestures };
  // A5: `static` es una elección legítima; ya no se filtra del enum de cámara.
  const cameraPresets = [...new Set(catalog.entries
    .filter((entry) => entry.type === 'background')
    .flatMap((entry) => entry.capabilities.cameraPresets))];
  schema.$defs.scene.properties.cameraPreset = { type: 'string', enum: cameraPresets };
  if (constraints.tone) schema.properties.tone = { const: constraints.tone };
  if (constraints.targetDurationSeconds) {
    schema.properties.targetDurationSeconds = { const: constraints.targetDurationSeconds };
  }
  if (constraints.sceneCount) {
    schema.properties.scenes.minItems = constraints.sceneCount;
    schema.properties.scenes.maxItems = constraints.sceneCount;
  }
  return schema;
}

function buildOllamaPlanV2Schema(catalog, constraints, templates) {
  const schema = getDirectorPlanV2Schema();
  const ids = (type) => catalog.entries.filter((entry) => entry.type === type).map((entry) => entry.id);
  const characters = ids('character');
  const voices = ids('voice');
  const backgrounds = ids('background');
  const props = ids('prop');
  const visualTemplates = ids('template');
  const music = ids('music');
  if (voices.length < 1 || backgrounds.length < 1) directorError('DIRECTOR_CATALOG_INSUFFICIENT', 'El catálogo necesita al menos una voz y un fondo.');
  schema.$defs.participant.properties.characterResourceId = { type: 'string', enum: characters };
  schema.$defs.participant.properties.voiceId = { type: 'string', enum: voices };
  schema.$defs.voiceoverTurn.properties.voiceId = { type: 'string', enum: voices };
  schema.$defs.visual.properties.resourceId = { type: 'string', enum: [...props, ...visualTemplates] };
  schema.$defs.scene.properties.backgroundResourceId = { type: 'string', enum: backgrounds };
  schema.properties.narrativeTemplateId = { type: 'string', enum: templates.map((template) => template.id) };
  if (!schema.required.includes('narrativeTemplateId')) schema.required.push('narrativeTemplateId');
  if (music.length) schema.properties.musicResourceId = { type: 'string', enum: music };
  schema.$defs.participant.properties.animationPresetId = {
    type: 'string',
    enum: [...new Set(catalog.entries.filter((entry) => entry.type === 'character').flatMap((entry) => entry.capabilities.animationPresets))],
  };
  schema.$defs.scene.properties.layoutPreset = { type: 'string', enum: listLayoutPresetIds() };
  schema.$defs.scene.properties.cameraPreset = {
    type: 'string',
    enum: [...new Set(catalog.entries.filter((entry) => entry.type === 'background').flatMap((entry) => entry.capabilities.cameraPresets))],
  };
  const recipes = creativeCatalogForConstraints(constraints);
  schema.$defs.scene.properties.sceneRecipeId = { type: 'string', enum: recipes.sceneRecipes.map((entry) => entry.id) };
  schema.$defs.scene.properties.effectSequenceIds = {
    type: 'array', maxItems: 4, uniqueItems: true,
    items: { type: 'string', enum: recipes.effectSequences.map((entry) => entry.id) },
  };
  if (constraints.tone) schema.properties.tone = { const: constraints.tone };
  if (constraints.targetDurationSeconds) schema.properties.targetDurationSeconds = { const: constraints.targetDurationSeconds };
  if (constraints.richnessProfile) schema.properties.richnessProfile = { const: constraints.richnessProfile };
  if (constraints.sceneCount) schema.properties.scenes = { ...schema.properties.scenes, minItems: constraints.sceneCount, maxItems: constraints.sceneCount };
  if (constraints.structure && constraints.structure !== 'automatic') {
    const mode = constraints.structure === 'narration' ? 'voiceover' : constraints.structure === 'one-character' ? 'solo' : 'dialogue';
    schema.$defs.scene.properties.mode = { const: mode };
  }
  return schema;
}

function buildSystemPrompt(directorContext, constraints = {}) {
  const entries = compactResourceEntries(directorContext.catalog);
  const templates = compactNarrativeTemplates(directorContext.templates);
  const creativeCatalog = creativeCatalogForConstraints(constraints);
  const creativeRecipes = creativeCatalog.sceneRecipes.map((recipe) => ({
    id: recipe.id, modes: recipe.compatibleModes, participants: recipe.participantRange,
    requires: recipe.requiredElementTypes, optional: recipe.optionalElementTypes,
    sequences: recipe.recommendedEffectSequenceIds,
  }));
  const effectSequences = creativeCatalog.effectSequences.map((sequence) => ({
    id: sequence.id, phase: sequence.phase, anchors: sequence.compatibleAnchorKinds,
    slots: sequence.slots.map((slot) => ({ id: slot.id, types: slot.elementTypes, parameters: slot.requiredParameters })),
    presets: sequence.actions.map((action) => action.presetId),
  }));
  const recommendedTemplateId = directorContext.summary.recommendedTemplateId;
  return [
    'Sos el Director IA de una herramienta local de videos animados verticales.',
    'Transformá la idea del usuario en un plan breve, claro, entretenido y renderizable.',
    'Cumplí exactamente el JSON Schema solicitado.',
    '',
    'ESTRUCTURA. Todo video sigue tres momentos:',
    '- Gancho: la primera línea plantea una tensión, pregunta o afirmación que engancha.',
    '- Desarrollo: uno o dos intercambios que avanzan la idea, sin repetir el gancho.',
    '- Cierre: la última línea deja una conclusión útil o memorable.',
    '',
    'TONO. Ajustá el registro al tono pedido:',
    '- educational: claro y ordenado, enseña un concepto sin tecnicismos.',
    '- ironic: contrasta expectativa y realidad con humor seco; nunca agresivo.',
    '- serious: sobrio y directo, sin chistes, con una conclusión firme.',
    '- energetic: frases cortas y entusiastas, ritmo rápido.',
    '- inspirational: cálido y esperanzador, cierra con un llamado a la acción.',
    '',
    'RITMO PARA VOZ (TTS). Frases cortas, una idea por turno. Evitá enumeraciones',
    'largas, incisos, siglas deletreadas y números complejos: se leen mal en voz.',
    '',
    'EJEMPLOS DE GANCHO → CIERRE. Variá la apertura; no empieces con «¿Sabías que…?»:',
    '- educational: "Tu contraseña larga puede seguir siendo débil." → "La longitud ayuda, pero combinar palabras únicas ayuda más."',
    '- ironic: "Dicen que la IA va a reemplazar a los programadores." → "Perfecto: ahora alguien debe explicarle por qué cayó producción."',
    '- serious: "Una copia de seguridad que nunca probaste todavía no es una copia." → "Restaurarla hoy evita descubrir el fallo durante una emergencia."',
    '- energetic: "¡Treinta segundos alcanzan para destrabar tu mañana!" → "Elegí una tarea, cerrá distracciones y empezá ahora."',
    '- inspirational: "Todo proyecto grande alguna vez fue una primera prueba imperfecta." → "Construí hoy el paso que mañana te permita continuar."',
    '',
    'REGLAS:',
    constraints.planVersion === 2 ? 'Usá estructura flexible por escena: voiceover, solo, dialogue o visual-with-voiceover. No agregues personajes si la idea funciona mejor narrada.' : null,
    constraints.planVersion === 2 ? 'Cada escena admite de cero a dos participantes y desde un turno. Elegí recetas, props, plantillas y secuencias solo por IDs permitidos.' : null,
    constraints.planVersion === 2 ? 'Una plantilla ocupa toda la pantalla: usala como único elemento visual, sin personajes, y solo con voz fuera de campo. Nunca superpongas dos plantillas.' : null,
    constraints.planVersion === 2 ? 'Distribuí el movimiento durante toda la escena: combiná secuencias opening, development y closing cuando el perfil sea variado o dinámico. Priorizá secuencias exclusivas de prop si agregaste un prop.' : null,
    constraints.planVersion === 2 ? 'Para fondos con parallax, elegí cámaras móviles variadas en perfiles varied o dynamic; reservá static para una pausa visual intencional.' : null,
    constraints.planVersion === 2 ? 'Usá durationWeight para repartir el objetivo: valores mayores reservan proporcionalmente más narración; no hagas todas las escenas iguales salvo que el contenido lo justifique.' : null,
    constraints.planVersion === 2 ? `Perfil de riqueza: ${constraints.richnessProfile || 'automatic'}. Preferencia estructural: ${constraints.structure || 'automatic'}.` : null,
    'Recibís una shortlist local, no el inventario completo. Usá solamente IDs presentes en esa shortlist.',
    'Elegí la plantilla narrativa más adecuada entre las candidatas. La recomendada es un punto de partida, no una obligación.',
    'Usá sus beats como estructura semántica y combinalos con recursos compatibles; no copies literalmente sus ejemplos.',
    'Elegí para cada personaje una pose y una animación entre las que declara su catálogo (capabilities).',
    'Podés elegir música del catálogo, pace slow|normal|fast y un layout por turno cuando aporten intención.',
    'gestureAtWord es un índice desde 0: usalo para disparar gestos cerca de la palabra importante.',
    'transitionDurationSeconds solo importa cuando transitionPreset es «fade»: usá entre 0.15 y 1.0 segundos; con «cut» dejá 0.',
    constraints.planVersion === 2 ? 'En dialogue deben hablar ambos participantes; en solo habla el único personaje; en voiceover la voz no referencia personajes.' : 'Cada escena debe tener de 2 a 6 turnos e incluir a ambos personajes.',
    'Escribí español natural para voz, sin markdown, acotaciones, emojis ni instrucciones técnicas.',
    'La duración es un objetivo editorial: mantené el guion conciso para no pasarte del presupuesto de palabras.',
    'No generes rutas, código, comandos, frames, tiempos absolutos ni propiedades adicionales.',
    `Plantilla recomendada: ${recommendedTemplateId}.`,
    `Plantillas narrativas candidatas: ${JSON.stringify(templates)}`,
    `Recetas de escena compatibles: ${JSON.stringify(creativeRecipes)}`,
    `Secuencias coordinadas disponibles: ${JSON.stringify(effectSequences)}`,
    `Shortlist de recursos permitidos: ${JSON.stringify(entries)}`,
  ].filter((line) => line !== null).join('\n');
}

function buildUserPrompt(prompt, variant, constraints, strategy, feedback = null) {
  const requested = [
    constraints.tone ? `tono=${constraints.tone}` : null,
    constraints.targetDurationSeconds ? `duración objetivo=${constraints.targetDurationSeconds} segundos` : null,
    constraints.sceneCount ? `escenas=${constraints.sceneCount}` : null,
  ].filter(Boolean).join(', ');
  const sceneCount = constraints.sceneCount || 2;
  const targetDurationSeconds = constraints.targetDurationSeconds || 30;
  const budgets = editorialWordBudgets(targetDurationSeconds, sceneCount);
  return [
    `Idea del video: ${prompt}`,
    `Variante solicitada: ${variant}.`,
    `Estrategia creativa: ${strategy.instruction}`,
    `Presupuesto editorial obligatorio: entre ${budgets.minimumWords} y ${budgets.maximumWords} palabras en total; por escena respetá estos rangos ${budgets.scenes.map((scene) => `${scene.scene}:${scene.minimumWords}-${scene.maximumWords}`).join(', ')}. Contá solamente las palabras pronunciadas.`,
    requested ? `Parámetros editoriales obligatorios: ${requested}.` : null,
    'Creá un gancho claro, desarrollo breve y cierre útil o memorable.',
    feedback ? `Corrección obligatoria: ${feedback}` : null,
  ].filter(Boolean).join('\n');
}

function budgetRepairFeedback(error) {
  const detail = String(error?.technicalDetail || '');
  const words = Number(/words=(\d+)/.exec(detail)?.[1]);
  const maximum = Number(/maximum=(\d+)/.exec(detail)?.[1]);
  if (Number.isFinite(words) && Number.isFinite(maximum) && maximum > 0) {
    const overflow = Math.max(1, words - maximum);
    return `el guion anterior tenía ${words} palabras y el máximo es ${maximum}: recortá al menos ${overflow} palabras manteniendo el gancho inicial y el cierre.`;
  }
  return 'el guion anterior excedió el presupuesto de palabras: recortá el diálogo manteniendo el gancho inicial y el cierre.';
}

function repairFeedback(error) {
  if (error?.code === 'DIRECTOR_DURATION_BUDGET_EXCEEDED') return budgetRepairFeedback(error);
  if (error?.code === 'DIRECTOR_QUALITY_FLOOR_NOT_MET' && error.quality) {
    return qualityRepairFeedback(error.quality);
  }
  const messages = {
    DIRECTOR_PLAN_SCHEMA_INVALID: 'corregí la estructura y completá únicamente las propiedades admitidas por el esquema.',
    DIRECTOR_TEMPLATE_INVALID: 'elegí una plantilla incluida en la shortlist.',
    DIRECTOR_RESOURCE_INVALID: 'usá únicamente IDs de recursos incluidos en la shortlist y del tipo correcto.',
    DIRECTOR_RESOURCE_UNSUPPORTED: 'elegí capacidades que el recurso seleccionado declare explícitamente.',
    DIRECTOR_RECIPE_INVALID: 'elegí una receta compatible con el modo, la cantidad de participantes y los tipos visuales presentes.',
    DIRECTOR_COMPOSITION_INVALID: 'separá personajes, carteles de pantalla completa y salidas visuales para que ningún hablante quede oculto antes de terminar.',
    DIRECTOR_CAST_INVALID: 'ajustá el reparto al modo: voiceover sin personajes, solo con uno, dialogue con dos distintos y visual-with-voiceover con cero a dos.',
    DIRECTOR_TRANSITION_INVALID: 'usá fundidos entre 0.15 y 1 segundo, o corte con duración cero.',
    DIRECTOR_GESTURE_TIMING_INVALID: 'ubicá gestureAtWord dentro de las palabras reales del turno.',
    DIRECTOR_SCENE_DIALOGUE_INVALID: 'usá solo narración en modos voiceover, un único hablante en solo y al menos un turno de cada participante en dialogue.',
  };
  const instruction = messages[error?.code] || 'corregí el plan para que cumpla todas las restricciones indicadas.';
  const detail = sanitizeRepairDetail(error?.technicalDetail);
  return detail ? `${instruction} El validador señaló exactamente: ${detail}. Conservá el resto del plan válido.` : instruction;
}

function creativeCatalogForConstraints(constraints) {
  const catalog = loadCreativeRecipeCatalog();
  const activeEffectSequences = catalog.effectSequences.filter((sequence) => sequence.directorAvailability !== 'legacy');
  const requestedMode = constraints.structure === 'narration'
    ? new Set(['voiceover', 'visual-with-voiceover'])
    : constraints.structure === 'one-character'
      ? new Set(['solo'])
      : constraints.structure === 'dialogue' ? new Set(['dialogue']) : null;
  if (!requestedMode) return { ...catalog, effectSequences: activeEffectSequences };
  const sceneRecipes = catalog.sceneRecipes.filter((recipe) => recipe.compatibleModes.some((mode) => requestedMode.has(mode)));
  const recommended = new Set(sceneRecipes.flatMap((recipe) => recipe.recommendedEffectSequenceIds));
  const effectSequences = activeEffectSequences.filter((sequence) => recommended.has(sequence.id));
  return { ...catalog, sceneRecipes, effectSequences };
}

function compactRepairOutput(planOrContent, error = null) {
  if (typeof planOrContent === 'string') return planOrContent.slice(0, 6000);
  if (!planOrContent || typeof planOrContent !== 'object') return null;
  const detail = String(error?.technicalDetail || '');
  const sceneIndex = Number(/\/scenes\/(\d+)/u.exec(detail)?.[1]);
  const value = Number.isInteger(sceneIndex) && Array.isArray(planOrContent.scenes)
    ? { sceneIndex, scene: planOrContent.scenes[sceneIndex] }
    : planOrContent;
  return JSON.stringify(value).slice(0, 8000);
}

function sanitizeRepairDetail(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/\s{2,}/gu, ' ')
    .trim()
    .slice(0, 1200);
}

function isRepairableDirectorError(error) {
  return error instanceof PipelineError && new Set([
    'DIRECTOR_PLAN_SCHEMA_INVALID',
    'DIRECTOR_TEMPLATE_INVALID',
    'DIRECTOR_RESOURCE_INVALID',
    'DIRECTOR_RESOURCE_UNSUPPORTED',
    'DIRECTOR_RECIPE_INVALID',
    'DIRECTOR_CAST_INVALID',
    'DIRECTOR_TRANSITION_INVALID',
    'DIRECTOR_GESTURE_TIMING_INVALID',
    'DIRECTOR_SCENE_DIALOGUE_INVALID',
    'DIRECTOR_DURATION_BUDGET_EXCEEDED',
    'DIRECTOR_QUALITY_FLOOR_NOT_MET',
  ]).has(error.code);
}

function qualityError(quality) {
  const error = new PipelineError({
    code: 'DIRECTOR_QUALITY_FLOOR_NOT_MET',
    stage: 'directing',
    message: 'La propuesta no alcanzó el umbral mínimo de calidad.',
    technicalDetail: `score=${quality.score}; floor=${quality.floor}; issues=${quality.issues.map((issue) => issue.code).join(',')}`,
    suggestedAction: 'Regenerá la propuesta o ajustá la idea y sus restricciones.',
  });
  error.quality = quality;
  throw error;
}

function judgeRepairFeedback(judged) {
  const score = judged.scores[judged.winnerIndex];
  const weakest = Object.entries(score)
    .sort((left, right) => left[1] - right[1])
    .slice(0, 3)
    .map(([key]) => key)
    .join(', ');
  return `el juez detectó calidad insuficiente. Reescribí el plan completo mejorando especialmente: ${weakest}.`;
}

function normalizeModelIdentity(value, model) {
  if (!value || typeof value !== 'object') return { model, digest: null, runtimeVersion: null };
  return {
    model,
    digest: typeof value.digest === 'string' ? value.digest : null,
    runtimeVersion: typeof value.runtimeVersion === 'string' ? value.runtimeVersion : null,
  };
}

function validateDirectorConstraints(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    directorError('DIRECTOR_OPTION_INVALID', 'Los parámetros editoriales deben ser un objeto.');
  }
  const allowed = new Set(['tone', 'targetDurationSeconds', 'sceneCount', 'planVersion', 'richnessProfile', 'structure']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) directorError('DIRECTOR_OPTION_INVALID', `El parámetro editorial «${key}» no está permitido.`);
  }
  const result = {};
  if (value.tone !== undefined) {
    if (typeof value.tone !== 'string' || !DIRECTOR_TONES.has(value.tone)) {
      directorError('DIRECTOR_OPTION_INVALID', 'El tono solicitado no es compatible.');
    }
    result.tone = value.tone;
  }
  if (value.targetDurationSeconds !== undefined) {
    result.targetDurationSeconds = integerOption(value.targetDurationSeconds, 30, 8, 90);
  }
  if (value.sceneCount !== undefined) {
    result.sceneCount = integerOption(value.sceneCount, 2, 1, value.planVersion === 2 ? 8 : 4);
  }
  if (value.planVersion !== undefined) result.planVersion = integerOption(value.planVersion, 2, 1, 2);
  if (value.richnessProfile !== undefined) {
    if (!['automatic', 'simple', 'varied', 'dynamic'].includes(value.richnessProfile)) directorError('DIRECTOR_OPTION_INVALID', 'El perfil de riqueza no es compatible.');
    result.richnessProfile = value.richnessProfile;
  }
  if (value.structure !== undefined) {
    if (!['automatic', 'narration', 'one-character', 'dialogue'].includes(value.structure)) directorError('DIRECTOR_OPTION_INVALID', 'La estructura solicitada no es compatible.');
    result.structure = value.structure;
  }
  return result;
}

function validatePrompt(value) {
  if (typeof value !== 'string') directorError('DIRECTOR_PROMPT_INVALID', 'El prompt debe ser texto.');
  const prompt = value.trim();
  if (prompt.length < 3 || prompt.length > MAX_PROMPT_LENGTH) {
    directorError('DIRECTOR_PROMPT_INVALID', `El prompt debe tener entre 3 y ${MAX_PROMPT_LENGTH} caracteres.`);
  }
  return prompt;
}

function numberOption(value, fallback, minimum, maximum) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    directorError('DIRECTOR_OPTION_INVALID', `La opción debe estar entre ${minimum} y ${maximum}.`);
  }
  return result;
}

function integerOption(value, fallback, minimum, maximum) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    directorError('DIRECTOR_OPTION_INVALID', `La opción debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return result;
}

function booleanOption(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') directorError('DIRECTOR_OPTION_INVALID', 'La opción debe ser verdadero o falso.');
  return value;
}

function seedFrom(hash) {
  return Number.parseInt(hash.slice(0, 8), 16) & 0x7fffffff;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function integerBudget(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 5_000 || result > 5_000_000) {
    directorError('DIRECTOR_OPTION_INVALID', 'El presupuesto OpenAI debe ser un entero entre 5000 y 5000000 tokens.');
  }
  return result;
}

function emitProgress(options, stage, detail = {}) {
  options.onProgress?.({ stage, ...detail });
}

function directorError(code, message, technicalDetail) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message,
    technicalDetail,
    suggestedAction: 'Revisá la configuración del Director IA y volvé a intentar.',
  });
}
