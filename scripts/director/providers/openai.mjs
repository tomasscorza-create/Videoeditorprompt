import { PipelineError } from '../../stage1/errors.mjs';
import { normalizeProviderUsage } from './usage.mjs';

export const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 400;

export function createOpenAIProvider(config = {}) {
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    providerError('OPENAI_FETCH_UNAVAILABLE', 'El runtime no ofrece un cliente HTTP para OpenAI.');
  }
  const apiKey = String(config.apiKey ?? process.env.OPENAI_API_KEY ?? '').trim();
  const baseUrl = DEFAULT_OPENAI_URL;

  function requireApiKey() {
    if (!apiKey) {
      providerError(
        'OPENAI_API_KEY_MISSING',
        'OpenAI no está configurado en este equipo.',
        'Definí OPENAI_API_KEY en el proceso que inicia el servicio local.',
      );
    }
  }

  async function generate({ messages, schema, options = {}, signal }) {
    requireApiKey();
    const startedAt = Date.now();
    const requestedModel = String(options.model || process.env.LOCAL_VIDEO_OPENAI_MODEL || DEFAULT_OPENAI_MODEL);
    const apiSchema = prepareJsonSchema(schema);
    const requestBody = {
      model: requestedModel,
      input: messages,
      store: false,
      max_output_tokens: options.maxOutputTokens,
      reasoning: { effort: options.think === true ? 'medium' : 'low' },
      text: {
        format: {
          type: 'json_schema',
          name: 'director_output',
          strict: supportsStrictJsonSchema(apiSchema),
          schema: apiSchema,
        },
      },
    };
    if (typeof options.promptCacheKey === 'string' && options.promptCacheKey.length > 0) {
      requestBody.prompt_cache_key = options.promptCacheKey.slice(0, 64);
    }
    const { data: response, attempts } = await requestJson(fetchImpl, `${baseUrl}/responses`, {
      apiKey,
      timeoutMs: options.timeoutMs ?? 240_000,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBaseMs: options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
      method: 'POST',
      body: JSON.stringify(requestBody),
      signal,
    });
    const content = extractOutputText(response);
    if (!content) {
      providerError(
        'OPENAI_RESPONSE_EMPTY',
        'OpenAI no devolvió una respuesta utilizable.',
        response?.status === 'incomplete' ? JSON.stringify(response.incomplete_details || {}) : undefined,
      );
    }
    return {
      content,
      usage: normalizeProviderUsage({
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: response.usage?.input_tokens_details?.cache_write_tokens
          ?? response.usage?.cache_write_tokens
          ?? 0,
        totalTokens: response.usage?.total_tokens ?? null,
        totalDurationNanoseconds: null,
        elapsedMilliseconds: Date.now() - startedAt,
        requestCount: 1,
        transportAttempts: attempts,
        retryCount: Math.max(0, attempts - 1),
      }),
    };
  }

  return {
    name: 'openai',
    defaultModel: process.env.LOCAL_VIDEO_OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    generatePlan: generate,
    generateCommands: generate,
    generateQuestions: generate,
    async inspect({ model, timeoutMs } = {}) {
      requireApiKey();
      const requestedModel = String(model || process.env.LOCAL_VIDEO_OPENAI_MODEL || DEFAULT_OPENAI_MODEL);
      const { data: result } = await requestJson(fetchImpl, `${baseUrl}/models/${encodeURIComponent(requestedModel)}`, {
        apiKey,
        timeoutMs: timeoutMs ?? 10_000,
        maxRetries: 1,
        retryBaseMs: DEFAULT_RETRY_BASE_MS,
      });
      return {
        available: true,
        version: null,
        model: requestedModel,
        modelInstalled: result?.id === requestedModel,
        digest: null,
      };
    },
  };
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  if (!Array.isArray(response?.output)) return '';
  for (const item of response.output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
      if (part?.type === 'refusal' && typeof part.refusal === 'string') {
        providerError('OPENAI_REFUSAL', 'OpenAI no pudo completar esta petición.', part.refusal);
      }
    }
  }
  return '';
}

async function requestJson(fetchImpl, url, options) {
  const startedAt = Date.now();
  const maximumRetries = boundedInteger(options.maxRetries, DEFAULT_MAX_RETRIES, 0, 5);
  const retryBaseMs = boundedInteger(options.retryBaseMs, DEFAULT_RETRY_BASE_MS, 50, 10_000);
  for (let attempt = 0; ; attempt += 1) {
    const elapsed = Date.now() - startedAt;
    const remainingMs = options.timeoutMs - elapsed;
    if (remainingMs <= 0) throw timeoutError();
    try {
      const data = await requestJsonAttempt(fetchImpl, url, { ...options, timeoutMs: remainingMs });
      return { data, attempts: attempt + 1 };
    } catch (error) {
      if (!isRetryable(error) || attempt >= maximumRetries) throw error;
      const retryAfterMs = Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : null;
      const exponentialMs = retryBaseMs * (2 ** attempt);
      const delayMs = Math.min(retryAfterMs ?? exponentialMs, Math.max(0, remainingMs - 1));
      await waitForRetry(delayMs, options.signal);
    }
  }
}

