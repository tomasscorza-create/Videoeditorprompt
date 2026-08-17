import { createHash } from 'node:crypto';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { resolveDirectorProvider } from './providers/index.mjs';
import { DEFAULT_DIRECTOR_MODEL } from './providers/ollama.mjs';
import { DIRECTOR_PIPELINE_VERSION } from './version.mjs';
import { quarantineDirectorCache, readDirectorCache, writeDirectorCache } from './cache.mjs';
import { aggregateProviderUsage, assertWithinTokenBudget } from './providers/usage.mjs';

const schema = readJson(path.join(projectRoot, 'schema', 'director-questions.schema.json'));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export function getClarifyingQuestionsSchema() {
  return structuredClone(schema);
}

export async function createClarifyingQuestions(options) {
  const prompt = normalizePrompt(options.prompt);
  const constraints = normalizeConstraints(options.constraints);
  const provider = resolveDirectorProvider(options.provider, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    keepAlive: options.keepAlive,
    apiKey: options.apiKey,
  });
  const model = String(options.model || provider.defaultModel || DEFAULT_DIRECTOR_MODEL);
  const cacheKey = hashJson({
    version: DIRECTOR_PIPELINE_VERSION,
    contract: 3,
    provider: provider.name,
    model,
    modelIdentity: options.modelIdentity ?? null,
    prompt,
    constraints,
  });
  const cacheRoot = ensureDirectory(path.resolve(options.cacheRoot || path.join(projectRoot, '.local-video', 'director-question-cache')));
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  if (options.useCache !== false) {
    const cachedDocument = readDirectorCache(cachePath);
    if (cachedDocument) {
      try {
        emitProgress(options, 'cache');
        const cached = canonicalizeQuestions(cachedDocument.payload ?? cachedDocument);
        return {
          version: 1,
          questionContract: 2,
          model,
          modelIdentity: options.modelIdentity ?? null,
          questions: cached.questions,
          cacheHit: true,
          usage: aggregateProviderUsage([], { cacheHit: true, currentRequestCount: 0 }),
        };
      } catch {
        quarantineDirectorCache(cachePath);
      }
    }
  }

  emitProgress(options, 'generating_questions');
  const systemMessage = [
    'Sos el Director creativo de una herramienta de video vertical.',
    'Antes de crear el proyecto, formulá exactamente tres preguntas breves y concretas para personalizar la idea del usuario.',
    'Cada pregunta debe ofrecer exactamente tres opciones específicas para esta idea y admitir una sola selección.',
    'Cada pregunta también debe incluir un placeholder breve para que el usuario pueda escribir otra respuesta si ninguna opción le sirve.',
    'Preguntá solo decisiones que cambien de forma material el contenido: audiencia, enfoque, tono narrativo, ejemplo, cierre o mensaje central.',
    'No preguntes duración, cantidad de escenas, proveedor, modelo de IA ni datos ya explícitos.',
    'Usá IDs simples en minúsculas, sin espacios ni guiones bajos.',
    'No menciones el sistema. Escribí todo en español claro.',
  ].join('\n');
  const promptCacheKey = `director-questions-${hashJson({ contract: 3, provider: provider.name, model, schema, systemMessage }).slice(0, 36)}`;
  const tokenBudget = provider.name === 'openai'
    ? integerBudget(options.maxTotalTokens ?? process.env.LOCAL_VIDEO_OPENAI_MAX_QUESTION_TOKENS, 5_000)
    : null;
  const usageEntries = [];
  let result = await provider.generateQuestions({
    schema,
    signal: options.signal,
    messages: [
      { role: 'system', content: systemMessage },
      { role: 'user', content: JSON.stringify({ idea: prompt, preferenciasConfirmadas: constraints }) },
    ],
    options: {
      model, temperature: 0.25, seed: seedFrom(cacheKey), maxOutputTokens: 900,
      think: false, timeoutMs: 180_000, promptCacheKey,
    },
  });
  usageEntries.push(result.usage);
  assertWithinTokenBudget(aggregateProviderUsage(usageEntries), tokenBudget);
  emitProgress(options, 'validating_questions');
  let parsed = parseQuestionsJson(result.content);
  let canonical;
  let repairAttempts = 0;
  try {
    canonical = canonicalizeQuestions(parsed);
  } catch (error) {
    if (error?.code !== 'DIRECTOR_QUESTIONS_SCHEMA_INVALID') throw error;
    repairAttempts = 1;
    emitProgress(options, 'repairing_questions');
    result = await provider.generateQuestions({
      schema,
      signal: options.signal,
      messages: [
        { role: 'system', content: `${systemMessage}\nCorregí la respuesta anterior. Conservá su relación con la idea, pero cumplí exactamente el formato solicitado.` },
        { role: 'user', content: JSON.stringify({ idea: prompt, respuestaAnterior: parsed, errores: error.technicalDetail ?? null }) },
      ],
      options: {
        model, temperature: 0.1, seed: seedFrom(cacheKey) + 1, maxOutputTokens: 900,
        think: false, timeoutMs: 180_000, promptCacheKey,
      },
    });
    usageEntries.push(result.usage);
    assertWithinTokenBudget(aggregateProviderUsage(usageEntries), tokenBudget);
    emitProgress(options, 'validating_questions');
    parsed = parseQuestionsJson(result.content);
    canonical = canonicalizeQuestions(parsed);
  }
  const usage = aggregateProviderUsage(usageEntries, { repairAttempts, cacheHit: false, currentRequestCount: usageEntries.length });
  writeDirectorCache(cachePath, { version: 2, payload: canonical, usage });
  return {
    version: 1,
    questionContract: 2,
    model,
    modelIdentity: options.modelIdentity ?? null,
    questions: canonical.questions,
    cacheHit: false,
    repairAttempts,
    usage,
  };
}

