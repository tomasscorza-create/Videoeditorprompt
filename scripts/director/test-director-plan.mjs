import assert from 'node:assert/strict';
import path from 'node:path';
import { writeJson, projectRoot } from '../stage1/common.mjs';
import { loadAuthoringCatalog, normalizeDirectorPlan, validateDirectorPlan } from './director-plan.mjs';

const catalog = loadAuthoringCatalog();
const validPlan = {
  version: 1,
  title: 'La inteligencia artificial y los programadores',
  tone: 'ironic',
  targetDurationSeconds: 28,
  cast: {
    a: {
      role: 'presentadora optimista',
      characterResourceId: 'mono-azul-v1',
      voiceId: 'voz-daniela-ar-v1',
    },
    b: {
      role: 'analista escéptico',
      characterResourceId: 'mono-ciruela-v1',
      voiceId: 'voz-davefx-es-v1',
    },
  },
  scenes: [
    {
      title: 'La predicción',
      purpose: 'Presentar una afirmación polémica como gancho.',
      backgroundResourceId: 'fondo-estudio-parallax-v1',
      cameraPreset: 'slow-pan',
      layoutPreset: 'focus-a',
      transitionPreset: 'fade',
      dialogue: [
        {
          speaker: 'a',
          text: 'En pocos años la inteligencia artificial va a programar absolutamente todo.',
          gestureId: 'point',
          gapAfterSeconds: 0.25,
        },
        {
          speaker: 'b',
          text: 'Perfecto. Entonces también tendrá que explicar por qué falló en producción.',
          gestureId: 'neutral',
          gapAfterSeconds: 0.2,
        },
      ],
    },
    {
      title: 'La conclusión',
      purpose: 'Cerrar con una conclusión equilibrada y optimista.',
      backgroundResourceId: 'fondo-estudio-parallax-v1',
      cameraPreset: 'slow-zoom',
      layoutPreset: 'focus-b',
      transitionPreset: 'cut',
      dialogue: [
        {
          speaker: 'b',
          text: 'La herramienta acelera tareas, pero alguien todavía debe decidir qué construir.',
          gestureId: 'point',
          gapAfterSeconds: 0.25,
        },
        {
          speaker: 'a',
          text: 'Entonces el futuro no es competir con la máquina, sino aprender a dirigirla.',
          gestureId: 'neutral',
          gapAfterSeconds: 0,
        },
      ],
    },
  ],
};

const budget = validateDirectorPlan(validPlan, catalog);
assert.equal(budget.totalWords > 0, true);
const normalizedA = normalizeDirectorPlan(validPlan, catalog, { promptHash: 'prompt-fixture' });
const normalizedB = normalizeDirectorPlan(validPlan, catalog, { promptHash: 'prompt-fixture' });
assert.deepEqual(normalizedA, normalizedB);
assert.equal(normalizedA.project.scenes.length, 2);
assert.equal(normalizedA.project.scenes[0].elements.length, 2);
assert.equal(normalizedA.project.scenes[0].transitionToNext.preset, 'fade');
assert.equal(Object.hasOwn(normalizedA.project.scenes[1], 'transitionToNext'), false);
assert.equal(normalizedA.project.scenes.every((scene) => scene.dialogue.at(-1).gapAfterSeconds === 0), true);
assert.equal(normalizedA.project.scenes.every((scene) => scene.elements[0].transform.zIndex < scene.elements[1].transform.zIndex), true);
const staticPlan = structuredClone(validPlan);
staticPlan.scenes[0].cameraPreset = 'static';
assert.equal(normalizeDirectorPlan(staticPlan, catalog).project.scenes[0].background.cameraPreset, 'slow-pan');

assert.throws(
  () => validateDirectorPlan({
    ...validPlan,
    cast: {
      ...validPlan.cast,
      b: { ...validPlan.cast.b, characterResourceId: 'personaje-inventado' },
    },
  }, catalog),
  (error) => error.code === 'DIRECTOR_RESOURCE_INVALID',
);

assert.throws(
  () => validateDirectorPlan({
    ...validPlan,
    scenes: [{
      ...validPlan.scenes[0],
      dialogue: validPlan.scenes[0].dialogue.map((turn) => ({ ...turn, speaker: 'a' })),
    }],
  }, catalog),
  (error) => error.code === 'DIRECTOR_SCENE_DIALOGUE_INVALID',
);

assert.throws(
  () => validateDirectorPlan({
    ...validPlan,
    unexpected: true,
  }, catalog),
  (error) => error.code === 'DIRECTOR_PLAN_SCHEMA_INVALID',
);

const summary = {
  version: 1,
  passed: 13,
  failed: 0,
  semanticHash: normalizedA.semanticHash,
  projectId: normalizedA.project.id,
  scenes: normalizedA.project.scenes.length,
  totalWords: budget.totalWords,
  maximumWords: budget.maximumWords,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'director-plan-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary)}\n`);
