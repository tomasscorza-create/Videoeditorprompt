import { createOllamaProvider } from './providers/ollama.mjs';
import { createOpenAIProvider } from './providers/openai.mjs';
import { assertDirectorProviderContract } from './providers/contract.mjs';
import assert from 'node:assert/strict';

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

const ollama = await assertDirectorProviderContract({ makeProvider, schema });

function makeOpenAIFetch(behavior) {
  return async (url, options = {}) => {
    if (behavior === 'error') return jsonResponse({ error: { message: 'boom' } }, 500);
    if (behavior === 'abort') {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true },
        );
      });
    }
    if (url.includes('/models/')) return jsonResponse({ id: 'gpt-5.6-luna' });
    const body = JSON.parse(options.body);
    if (options.headers.authorization !== 'Bearer test-key') throw new Error('falta autenticación Bearer');
    if (body.text?.format?.type !== 'json_schema') throw new Error('falta Structured Output');
    return jsonResponse({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(validSample) }] }],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    });
  };
}

const makeOpenAIProvider = (behavior) => createOpenAIProvider({
  apiKey: 'test-key',
  fetchImpl: makeOpenAIFetch(behavior),
});
const openai = await assertDirectorProviderContract({
  makeProvider: makeOpenAIProvider,
  schema,
  expectedCancelledCode: 'OPENAI_CANCELLED',
  expectedDigest: null,
  model: 'gpt-5.6-luna',
});

let retryCalls = 0;
let retriedBody;
const retryProvider = createOpenAIProvider({
  apiKey: 'test-key',
  fetchImpl: async (_url, options = {}) => {
    retryCalls += 1;
    retriedBody = JSON.parse(options.body);
    if (retryCalls === 1) return jsonResponse({ error: { message: 'temporal' } }, 429);
    return jsonResponse({
      output_text: JSON.stringify(validSample),
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
      },
    });
  },
});
const retried = await retryProvider.generatePlan({
  schema,
  messages: [{ role: 'user', content: 'prueba' }],
  options: {
    model: 'gpt-5.6-luna', maxOutputTokens: 128, timeoutMs: 5_000,
    maxRetries: 2, retryBaseMs: 50, promptCacheKey: 'director-test-cache',
  },
});
assert.equal(retryCalls, 2);
assert.equal(retriedBody.prompt_cache_key, 'director-test-cache');
assert.equal(retriedBody.text.format.strict, true);
assert.equal(retriedBody.text.format.schema.properties.ok.type, 'boolean');
assert.equal(retried.usage.inputTokens, 100);
assert.equal(retried.usage.outputTokens, 20);
assert.equal(retried.usage.cachedInputTokens, 40);
assert.equal(retried.usage.cacheWriteTokens, 10);
assert.equal(retried.usage.retryCount, 1);

let forbiddenFetches = 0;
const lockedProvider = createOpenAIProvider({
  apiKey: 'test-key',
  fetchImpl: async () => { forbiddenFetches += 1; return jsonResponse({}); },
});
await assert.rejects(
  () => lockedProvider.generatePlan({ schema, messages: [], options: { model: 'modelo-no-permitido', maxOutputTokens: 1 } }),
  (error) => error.code === 'OPENAI_MODEL_NOT_ALLOWED',
);
assert.equal(forbiddenFetches, 0);

const checks = ollama.checks + openai.checks + 11;

process.stdout.write(`${JSON.stringify({ version: 1, passed: checks, failed: 0 })}\n`);
