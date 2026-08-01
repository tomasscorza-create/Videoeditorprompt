import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createFfmpegMotionExpressions, evaluateScene, sceneFrameCount, sceneRenderDurationSeconds } from '../../shared/scene-evaluator.js';
import { ensureDirectory, ffprobe, isMain, readJson, run, sha256, writeJson } from './common.mjs';
import { createJobContext, resolveAsset } from './job-context.mjs';
import { createProgressReporter, serializeError } from './progress.mjs';
import { loadAndValidateJobConfig } from './validate-scene-config.mjs';
import { exportDialogueJob } from './export-dialogue.mjs';

export async function exportJob(context, options = {}) {
  const report = options.report || createProgressReporter(context);
  const runNumber = Number(options.runNumber ?? 1);
  if (!Number.isInteger(runNumber) || runNumber < 1) throw new Error('runNumber debe ser un entero positivo.');
  const config = loadAndValidateJobConfig(context);
  if (config.version === 2) return exportDialogueJob(context, config, { ...options, report, runNumber });
  const runtime = readJson(path.join(context.runtimeRoot, 'scene-runtime.json'));
  const generatedPath = (relativePath) => {
    if (path.isAbsolute(relativePath)) throw new Error(`Ruta generada absoluta no permitida: ${relativePath}`);
    const resolved = path.resolve(context.generatedRoot, relativePath);
    if (path.relative(context.generatedRoot, resolved).startsWith('..')) throw new Error(`Ruta generada fuera del trabajo: ${relativePath}`);
    return resolved;
  };
  const mouthData = readJson(generatedPath(runtime.mouthCuesPath));
  const fps = config.video.fps;
  const frameCount = sceneFrameCount(runtime.audio.durationSeconds, fps);
  const renderDuration = sceneRenderDurationSeconds(runtime.audio.durationSeconds, fps);
  const framePlan = Array.from({ length: frameCount }, (_, frameIndex) => ({
    frameIndex,
    timeSeconds: frameIndex / fps,
    ...evaluateScene(config, runtime, mouthData.cues, frameIndex / fps),
  }));
  const temporalHash = sha256(JSON.stringify(framePlan));
  const renderId = `render-${runNumber}`;
  const renderTempRoot = path.join(context.tempRoot, renderId);
  const relativeTemp = path.relative(context.tempRoot, renderTempRoot);
  if (relativeTemp.startsWith('..') || path.isAbsolute(relativeTemp)) throw new Error('Directorio temporal fuera del trabajo.');
  rmSync(renderTempRoot, { recursive: true, force: true });
  const framesDirectory = ensureDirectory(path.join(renderTempRoot, 'frames'));
  writeJson(path.join(context.resultRoot, `frame-plan-${runNumber}.json`), { version: 1, jobId: context.jobId, renderId, temporalHash, frameCount, fps, frames: framePlan });

  const sceneAssets = runtime.assets || context.resolvedAssets || config.assets;
  const assetKeys = ['background', 'body', 'eyesOpen', 'eyesClosed', 'mouthClosed', 'mouthMedium', 'mouthOpen'];
  const hasHandLayers = Boolean(sceneAssets.handNeutral && sceneAssets.handPoint);
  if (hasHandLayers) assetKeys.push('handNeutral', 'handPoint');
  const assetInputIndex = Object.fromEntries(assetKeys.map((key, index) => [key, index]));
  const inputs = assetKeys.map((key) => resolveAsset(context, sceneAssets[key], key));
  const subtitleInputIndex = inputs.length;
  inputs.push(generatedPath(runtime.subtitlePath));
  const audioPath = generatedPath(runtime.audio.path);
  const enable = (predicate) => ranges(framePlan, predicate)
    .map(([start, end]) => `between(n\\,${start}\\,${end})`).join('+') || '0';
  const motion = createFfmpegMotionExpressions(config);
  const filters = [
    `[${assetInputIndex.body}:v][${assetInputIndex.eyesOpen}:v]overlay=0:0:format=auto:enable='${enable((state) => state.eyes === 'open')}'[c1]`,
    `[c1][${assetInputIndex.eyesClosed}:v]overlay=0:0:format=auto:enable='${enable((state) => state.eyes === 'closed')}'[c2]`,
    `[c2][${assetInputIndex.mouthClosed}:v]overlay=0:0:format=auto:enable='${enable((state) => state.mouth === 'closed')}'[c3]`,
    `[c3][${assetInputIndex.mouthMedium}:v]overlay=0:0:format=auto:enable='${enable((state) => state.mouth === 'medium')}'[c4]`,
    `[c4][${assetInputIndex.mouthOpen}:v]overlay=0:0:format=auto:enable='${enable((state) => state.mouth === 'open')}'[c5]`,
  ];
  let characterLabel = 'c5';
  if (hasHandLayers) {
    filters.push(`[${characterLabel}][${assetInputIndex.handNeutral}:v]overlay=0:0:format=auto:enable='${enable((state) => state.gesture === 'neutral')}'[c6]`);
    filters.push(`[c6][${assetInputIndex.handPoint}:v]overlay=0:0:format=auto:enable='${enable((state) => state.gesture === 'point')}'[c7]`);
    characterLabel = 'c7';
  }
  filters.push(`[${characterLabel}]fade=t=in:st=0:d=0.3:alpha=1[character]`);
  filters.push(`[character]scale=w='${motion.scaleWidth}':h='${motion.scaleHeight}':eval=frame[scaled]`);
  filters.push(`[${assetInputIndex.background}:v][scaled]overlay=x='${motion.x}':y='${motion.y}':eval=frame:format=auto[scene]`);
  filters.push(`[scene][${subtitleInputIndex}:v]overlay=0:0:format=auto:enable='between(n\\,0\\,${frameCount - 1})',format=rgba[out]`);
  const filterGraph = filters.join(';');
  const framePattern = path.join(framesDirectory, 'frame_%04d.png');
  const started = performance.now();
  report('rendering_frames', { stage: 'rendering_frames', renderId, frameCount, fps });
  const framesStarted = performance.now();
  const inputArgs = inputs.flatMap((file) => ['-loop', '1', '-framerate', String(fps), '-t', String(renderDuration), '-i', file]);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-y', ...inputArgs,
    '-filter_complex', filterGraph, '-map', '[out]', '-frames:v', String(frameCount),
    '-start_number', '0', framePattern,
  ], { stage: 'rendering_frames', errorCode: 'FFMPEG_RENDER_EXIT_NONZERO' });
  const frameGenerationSeconds = (performance.now() - framesStarted) / 1000;
  report('encoding', { stage: 'encoding', renderId, frameCount });
  const encodingStarted = performance.now();
  const videoFile = path.join(context.resultRoot, `${renderId}.mp4`);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-y', '-framerate', String(fps), '-start_number', '0',
    '-i', framePattern, '-i', audioPath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-t', String(renderDuration), '-movflags', '+faststart', videoFile,
  ], { stage: 'encoding', errorCode: 'FFMPEG_ENCODE_EXIT_NONZERO' });
  const encodingSeconds = (performance.now() - encodingStarted) / 1000;
  const frameFiles = readdirSync(framesDirectory).filter((name) => /^frame_\d{4}\.png$/.test(name)).sort();
  const frameHash = createHash('sha256');
  for (const name of frameFiles) frameHash.update(readFileSync(path.join(framesDirectory, name)));
  const metrics = {
    version: 1, jobId: context.jobId, renderId, temporalHash, frameContentHash: frameHash.digest('hex'),
    frameCount: frameFiles.length, fps, audioDurationSeconds: runtime.audio.durationSeconds,
    renderDurationSeconds: renderDuration, frameGenerationSeconds, encodingSeconds,
    totalSeconds: (performance.now() - started) / 1000,
    output: `${renderId}.mp4`, outputBytes: statSync(videoFile).size, probe: ffprobe(videoFile),
  };
  writeJson(path.join(context.resultRoot, `export-metrics-${runNumber}.json`), metrics);
  if (options.emitCompleted !== false) report('completed', { stage: 'export', renderId, result: `${renderId}.mp4` });
  return metrics;
}

if (isMain(import.meta.url)) {
  let context;
  let report;
  try {
    context = createJobContext();
    report = createProgressReporter(context);
    await exportJob(context, { runNumber: context.args.run || 1, report });
  } catch (error) {
    if (context) (report || createProgressReporter(context))('failed', serializeError(error, 'export'));
    else process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'export') })}\n`);
    process.exitCode = 1;
  }
}

function ranges(items, predicate) {
  const result = [];
  let start = null;
  for (let index = 0; index < items.length; index += 1) {
    if (predicate(items[index]) && start === null) start = index;
    if ((!predicate(items[index]) || index === items.length - 1) && start !== null) {
      result.push([start, predicate(items[index]) && index === items.length - 1 ? index : index - 1]);
      start = null;
    }
  }
  return result;
}
