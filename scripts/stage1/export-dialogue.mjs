import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { evaluateScene } from '../../shared/scene-evaluator.js';
import { buildSceneTiming, resolveAnimationScene } from '../../shared/animation-evaluator.js';
import { composeFramesWithFfmpeg } from '../compositor/ffmpeg-compositor.mjs';
import { ensureDirectory, ffprobe, readJson, run, sha256, writeJson } from './common.mjs';

export function exportDialogueJob(context, config, options) {
  const report = options.report;
  const runNumber = Number(options.runNumber ?? 1);
  const runtime = readJson(path.join(context.runtimeRoot, 'scene-runtime.json'));
  const generatedPath = (relativePath) => {
    if (path.isAbsolute(relativePath)) throw new Error(`Ruta generada absoluta no permitida: ${relativePath}`);
    const resolved = path.resolve(context.generatedRoot, relativePath);
    if (path.relative(context.generatedRoot, resolved).startsWith('..')) throw new Error(`Ruta generada fuera del trabajo: ${relativePath}`);
    return resolved;
  };
  const dialogueData = readJson(generatedPath(runtime.dialoguePath));
  const fps = config.video.fps;
  const frameCount = Math.ceil(runtime.audio.durationSeconds * fps);
  const renderDuration = frameCount / fps;
  // Fase 4: las pistas de animación se resuelven contra el audio ya medido y
  // alimentan tanto el plan de frames como las expresiones de FFmpeg, de modo
  // que la vista previa y el MP4 salgan del mismo estado temporal.
  const animation = resolveSceneAnimation(config, dialogueData, runtime.audio.durationSeconds);
  const framePlan = Array.from({ length: frameCount }, (_, frameIndex) => ({
    frameIndex,
    timeSeconds: frameIndex / fps,
    ...evaluateScene(config, runtime, dialogueData, frameIndex / fps, animation),
  }));
  const temporalHash = sha256(JSON.stringify(framePlan));
  const renderId = `render-${runNumber}`;
  const renderTempRoot = path.join(context.tempRoot, renderId);
  const relativeTemp = path.relative(context.tempRoot, renderTempRoot);
  if (relativeTemp.startsWith('..') || path.isAbsolute(relativeTemp)) throw new Error('Directorio temporal fuera del trabajo.');
  rmSync(renderTempRoot, { recursive: true, force: true });
  const framesDirectory = ensureDirectory(path.join(renderTempRoot, 'frames'));
  writeJson(path.join(context.resultRoot, `frame-plan-${runNumber}.json`), {
    version: 2, jobId: context.jobId, renderId, temporalHash, frameCount, fps, frames: framePlan,
  });

  // Fase 3: componer los PNG es responsabilidad del compositor, detrás de un
  // contrato. Acá quedan las tres cosas que NO son composición: resolver el
  // tiempo, encodear el video y medir el resultado.
  const composition = composeFramesWithFfmpeg({
    context,
    config,
    runtime,
    dialogueData,
    framePlan,
    animation,
    framesDirectory,
    fps,
    renderDuration,
    frameCount,
    generatedPath,
    report,
    renderId,
  });

  const framePattern = composition.framePattern;
  const started = performance.now() - composition.seconds * 1000;
  const frameGenerationSeconds = composition.seconds;
  report('encoding', { stage: 'encoding', renderId, frameCount });
  const encodingStarted = performance.now();
  const videoFile = path.join(context.resultRoot, `${renderId}.mp4`);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-y', '-framerate', String(fps), '-start_number', '0',
    '-i', framePattern, '-i', generatedPath(runtime.audio.path), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-t', String(renderDuration), '-movflags', '+faststart', videoFile,
  ], { stage: 'encoding', errorCode: 'FFMPEG_ENCODE_EXIT_NONZERO' });
  const encodingSeconds = (performance.now() - encodingStarted) / 1000;
  const frameHash = createHash('sha256');
  for (const file of composition.files) frameHash.update(readFileSync(file));
  const metrics = {
    version: 2, jobId: context.jobId, renderId, temporalHash, frameContentHash: frameHash.digest('hex'),
    frameCount: composition.frameCount, fps, audioDurationSeconds: runtime.audio.durationSeconds,
    renderDurationSeconds: renderDuration, frameGenerationSeconds, encodingSeconds,
    totalSeconds: (performance.now() - started) / 1000,
    output: `${renderId}.mp4`, outputBytes: statSync(videoFile).size, probe: ffprobe(videoFile),
  };
  writeJson(path.join(context.resultRoot, `export-metrics-${runNumber}.json`), metrics);
  if (options.emitCompleted !== false) report('completed', { stage: 'export', renderId, result: `${renderId}.mp4` });
  return metrics;
}

/**
 * Documento de animación resuelto contra el audio medido, o null si la escena no
 * tiene pistas. Sin pistas nada cambia: `evaluateScene` no agrega la clave
 * `elements` y el `temporalHash` de los pilotos v2 queda igual.
 *
 * Las pistas viajan en coordenadas de AUTORÍA (origen arriba a la izquierda) y
 * el runtime trabaja centrado, igual que `transform.toX` y `transform.baseY`. La
 * traslación ocurre una sola vez, acá, para que el plan de frames y las
 * expresiones de FFmpeg partan exactamente del mismo número.
 */
function resolveSceneAnimation(config, dialogueData, durationSeconds) {
  const animated = (config.characters ?? []).filter((character) => character.tracks?.length);
  if (animated.length === 0) return null;
  const centerOffsets = {
    'position.x': config.video.width / 2,
    'position.y': config.video.height / 2,
  };
  const document = {
    version: 1,
    sceneId: 'scene',
    elements: animated.map((character) => ({
      elementId: character.id,
      elementType: 'character',
      tracks: character.tracks.map((track) => ({
        parameterId: track.parameterId,
        source: track.source,
        keyframes: track.keyframes.map((keyframe) => ({
          ...keyframe,
          value: keyframe.value - (centerOffsets[track.parameterId] ?? 0),
        })),
      })),
    })),
  };
  return resolveAnimationScene(document, buildSceneTiming(dialogueData, durationSeconds), config.video.fps);
}
