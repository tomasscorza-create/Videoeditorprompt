import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, isMain, readJson, writeJson } from './common.mjs';
import { PipelineError } from './errors.mjs';
import { createJobContext } from './job-context.mjs';
import { createProgressReporter, serializeError } from './progress.mjs';
import { loadAndValidateJobConfig } from './validate-scene-config.mjs';

export function publishPreview(context) {
  if (!context.publishRoot || !context.publishBaseRoot) return null;
  loadAndValidateJobConfig(context);
  assertPublishTarget(context.publishBaseRoot, context.publishRoot);
  ensureDirectory(context.publishBaseRoot);
  if (existsSync(context.publishRoot)) rmSync(context.publishRoot, { recursive: true, force: true });
  ensureDirectory(context.publishRoot);

  copyTree(context.generatedRoot, context.publishRoot);
  copyFileSync(context.jobConfigPath, path.join(context.publishRoot, 'scene.config.json'));
  const runtimePath = path.join(context.runtimeRoot, 'scene-runtime.json');
  copyFileSync(runtimePath, path.join(context.publishRoot, 'scene-runtime.json'));

  const sourceVideo = path.join(context.resultRoot, 'render-1.mp4');
  const hasVideo = existsSync(sourceVideo);
  if (hasVideo) copyFileSync(sourceVideo, path.join(context.publishRoot, 'video.mp4'));
  const runtime = readJson(runtimePath);
  const verificationPath = path.join(context.resultRoot, 'verification.json');
  const verification = existsSync(verificationPath) ? readJson(verificationPath) : null;
  const updatedAt = new Date().toISOString();
  const manifest = {
    version: 1,
    jobId: context.jobId,
    state: hasVideo ? 'completed' : 'prepared',
    updatedAt,
    durationSeconds: runtime.audio.durationSeconds,
    configPath: 'scene.config.json',
    runtimePath: 'scene-runtime.json',
    videoPath: hasVideo ? 'video.mp4' : null,
    verificationPassed: verification?.passed ?? null,
    deterministic: verification
      ? verification.videos?.length >= 2 && verification.videos[0].sha256 === verification.videos[1].sha256
      : null,
  };
  writeJson(path.join(context.publishRoot, 'preview-manifest.json'), manifest);
  updatePreviewIndex(context.publishBaseRoot, manifest);
  return manifest;
}

function updatePreviewIndex(publishBaseRoot, manifest) {
  const indexPath = path.join(publishBaseRoot, 'index.json');
  let current = { version: 1, defaultJobId: manifest.jobId, jobs: [] };
  if (existsSync(indexPath)) {
    try {
      current = JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch (error) {
      throw new PipelineError({
        code: 'PREVIEW_INDEX_INVALID',
        stage: 'publish',
        message: 'El índice de previews existente no contiene JSON válido.',
        cause: error,
        suggestedAction: 'Corrija o retire public/generated/index.json y vuelva a publicar.',
      });
    }
  }
  const previousJobs = Array.isArray(current.jobs) ? current.jobs : [];
  const entry = {
    jobId: manifest.jobId,
    state: manifest.state,
    updatedAt: manifest.updatedAt,
    durationSeconds: manifest.durationSeconds,
    previewPath: `${manifest.jobId}/`,
    configPath: `${manifest.jobId}/${manifest.configPath}`,
    runtimePath: `${manifest.jobId}/${manifest.runtimePath}`,
    videoPath: manifest.videoPath ? `${manifest.jobId}/${manifest.videoPath}` : null,
    verificationPassed: manifest.verificationPassed,
    deterministic: manifest.deterministic,
  };
  const jobs = previousJobs
    .filter((item) => item && item.jobId !== manifest.jobId && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(item.jobId))
    .concat(entry)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.jobId.localeCompare(right.jobId));
  writeJson(indexPath, { version: 1, defaultJobId: manifest.jobId, jobs });
}

function assertPublishTarget(baseRoot, targetRoot) {
  const relative = path.relative(path.resolve(baseRoot), path.resolve(targetRoot));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PipelineError({
      code: 'PUBLISH_TARGET_INVALID',
      stage: 'publish',
      message: 'La carpeta de publicación del trabajo debe estar dentro de publish-dir.',
      suggestedAction: 'Use un publish-dir válido y un jobId independiente.',
    });
  }
}

function copyTree(source, destination) {
  ensureDirectory(destination);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

if (isMain(import.meta.url)) {
  let context;
  try {
    context = createJobContext();
    const manifest = publishPreview(context);
    if (!manifest) throw new Error('Debe indicar --publish-dir para publicar la vista previa.');
    process.stdout.write(`${JSON.stringify({ jobId: context.jobId, published: true, state: manifest.state })}\n`);
  } catch (error) {
    if (context) createProgressReporter(context)('failed', serializeError(error, 'publish'));
    else process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'publish') })}\n`);
    process.exitCode = 1;
  }
}
