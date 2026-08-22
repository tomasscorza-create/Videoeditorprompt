import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { evaluateScene, sceneFrameCount, sceneRenderDurationSeconds } from '../../shared/scene-evaluator.js';
import { buildSceneTiming, resolveAnimationScene } from '../../shared/animation-evaluator.js';
import { composeFramesWithFfmpeg } from '../compositor/ffmpeg-compositor.mjs';
import { composeFramesWithPixi } from '../compositor/pixi-compositor.mjs';
import { buildPixiFrameFromV2 } from '../compositor/v2-frame-adapter.mjs';
import { ensureDirectory, ffprobe, readJson, run, sha256, writeJson } from './common.mjs';
import { resolveAsset } from './job-context.mjs';

export async function exportDialogueJob(context, config, options) {
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
  const frameCount = sceneFrameCount(runtime.audio.durationSeconds, fps);
  const renderDuration = sceneRenderDurationSeconds(runtime.audio.durationSeconds, fps);
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
  const compositorBackend = selectCompositorBackend(runtime, options.compositorBackend);
  const compose = async (targetRuntime, targetDirectory, progress = true) => {
    if (compositorBackend === 'pixi') {
      const manifestCache = new Map();
      const pixiVideo = {
        width: config.video.width,
        height: config.video.height,
        ...(targetRuntime.backgroundAnimation ? { backgroundColor: '#071022' } : {}),
      };
      const pixiFrames = framePlan.map((frame) => buildPixiFrameFromV2({
        video: pixiVideo,
        runtime: targetRuntime,
        evaluatedFrame: frame,
        assetsRoot: context.assetsRoot,
        subtitleSrc: frame.subtitlePath ? `generated/${frame.subtitlePath}` : null,
        manifestCache,
      }));
      if (progress) report('rendering_frames', {
        stage: 'rendering_frames', renderId, frameCount, fps, contractVersion: 2, compositorBackend,
      });
      return composeFramesWithPixi({
        video: pixiVideo,
        frames: pixiFrames,
        assetsRoot: context.assetsRoot,
        assetMounts: [{ prefix: 'generated', root: context.generatedRoot }],
        framesDirectory: targetDirectory,
        onProgress: progress ? ({ index, total }) => {
          if (index === 0 || index + 1 === total || (index + 1) % 30 === 0) {
            report('rendering_frames', { stage: 'rendering_frames', renderId, frameCount, completedFrames: index + 1 });
          }
        } : undefined,
      });
    }
    return composeFramesWithFfmpeg({
      context, config, runtime: targetRuntime, dialogueData, framePlan, animation,
      framesDirectory: targetDirectory, fps, renderDuration, frameCount, generatedPath, report, renderId,
    });
  };
  const composition = await compose(runtime, framesDirectory);
  const backgroundTimeline = Array.isArray(options.backgroundTimeline) ? options.backgroundTimeline : [];
  const foregroundComposition = backgroundTimeline.length
    ? await compose(
      { ...runtime, backgroundAnimation: undefined, backgroundVideo: { asset: '', durationSeconds: 1, fps } },
      ensureDirectory(path.join(renderTempRoot, 'foreground-frames')),
      false,
    )
    : null;

  const framePattern = composition.framePattern;
  const started = performance.now() - composition.seconds * 1000;
  const frameGenerationSeconds = composition.seconds + (foregroundComposition?.seconds ?? 0);
  report('encoding', { stage: 'encoding', renderId, frameCount });
  const encodingStarted = performance.now();
  const videoFile = path.join(context.resultRoot, `${renderId}.mp4`);
  const encodingArgs = buildDialogueEncodingArguments({
    fps,
    width: config.video.width,
    height: config.video.height,
    framePattern,
    audioFile: generatedPath(runtime.audio.path),
    renderDuration,
    videoFile,
    ...(foregroundComposition ? {
      foregroundFramePattern: foregroundComposition.framePattern,
      backgroundTimeline,
    } : {}),
    ...(runtime.backgroundVideo ? {
      backgroundVideoFile: resolveAsset(context, runtime.backgroundVideo.asset, 'backgroundVideo/asset'),
    } : {}),
  });
  run('ffmpeg', encodingArgs, { stage: 'encoding', errorCode: 'FFMPEG_ENCODE_EXIT_NONZERO' });
  const encodingSeconds = (performance.now() - encodingStarted) / 1000;
  const frameHash = createHash('sha256');
  for (const file of composition.files) frameHash.update(readFileSync(file));
  for (const file of foregroundComposition?.files ?? []) frameHash.update(readFileSync(file));
  const metrics = {
    version: 2, jobId: context.jobId, renderId, temporalHash, frameContentHash: frameHash.digest('hex'),
    frameCount: composition.frameCount, fps, audioDurationSeconds: runtime.audio.durationSeconds,
    renderDurationSeconds: renderDuration, frameGenerationSeconds, encodingSeconds,
    totalSeconds: (performance.now() - started) / 1000,
    compositorBackend: composition.backend,
    compositorRenderer: composition.renderer,
    output: `${renderId}.mp4`, outputBytes: statSync(videoFile).size, probe: ffprobe(videoFile),
  };
  writeJson(path.join(context.resultRoot, `export-metrics-${runNumber}.json`), metrics);
  if (options.emitCompleted !== false) report('completed', { stage: 'export', renderId, result: `${renderId}.mp4` });
  return metrics;
}

