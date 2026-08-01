// Medición de un proyecto SIN renderizarlo.
//
// La duración de un video local nace del audio: la sintetiza Piper y la mide
// FFprobe. Renderizar cuadros y encodear no aporta ni un milisegundo a esa
// medición, pero hoy es la única forma de obtenerla, y por eso cualquier cambio
// de diálogo obliga a esperar minutos para volver a ubicar el cabezal, los
// keyframes o un corte.
//
// Este módulo hace exactamente el trabajo que sí mide: compila el proyecto y
// corre la preparación de cada escena, que es Piper más FFprobe. Después arma
// la línea de tiempo con LAS MISMAS funciones que usa el render
// (`buildAssemblyPlan` y `buildRenderedTurnTimeline`), así que no produce una
// aproximación: produce el mismo resultado que produciría el render.
//
// Lo que lo vuelve barato es que la caché de voz de `piper-voice.mjs` está
// indexada por contenido y es compartida entre trabajos: al cortar un turno,
// solo los dos textos nuevos se sintetizan y el resto sale de caché.

import path from 'node:path';
import { isMain, readJson, writeJson } from '../stage1/common.mjs';
import { serializeError } from '../stage1/errors.mjs';
import { createJobContext } from '../stage1/job-context.mjs';
import { prepareJob } from '../stage1/prepare-scene.mjs';
import { createProgressReporter } from '../stage1/progress.mjs';
import { sceneRenderDurationSeconds } from '../../shared/scene-evaluator.js';
import { compileVideoProject } from './compile-video-project.mjs';
import { createProjectCompilationContext } from './project-compilation-context.mjs';
import {
  buildAssemblyPlan,
  buildRenderedTurnTimeline,
  createSceneJobId,
  resolveWithin,
} from './project-pipeline.mjs';

export async function measureProject(context, options = {}) {
  const report = options.report || createProgressReporter(context);
  const compiled = compileVideoProject(context, { report, emitCompleted: false });
  const fps = compiled.manifest.video.fps;
  const sceneWorkRoot = path.join(context.jobRoot, 'scene-work');
  const sceneOutputRoot = path.join(context.jobRoot, 'scene-output');
  const scenes = [];

  for (const [index, scene] of compiled.manifest.scenes.entries()) {
    report('preparing', {
      stage: 'measuring_scene',
      sceneId: scene.id,
      sceneIndex: index,
      sceneCount: compiled.manifest.scenes.length,
    });
    const sceneContext = createJobContext({
      'job-id': createSceneJobId(index, scene.id),
      config: resolveWithin(context.jobRoot, scene.config, `configuración de ${scene.id}`),
      'assets-dir': context.assetsRoot,
      'work-dir': sceneWorkRoot,
      'output-dir': sceneOutputRoot,
      'tts-root': context.ttsRoot,
    });
    // Única etapa que se ejecuta: voz, análisis y medición. Sin plan de cuadros,
    // sin FFmpeg de video, sin verificación ni publicación.
    prepareJob(sceneContext, report);
    const runtime = readJson(path.join(sceneContext.runtimeRoot, 'scene-runtime.json'));
    const dialogue = readJson(resolveWithin(
      sceneContext.generatedRoot,
      runtime.dialoguePath,
      `timeline de diálogo de ${scene.id}`,
    ));
    scenes.push({
      id: scene.id,
      turns: dialogue.turns,
      audioDurationSeconds: runtime.audio.durationSeconds,
      // Derivada, no observada: el render redondea el audio al cuadro siguiente
      // con esta misma función, así que medir y renderizar coinciden exacto.
      renderDurationSeconds: sceneRenderDurationSeconds(runtime.audio.durationSeconds, fps),
      transitionToNext: compiled.manifest.scenes[index].transitionToNext,
    });
  }

  const plan = buildAssemblyPlan(scenes);
  const timeline = {
    durationSeconds: plan.durationSeconds,
    scenes: plan.scenes.map((timelineScene, index) => ({
      id: timelineScene.id,
      startSeconds: timelineScene.startSeconds,
      endSeconds: timelineScene.endSeconds,
      audioDurationSeconds: scenes[index].audioDurationSeconds,
      turns: buildRenderedTurnTimeline(
        scenes[index].turns,
        timelineScene.startSeconds,
        scenes[index].audioDurationSeconds,
      ),
      ...(timelineScene.transitionToNext ? { transitionToNext: timelineScene.transitionToNext } : {}),
    })),
  };
  const manifest = {
    version: 1,
    jobId: context.jobId,
    projectId: compiled.manifest.projectId,
    compiledSemanticHash: compiled.manifest.semanticHash,
    video: compiled.manifest.video,
    timeline,
  };
  writeJson(path.join(context.resultRoot, 'measurement.json'), manifest);
  report('completed', {
    stage: 'measure_project',
    result: 'measurement.json',
    scenes: timeline.scenes.length,
    durationSeconds: timeline.durationSeconds,
  });
  return manifest;
}

if (isMain(import.meta.url)) {
  try {
    const context = createProjectCompilationContext();
    const manifest = await measureProject(context);
    process.stdout.write(`${JSON.stringify({
      jobId: context.jobId,
      measured: true,
      scenes: manifest.timeline.scenes.length,
      durationSeconds: manifest.timeline.durationSeconds,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'measure_project') })}\n`);
    process.exitCode = 1;
  }
}
