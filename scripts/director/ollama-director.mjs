import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PipelineError } from '../stage1/errors.mjs';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  getDirectorPlanSchema,
  loadAuthoringCatalog,
  normalizeDirectorPlan,
} from './director-plan.mjs';
import { DIRECTOR_PIPELINE_VERSION } from './version.mjs';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_DIRECTOR_MODEL = 'qwen3:8b';
const MAX_PROMPT_LENGTH = 2000;
const DIRECTOR_TONES = new Set(['educational', 'ironic', 'serious', 'energetic', 'inspirational']);

export async function createDirectorProposal(options) {
  const prompt = validatePrompt(options.prompt);
  const assetsRoot = path.resolve(options.assetsRoot || path.join(projectRoot, 'public'));
  const catalog = options.catalog || loadAuthoringCatalog(assetsRoot);
  const model = String(options.model || DEFAULT_DIRECTOR_MODEL);
  const baseUrl = normalizeLoopbackUrl(options.baseUrl || DEFAULT_OLLAMA_URL);
  const temperature = numberOption(options.temperature, 0.35, 0, 1);
  const variant = integerOption(options.variant, 0, 0, 1_000_000);
  const constraints = validateDirectorConstraints(options.constraints);
  const schema = buildOllamaPlanSchema(catalog, constraints);
  const cacheKey = hashJson({
    version: DIRECTOR_PIPELINE_VERSION,
    prompt,
    model,
    temperature,
    variant,
    constraints,
    catalog: hashJson(catalog),
    schema: hashJson(schema),
  });
  const cacheRoot = ensureDirectory(path.resolve(options.cacheRoot || path.join(projectRoot, '.local-video', 'director-cache')));
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  if (options.useCache !== false && existsSync(cachePath)) {
    const cached = readJson(cachePath);
    const normalized = normalizeDirectorPlan(cached.plan, catalog, { assetsRoot, promptHash: cacheKey });
    return {
      ...cached,
      project: normalized.project,
      semanticHash: normalized.semanticHash,
      cacheKey,
      cacheHit: true,
      cachePath,
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') directorError('OLLAMA_FETCH_UNAVAILABLE', 'El runtime no ofrece un cliente HTTP para Ollama.');
  const timeoutMs = integerOption(options.timeoutMs, 240_000, 1_000, 300_000);
  const response = await requestOllama({
    fetchImpl,
    baseUrl,
    timeoutMs,
    signal: options.signal,
    body: {
      model,
      stream: false,
      think: false,
      keep_alive: 0,
      format: schema,
      messages: [
        { role: 'system', content: buildSystemPrompt(catalog) },
        { role: 'user', content: buildUserPrompt(prompt, variant, constraints) },
      ],
      options: {
        temperature,
        seed: seedFrom(cacheKey),
        num_predict: 4000,
      },
    },
  });
  const content = response?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    directorError('OLLAMA_RESPONSE_EMPTY', 'Ollama no devolvió un plan utilizable.');
  }
  let plan;
  try {
    plan = JSON.parse(content);
  } catch (error) {
    throw new PipelineError({
      code: 'OLLAMA_RESPONSE_JSON_INVALID',
      stage: 'directing',
      message: 'Ollama devolvió contenido que no es JSON válido.',
      technicalDetail: error instanceof Error ? error.message : String(error),
      suggestedAction: 'Reintentá la propuesta o verificá el soporte de salidas estructuradas del modelo.',
    });
  }
  const normalized = normalizeDirectorPlan(plan, catalog, { assetsRoot, promptHash: cacheKey });
  const cached = {
    version: 1,
    directorVersion: DIRECTOR_PIPELINE_VERSION,
    model,
    plan,
    project: normalized.project,
    semanticHash: normalized.semanticHash,
    budget: normalized.budget,
    usage: {
      promptEvalCount: response.prompt_eval_count ?? null,
      evalCount: response.eval_count ?? null,
      totalDurationNanoseconds: response.total_duration ?? null,
    },
  };
  writeJson(cachePath, cached);
  return { ...cached, cacheKey, cacheHit: false, cachePath };
}

export async function inspectOllama(options = {}) {
  const baseUrl = normalizeLoopbackUrl(options.baseUrl || DEFAULT_OLLAMA_URL);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = integerOption(options.timeoutMs, 5000, 500, 30_000);
  const [version, tags] = await Promise.all([
    requestJson(fetchImpl, `${baseUrl}/api/version`, { timeoutMs, errorCode: 'OLLAMA_UNAVAILABLE' }),
    requestJson(fetchImpl, `${baseUrl}/api/tags`, { timeoutMs, errorCode: 'OLLAMA_UNAVAILABLE' }),
  ]);
  const model = String(options.model || DEFAULT_DIRECTOR_MODEL);
  return {
    available: true,
    version: version.version || null,
    model,
    modelInstalled: Array.isArray(tags.models) && tags.models.some((entry) => entry.name === model || entry.model === model),
  };
}

export function buildOllamaPlanSchema(catalog, constraints = {}) {
  const schema = getDirectorPlanSchema();
  const characters = catalog.entries.filter((entry) => entry.type === 'character').map((entry) => entry.id);
  const voices = catalog.entries.filter((entry) => entry.type === 'voice').map((entry) => entry.id);
  const backgrounds = catalog.entries.filter((entry) => entry.type === 'background').map((entry) => entry.id);
  if (characters.length < 2 || voices.length < 2 || backgrounds.length < 1) {
    directorError('DIRECTOR_CATALOG_INSUFFICIENT', 'El catálogo no tiene recursos suficientes para dirigir un video.');
  }
  schema.$defs.castMember.properties.characterResourceId = { type: 'string', enum: characters };
  schema.$defs.castMember.properties.voiceId = { type: 'string', enum: voices };
  schema.$defs.scene.properties.backgroundResourceId = { type: 'string', enum: backgrounds };
  const cameraPresets = [...new Set(catalog.entries
    .filter((entry) => entry.type === 'background')
    .flatMap((entry) => entry.capabilities.cameraPresets))]
    .filter((preset) => preset !== 'static');
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

async function requestOllama({ fetchImpl, baseUrl, timeoutMs, body, signal }) {
  return requestJson(fetchImpl, `${baseUrl}/api/chat`, {
    timeoutMs,
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    errorCode: 'OLLAMA_DIRECTOR_REQUEST_FAILED',
    signal,
  });
}

async function requestJson(fetchImpl, url, options) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new PipelineError({
        code: options.errorCode,
        stage: 'directing',
        message: 'Ollama rechazó la solicitud del Director IA.',
        technicalDetail: `HTTP ${response.status}: ${text.slice(0, 1000)}`,
        suggestedAction: 'Verificá que Ollama esté iniciado y que qwen3:8b esté instalado.',
      });
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new PipelineError({
        code: 'OLLAMA_HTTP_JSON_INVALID',
        stage: 'directing',
        message: 'Ollama devolvió una respuesta HTTP inválida.',
        technicalDetail: error instanceof Error ? error.message : String(error),
        suggestedAction: 'Reiniciá Ollama y volvé a intentar.',
      });
    }
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    const timedOut = error?.name === 'AbortError';
    throw new PipelineError({
      code: timedOut ? 'OLLAMA_TIMEOUT' : options.errorCode,
      stage: 'directing',
      message: timedOut ? 'Ollama agotó el tiempo permitido.' : 'No se pudo conectar con Ollama.',
      cause: error,
      suggestedAction: 'Iniciá Ollama, verificá qwen3:8b y volvé a intentar.',
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

function buildSystemPrompt(catalog) {
  const entries = catalog.entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    label: entry.label,
    capabilities: entry.capabilities || null,
  }));
  return [
    'Sos el Director IA de una herramienta local de videos animados verticales.',
    'Transformá la idea del usuario en un plan breve, claro, entretenido y renderizable.',
    'Cumplí exactamente el JSON Schema solicitado.',
    'Usá solamente IDs presentes en el catálogo.',
    'Cada escena debe tener de 2 a 6 turnos e incluir a ambos personajes.',
    'Escribí español natural para voz, sin markdown, acotaciones, emojis ni instrucciones técnicas.',
    'La duración es un objetivo editorial: mantené el guion conciso.',
    'No generes rutas, código, comandos, frames, tiempos absolutos ni propiedades adicionales.',
    `Catálogo permitido: ${JSON.stringify(entries)}`,
  ].join('\n');
}

