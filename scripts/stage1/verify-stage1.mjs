import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateScene } from '../../shared/scene-evaluator.js';
import { ffprobe, isMain, readJson, writeJson } from './common.mjs';
import { createJobContext, resolveAsset } from './job-context.mjs';
import { createProgressReporter, serializeError } from './progress.mjs';
import { loadAndValidateJobConfig } from './validate-scene-config.mjs';

export function verifyJob(context, options = {}) {
  const config = loadAndValidateJobConfig(context);
  const runtime = readJson(path.join(context.runtimeRoot, 'scene-runtime.json'));
  const mouth = readJson(path.join(context.generatedRoot, runtime.mouthCuesPath));
  const plan1 = readJson(path.join(context.resultRoot, 'frame-plan-1.json'));
  const plan2 = readJson(path.join(context.resultRoot, 'frame-plan-2.json'));
  const metrics1 = readJson(path.join(context.resultRoot, 'export-metrics-1.json'));
  const metrics2 = readJson(path.join(context.resultRoot, 'export-metrics-2.json'));
  const checks = [];
  const check = (name, condition, evidence) => {
    assert.ok(condition, name);
    checks.push({ name, passed: true, evidence });
  };

  check('Identidad de trabajo consistente', runtime.jobId === context.jobId && plan1.jobId === context.jobId && plan2.jobId === context.jobId, context.jobId);
  check('Composición vertical', config.video.width === 1080 && config.video.height === 1920 && config.video.fps === 30, config.video);
  const sceneAssets = runtime.assets || context.resolvedAssets || config.assets;
  const assetProbes = {};
  for (const [name, asset] of Object.entries(sceneAssets)) {
    const stream = ffprobe(resolveAsset(context, asset)).streams[0];
    assetProbes[name] = { width: stream.width, height: stream.height, pixFmt: stream.pix_fmt };
    check(`Asset ${name} 1080x1920`, stream.width === 1080 && stream.height === 1920, assetProbes[name]);
  }
  const transparentLayers = ['body', 'eyesOpen', 'eyesClosed', 'mouthClosed', 'mouthMedium', 'mouthOpen'];
  if (sceneAssets.handNeutral && sceneAssets.handPoint) transparentLayers.push('handNeutral', 'handPoint');
  for (const name of transparentLayers) {
    check(`Transparencia ${name}`, assetProbes[name].pixFmt === 'rgba', assetProbes[name].pixFmt);
  }
  if (runtime.characterRig) {
    check('Rig versionado compilado', runtime.characterRig.version === 1 && typeof runtime.characterRig.id === 'string', runtime.characterRig);
    check('Ruta de manifiesto portable', !path.isAbsolute(runtime.characterRig.manifestPath), runtime.characterRig.manifestPath);
    check('Gestos con capas completas', Boolean(sceneAssets.handNeutral && sceneAssets.handPoint), ['handNeutral', 'handPoint']);
  }
  const states = new Set(mouth.cues.map((cue) => cue.state));
  check('Tres estados de boca', ['closed', 'medium', 'open'].every((state) => states.has(state)), [...states]);
  check('Cues RMS ordenados y válidos', mouth.cues.every((cue, index) => cue.end > cue.start && (index === 0 || cue.start >= mouth.cues[index - 1].end - 1e-8)), mouth.cues.length);
  check('Boca cerrada fuera del audio', evaluateScene(config, runtime, mouth.cues, runtime.audio.durationSeconds).mouth === 'closed', 'closed');
  check('Rutas de runtime relativas', [runtime.audio.path, runtime.mouthCuesPath, runtime.subtitlePath].every((item) => !path.isAbsolute(item)), [runtime.audio.path, runtime.mouthCuesPath, runtime.subtitlePath]);
  check('Parpadeos deterministas presentes', runtime.blinks.length >= 2, runtime.blinks.length);
  check('Planes temporales idénticos', plan1.temporalHash === plan2.temporalHash, plan1.temporalHash);
  check('Frames PNG idénticos', metrics1.frameContentHash === metrics2.frameContentHash, metrics1.frameContentHash);
  check('Cantidad de frames consistente', metrics1.frameCount === metrics2.frameCount && metrics1.frameCount === Math.ceil(runtime.audio.durationSeconds * config.video.fps), metrics1.frameCount);
  check('Movimiento visible', plan1.frames[0].character.x !== plan1.frames[Math.min(30, plan1.frames.length - 1)].character.x, true);
  check('Subtítulo visible', plan1.frames.some((frame) => frame.subtitleVisible), true);
  if (config.gestures?.length) {
    check('Gesto point presente', plan1.frames.some((frame) => frame.gesture === 'point'), true);
    check('Retorno a pose neutral', plan1.frames.some((frame) => frame.gesture === 'neutral'), true);
  }

  const videos = [];
  for (const runNumber of [1, 2]) {
    const file = path.join(context.resultRoot, `render-${runNumber}.mp4`);
    const probe = ffprobe(file);
    const video = probe.streams.find((stream) => stream.codec_type === 'video');
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
    check(`MP4 ${runNumber} H.264/AAC/yuv420p`, video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && audio.codec_name === 'aac', { video: video.codec_name, audio: audio.codec_name, pixFmt: video.pix_fmt });
    check(`MP4 ${runNumber} completo`, video.width === 1080 && video.height === 1920 && video.r_frame_rate === '30/1' && Number(probe.format.duration) >= runtime.audio.durationSeconds, probe.format.duration);
    videos.push({ runNumber, file: `render-${runNumber}.mp4`, sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), probe });
  }
  check('MP4 binariamente idénticos', videos[0].sha256 === videos[1].sha256, videos[0].sha256);
  const result = { version: 1, jobId: context.jobId, verifiedAt: new Date().toISOString(), passed: checks.length, failed: 0, checks, assetProbes, videos };
  writeJson(path.join(context.resultRoot, 'verification.json'), result);
  if (options.emitCompleted) (options.report || createProgressReporter(context))('completed', { stage: 'verify', passed: result.passed, result: 'verification.json' });
  return result;
}

if (isMain(import.meta.url)) {
  let context;
  let report;
  try {
    context = createJobContext();
    report = createProgressReporter(context);
    const result = verifyJob(context, { emitCompleted: true, report });
    process.stdout.write(`${JSON.stringify({ jobId: context.jobId, passed: result.passed, failed: 0 })}\n`);
  } catch (error) {
    if (context) (report || createProgressReporter(context))('failed', serializeError(error, 'verify'));
    else process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'verify') })}\n`);
    process.exitCode = 1;
  }
}
