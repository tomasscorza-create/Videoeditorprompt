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
    a: { role: 'optimista', characterResourceId: 'mono-azul-v1', voiceId: 'voz-claude-mx-v1', poseId: 'neutral', animationPreset: 'talk-calm' },
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
  if (url.endsWith('/api/tags')) return response({ models: [{ name: 'qwen3:8b', digest: 'sha256:qwen3-test' }] });
  if (url.endsWith('/api/chat')) {
    chatRequests += 1;
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'qwen3:8b');
    assert.equal(request.stream, false);
    assert.equal(request.keep_alive, '10m');
    assert.equal(request.format.$defs.castMember.properties.characterResourceId.enum.length, 6);
    assert.equal(request.format.properties.narrativeTemplateId.enum.length, 3);
    assert.ok(request.format.required.includes('narrativeTemplateId'));
    assert.equal(request.format.$defs.castMember.properties.poseId.const, 'neutral');
    assert.ok(request.format.$defs.castMember.properties.animationPreset.enum.includes('talk-calm'));
    assert.equal(request.format.$defs.scene.properties.transitionDurationSeconds.maximum, 1);
    assert.ok(request.format.$defs.scene.properties.layoutPreset.enum.includes('stacked'));
    assert.ok(request.format.$defs.scene.properties.cameraPreset.enum.includes('static'));
    assert.ok(request.messages[0].content.includes('educational:'));
    assert.ok(request.messages[0].content.includes('inspirational:'));
    assert.ok(request.messages[0].content.includes('no empieces con «¿Sabías que…?»'));
    assert.ok(request.messages[0].content.includes('Plantillas narrativas candidatas:'));
    assert.ok(request.messages[0].content.includes('Shortlist de recursos permitidos:'));
    return response({
      message: { role: 'assistant', content: JSON.stringify(plan) },
      prompt_eval_count: 100,
      eval_count: 200,
      total_duration: 1_000_000,
    });
  }
  return response({ error: 'not found' }, 404);
};

const judgeScore = (value) => ({
  relevance: value,
  hook: value,
  naturalness: value,
  progression: value,
  ending: value,
  tone: value,
  tts: value,
  audiovisual: value,
});

const cacheRoot = mkdtempSync(path.join(os.tmpdir(), 'local-video-director-'));
const health = await inspectOllama({ fetchImpl: fakeFetch });
assert.equal(health.modelInstalled, true);
assert.equal(health.digest, 'sha256:qwen3-test');
const first = await createDirectorProposal({
  prompt: 'Explicá de forma breve cómo colaborar con inteligencia artificial.',
  fetchImpl: fakeFetch,
  cacheRoot,
});
assert.equal(first.cacheHit, false);
assert.equal(first.project.scenes.length, 1);
assert.equal(first.context.shortlistedEntries, 14);
assert.equal(first.context.totalCatalogEntries, 16);
assert.equal(first.context.templateIds.length, 3);
assert.ok(first.context.recommendedTemplateId);
assert.equal(first.context.selectedTemplateId, first.context.recommendedTemplateId);
assert.equal(first.plan.narrativeTemplateId, first.context.selectedTemplateId);
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
// D2: un proveedor no registrado da un error legible.
await assert.rejects(
  () => createDirectorProposal({ prompt: 'Una idea válida', provider: 'proveedor-x', fetchImpl: fakeFetch, cacheRoot }),
  (error) => error.code === 'DIRECTOR_PROVIDER_UNKNOWN',
);

// C3: modo think. Se propaga a la petición, entra en la clave de caché y aparece en usage.
let thinkRequest;
const thinkResult = await createDirectorProposal({
  prompt: 'Explicá con calma cómo colaborar con inteligencia artificial.',
  think: true,
  fetchImpl: async (url, options = {}) => {
    if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
    thinkRequest = JSON.parse(options.body);
    return response({ message: { content: JSON.stringify(plan) } });
  },
  cacheRoot, useCache: false,
});
assert.equal(thinkRequest.think, true);
assert.equal(thinkResult.usage.think, true);

const noThinkResult = await createDirectorProposal({
  prompt: 'Explicá con calma cómo colaborar con inteligencia artificial.',
  think: false,
  fetchImpl: async (url, options = {}) => (url.endsWith('/api/chat')
    ? response({ message: { content: JSON.stringify(plan) } })
    : fakeFetch(url, options)),
  cacheRoot, useCache: false,
});
assert.notEqual(thinkResult.cacheKey, noThinkResult.cacheKey);

const identityA = await createDirectorProposal({
  prompt: 'Explicá cómo identificar exactamente un modelo local.',
  modelIdentity: { digest: 'sha256:a', runtimeVersion: 'test' },
  fetchImpl: fakeFetch,
  cacheRoot,
  useCache: false,
});
const identityB = await createDirectorProposal({
  prompt: 'Explicá cómo identificar exactamente un modelo local.',
  modelIdentity: { digest: 'sha256:b', runtimeVersion: 'test' },
  fetchImpl: fakeFetch,
  cacheRoot,
  useCache: false,
});
assert.notEqual(identityA.cacheKey, identityB.cacheKey);