export function buildDialogueEncodingArguments({
  fps,
  width = 1080,
  height = 1920,
  framePattern,
  audioFile,
  renderDuration,
  videoFile,
  backgroundVideoFile = null,
  foregroundFramePattern = null,
  backgroundTimeline = [],
}) {
  const commonEncoding = [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-t', String(renderDuration), '-movflags', '+faststart',
  ];
  if (foregroundFramePattern && backgroundTimeline.length) {
    const activeClips = backgroundTimeline.filter((clip) => (
      clip.localStartSeconds < renderDuration && clip.durationSeconds > 0
    ));
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-y',
      '-framerate', String(fps), '-start_number', '0', '-i', framePattern,
      '-framerate', String(fps), '-start_number', '0', '-i', foregroundFramePattern,
    ];
    let nextInput = 2;
    let baseLabel = '0:v';
    const filters = [];
    if (backgroundVideoFile) {
      args.push('-stream_loop', '-1', '-i', backgroundVideoFile);
      filters.push(`[${nextInput}:v]fps=${fps},trim=duration=${renderDuration},setpts=PTS-STARTPTS[base0]`);
      baseLabel = 'base0';
      nextInput += 1;
    }
    for (const [index, clip] of activeClips.entries()) {
      const duration = Math.min(clip.durationSeconds, renderDuration - clip.localStartSeconds);
      args.push('-ss', String(clip.sourceInSeconds), '-t', String(duration), '-i', clip.file);
      const shifted = `timeline${index}`;
      const output = `timelinebase${index}`;
      filters.push(
        `[${nextInput}:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},trim=duration=${duration},setpts=PTS-STARTPTS+${clip.localStartSeconds}/TB[${shifted}]`,
      );
      filters.push(`[${baseLabel}][${shifted}]overlay=0:0:eof_action=pass:shortest=0:format=auto[${output}]`);
      baseLabel = output;
      nextInput += 1;
    }
    args.push('-i', audioFile);
    filters.push(`[${baseLabel}][1:v]overlay=0:0:shortest=1:format=auto,format=yuv420p[outv]`);
    return [...args, '-filter_complex', filters.join(';'), '-map', '[outv]', '-map', `${nextInput}:a:0`, ...commonEncoding, videoFile];
  }
  return backgroundVideoFile ? [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-framerate', String(fps), '-start_number', '0', '-i', framePattern,
    '-stream_loop', '-1', '-i', backgroundVideoFile,
    '-i', audioFile,
    '-filter_complex', `[1:v]fps=${fps},trim=duration=${renderDuration},setpts=PTS-STARTPTS[bg];[bg][0:v]overlay=0:0:shortest=1:format=auto,format=yuv420p[outv]`,
    '-map', '[outv]', '-map', '2:a:0', ...commonEncoding, videoFile,
  ] : [
    '-hide_banner', '-loglevel', 'warning', '-y', '-framerate', String(fps), '-start_number', '0',
    '-i', framePattern, '-i', audioFile, ...commonEncoding, videoFile,
  ];
}

export function selectCompositorBackend(runtime, requested = 'auto') {
  if (!['auto', 'ffmpeg', 'pixi'].includes(requested)) {
    throw new Error(`Backend de compositor desconocido: ${requested}`);
  }
  if (requested !== 'auto') return requested;
  // Una ventana de visibilidad se aplica como alfa por frame y el overlay de
  // FFmpeg no acepta una expresión de alfa por personaje, así que recortar un
  // elemento enruta la escena a PixiJS igual que lo hace un rig v3 o un prop.
  const recortado = (element) => Boolean(element.visibility);
  return (runtime.props?.length ?? 0) > 0
    || (runtime.templates?.length ?? 0) > 0
    || runtime.characters.some((character) => character.characterRig?.version === 3)
    || runtime.characters.some(recortado)
    ? 'pixi'
    : 'ffmpeg';
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
  const animated = [
    ...(config.characters ?? []).map((element) => ({ ...element, elementType: 'character' })),
    ...(config.props ?? []).map((element) => ({ ...element, elementType: 'prop' })),
    // Un elemento recortado entra aunque no tenga keyframes: su ventana también
    // se resuelve contra la medición y produce estado por frame.
  ].filter((element) => element.tracks?.length || element.visibility);
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
      elementType: character.elementType,
      ...(character.visibility ? { visibility: character.visibility } : {}),
      tracks: (character.tracks ?? []).map((track) => ({
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
