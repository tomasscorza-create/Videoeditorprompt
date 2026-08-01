// Medir sin renderizar tiene que dar EXACTAMENTE lo mismo que renderizar, o la
// timeline mostraría un tiempo y el MP4 otro. Esta prueba cubre las dos mitades
// de esa garantía: la fórmula compartida de duración y el hecho de que el medidor
// arme la línea de tiempo con las mismas funciones que el render.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';
import { sceneFrameCount, sceneRenderDurationSeconds } from '../../shared/scene-evaluator.js';
import { measureProject } from './measure-project.mjs';
import { createProjectCompilationContext } from './project-compilation-context.mjs';

const results = [];
function test(name, run) {
  try {
    run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

// ---- La fórmula que permite conocer la duración sin renderizar ----

test('la duracion renderizada redondea el audio al cuadro siguiente', () => {
  // El video cubre el audio completo: 7.8116 s a 30 fps son 235 cuadros.
  assert.equal(sceneFrameCount(7.811655, 30), 235);
  assert.equal(sceneRenderDurationSeconds(7.811655, 30), 235 / 30);
  // Un audio que cae justo en un cuadro no agrega uno de más.
  assert.equal(sceneFrameCount(2, 30), 60);
  assert.equal(sceneRenderDurationSeconds(2, 30), 2);
});

test('la duracion renderizada nunca queda por debajo del audio medido', () => {
  for (const seconds of [0.001, 1.0333, 3.215964, 4.295692, 16.68]) {
    assert.equal(sceneRenderDurationSeconds(seconds, 30) >= seconds, true, `${seconds} quedó corto`);
  }
});

// ---- El medidor real, sobre el piloto ----

const jobId = 'test-medicion-proyecto';
const workRoot = path.join(projectRoot, '.local-video', 'work', jobId);
const outputRoot = path.join(projectRoot, '.local-video', 'output', jobId);
for (const directory of [workRoot, outputRoot]) rmSync(directory, { recursive: true, force: true });

let medicion = null;
const ttsDisponible = existsSync(process.env.LOCAL_VIDEO_TTS_ROOT || 'C:\\LocalVideoTTS');

if (ttsDisponible) {
  const context = createProjectCompilationContext({
    'job-id': jobId,
    project: path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'),
  });
  medicion = await measureProject(context, { report: () => {} });

  test('el medidor publica una linea de tiempo completa', () => {
    assert.equal(medicion.timeline.scenes.length, 2);
    assert.equal(medicion.timeline.durationSeconds > 0, true);
    assert.equal(existsSync(path.join(outputRoot, 'measurement.json')), true);
  });

  test('cada escena termina donde su audio redondeado al cuadro dice', () => {
    const fps = medicion.video.fps;
    for (const scene of medicion.timeline.scenes) {
      const esperado = sceneRenderDurationSeconds(scene.audioDurationSeconds, fps);
      assert.equal(
        Math.abs((scene.endSeconds - scene.startSeconds) - esperado) < 1e-6,
        true,
        `${scene.id}: ${scene.endSeconds - scene.startSeconds} != ${esperado}`,
      );
    }
  });

  test('los turnos son contiguos y respetan sus pausas', () => {
    for (const scene of medicion.timeline.scenes) {
      assert.equal(scene.turns.length >= 2, true);
      for (let index = 1; index < scene.turns.length; index += 1) {
        const previo = scene.turns[index - 1];
        const actual = scene.turns[index];
        const esperado = previo.endSeconds + previo.gapAfterSeconds;
        assert.equal(Math.abs(actual.startSeconds - esperado) < 1e-6, true, `${actual.id} no arranca tras la pausa del anterior`);
      }
    }
  });

  test('medir dos veces da el mismo resultado', async () => {
    // Segunda pasada: todo sale de la caché de voz y no puede mover un tiempo.
    const repetido = createProjectCompilationContext({
      'job-id': `${jobId}-b`,
      project: path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'),
    });
    return measureProject(repetido, { report: () => {} }).then((segunda) => {
      assert.deepEqual(segunda.timeline, medicion.timeline);
      rmSync(path.join(projectRoot, '.local-video', 'work', `${jobId}-b`), { recursive: true, force: true });
      rmSync(path.join(projectRoot, '.local-video', 'output', `${jobId}-b`), { recursive: true, force: true });
    });
  });
} else {
  results.push({ name: 'medicion real omitida: no hay runtime TTS local', passed: true, skipped: true });
}

// El medidor NO puede tener su propia aritmética de ensamblaje: comparte las
// funciones del render. Si alguien las duplicara, medir y renderizar podrían
// divergir sin que ninguna prueba lo note.
test('el medidor reutiliza las funciones de linea de tiempo del render', () => {
  const source = readFileSync(path.join(projectRoot, 'scripts', 'stage3a', 'measure-project.mjs'), 'utf8');
  assert.equal(source.includes("from './project-pipeline.mjs'"), true);
  assert.equal(source.includes('buildAssemblyPlan'), true);
  assert.equal(source.includes('buildRenderedTurnTimeline'), true);
  assert.equal(source.includes('sceneRenderDurationSeconds'), true);
  // Y no debe generar cuadros ni encodear.
  assert.equal(source.includes('exportJob'), false);
  assert.equal(source.includes('runPipeline'), false);
});

const failed = results.filter((result) => !result.passed);
process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: results.filter((result) => result.passed).length,
  failed: failed.length,
  ...(medicion ? { durationSeconds: medicion.timeline.durationSeconds } : {}),
  results,
}, null, 2)}\n`);
if (failed.length > 0) process.exitCode = 1;