await assert.rejects(
  () => createDirectorProposal({ prompt: 'Idea válida', think: 'sí', fetchImpl: fakeFetch, cacheRoot }),
  (error) => error.code === 'DIRECTOR_OPTION_INVALID',
);

// Fase 1a: keep-alive configurable con un default que evita recargar el modelo.
let configuredKeepAlive;
await createDirectorProposal({
  prompt: 'Explicá por qué conviene reutilizar el modelo ya cargado.',
  keepAlive: '2m',
  fetchImpl: async (url, options = {}) => {
    if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
    configuredKeepAlive = JSON.parse(options.body).keep_alive;
    return response({ message: { content: JSON.stringify(plan) } });
  },
  cacheRoot,
  useCache: false,
});
assert.equal(configuredKeepAlive, '2m');
await assert.rejects(
  () => createDirectorProposal({
    prompt: 'Explicá una configuración inválida.',
    keepAlive: 'para siempre',
    fetchImpl: fakeFetch,
    cacheRoot,
  }),
  (error) => error.code === 'OLLAMA_KEEP_ALIVE_INVALID',
);

// Fase 1d: dos candidatos, juez estructurado y caché del ganador.
const alternativePlan = structuredClone(plan);
alternativePlan.title = 'Colaborar sin perder el criterio';
alternativePlan.scenes[0].dialogue[0].text = 'Una respuesta rápida no siempre es una respuesta correcta.';
alternativePlan.scenes[0].dialogue[1].text = 'Usá la velocidad de la herramienta y reservá el criterio para decidir.';
let bestOfCalls = 0;
const candidateVariants = [];
const bestOfFetch = async (url, options = {}) => {
  if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
  bestOfCalls += 1;
  const request = JSON.parse(options.body);
  if (request.format.properties?.winnerIndex) {
    assert.equal(request.think, false);
    const judgeRequest = JSON.parse(request.messages[1].content);
    const judgedCandidates = judgeRequest.candidates;
    assert.equal(judgedCandidates.length, 2);
    assert.ok(judgeRequest.request.idea.includes('colaborar'));
    assert.equal(judgeRequest.request.templates.length, 3);
    assert.equal('characterResourceId' in judgedCandidates[0], false);
    return response({
      message: {
        content: JSON.stringify({
          winnerIndex: 1,
          scores: [
            judgeScore(1),
            judgeScore(3),
          ],
        }),
      },
    });
  }
  candidateVariants.push(Number(/Variante solicitada: (\d+)/u.exec(request.messages[1].content)?.[1]));
  return response({
    message: {
      content: JSON.stringify(candidateVariants.length === 1 ? plan : alternativePlan),
    },
  });
};
const bestOfResult = await createDirectorProposal({
  prompt: 'Compará dos maneras de colaborar con inteligencia artificial.',
  variant: 10,
  bestOf: 2,
  think: true,
  fetchImpl: bestOfFetch,
  cacheRoot,
  useCache: false,
});
assert.equal(bestOfCalls, 3);
assert.deepEqual(candidateVariants, [10, 11]);
assert.equal(bestOfResult.plan.title, alternativePlan.title);
assert.equal(bestOfResult.selection.bestOf, 2);
assert.equal(bestOfResult.selection.winnerIndex, 1);
assert.equal(bestOfResult.selection.judgeVersion, 2);
assert.equal(bestOfResult.selection.scores[1].hook, 3);
assert.equal(bestOfResult.usage.generationCount, 2);

const cachedBestOf = await createDirectorProposal({
  prompt: 'Compará dos maneras de colaborar con inteligencia artificial.',
  variant: 10,
  bestOf: 2,
  think: true,
  fetchImpl: bestOfFetch,
  cacheRoot,
});
assert.equal(cachedBestOf.cacheHit, true);
assert.equal(bestOfCalls, 3);
assert.deepEqual(cachedBestOf.selection, bestOfResult.selection);

let escalationCalls = 0;
let judgeRounds = 0;
const escalationFetch = async (url, options = {}) => {
  if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
  escalationCalls += 1;
  const request = JSON.parse(options.body);
  if (request.format.properties?.winnerIndex) {
    judgeRounds += 1;
    return response({
      message: {
        content: JSON.stringify({
          winnerIndex: 0,
          scores: judgeRounds === 1
            ? [judgeScore(1), judgeScore(1)]
            : [judgeScore(3), judgeScore(1)],
        }),
      },
    });
  }
  return response({ message: { content: JSON.stringify(escalationCalls % 2 ? plan : alternativePlan) } });
};
const escalated = await createDirectorProposal({
  prompt: 'Explicá cómo colaborar con inteligencia artificial y conservar el criterio.',
  bestOf: 2,
  fetchImpl: escalationFetch,
  cacheRoot,
  useCache: false,
});
assert.equal(escalationCalls, 5);
assert.equal(escalated.usage.qualityEscalations, 1);
assert.equal(escalated.usage.generationCount, 3);
assert.equal(escalated.selection.qualityFloorMet, true);