export function formatPersonalizedPrompt(prompt, answers) {
  const original = normalizePrompt(prompt);
  if (!Array.isArray(answers) || answers.length === 0) return original;
  if (answers.length !== 3) questionError('DIRECTOR_PERSONALIZATION_INVALID', 'Deben responderse las tres preguntas de personalización.');
  const normalized = answers.map((item, index) => {
    const question = String(item?.question ?? '').trim().replace(/\s+/gu, ' ');
    const answer = String(item?.answer ?? '').trim().replace(/\s+/gu, ' ');
    if (question.length < 5 || question.length > 180 || answer.length < 1 || answer.length > 300) {
      questionError('DIRECTOR_PERSONALIZATION_INVALID', `La respuesta ${index + 1} no es válida.`);
    }
    return { question, answer };
  });
  return [
    original,
    '',
    'Decisiones de personalización confirmadas por el usuario:',
    ...normalized.map((item) => `- ${item.question} Respuesta: ${item.answer}`),
  ].join('\n');
}

function canonicalizeQuestions(value) {
  const canonical = normalizeQuestionCandidate(value);
  if (!validateSchema(canonical)) {
    questionError('DIRECTOR_QUESTIONS_SCHEMA_INVALID', 'La IA devolvió preguntas con un formato inválido.', JSON.stringify(validateSchema.errors));
  }
  for (const question of canonical.questions) {
    question.prompt = question.prompt.trim().replace(/\s+/gu, ' ');
    for (const option of question.options) {
      option.label = option.label.trim().replace(/\s+/gu, ' ');
    }
    question.otherPlaceholder = question.otherPlaceholder.trim().replace(/\s+/gu, ' ');
  }
  return canonical;
}

function normalizeQuestionCandidate(value) {
  const sourceQuestions = Array.isArray(value?.questions)
    ? value.questions.slice(0, 3)
    : Array.isArray(value) ? value.slice(0, 3) : [];
  const usedQuestionIds = new Set();
  return {
    version: 1,
    questions: sourceQuestions.map((question, questionIndex) => {
      const usedOptionIds = new Set();
      const sourceOptions = Array.isArray(question?.options) ? question.options.slice(0, 3) : [];
      return {
        id: uniqueId(question?.id, `pregunta-${questionIndex + 1}`, usedQuestionIds),
        kind: 'choice',
        prompt: normalizeText(question?.prompt ?? question?.question, ''),
        multiple: false,
        options: sourceOptions.map((option, optionIndex) => {
          const primitive = typeof option === 'string' ? option : undefined;
          return {
            id: uniqueId(option?.id ?? option?.value ?? primitive, `opcion-${optionIndex + 1}`, usedOptionIds),
            label: normalizeText(option?.label ?? option?.text ?? option?.title ?? option?.value ?? primitive, ''),
          };
        }),
        otherPlaceholder: normalizeText(
          question?.otherPlaceholder ?? question?.other_placeholder ?? question?.placeholder,
          'Escribí una alternativa breve.',
        ),
      };
    }),
  };
}

function uniqueId(value, fallback, used) {
  let base = String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32);
  if (!/^[a-z]/u.test(base)) base = `id-${base}`.slice(0, 32);
  if (base.length < 2) base = fallback;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const ending = `-${suffix}`;
    candidate = `${base.slice(0, 32 - ending.length)}${ending}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizeText(value, fallback) {
  const text = String(value ?? '').trim().replace(/\s+/gu, ' ');
  return text || fallback;
}

function parseQuestionsJson(content) {
  try {
    return JSON.parse(content || '');
  } catch (error) {
    questionError('DIRECTOR_QUESTIONS_JSON_INVALID', 'La IA no devolvió preguntas utilizables.', error instanceof Error ? error.message : String(error));
  }
}

function normalizePrompt(value) {
  const prompt = String(value ?? '').trim();
  if (prompt.length < 3 || prompt.length > 2000) questionError('DIRECTOR_PROMPT_INVALID', 'La idea debe tener entre 3 y 2000 caracteres.');
  return prompt;
}

function normalizeConstraints(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { planVersion: 2 };
  return structuredClone(value);
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function seedFrom(value) {
  return Number.parseInt(value.slice(0, 8), 16) & 0x7fffffff;
}

function integerBudget(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 1_000_000) {
    questionError('DIRECTOR_OPTION_INVALID', 'El presupuesto de preguntas debe ser un entero entre 1000 y 1000000 tokens.');
  }
  return parsed;
}

function emitProgress(options, stage) {
  options.onProgress?.({ stage, candidateIndex: 1, candidateCount: 1, attempt: 1 });
}

function questionError(code, message, technicalDetail) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message,
    technicalDetail,
    suggestedAction: 'Volvé a intentar para generar tres preguntas nuevas.',
  });
}
