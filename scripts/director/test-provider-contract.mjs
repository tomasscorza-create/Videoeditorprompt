import { createOllamaProvider } from './providers/ollama.mjs';
import { assertDirectorProviderContract } from './providers/contract.mjs';

// Corre el contrato genérico de proveedor (D3) contra el proveedor Ollama con un
// transporte simulado. La misma suite servirá para validar un futuro proveedor web.
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { const: true } },
};
const validSample = { ok: true };

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) };
}

function makeFetch(behavior) {
  return async (url, options = {}) => {
    if (url.endsWith('/api/version')) return jsonResponse({ version: 'test' });
    if (url.endsWith('/api/tags')) return jsonResponse({ models: [{ name: 'modelo-x', digest: 'sha256:modelo-x' }] });
    if (behavior === 'error') return jsonResponse({ error: 'boom' }, 500);
    if (behavior === 'abort') {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true },
        );
      });
    }
    return jsonResponse({
      message: { content: JSON.stringify(validSample) },
      prompt_eval_count: 1,
      eval_count: 2,
      total_duration: 3,
    });
  };
}

const makeProvider = (behavior) => createOllamaProvider({ fetchImpl: makeFetch(behavior) });

const { checks } = await assertDirectorProviderContract({ makeProvider, schema });

process.stdout.write(`${JSON.stringify({ version: 1, passed: checks, failed: 0 })}\n`);
