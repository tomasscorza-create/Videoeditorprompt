import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { PipelineError, serializeError } from '../stage1/errors.mjs';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { loadAuthoringCatalog } from '../director/director-plan.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { cleanupCompletedJob } from './retention.mjs';
import { createFileRenderJobRepository } from '../storage/file-render-job-repository.mjs';
import { publishRenderArtifacts } from '../storage/artifact-storage.mjs';

const JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const MAX_IN_MEMORY_JOBS = 500;

export async function createRenderJobManager(options = {}) {
  const root = path.resolve(options.root || projectRoot);
  const assetsRoot = path.resolve(options.assetsRoot || path.join(root, 'public'));
  const appJobsRoot = ensureDirectory(path.resolve(options.appJobsRoot || path.join(root, '.local-video', 'app-jobs')));
  const appInputRoot = ensureDirectory(path.resolve(options.appInputRoot || path.join(root, '.local-video', 'app-input')));
  const workRoot = path.resolve(options.workRoot || path.join(root, '.local-video', 'work'));
  const outputRoot = path.resolve(options.outputRoot || path.join(root, '.local-video', 'output'));
  const catalogProvider = options.catalogProvider
    || (() => options.catalog || loadAuthoringCatalog(assetsRoot));
  const pipelineScript = path.join(root, 'scripts', 'stage3a', 'project-pipeline.mjs');
  const spawnImpl = options.spawnImpl || spawn;
  const terminateTree = options.terminateProcessTreeImpl || terminateProcessTree;
  const repositoryFactory = options.repositoryFactory || createFileRenderJobRepository;
  const repository = options.repository || await repositoryFactory({ storageRoot: appJobsRoot });
  const blobStorage = options.blobStorage || null;
  const artifactPublisher = options.artifactPublisher || publishRenderArtifacts;
  const jobs = new Map();
  let activeJobId = null;
  await recoverPersistedJobs();

  async function create(project) {
    if (activeJobId) {
      throw new PipelineError({
        code: 'RENDER_BUSY',
        stage: 'queueing',
        message: 'Ya existe un render activo en este equipo.',
        technicalDetail: activeJobId,
        suggestedAction: 'Esperá a que termine el trabajo actual antes de iniciar otro.',
      });
    }
    validateVideoProjectDocument({ project, catalog: catalogProvider(), assetsRoot });
    const jobId = createJobId();
    const inputDirectory = ensureDirectory(path.join(appInputRoot, jobId));
    const projectFile = path.join(inputDirectory, 'project.json');
    writeJson(projectFile, project);
    const job = {
      version: 1,
      jobId,
      projectId: project.id,
      state: 'queued',
      stage: 'queueing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectFile,
      progress: null,
      error: null,
      process: null,
      stdoutBuffer: '',
      timeout: null,
      operation: Promise.resolve(),
    };
    await repository.reserve(publicJob(job));
    jobs.set(jobId, job);
    activeJobId = jobId;
    await launch(job);
    return publicJob(job);
  }

  async function launch(job) {
    await update(job, { state: 'rendering', stage: 'starting_pipeline' });
    const args = [
      pipelineScript,
      `--job-id=${job.jobId}`,
      `--project=${job.projectFile}`,
      `--assets-dir=${assetsRoot}`,
      `--work-dir=${workRoot}`,
      `--output-dir=${outputRoot}`,
      '--verification-mode=interactive',
    ];
    const child = spawnImpl(process.execPath, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    job.process = child;
    job.processId = child.pid ?? null;
    const timeoutMs = Number(options.renderTimeoutMs || 45 * 60 * 1000);
    job.timeout = setTimeout(() => {
      void fail(job, new PipelineError({
        code: 'RENDER_TIMEOUT',
        stage: 'rendering',
        message: 'El render superó el tiempo máximo permitido.',
        suggestedAction: 'Reducí la cantidad de escenas o revisá el rendimiento de Piper y FFmpeg.',
      })).catch(() => {});
      terminateTree(child);
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => consumeStdout(job, chunk));
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on('error', (error) => {
      void fail(job, error).catch(() => {});
    });
    child.on('close', (code) => {
      void handleClose().catch((error) => fail(job, error).catch(() => {}));
      async function handleClose() {
      await job.operation;
      if (job.state === 'cancelled') {
        await cleanupJob(job);
        return;
      }
      if (job.state === 'failed') return;
      if (code !== 0) {
        const reportedFailure = job.progress?.state === 'failed' ? job.progress : null;
        await fail(job, new PipelineError(reportedFailure ? {
          code: reportedFailure.code || 'PROJECT_PIPELINE_EXIT_NONZERO',
          stage: reportedFailure.stage || job.stage || 'rendering',
          message: reportedFailure.message || 'El pipeline local no pudo completar el video.',
          technicalDetail: reportedFailure.technicalDetail || stderr.trim() || `exitCode=${code}`,
          cause: reportedFailure.cause,
          suggestedAction: reportedFailure.suggestedAction || 'Revisá el estado del trabajo y la instalación local de Piper/FFmpeg.',
        } : {
          code: 'PROJECT_PIPELINE_EXIT_NONZERO',
          stage: job.stage || 'rendering',
          message: 'El pipeline local no pudo completar el video.',
          technicalDetail: stderr.trim() || `exitCode=${code}`,
          suggestedAction: 'Revisá el estado del trabajo y la instalación local de Piper/FFmpeg.',
        }));
        return;
      }
      const manifestFile = resultPath(job.jobId, 'project-manifest.json');
      const videoFile = resultPath(job.jobId, 'render-1.mp4');
      if (!existsSync(manifestFile) || !existsSync(videoFile)) {
        await fail(job, new PipelineError({
          code: 'RENDER_OUTPUT_MISSING',
          stage: 'verifying_project',
          message: 'El pipeline terminó sin producir el manifiesto o el MP4 esperado.',
          suggestedAction: 'Revisá los outputs aislados del trabajo.',
        }));
        return;
      }
      const manifest = readJson(manifestFile);
      let artifacts = null;
      if (blobStorage) {
        try {
          artifacts = await artifactPublisher({
            blobStorage,
            jobId: job.jobId,
            manifestFile,
            videoFile,
          });
        } catch (error) {
          await fail(job, error);
          return;
        }
      }
      await complete(job, {
        stage: 'project_pipeline',
        result: {
          durationSeconds: manifest.timeline.durationSeconds,
          scenes: manifest.timeline.scenes.length,
          deterministic: manifest.deterministic,
          videoUrl: `/api/render-jobs/${job.jobId}/video`,
          downloadName: `${job.projectId}.mp4`,
          timeline: publicTimeline(manifest.timeline),
          ...(artifacts ? { artifacts } : {}),
        },
      });
      }
    });
  }

  function consumeStdout(job, chunk) {
    job.stdoutBuffer += chunk;
    const lines = job.stdoutBuffer.split(/\r?\n/u);
    job.stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const event = JSON.parse(line);
        if (event.jobId === job.jobId || event.jobId?.startsWith('scene-')) {
          queueJobOperation(job, () => update(job, {
            state: 'rendering',
            stage: event.stage || event.state || job.stage,
            progress: event,
          }));
        }
      } catch {
        // La salida externa no estructurada se ignora; el pipeline conserva sus propios logs.
      }
    }
  }

  async function get(jobId) {
    assertJobId(jobId);
    const inMemory = jobs.get(jobId);
    if (inMemory) return publicJob(inMemory);
    return repository.get(jobId);
  }

  async function cancel(jobId) {
    assertJobId(jobId);
    const job = jobs.get(jobId);
    if (!job || !['queued', 'rendering'].includes(job.state)) return await get(jobId);
    const processToKill = job.process;
    clearTimeout(job.timeout);
    job.timeout = null;
    job.process = null;
    activeJobId = null;
    await update(job, { state: 'cancelled', stage: 'cancelled' });
    if (processToKill) terminateTree(processToKill);
    return publicJob(job);
  }

  async function video(jobId) {
    const status = await get(jobId);
    if (!status || status.state !== 'completed') return null;
    const remote = status.result?.artifacts?.video;
    if (blobStorage && remote?.key) {
      return {
        blobStorage,
        key: remote.key,
        size: remote.bytes,
        name: status.result.downloadName,
      };
    }
    const file = resultPath(jobId, 'render-1.mp4');
    if (!existsSync(file)) return null;
    return { file, size: statSync(file).size, name: status.result.downloadName };
  }

  async function list() {
    return (await repository.list()).slice(0, MAX_IN_MEMORY_JOBS);
  }

  async function cancelActive() {
    return activeJobId ? await cancel(activeJobId) : null;
  }

  async function update(job, patch) {
    const expectedState = job.state;
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    await repository.transition(job.jobId, expectedState, publicJob(next));
    Object.assign(job, next);
    return publicJob(job);
  }

  async function complete(job, patch) {
    clearTimeout(job.timeout);
    job.timeout = null;
    job.process = null;
    activeJobId = null;
    await update(job, { ...patch, state: 'completed', error: null });
    await cleanupJob(job);
  }

  async function cleanupJob(job) {
    try {
      const cleanup = cleanupCompletedJob({ workRoot, jobId: job.jobId, apply: true });
      await update(job, { cleanup: { removedBytes: cleanup.removedBytes, paths: cleanup.paths.length } });
    } catch (error) {
      await update(job, { cleanup: { removedBytes: 0, paths: 0, warning: serializeError(error, 'cleanup') } });
    }
  }

  async function fail(job, error) {
    if (!job || job.state === 'failed') return;
    clearTimeout(job.timeout);
    job.timeout = null;
    job.process = null;
    if (activeJobId === job.jobId) activeJobId = null;
    await update(job, {
      state: 'failed',
      error: serializeError(error, job.stage || 'rendering'),
    });
    await cleanupJob(job);
  }

  function resultPath(jobId, filename) {
    assertJobId(jobId);
    return path.join(outputRoot, jobId, filename);
  }

  async function recoverPersistedJobs() {
    for (const status of await repository.list()) {
      try {
        if (!status?.jobId || !JOB_ID_PATTERN.test(status.jobId)) continue;
        const recovered = {
          ...status,
          process: null,
          processId: null,
          stdoutBuffer: '',
          timeout: null,
          operation: Promise.resolve(),
        };
        if (['queued', 'rendering'].includes(recovered.state)) {
          recovered.state = 'failed';
          recovered.stage = 'recovery';
          recovered.updatedAt = new Date().toISOString();
          recovered.error = serializeError(new PipelineError({
            code: 'RENDER_INTERRUPTED',
            stage: 'recovery',
            message: 'El servicio se reinició antes de que terminara el render.',
            suggestedAction: 'Volvé a iniciar el render; los outputs incompletos no se publicaron.',
          }), 'recovery');
        } else if (recovered.state === 'completed' && recovered.result && !recovered.result.timeline) {
          const manifestFile = resultPath(recovered.jobId, 'project-manifest.json');
          if (existsSync(manifestFile)) {
            const manifest = readJson(manifestFile);
            recovered.result = { ...recovered.result, timeline: publicTimeline(manifest.timeline) };
          }
        }
        jobs.set(recovered.jobId, recovered);
        if (recovered.state === 'failed' && recovered.stage === 'recovery') {
          await repository.transition(status.jobId, status.state, publicJob(recovered));
        } else if (JSON.stringify(publicJob(recovered)) !== JSON.stringify(status)) {
          await repository.transition(status.jobId, status.state, publicJob(recovered));
        }
      } catch {
        // Un estado corrupto no puede bloquear el arranque ni convertirse en fuente de verdad.
      }
    }
    trimJobs();
  }

  function trimJobs() {
    if (jobs.size <= MAX_IN_MEMORY_JOBS) return;
    const removable = [...jobs.values()]
      .filter((job) => !['queued', 'rendering'].includes(job.state))
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
    while (jobs.size > MAX_IN_MEMORY_JOBS && removable.length > 0) {
      jobs.delete(removable.shift().jobId);
    }
  }

  function queueJobOperation(job, operation) {
    job.operation = job.operation.then(operation, operation);
    job.operation.catch(() => {});
  }

  return {
    repository,
    create,
    get,
    list,
    cancel,
    cancelActive,
    video,
    get activeJobId() { return activeJobId; },
  };
}

