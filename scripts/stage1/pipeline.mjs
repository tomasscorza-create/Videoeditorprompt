import path from 'node:path';
import { isMain, sha256, writeJson } from './common.mjs';
import { exportJob } from './export-scene.mjs';
import { createJobContext } from './job-context.mjs';
import { prepareJob } from './prepare-scene.mjs';
import { createProgressReporter, serializeError } from './progress.mjs';
import { publishPreview } from './publish-preview.mjs';
import { verifyJob } from './verify-stage1.mjs';
import { loadAndValidateJobConfig } from './validate-scene-config.mjs';

export function runPipeline(context) {
  const report = createProgressReporter(context);
  try {
    loadAndValidateJobConfig(context);
    const prepared = prepareJob(context, report);
    const first = exportJob(context, { runNumber: 1, report, emitCompleted: false });
    const second = exportJob(context, { runNumber: 2, report, emitCompleted: false });
    const verification = verifyJob(context);
    const published = publishPreview(context);
    const manifest = {
      version: 1,
      jobId: context.jobId,
      config: 'input/scene.config.json',
      configSha256: sha256(JSON.stringify(context.config)),
      runtime: 'runtime/scene-runtime.json',
      results: ['render-1.mp4', 'render-2.mp4', 'verification.json'],
      cacheKey: prepared.runtime.cacheKey,
      deterministic: first.temporalHash === second.temporalHash && first.frameContentHash === second.frameContentHash,
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

if (isMain(import.meta.url)) {
  try {
    const context = createJobContext();
    const result = runPipeline(context);
    process.stdout.write(`${JSON.stringify({ jobId: context.jobId, completed: true, passed: result.verification.passed })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'pipeline') })}\n`);
    process.exitCode = 1;
  }
}
