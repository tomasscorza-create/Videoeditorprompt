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
      voiceId: 'voz-claude-mx-v1',
      poseId: 'neutral',
      animationPreset: 'talk-calm',
    },
    b: {
      role: 'analista escéptico',
      characterResourceId: 'mono-ciruela-v1',
      voiceId: 'voz-davefx-es-v1',
      poseId: 'neutral',
      animationPreset: 'idle-calm',
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
      transitionDurationSeconds: 0.6,
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
      transitionDurationSeconds: 0,
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
// A5: `static` es una elección legítima y sobrevive sin coerción hasta el proyecto.
const staticPlan = structuredClone(validPlan);
staticPlan.scenes[0].cameraPreset = 'static';
assert.equal(normalizeDirectorPlan(staticPlan, catalog).project.scenes[0].background.cameraPreset, 'static');

// A4: un layout nuevo del catálogo de datos ubica los personajes por ID.
const wideLayoutPlan = structuredClone(validPlan);
wideLayoutPlan.scenes[0].layoutPreset = 'stacked';
const wideNormalized = normalizeDirectorPlan(wideLayoutPlan, catalog).project.scenes[0];
assert.equal(wideNormalized.elements[0].transform.x, 540);
assert.equal(wideNormalized.elements[1].transform.y, 1240);

// A4: un layout inexistente se rechaza con recurso no soportado.
assert.throws(
  () => validateDirectorPlan({
    ...validPlan,
    scenes: [{ ...validPlan.scenes[0], layoutPreset: 'no-existe' }, validPlan.scenes[1]],
  }, catalog),
  (error) => error.code === 'DIRECTOR_RESOURCE_UNSUPPORTED',
);

// La pose inicial compilable y la animación elegida llegan al proyecto normalizado.
assert.equal(normalizedA.project.scenes[0].elements[0].poseId, 'neutral');
assert.equal(normalizedA.project.scenes[0].elements[0].animationPreset, 'talk-calm');
assert.equal(normalizedA.project.scenes[0].elements[1].poseId, 'neutral');
assert.equal(normalizedA.project.scenes[0].elements[1].animationPreset, 'idle-calm');

// A3: la duración de fundido pedida por la IA sobrevive hasta el proyecto validado.
assert.equal(normalizedA.project.scenes[0].transitionToNext.durationSeconds, 0.6);

// `point` sigue siendo gesto de diálogo, pero el contrato lo rechaza como pose inicial.
assert.throws(
  () => validateDirectorPlan({
    ...validPlan,
    cast: { ...validPlan.cast, a: { ...validPlan.cast.a, poseId: 'point' } },
  }, catalog),
  (error) => error.code === 'DIRECTOR_PLAN_SCHEMA_INVALID',
);
assert.throws(
  () => validateDirectorPlan({
    ...validPlan,
    cast: { ...validPlan.cast, b: { ...validPlan.cast.b, animationPreset: 'hyper-jump' } },
  }, catalog),
  (error) => error.code === 'DIRECTOR_RESOURCE_UNSUPPORTED',
);

// A3: un fundido fuera de rango [0.15, 1.0] se rechaza.
assert.throws(
  () => validateDirectorPlan({
    ...validPlan,
    scenes: [
      { ...validPlan.scenes[0], transitionPreset: 'fade', transitionDurationSeconds: 0.05 },
      validPlan.scenes[1],
    ],
  }, catalog),
  (error) => error.code === 'DIRECTOR_TRANSITION_INVALID',
);

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
  passed: 22,
  failed: 0,
  semanticHash: normalizedA.semanticHash,
  projectId: normalizedA.project.id,
  scenes: normalizedA.project.scenes.length,
  totalWords: budget.totalWords,
  maximumWords: budget.maximumWords,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'director-plan-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary)}\n`);