export function publicTimeline(timeline) {
  return {
    durationSeconds: timeline.durationSeconds,
    scenes: timeline.scenes.map((scene) => ({
      id: scene.id,
      startSeconds: scene.startSeconds,
      endSeconds: scene.endSeconds,
      audioDurationSeconds: scene.audioDurationSeconds,
      turns: Array.isArray(scene.turns) ? scene.turns.map((turn) => ({
        id: turn.id,
        speakerId: turn.speakerId,
        startSeconds: turn.startSeconds,
        endSeconds: turn.endSeconds,
        durationSeconds: turn.durationSeconds,
        gapAfterSeconds: turn.gapAfterSeconds,
      })) : [],
      ...(scene.transitionToNext ? {
        transitionToNext: {
          preset: scene.transitionToNext.preset,
          durationSeconds: scene.transitionToNext.durationSeconds,
          startSeconds: scene.transitionToNext.startSeconds,
          endSeconds: scene.transitionToNext.endSeconds,
        },
      } : {}),
    })),
  };
}

function publicJob(job) {
  return {
    version: job.version,
    jobId: job.jobId,
    projectId: job.projectId,
    state: job.state,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
    ...(job.cleanup ? { cleanup: job.cleanup } : {}),
    ...(job.result ? { result: job.result } : {}),
  };
}

