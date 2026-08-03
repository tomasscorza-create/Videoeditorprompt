import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PipelineError } from '../stage1/errors.mjs';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  getDirectorPlanSchema,
  listLayoutPresetIds,
  loadAuthoringCatalog,
  normalizeDirectorPlan,
} from './director-plan.mjs';
import { getDirectorPlanV2Schema, normalizeDirectorPlanV2 } from './director-plan-v2.mjs';
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

export { DEFAULT_DIRECTOR_MODEL, DEFAULT_OLLAMA_URL };
const MAX_PROMPT_LENGTH = 2000;
const MAX_REPAIR_ATTEMPTS = 2;
const DIRECTOR_TONES = new Set(['educational', 'ironic', 'serious', 'energetic', 'inspirational']);

export async function createDirectorProposal(options) {
  const prompt = validatePrompt(options.prompt);
  emitProgress(options, 'preparing_context');
  const assetsRoot = path.resolve(options.assetsRoot || path.join(projectRoot, 'public'));
  const catalog = options.catalog || loadAuthoringCatalog(assetsRoot);
  const model = String(options.model || DEFAULT_DIRECTOR_MODEL);
  const modelIdentity = normalizeModelIdentity(options.modelIdentity, model);
  // El proveedor concentra toda la especificidad de la IA (D1/D2). La clave de
  // caché incorpora su nombre para no mezclar resultados entre proveedores.
  const provider = resolveDirectorProvider(options.provider, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl || DEFAULT_OLLAMA_URL,
    keepAlive: options.keepAlive,
  });
  const temperature = numberOption(options.temperature, 0.35, 0, 1);
  const variant = integerOption(options.variant, 0, 0, 1_000_000);
  const bestOf = integerOption(options.bestOf, 1, 1, 3);
  if (variant + bestOf - 1 > 1_000_000) {
    directorError('DIRECTOR_OPTION_INVALID', 'La variante inicial no deja espacio para comparar la cantidad solicitada.');
  }
  // Modo «calidad máxima» (C3): con think:true qwen3 razona antes de responder
  // (mejor plan, más lento en CPU). Default false. Forma parte de la clave de caché.
  const think = booleanOption(options.think, false);
  const constraints = validateDirectorConstraints(options.constraints);
  const templates = options.templates || loadNarrativeTemplates(options.templatesPath);
  const directorContext = buildDirectorContext({
    prompt,
    constraints,
    catalog,
    templates,
    resourceLimits: options.resourceLimits,
    templateLimit: options.templateLimit,
  });
  const schema = buildOllamaPlanSchema(directorContext.catalog, constraints, directorContext.templates);
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
    catalog: hashJson(catalog),
    contextVersion: DIRECTOR_CONTEXT_VERSION,
    context: hashJson(directorContext.summary),
    templates: hashJson(templates),
    schema: hashJson(schema),
  });
  const cacheRoot = ensureDirectory(path.resolve(options.cacheRoot || path.join(projectRoot, '.local-video', 'director-cache')));
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  if (options.useCache !== false && existsSync(cachePath)) {
    emitProgress(options, 'cache');
    const cached = readJson(cachePath);
    const normalized = normalizeDirectorPlan(cached.plan, catalog, {
      assetsRoot,
      promptHash: cacheKey,
      resourceCatalog: options.resourceCatalog,
    });
    return {
      ...cached,
      project: normalized.project,
      semanticHash: normalized.semanticHash,
      repairAttempts: cached.repairAttempts ?? 0,
      selection: cached.selection ?? defaultSelection(),
      context: cached.context ?? directorContext.summary,
      cacheKey,
      cacheHit: true,
      cachePath,
    };
  }

  const timeoutMs = integerOption(options.timeoutMs, think ? 300_000 : 240_000, 1_000, 300_000);

  const generationStartedAt = Date.now();
  const candidates = [];
  const generationRuns = [];
  for (let candidateIndex = 0; candidateIndex < bestOf; candidateIndex += 1) {
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
    });
    candidates.push(candidate);
    generationRuns.push(candidate);
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
    });
    if (!judged.qualityFloorMet) {
      qualityEscalations += 1;
      emitProgress(options, 'repairing');
      const revisionIndex = judged.winnerIndex;
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
      });
      candidates[revisionIndex] = revisedCandidate;
      generationRuns.push(revisedCandidate);
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
      });
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
      usage: judged.usage,
    };
  }
  const selected = candidates[selection.winnerIndex];
  const repairAttempts = generationRuns.reduce((total, candidate) => total + candidate.repairAttempts, 0);

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
      think,
      generationCount: generationRuns.length,
      qualityEscalations,
      promptEvalCount: sumUsage(generationRuns, 'promptEvalCount'),
      evalCount: sumUsage(generationRuns, 'evalCount'),
      totalDurationNanoseconds: sumUsage(generationRuns, 'totalDurationNanoseconds'),
      elapsedMilliseconds: Date.now() - generationStartedAt,
      candidateElapsedMilliseconds: generationRuns.map((candidate) => candidate.elapsedMilliseconds),
    },
  };
  emitProgress(options, 'finalizing');
  writeJson(cachePath, cached);
  return { ...cached, cacheKey, cacheHit: false, cachePath };
}

