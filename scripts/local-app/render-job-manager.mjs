import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { PipelineError, serializeError } from '../stage1/errors.mjs';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { loadAuthoringCatalog } from '../director/director-plan.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { cleanupCompletedJob } from './retention.mjs';

const JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const MAX_IN_MEMORY_JOBS = 500;

export function createRenderJobManager(options = {}) {
  const root = path.resolve(options.root || projectRoot);
  const assetsRoot = path.resolve(options.assetsRoot || path.join(root, 'public'));
  const appJobsRoot = ensureDirectory(path.resolve(options.appJobsRoot || path.join(root, '.local-video', 'app-jobs')));
  const appInputRoot = ensureDirectory(path.resolve(options.appInputRoot || path.join(root, '.local-video', 'app-input')));
  const workRoot = path.resolve(options.workRoot || path.join(root, '.local-video', 'work'));
  const outputRoot = path.resolve(options.outputRoot || path.join(root, '.local-video', 'output'));
  const catalog = options.catalog || loadAuthoringCatalog(assetsRoot);
  const pipelineScript = path.join(root, 'scripts', 'stage3a', 'project-pipeline.mjs');
  const spawnImpl = options.spawnImpl || spawn;
  const terminateTree = options.terminateProcessTreeImpl || terminateProcessTree;
  const jobs = new Map();
  let activeJobId = null;
  recoverPersistedJobs();

  function create(project) {
    if (activeJobId) {
      throw new PipelineError({
        code: 'RENDER_BUSY',
        stage: 'queueing',
        message: 'Ya existe un render activo en este equipo.',
        technicalDetail: activeJobId,
        suggestedAction: 'Esperá a que termine el trabajo actual antes de iniciar otro.',
      });
    }
    validateVideoProjectDocument({ project, catalog, assetsRoot });
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
    };
    jobs.set(jobId, job);
    activeJobId = jobId;
    persist(job);
    launch(job);
    return publicJob(job);
  }

  function launch(job) {
    update(job, { state: 'rendering', stage: 'starting_pipeline' });
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
    persist(job);
    const timeoutMs = Number(options.renderTimeoutMs || 45 * 60 * 1000);
    job.timeout = setTimeout(() => {
      fail(job, new PipelineError({
        code: 'RENDER_TIMEOUT',
        stage: 'rendering',
        message: 'El render superó el tiempo máximo permitido.',
        suggestedAction: 'Reducí la cantidad de escenas o revisá el rendimiento de Piper y FFmpeg.',
      }));
      terminateTree(child);
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => consumeStdout(job, chunk));
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on('error', (error) => fail(job, error));
    child.on('close', (code) => {
      if (job.state === 'cancelled') {
        cleanupJob(job);
        return;
      }
      if (job.state === 'failed') return;
      if (code !== 0) {
        const reportedFailure = job.progress?.state === 'failed' ? job.progress : null;
        fail(job, new PipelineError(reportedFailure ? {
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
        fail(job, new PipelineError({
          code: 'RENDER_OUTPUT_MISSING',
          stage: 'verifying_project',
          message: 'El pipeline terminó sin producir el manifiesto o el MP4 esperado.',
          suggestedAction: 'Revisá los outputs aislados del trabajo.',
        }));
        return;
      }
      const manifest = readJson(manifestFile);
      complete(job, {
        stage: 'project_pipeline',
        result: {
          durationSeconds: manifest.timeline.durationSeconds,
          scenes: manifest.timeline.scenes.length,
          deterministic: manifest.deterministic,
          videoUrl: `/api/render-jobs/${job.jobId}/video`,
          downloadName: `${job.projectId}.mp4`,
        },
      });
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
          update(job, {
            state: 'rendering',
            stage: event.stage || event.state || job.stage,
            progress: event,
          });
        }
      } catch {
        // La salida externa no estructurada se ignora; el pipeline conserva sus propios logs.
      }
    }
  }

  function get(jobId) {
    assertJobId(jobId);
    const inMemory = jobs.get(jobId);
    if (inMemory) return publicJob(inMemory);
    const statusFile = statusPath(jobId);
    if (!existsSync(statusFile)) return null;
    return readJson(statusFile);
  }

  function cancel(jobId) {
    assertJobId(jobId);
    const job = jobs.get(jobId);
    if (!job || !['queued', 'rendering'].includes(job.state)) return get(jobId);
    const processToKill = job.process;
    clearTimeout(job.timeout);
    job.timeout = null;
    job.process = null;
    activeJobId = null;
    update(job, { state: 'cancelled', stage: 'cancelled' });
    if (processToKill) terminateTree(processToKill);
    return publicJob(job);
  }

  function video(jobId) {
    const status = get(jobId);
    if (!status || status.state !== 'completed') return null;
    const file = resultPath(jobId, 'render-1.mp4');
    if (!existsSync(file)) return null;
    return { file, size: statSync(file).size, name: status.result.downloadName };
  }

  function list() {
    return [...jobs.values()].map(publicJob).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  function cancelActive() {
    return activeJobId ? cancel(activeJobId) : null;
  }

  function update(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    persist(job);
  }

  function complete(job, patch) {
    clearTimeout(job.timeout);
    job.timeout = null;
    job.process = null;
    activeJobId = null;
    update(job, { ...patch, state: 'completed', error: null });
    cleanupJob(job);
  }

  function cleanupJob(job) {
    try {
      const cleanup = cleanupCompletedJob({ workRoot, jobId: job.jobId, apply: true });
      update(job, { cleanup: { removedBytes: cleanup.removedBytes, paths: cleanup.paths.length } });
    } catch (error) {
      update(job, { cleanup: { removedBytes: 0, paths: 0, warning: serializeError(error, 'cleanup') } });
    }
  }

  function fail(job, error) {
    if (!job || job.state === 'failed') return;
    clearTimeout(job.timeout);
    job.timeout = null;
    job.process = null;
    if (activeJobId === job.jobId) activeJobId = null;
    update(job, {
      state: 'failed',
      error: serializeError(error, job.stage || 'rendering'),
    });
  }

  function persist(job) {
    writeJson(statusPath(job.jobId), publicJob(job));
  }

  function statusPath(jobId) {
    return path.join(appJobsRoot, `${jobId}.json`);
  }

  function resultPath(jobId, filename) {
    assertJobId(jobId);
    return path.join(outputRoot, jobId, filename);
  }

  function recoverPersistedJobs() {
    for (const entry of readdirSync(appJobsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const status = readJson(path.join(appJobsRoot, entry.name));
        if (!status?.jobId || !JOB_ID_PATTERN.test(status.jobId)) continue;
        const recovered = { ...status, process: null, processId: null, stdoutBuffer: '', timeout: null };
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
        }
        jobs.set(recovered.jobId, recovered);
        if (recovered.state === 'failed' && recovered.stage === 'recovery') persist(recovered);
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

  return { create, get, list, cancel, cancelActive, video, get activeJobId() { return activeJobId; } };
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

export function streamVideoResponse(request, response, video) {
  const range = request.headers.range;
  response.setHeader('accept-ranges', 'bytes');
  response.setHeader('content-type', 'video/mp4');
  response.setHeader('content-disposition', `inline; filename="${video.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`);
  if (!range) {
    response.writeHead(200, { 'content-length': video.size });
    createReadStream(video.file).pipe(response);
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
  response.writeHead(206, {
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${video.size}`,
  });
  createReadStream(video.file, { start, end }).pipe(response);
}
