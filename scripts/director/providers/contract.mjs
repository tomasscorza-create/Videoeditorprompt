import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { PipelineError } from '../../stage1/errors.mjs';

// Definición ejecutable del contrato DirectorProvider (D3). Cualquier proveedor
// nuevo debe pasar esta suite. `makeProvider(behavior)` construye el proveedor con
// un transporte simulado en uno de tres estados: 'ok', 'abort', 'error'. Así el
// contrato es agnóstico al transporte concreto (Ollama HTTP, API web, etc.).
//
// Garantías verificadas:
// - name: identificador de proveedor no vacío.
// - generatePlan / generateCommands: devuelven { content } string parseable como
//   JSON que cumple el schema pedido.
// - inspect(): responde { available, model, modelInstalled, version }.
// - respeta signal (abortable) propagando un PipelineError.
// - propaga fallos de transporte con la taxonomía PipelineError (stage 'directing').
//
// Lo que un proveedor NO puede asumir: determinismo por seed es opcional (se declara
// por proveedor); la caché aguas arriba mitiga el no-determinismo pero no lo exige.
export async function assertDirectorProviderContract({ makeProvider, schema }) {
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const baseCall = {
    schema,
    messages: [
      { role: 'system', content: 'Instrucción de sistema de prueba.' },
      { role: 'user', content: 'Pedido de prueba.' },
    ],
    options: { model: 'modelo-x', temperature: 0.1, seed: 1, maxOutputTokens: 128, think: false, timeoutMs: 5000 },
  };
  let checks = 0;

  const named = makeProvider('ok');
  assert.equal(typeof named.name, 'string');
  assert.ok(named.name.length > 0, 'el proveedor debe declarar un name no vacío');
  checks += 1;

  for (const operation of ['generatePlan', 'generateCommands']) {
    const provider = makeProvider('ok');
    const result = await provider[operation]({ ...baseCall });
    assert.equal(typeof result.content, 'string', `${operation} debe devolver content string`);
    const parsed = JSON.parse(result.content);
    assert.ok(validate(parsed), `${operation} debe cumplir el schema pedido`);
    checks += 1;
  }

  const health = await makeProvider('ok').inspect({ model: 'modelo-x' });
  assert.equal(typeof health.available, 'boolean');
  assert.equal(typeof health.modelInstalled, 'boolean');
  assert.equal(health.model, 'modelo-x');
  assert.ok('version' in health, 'inspect() debe declarar version (puede ser null)');
  assert.equal(health.digest, 'sha256:modelo-x');
  checks += 1;

  const controller = new AbortController();
  const pending = makeProvider('abort').generatePlan({ ...baseCall, signal: controller.signal });
  controller.abort();
  await assert.rejects(
    () => pending,
    (error) => error instanceof PipelineError && error.code === 'OLLAMA_CANCELLED',
  );
  checks += 1;

  await assert.rejects(
    () => makeProvider('error').generatePlan({ ...baseCall }),
    (error) => error instanceof PipelineError && error.stage === 'directing',
  );
  checks += 1;

  return { checks };
}