export async function inspectOllama(options = {}) {
  const provider = resolveDirectorProvider(options.provider, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl || DEFAULT_OLLAMA_URL,
    keepAlive: options.keepAlive,
  });
  const timeoutMs = integerOption(options.timeoutMs, 5000, 500, 30_000);
  return provider.inspect({ model: options.model, timeoutMs });
}

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
}) {
  const startedAt = Date.now();
  let plan;
  let normalized;
  let usage = null;
  let repairAttempts = 0;
  let feedback = initialFeedback;
  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
    onProgress?.({
      stage: 'generating',
      candidateIndex,
      candidateCount,
      attempt: attempt + 1,
    });
    const result = await provider.generatePlan({
      schema,
      signal,
      messages: [
        { role: 'system', content: buildSystemPrompt(directorContext, constraints) },
        { role: 'user', content: buildUserPrompt(prompt, variant, constraints, strategy, feedback) },
      ],
      options: {
        model,
        temperature,
        think,
        seed: seedFrom(seedKey) + attempt,
        maxOutputTokens: 4000,
        timeoutMs,
      },
    });
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
      continue;
    }
    try {
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
      const quality = analyzePlanQuality(plan, { prompt, constraints });
      if (!quality.passed) qualityError(quality);
      usage = result.usage || null;
      break;
    } catch (error) {
      if (!isRepairableDirectorError(error) || attempt === MAX_REPAIR_ATTEMPTS) throw error;
      repairAttempts += 1;
      feedback = repairFeedback(error);
    }
  }
  const quality = analyzePlanQuality(plan, { prompt, constraints });
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
  if (plan.version === 2) quality.richness = analyzeCreativeRichness(plan, { ...context.constraints, prompt: context.prompt });
  return quality;
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
  const recipes = loadCreativeRecipeCatalog();
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
    '- educational: "Una planta no se marchita solo por falta de agua." → "Primero mirá luz, suelo y raíces; después regá."',
    '- ironic: "Dicen que la IA va a reemplazar a los programadores." → "Perfecto: ahora alguien debe explicarle por qué cayó producción."',
    '- ironic: "Compré una agenda para organizar cada minuto." → "Mañana anoto cuándo voy a empezar a usarla."',
    '- serious: "Una copia de seguridad que nunca probaste todavía no es una copia." → "Restaurarla hoy evita descubrir el fallo durante una emergencia."',
    '- serious: "Compartir un dato personal parece instantáneo; recuperarlo no." → "Antes de publicar, decidí si aceptarías que permanezca años."',
    '- energetic: "¡Treinta segundos alcanzan para destrabar tu mañana!" → "Elegí una tarea, cerrá distracciones y empezá ahora."',
    '- energetic: "¡Tu idea no necesita otra semana de espera!" → "Hacé una versión pequeña, probala y mejorala en movimiento."',
    '- inspirational: "Todo proyecto grande alguna vez fue una primera prueba imperfecta." → "Construí hoy el paso que mañana te permita continuar."',
    '- inspirational: "Compararte borra la distancia que ya recorriste." → "Medí tu avance contra tu punto de partida y seguí creciendo."',
    '',
    'REGLAS:',
    constraints.planVersion === 2 ? 'Usá estructura flexible por escena: voiceover, solo, dialogue o visual-with-voiceover. No agregues personajes si la idea funciona mejor narrada.' : null,
    constraints.planVersion === 2 ? 'Cada escena admite de cero a dos participantes y desde un turno. Elegí recetas, props, plantillas y secuencias solo por IDs permitidos.' : null,
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
    `Presupuesto editorial aproximado: máximo ${budgets.maximumWords} palabras; por escena ${budgets.scenes.map((scene) => `${scene.scene}:${scene.maximumWords}`).join(', ')}.`,
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
    DIRECTOR_CAST_INVALID: 'usá dos personajes y dos voces diferentes.',
    DIRECTOR_TRANSITION_INVALID: 'usá fundidos entre 0.15 y 1 segundo, o corte con duración cero.',
    DIRECTOR_GESTURE_TIMING_INVALID: 'ubicá gestureAtWord dentro de las palabras reales del turno.',
    DIRECTOR_SCENE_DIALOGUE_INVALID: 'incluí al menos un turno de cada personaje en cada escena.',
  };
  return messages[error?.code] || 'corregí el plan para que cumpla todas las restricciones indicadas.';
}

function isRepairableDirectorError(error) {
  return error instanceof PipelineError && new Set([
    'DIRECTOR_PLAN_SCHEMA_INVALID',
    'DIRECTOR_TEMPLATE_INVALID',
    'DIRECTOR_RESOURCE_INVALID',
    'DIRECTOR_RESOURCE_UNSUPPORTED',
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

function sumUsage(candidates, key) {
  const values = candidates.map((candidate) => candidate.usage?.[key]).filter(Number.isFinite);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
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