async function requestJsonAttempt(fetchImpl, url, options) {
  const controller = new AbortController();
  let abortReason = null;
  const abortFromCaller = () => {
    abortReason = 'caller';
    controller.abort();
  };
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    abortReason = 'timeout';
    controller.abort();
  }, options.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: options.method || 'GET',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: options.body,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed?.error?.message === 'string') detail += `: ${parsed.error.message.slice(0, 800)}`;
      } catch {}
      const error = new PipelineError({
        code: response.status === 401
          ? 'OPENAI_AUTH_INVALID'
          : response.status === 429 ? 'OPENAI_RATE_LIMITED' : 'OPENAI_REQUEST_FAILED',
        stage: 'directing',
        message: response.status === 401
          ? 'OpenAI rechazó la credencial configurada.'
          : response.status === 429 ? 'OpenAI alcanzó un límite de uso temporal.' : 'OpenAI rechazó la solicitud del Director.',
        technicalDetail: detail,
        suggestedAction: response.status === 401
          ? 'Configurá una clave nueva y reiniciá el servicio local.'
          : response.status === 429 ? 'Revisá el límite de uso y volvé a intentar más tarde.' : 'Revisá la configuración de OpenAI y volvé a intentar.',
      });
      error.httpStatus = response.status;
      error.retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
      throw error;
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new PipelineError({
        code: 'OPENAI_HTTP_JSON_INVALID',
        stage: 'directing',
        message: 'OpenAI devolvió una respuesta HTTP inválida.',
        technicalDetail: error instanceof Error ? error.message : String(error),
        suggestedAction: 'Volvé a intentar. Si continúa, revisá el estado del servicio de OpenAI.',
      });
    }
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    const aborted = error?.name === 'AbortError';
    const cancelled = aborted && abortReason === 'caller';
    const timedOut = aborted && !cancelled;
    const wrapped = new PipelineError({
      code: cancelled ? 'OPENAI_CANCELLED' : timedOut ? 'OPENAI_TIMEOUT' : 'OPENAI_UNAVAILABLE',
      stage: 'directing',
      message: cancelled
        ? 'La operación del Director fue cancelada.'
        : timedOut ? 'OpenAI agotó el tiempo permitido.' : 'No se pudo conectar con OpenAI.',
      cause: error,
      suggestedAction: cancelled
        ? 'Podés modificar la petición y volver a intentarlo.'
        : timedOut ? 'Probá una sola propuesta o volvé a intentar.' : 'Comprobá la conexión a Internet y volvé a intentar.',
    });
    wrapped.retryable = !cancelled && !timedOut;
    throw wrapped;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

function supportsStrictJsonSchema(value) {
  if (!value || typeof value !== 'object') return true;
  if (value.type === 'object' || value.properties) {
    if (value.additionalProperties !== false) return false;
    const propertyKeys = Object.keys(value.properties || {});
    const required = new Set(value.required || []);
    if (propertyKeys.some((key) => !required.has(key))) return false;
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      if (child.some((entry) => !supportsStrictJsonSchema(entry))) return false;
    } else if (child && typeof child === 'object' && !supportsStrictJsonSchema(child)) return false;
  }
  return true;
}

function prepareJsonSchema(value) {
  if (Array.isArray(value)) return value.map(prepareJsonSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['$schema', '$id'].includes(key))
    .map(([key, child]) => [key, prepareJsonSchema(child)]));
}

function isRetryable(error) {
  if (error?.retryable === true) return true;
  return [408, 409, 429].includes(error?.httpStatus) || error?.httpStatus >= 500;
}

function parseRetryAfter(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function waitForRetry(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(done, milliseconds);
    signal?.addEventListener('abort', cancelled, { once: true });
    function done() {
      signal?.removeEventListener('abort', cancelled);
      resolve();
    }
    function cancelled() {
      clearTimeout(timeout);
      reject(cancelledError());
    }
  });
}

function cancelledError() {
  return new PipelineError({
    code: 'OPENAI_CANCELLED',
    stage: 'directing',
    message: 'La operación del Director fue cancelada.',
    suggestedAction: 'Podés modificar la petición y volver a intentarlo.',
  });
}

function timeoutError() {
  return new PipelineError({
    code: 'OPENAI_TIMEOUT',
    stage: 'directing',
    message: 'OpenAI agotó el tiempo permitido.',
    suggestedAction: 'Probá una sola propuesta o volvé a intentar.',
  });
}

function boundedInteger(value, fallback, minimum, maximum) {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    providerError('OPENAI_OPTION_INVALID', `La opción debe ser un entero entre ${minimum} y ${maximum}.`);
  }
  return resolved;
}

function providerError(code, message, technicalDetail) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message,
    technicalDetail,
    suggestedAction: code === 'OPENAI_API_KEY_MISSING'
      ? 'Definí OPENAI_API_KEY y reiniciá el servicio local.'
      : 'Revisá la configuración de OpenAI y volvé a intentar.',
  });
}
