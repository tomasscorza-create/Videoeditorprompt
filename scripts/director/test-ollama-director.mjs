import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDirectorProposal, inspectOllama } from './ollama-director.mjs';

const plan = {
  version: 1,
  title: 'Dos miradas sobre la inteligencia artificial',
  tone: 'educational',
  targetDurationSeconds: 20,
  cast: {
    a: { role: 'optimista', characterResourceId: 'mono-azul-v1', voiceId: 'voz-daniela-ar-v1', poseId: 'point', animationPreset: 'talk-calm' },
    b: { role: 'escéptico', characterResourceId: 'mono-ciruela-v1', voiceId: 'voz-davefx-es-v1', poseId: 'neutral', animationPreset: 'idle-calm' },
  },
  scenes: [{
    title: 'Debate',
    purpose: 'Contrastar dos posiciones y cerrar con una síntesis.',
    backgroundResourceId: 'fondo-estudio-parallax-v1',
    cameraPreset: 'slow-pan',
    layoutPreset: 'balanced',
    transitionPreset: 'cut',
    transitionDurationSeconds: 0,
    dialogue: [
      { speaker: 'a', text: 'La inteligencia artificial puede ayudarnos a trabajar con más rapidez.', gestureId: 'point', gapAfterSeconds: 0.2 },
      { speaker: 'b', text: 'Siempre que revisemos sus respuestas y mantengamos el criterio humano.', gestureId: 'neutral', gapAfterSeconds: 0 },
    ],
  }],
};

let chatRequests = 0;
const fakeFetch = async (url, options = {}) => {
  if (url.endsWith('/api/version')) return response({ version: 'test' });
  if (url.endsWith('/api/tags')) return response({ models: [{ name: 'qwen3:8b' }] });
  if (url.endsWith('/api/chat')) {
    chatRequests += 1;
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'qwen3:8b');
    assert.equal(request.stream, false);
    assert.equal(request.format.$defs.castMember.properties.characterResourceId.enum.length, 2);
    assert.ok(request.format.$defs.castMember.properties.poseId.enum.includes('point'));
    assert.ok(request.format.$defs.castMember.properties.animationPreset.enum.includes('talk-calm'));
    assert.equal(request.format.$defs.scene.properties.transitionDurationSeconds.maximum, 1);
    return response({
      message: { role: 'assistant', content: JSON.stringify(plan) },
      prompt_eval_count: 100,
      eval_count: 200,
      total_duration: 1_000_000,
    });
  }
  return response({ error: 'not found' }, 404);
};

const cacheRoot = mkdtempSync(path.join(os.tmpdir(), 'local-video-director-'));
const health = await inspectOllama({ fetchImpl: fakeFetch });
assert.equal(health.modelInstalled, true);
const first = await createDirectorProposal({
  prompt: 'Explicá de forma breve cómo colaborar con inteligencia artificial.',
  fetchImpl: fakeFetch,
  cacheRoot,
});
assert.equal(first.cacheHit, false);
assert.equal(first.project.scenes.length, 1);
const second = await createDirectorProposal({
  prompt: 'Explicá de forma breve cómo colaborar con inteligencia artificial.',
  fetchImpl: fakeFetch,
  cacheRoot,
});
assert.equal(second.cacheHit, true);
assert.equal(chatRequests, 1);
assert.deepEqual(first.project, second.project);

const constrainedPlan = structuredClone(plan);
constrainedPlan.tone = 'serious';
let constrainedRequest;
await createDirectorProposal({
  prompt: 'Explicá un riesgo técnico con una conclusión práctica.',
  constraints: { tone: 'serious', targetDurationSeconds: 20, sceneCount: 1 },
  fetchImpl: async (url, options = {}) => {
    if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
    constrainedRequest = JSON.parse(options.body);
    return response({ message: { content: JSON.stringify(constrainedPlan) } });
  },
  cacheRoot,
});
assert.equal(constrainedRequest.format.properties.tone.const, 'serious');
assert.equal(constrainedRequest.format.properties.targetDurationSeconds.const, 20);
assert.equal(constrainedRequest.format.properties.scenes.minItems, 1);
assert.equal(constrainedRequest.format.properties.scenes.maxItems, 1);

await assert.rejects(
  () => createDirectorProposal({ prompt: 'no', fetchImpl: fakeFetch, cacheRoot }),
  (error) => error.code === 'DIRECTOR_PROMPT_INVALID',
);
await assert.rejects(
  () => inspectOllama({ baseUrl: 'https://example.com', fetchImpl: fakeFetch }),
  (error) => error.code === 'OLLAMA_URL_INVALID',
);
await assert.rejects(
  () => createDirectorProposal({ prompt: 'Una idea válida', constraints: { sceneCount: 5 }, fetchImpl: fakeFetch, cacheRoot }),
  (error) => error.code === 'DIRECTOR_OPTION_INVALID',
);

process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: 20,
  failed: 0,
  cacheHit: second.cacheHit,
  projectId: first.project.id,
})}\n`);

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  };
}
