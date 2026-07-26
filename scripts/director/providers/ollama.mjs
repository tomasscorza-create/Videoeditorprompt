import { PipelineError } from '../../stage1/errors.mjs';

// Toda la especificidad de Ollama vive acá (D1): forma de la petición
// (format/think/keep_alive/seed/num_predict), parsing de message.content,
// /api/version + /api/tags, y la guarda de loopback. El resto del pipeline
// (schema, prompts, caché, normalización, validación) es agnóstico al proveedor.

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_DIRECTOR_MODEL = 'qwen3:8b';
export const DEFAULT_OLLAMA_KEEP_ALIVE = '10m';

export function createOllamaProvider(config = {}) {
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    providerError('OLLAMA_FETCH_UNAVAILABLE', 'El runtime no ofrece un cliente HTTP para Ollama.');
  }
  const baseUrl = normalizeLoopbackUrl(config.baseUrl || DEFAULT_OLLAMA_URL);
  const keepAlive = normalizeKeepAlive(
    config.keepAlive ?? process.env.LOCAL_VIDEO_OLLAMA_KEEP_ALIVE ?? DEFAULT_OLLAMA_KEEP_ALIVE,
  );

  async function chat({ messages, schema, options = {}, signal }) {
    const response = await requestJson(fetchImpl, `${baseUrl}/api/chat`, {
      timeoutMs: options.timeoutMs ?? 240_000,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: String(options.model || DEFAULT_DIRECTOR_MODEL),
        stream: false,
        think: options.think === true,
        keep_alive: keepAlive,
        format: schema,
        messages,
        options: {
          temperature: options.temperature,
          seed: options.seed,
          num_predict: options.maxOutputTokens,
        },
      }),
      errorCode: 'OLLAMA_DIRECTOR_REQUEST_FAILED',
      signal,
    });
    const content = response?.message?.content;
    return {
      content: typeof content === 'string' ? content : '',
      usage: {
        promptEvalCount: response.prompt_eval_count ?? null,
        evalCount: response.eval_count ?? null,
        totalDurationNanoseconds: response.total_duration ?? null,
      },
    };
  }

  return {
    name: 'ollama',
    generatePlan: chat,
    generateCommands: chat,
    async inspect({ model, timeoutMs } = {}) {
      const requestedModel = String(model || DEFAULT_DIRECTOR_MODEL);
      const [version, tags] = await Promise.all([
        requestJson(fetchImpl, `${baseUrl}/api/version`, { timeoutMs: timeoutMs ?? 5000, errorCode: 'OLLAMA_UNAVAILABLE' }),
        requestJson(fetchImpl, `${baseUrl}/api/tags`, { timeoutMs: timeoutMs ?? 5000, errorCode: 'OLLAMA_UNAVAILABLE' }),
      ]);
      return {
        available: true,
        version: version.version || null,
        model: requestedModel,
        modelInstalled: Array.isArray(tags.models) && tags.models.some((entry) => entry.name === requestedModel || entry.model === requestedModel),
      };
    },
  };
}

function normalizeKeepAlive(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*(?:ms|s|m|h))$/u.test(value)) return value;
  providerError(
    'OLLAMA_KEEP_ALIVE_INVALID',
    'La retención del modelo de Ollama debe ser 0 o una duración como 30s, 10m o 1h.',
  );
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

function normalizeLoopbackUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    providerError('OLLAMA_URL_INVALID', 'La URL de Ollama no es válida.');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    providerError('OLLAMA_URL_INVALID', 'Ollama debe ejecutarse mediante HTTP en la máquina local.');
  }
  return url.origin;
}

function providerError(code, message, technicalDetail) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message,
    technicalDetail,
    suggestedAction: 'Revisá la configuración del proveedor de IA local y volvé a intentar.',
  });
}
