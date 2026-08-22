import path from 'node:path';
import { ffprobe, isMain, readJson, sha256, writeJson } from './common.mjs';
import { exportJob } from './export-scene.mjs';
import { createJobContext } from './job-context.mjs';
import { prepareJob } from './prepare-scene.mjs';
import { createProgressReporter, serializeError } from './progress.mjs';
import { publishPreview } from './publish-preview.mjs';
import { verifyJob } from './verify-stage1.mjs';
import { loadAndValidateJobConfig } from './validate-scene-config.mjs';

export async function runPipeline(context, options = {}) {
  const verificationMode = options.verificationMode || 'full';
  const report = createProgressReporter(context);
  try {
    loadAndValidateJobConfig(context);
    const prepared = prepareJob(context, report);
    const first = await exportJob(context, {
      runNumber: 1,
      report,
      emitCompleted: false,
      compositorBackend: options.compositorBackend,
      backgroundTimeline: options.backgroundTimeline,
    });
    const second = verificationMode === 'full'
      ? await exportJob(context, {
        runNumber: 2,
        report,
        emitCompleted: false,
        compositorBackend: options.compositorBackend,
        backgroundTimeline: options.backgroundTimeline,
      })
      : null;
    const verification = verificationMode === 'full' ? verifyJob(context) : verifyInteractiveJob(context);
    const published = verificationMode === 'full' ? publishPreview(context) : null;
    const manifest = {
      version: 1,
      jobId: context.jobId,
      config: 'input/scene.config.json',
      configSha256: sha256(JSON.stringify(context.config)),
      runtime: 'runtime/scene-runtime.json',
      results: verificationMode === 'full'
        ? ['render-1.mp4', 'render-2.mp4', 'verification.json']
        : ['render-1.mp4', 'verification.json'],
      cacheKey: prepared.runtime.cacheKey,
      verificationMode,
      deterministic: Boolean(second && first.temporalHash === second.temporalHash && first.frameContentHash === second.frameContentHash),
      published: Boolean(published),
    };
    writeJson(path.join(context.resultRoot, 'job-manifest.json'), manifest);
    report('completed', { stage: 'pipeline', result: 'job-manifest.json', deterministic: manifest.deterministic });
    return { manifest, verification };
  } catch (error) {
    report('failed', serializeError(error, 'pipeline'));
    throw error;
  }
}

function verifyInteractiveJob(context) {
  const runtime = readJson(path.join(context.runtimeRoot, 'scene-runtime.json'));
  const probe = ffprobe(path.join(context.resultRoot, 'render-1.mp4'));
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const checks = [
    { name: 'MP4 H.264/AAC', passed: video?.codec_name === 'h264' && audio?.codec_name === 'aac' },
    { name: 'Video vertical 1080x1920', passed: video?.width === 1080 && video?.height === 1920 },
    { name: 'Video 30 fps', passed: video?.r_frame_rate === '30/1' },
    { name: 'Duración medida completa', passed: Number(probe.format.duration) >= runtime.audio.durationSeconds },
  ];
  if (checks.some((check) => !check.passed)) {
    const error = new Error(`Falló la verificación interactiva: ${checks.filter((check) => !check.passed).map((check) => check.name).join(', ')}`);
    error.code = 'INTERACTIVE_VERIFICATION_FAILED';
    throw error;
  }
  const verification = { version: 1, jobId: context.jobId, mode: 'interactive', passed: checks.length, failed: 0, checks };
  writeJson(path.join(context.resultRoot, 'verification.json'), verification);
  return verification;
}

if (isMain(import.meta.url)) {
  try {
    const context = createJobContext();
    const result = await runPipeline(context);
    process.stdout.write(`${JSON.stringify({ jobId: context.jobId, completed: true, passed: result.verification.passed })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'pipeline') })}\n`);
    process.exitCode = 1;
  }
}
