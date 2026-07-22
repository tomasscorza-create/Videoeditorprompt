import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createFfmpegMotionExpressions, evaluateScene } from '../../shared/scene-evaluator.js';
import { ensureDirectory, ffprobe, readJson, run, sha256, writeJson } from './common.mjs';
import { resolveAsset } from './job-context.mjs';

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
  const framePlan = Array.from({ length: frameCount }, (_, frameIndex) => ({
    frameIndex,
    timeSeconds: frameIndex / fps,
    ...evaluateScene(config, runtime, dialogueData, frameIndex / fps),
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

  const inputs = [];
  const addAsset = (relativePath, name) => {
    const index = inputs.length;
    inputs.push(resolveAsset(context, relativePath, name));
    return index;
  };
  const backgroundIndex = addAsset(runtime.assets.background, 'background');
  const layerKeys = ['body', 'eyesOpen', 'eyesClosed', 'mouthClosed', 'mouthMedium', 'mouthOpen', 'handNeutral'];
  const characterInputs = runtime.characters.map((character) => ({
    id: character.id,
    indices: Object.fromEntries(layerKeys.map((key) => [key, addAsset(character.assets[key], `${character.id}/${key}`)])),
    transform: character.transform,
  }));
  const subtitleInputs = dialogueData.turns.map((turn) => ({
    turnId: turn.id,
    index: inputs.push(generatedPath(turn.subtitlePath)) - 1,
  }));
  const enable = (predicate) => ranges(framePlan, predicate)
    .map(([start, end]) => `between(n\\,${start}\\,${end})`).join('+') || '0';
  const filters = [];
  const scaledLabels = [];

  for (const [index, item] of characterInputs.entries()) {
    const stateFor = (frame) => frame.characters.find((character) => character.id === item.id);
    const prefix = `d${index}`;
    filters.push(`[${item.indices.body}:v][${item.indices.eyesOpen}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).eyes === 'open')}'[${prefix}e1]`);
    filters.push(`[${prefix}e1][${item.indices.eyesClosed}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).eyes === 'closed')}'[${prefix}e2]`);
    filters.push(`[${prefix}e2][${item.indices.mouthClosed}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'closed')}'[${prefix}m1]`);
    filters.push(`[${prefix}m1][${item.indices.mouthMedium}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'medium')}'[${prefix}m2]`);
    filters.push(`[${prefix}m2][${item.indices.mouthOpen}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'open')}'[${prefix}m3]`);
    filters.push(`[${prefix}m3][${item.indices.handNeutral}:v]overlay=0:0:format=auto[${prefix}hands]`);
    filters.push(`[${prefix}hands]fade=t=in:st=0:d=0.3:alpha=1[${prefix}character]`);
    const motion = createFfmpegMotionExpressions(config, item.transform);
    filters.push(`[${prefix}character]scale=w='${motion.scaleWidth}':h='${motion.scaleHeight}':eval=frame[${prefix}scaled]`);
    scaledLabels.push({ label: `${prefix}scaled`, motion });
  }

  let sceneLabel = `${backgroundIndex}:v`;
  for (const [index, scaled] of scaledLabels.entries()) {
    const output = `scene${index}`;
    filters.push(`[${sceneLabel}][${scaled.label}]overlay=x='${scaled.motion.x}':y='${scaled.motion.y}':eval=frame:format=auto[${output}]`);
    sceneLabel = output;
  }
  for (const [index, subtitle] of subtitleInputs.entries()) {
    const output = `sub${index}`;
    filters.push(`[${sceneLabel}][${subtitle.index}:v]overlay=0:0:format=auto:enable='${enable((frame) => frame.activeTurnId === subtitle.turnId)}'[${output}]`);
    sceneLabel = output;
  }
  filters.push(`[${sceneLabel}]format=rgba[out]`);

  const framePattern = path.join(framesDirectory, 'frame_%04d.png');
  const started = performance.now();
  report('rendering_frames', { stage: 'rendering_frames', renderId, frameCount, fps, contractVersion: 2 });
  const framesStarted = performance.now();
  const inputArgs = inputs.flatMap((file) => ['-loop', '1', '-framerate', String(fps), '-t', String(renderDuration), '-i', file]);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-y', ...inputArgs,
    '-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', String(frameCount),
    '-start_number', '0', framePattern,
  ], { stage: 'rendering_frames', errorCode: 'FFMPEG_RENDER_EXIT_NONZERO' });
  const frameGenerationSeconds = (performance.now() - framesStarted) / 1000;
  report('encoding', { stage: 'encoding', renderId, frameCount });
  const encodingStarted = performance.now();
  const videoFile = path.join(context.resultRoot, `${renderId}.mp4`);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-y', '-framerate', String(fps), '-start_number', '0',
    '-i', framePattern, '-i', generatedPath(runtime.audio.path), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-t', String(renderDuration), '-movflags', '+faststart', videoFile,
  ], { stage: 'encoding', errorCode: 'FFMPEG_ENCODE_EXIT_NONZERO' });
  const encodingSeconds = (performance.now() - encodingStarted) / 1000;
  const frameFiles = readdirSync(framesDirectory).filter((name) => /^frame_\d{4}\.png$/.test(name)).sort();
  const frameHash = createHash('sha256');
  for (const name of frameFiles) frameHash.update(readFileSync(path.join(framesDirectory, name)));
  const metrics = {
    version: 2, jobId: context.jobId, renderId, temporalHash, frameContentHash: frameHash.digest('hex'),
    frameCount: frameFiles.length, fps, audioDurationSeconds: runtime.audio.durationSeconds,
    renderDurationSeconds: renderDuration, frameGenerationSeconds, encodingSeconds,
    totalSeconds: (performance.now() - started) / 1000,
    output: `${renderId}.mp4`, outputBytes: statSync(videoFile).size, probe: ffprobe(videoFile),
  };
  writeJson(path.join(context.resultRoot, `export-metrics-${runNumber}.json`), metrics);
  if (options.emitCompleted !== false) report('completed', { stage: 'export', renderId, result: `${renderId}.mp4` });
  return metrics;
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
