import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { isMain, projectRoot, readJson } from '../stage1/common.mjs';
import { PipelineError, serializeError } from '../stage1/errors.mjs';

const JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const DISPOSABLE_NAMES = new Set(['frames', 'temp']);

export function cleanupCompletedJob(options) {
  const workRoot = path.resolve(options.workRoot);
  const jobId = assertJobId(options.jobId);
  const jobRoot = resolveChild(workRoot, jobId);
  if (!existsSync(jobRoot)) return { jobId, removedBytes: 0, paths: [], applied: Boolean(options.apply) };
  const paths = findDisposableDirectories(jobRoot);
  const removedBytes = paths.reduce((total, target) => total + directoryBytes(target), 0);
  if (options.apply) {
    for (const target of paths.sort((left, right) => right.length - left.length)) {
      assertWithin(jobRoot, target);
      rmSync(target, { recursive: true, force: true });
    }
  }
  return { jobId, removedBytes, paths: paths.map((target) => path.relative(workRoot, target).replaceAll('\\', '/')), applied: Boolean(options.apply) };
}

export function cleanLocalVideo(options = {}) {
  const localRoot = path.resolve(options.localRoot || path.join(projectRoot, '.local-video'));
  const workRoot = resolveChild(localRoot, 'work');
  const jobsRoot = resolveChild(localRoot, 'app-jobs');
  const apply = Boolean(options.apply);
  const maximumAgeDays = Number(options.maximumAgeDays ?? 30);
  const maximumBytes = Number(options.maximumBytes ?? 10 * 1024 ** 3);
  const now = Number(options.now ?? Date.now());
  const activeIds = new Set();
  const statuses = new Map();
  if (existsSync(jobsRoot)) {
    for (const entry of readdirSync(jobsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const status = readJson(path.join(jobsRoot, entry.name));
      if (status?.jobId && JOB_ID_PATTERN.test(status.jobId)) {
        statuses.set(status.jobId, status);
        if (['queued', 'rendering'].includes(status.state)) activeIds.add(status.jobId);
      }
    }
  }
  const cleaned = [];
  const expired = [];
  const candidates = [];
  if (existsSync(workRoot)) {
    for (const entry of readdirSync(workRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name) || activeIds.has(entry.name)) continue;
      const status = statuses.get(entry.name);
      if (status?.state === 'completed') cleaned.push(cleanupCompletedJob({ workRoot, jobId: entry.name, apply }));
      const target = resolveChild(workRoot, entry.name);
      const stats = statSync(target);
      candidates.push({
        jobId: entry.name,
        target,
        mtimeMs: stats.mtimeMs,
        ageDays: (now - stats.mtimeMs) / 86_400_000,
        bytes: directoryBytes(target),
      });
    }
  }
  const selected = new Map();
  for (const candidate of candidates) {
    if (maximumAgeDays >= 0 && candidate.ageDays > maximumAgeDays) selected.set(candidate.jobId, { ...candidate, reason: 'age' });
  }
  let retainedBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0)
    - [...selected.values()].reduce((sum, candidate) => sum + candidate.bytes, 0);
  if (maximumBytes >= 0 && retainedBytes > maximumBytes) {
    for (const candidate of candidates.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
      if (selected.has(candidate.jobId)) continue;
      selected.set(candidate.jobId, { ...candidate, reason: 'size' });
      retainedBytes -= candidate.bytes;
      if (retainedBytes <= maximumBytes) break;
    }
  }
  for (const candidate of selected.values()) {
    if (apply) rmSync(candidate.target, { recursive: true, force: true });
    expired.push({
      jobId: candidate.jobId,
      ageDays: candidate.ageDays,
      bytes: candidate.bytes,
      reason: candidate.reason,
    });
  }
  return {
    version: 1,
    applied: apply,
    localRoot,
    maximumAgeDays,
    maximumBytes,
    cleaned,
    expired,
    reclaimedBytes: cleaned.reduce((sum, item) => sum + item.removedBytes, 0) + expired.reduce((sum, item) => sum + item.bytes, 0),
  };
}

// Barrido de retención pensado para el arranque del servicio local: aplica la política
// existente (edad + tamaño) sobre `.local-video/work`, respeta los trabajos activos y
// nunca toca los MP4 finales (viven fuera de `work/`). Jamás lanza: una limpieza fallida
// no puede impedir que el servidor levante.
export function runStartupRetention(options = {}) {
  try {
    return cleanLocalVideo({ ...options, apply: true });
  } catch (error) {
    return { version: 1, applied: false, skipped: true, error: serializeError(error, 'cleanup') };
  }
}

function findDisposableDirectories(root) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;
      if (DISPOSABLE_NAMES.has(entry.name)) found.push(target);
      else visit(target);
    }
  };
  visit(root);
  return found;
}

function directoryBytes(root) {
  let total = 0;
  const visit = (target) => {
    const stats = lstatSync(target);
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      for (const name of readdirSync(target)) visit(path.join(target, name));
    } else total += stats.size;
  };
  visit(root);
  return total;
}

function assertJobId(jobId) {
  if (!JOB_ID_PATTERN.test(String(jobId))) {
    throw new PipelineError({ code: 'JOB_ID_INVALID', stage: 'cleanup', message: 'El jobId de limpieza no es válido.' });
  }
  return String(jobId);
}

function resolveChild(root, child) {
  const target = path.resolve(root, child);
  assertWithin(root, target);
  return target;
}

function assertWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PipelineError({ code: 'CLEANUP_PATH_INVALID', stage: 'cleanup', message: 'La ruta de limpieza escapa de la raíz permitida.', technicalDetail: target });
  }
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const ageArgument = process.argv.find((argument) => argument.startsWith('--max-age-days='));
  const bytesArgument = process.argv.find((argument) => argument.startsWith('--max-bytes='));
  const maximumAgeDays = ageArgument ? Number(ageArgument.split('=')[1]) : 30;
  const maximumBytes = bytesArgument ? Number(bytesArgument.split('=')[1]) : 10 * 1024 ** 3;
  const result = cleanLocalVideo({ apply, maximumAgeDays, maximumBytes });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