export function terminateProcessTree(child) {
  const pid = Number(child?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    child?.kill?.();
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      timeout: 15_000,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill?.('SIGTERM');
  }
}

function createJobId() {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `render-${timestamp}-${randomBytes(4).toString('hex')}`;
}

function assertJobId(jobId) {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new PipelineError({
      code: 'JOB_ID_INVALID',
      stage: 'local_app',
      message: 'El identificador de trabajo no es válido.',
      suggestedAction: 'Usá únicamente el jobId devuelto por la aplicación.',
    });
  }
}

export async function streamVideoResponse(request, response, video) {
  const range = request.headers.range;
  response.setHeader('accept-ranges', 'bytes');
  response.setHeader('content-type', 'video/mp4');
  response.setHeader('content-disposition', `inline; filename="${video.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`);
  if (!range) {
    const stream = video.blobStorage
      ? (await video.blobStorage.openRead(video.key)).stream
      : createReadStream(video.file);
    response.writeHead(200, { 'content-length': video.size });
    await pipeResponse(stream, response);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
  if (!match) {
    response.writeHead(416, { 'content-range': `bytes */${video.size}` });
    response.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : video.size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= video.size) {
    response.writeHead(416, { 'content-range': `bytes */${video.size}` });
    response.end();
    return;
  }
  const stream = video.blobStorage
    ? (await video.blobStorage.openRead(video.key, { start, end })).stream
    : createReadStream(video.file, { start, end });
  response.writeHead(206, {
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${video.size}`,
  });
  await pipeResponse(stream, response);
}

async function pipeResponse(stream, response) {
  try {
    await streamPipeline(stream, response);
  } catch {
    response.destroy();
  }
}