function buildUserPrompt(prompt, variant, constraints) {
  const requested = [
    constraints.tone ? `tono=${constraints.tone}` : null,
    constraints.targetDurationSeconds ? `duración objetivo=${constraints.targetDurationSeconds} segundos` : null,
    constraints.sceneCount ? `escenas=${constraints.sceneCount}` : null,
  ].filter(Boolean).join(', ');
  return [
    `Idea del video: ${prompt}`,
    `Variante solicitada: ${variant}.`,
    requested ? `Parámetros editoriales obligatorios: ${requested}.` : null,
    'Creá un gancho claro, desarrollo breve y cierre útil o memorable.',
  ].filter(Boolean).join('\n');
}

function validateDirectorConstraints(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    directorError('DIRECTOR_OPTION_INVALID', 'Los parámetros editoriales deben ser un objeto.');
  }
  const allowed = new Set(['tone', 'targetDurationSeconds', 'sceneCount']);
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
    result.sceneCount = integerOption(value.sceneCount, 2, 1, 4);
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

function normalizeLoopbackUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    directorError('OLLAMA_URL_INVALID', 'La URL de Ollama no es válida.');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    directorError('OLLAMA_URL_INVALID', 'Ollama debe ejecutarse mediante HTTP en la máquina local.');
  }
  return url.origin;
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

function seedFrom(hash) {
  return Number.parseInt(hash.slice(0, 8), 16) & 0x7fffffff;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