await assert.rejects(
  () => createDirectorProposal({
    prompt: 'Compará demasiadas variantes.',
    bestOf: 4,
    fetchImpl: fakeFetch,
    cacheRoot,
  }),
  (error) => error.code === 'DIRECTOR_OPTION_INVALID',
);
await assert.rejects(
  () => createDirectorProposal({
    prompt: 'Compará variantes fuera del límite.',
    variant: 1_000_000,
    bestOf: 2,
    fetchImpl: fakeFetch,
    cacheRoot,
  }),
  (error) => error.code === 'DIRECTOR_OPTION_INVALID',
);

await assert.rejects(
  () => createDirectorProposal({
    prompt: 'Probá un juez que responde fuera del contrato.',
    bestOf: 2,
    fetchImpl: async (url, options = {}) => {
      if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
      const request = JSON.parse(options.body);
      return response({
        message: {
          content: request.format.properties?.winnerIndex
            ? JSON.stringify({ winnerIndex: 9, scores: [] })
            : JSON.stringify(plan),
        },
      });
    },
    cacheRoot,
    useCache: false,
  }),
  (error) => error.code === 'DIRECTOR_JUDGE_RESPONSE_INVALID',
);

// C1: bucle de reparación por presupuesto. overBudgetPlan excede el presupuesto
// de palabras para 8 s (máximo 40); el modelo lo corrige en el segundo intento.
const overBudgetPlan = structuredClone(plan);
overBudgetPlan.targetDurationSeconds = 8;
overBudgetPlan.scenes[0].dialogue[0].text = 'La inteligencia artificial hoy puede ayudarnos a redactar textos, resumir documentos, ordenar tareas, revisar código y también acompañar decisiones difíciles cuando revisamos con mucho cuidado cada una de sus respuestas.';
overBudgetPlan.scenes[0].dialogue[1].text = 'Sí, pero siempre necesitamos mantener el criterio humano, comparar fuentes, cuestionar los resultados y decidir con calma qué construir antes de confiar del todo en cualquier respuesta automática.';

let repairCalls = 0;
const repairFetch = async (url, options = {}) => {
  if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
  repairCalls += 1;
  return response({ message: { content: JSON.stringify(repairCalls === 1 ? overBudgetPlan : plan) } });
};
const repaired = await createDirectorProposal({
  prompt: 'Explicá con humor breve cómo colaborar con inteligencia artificial.',
  fetchImpl: repairFetch, cacheRoot, useCache: false,
});
assert.equal(repairCalls, 2);
assert.equal(repaired.repairAttempts, 1);
assert.equal(repaired.cacheHit, false);

const invalidGesturePlan = structuredClone(plan);
invalidGesturePlan.scenes[0].dialogue[0].gestureAtWord = 99;
let generalizedRepairCalls = 0;
const generalizedRepair = await createDirectorProposal({
  prompt: 'Explicá cómo colaborar con inteligencia artificial de forma responsable.',
  cacheRoot,
  useCache: false,
  fetchImpl: async (url, options = {}) => {
    if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
    generalizedRepairCalls += 1;
    const content = generalizedRepairCalls === 1
      ? '{json incompleto'
      : JSON.stringify(generalizedRepairCalls === 2 ? invalidGesturePlan : plan);
    return response({ message: { content } });
  },
});
assert.equal(generalizedRepairCalls, 3);
assert.equal(generalizedRepair.repairAttempts, 2);

const weakQualityPlan = structuredClone(plan);
weakQualityPlan.title = 'Otro asunto';
weakQualityPlan.scenes[0].title = 'Inicio';
weakQualityPlan.scenes[0].purpose = 'Relleno';
weakQualityPlan.scenes[0].dialogue[0].text = 'Hola.';
weakQualityPlan.scenes[0].dialogue[1].text = 'Hola.';
let qualityRepairCalls = 0;
const qualityRepaired = await createDirectorProposal({
  prompt: 'Explicá cómo colaborar con inteligencia artificial de forma responsable.',
  cacheRoot,
  useCache: false,
  fetchImpl: async (url, options = {}) => {
    if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
    qualityRepairCalls += 1;
    return response({
      message: { content: JSON.stringify(qualityRepairCalls === 1 ? weakQualityPlan : plan) },
    });
  },
});
assert.equal(qualityRepairCalls, 2);
assert.equal(qualityRepaired.repairAttempts, 1);
assert.equal(qualityRepaired.quality.passed, true);

let failCalls = 0;
const failFetch = async (url, options = {}) => {
  if (!url.endsWith('/api/chat')) return fakeFetch(url, options);
  failCalls += 1;
  return response({ message: { content: JSON.stringify(overBudgetPlan) } });
};
await assert.rejects(
  () => createDirectorProposal({
    prompt: 'Otra idea que siempre se pasa del presupuesto de palabras.',
    fetchImpl: failFetch, cacheRoot, useCache: false,
  }),
  (error) => error.code === 'DIRECTOR_DURATION_BUDGET_EXCEEDED',
);
assert.equal(failCalls, 3);

process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: 73,
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
