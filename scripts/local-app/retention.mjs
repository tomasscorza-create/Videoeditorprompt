import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { isMain, projectRoot, readJson } from '../stage1/common.mjs';
import { PipelineError, serializeError } from '../stage1/errors.mjs';
import { cleanDirectorCaches } from '../director/cache.mjs';

const JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/;
const DISPOSABLE_NAMES = new Set(['frames', 'temp']);
const ACTIVE_STATES = new Set(['queued', 'rendering']);
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

export function cleanupCompletedJob(options) {
  const workRoot = path.resolve(options.workRoot);
  const jobId = assertJobId(options.jobId);
  const jobRoot = resolveChild(workRoot, jobId);
  if (!existsSync(jobRoot)) return { jobId, removedBytes: 0, paths: [], applied: Boolean(options.apply) };
  if (lstatSync(jobRoot).isSymbolicLink()) {
    throw new PipelineError({ code: 'CLEANUP_PATH_INVALID', stage: 'cleanup', message: 'La limpieza no admite trabajos enlazados simbólicamente.' });
  }
  if (options.removeJobRoot) {
    const removedBytes = directoryBytes(jobRoot);
    if (options.apply) {
      assertWithin(workRoot, jobRoot);
      rmSync(jobRoot, { recursive: true, force: true });
    }
    return {
      jobId,
      removedBytes,
      paths: [path.relative(workRoot, jobRoot).replaceAll('\\', '/')],
      applied: Boolean(options.apply),
      removedJobRoot: true,
    };
  }
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
  const inputRoot = resolveChild(localRoot, 'app-input');
  const outputRoot = resolveChild(localRoot, 'output');
  const testsRoot = resolveChild(localRoot, 'tests');
  const bundlesRoot = resolveChild(localRoot, 'persistence-bundles');
  const apply = Boolean(options.apply);
  const maximumAgeDays = Number(options.maximumAgeDays ?? 30);
  const maximumBytes = Number(options.maximumBytes ?? 10 * 1024 ** 3);
  const testMaximumAgeDays = Number(options.testMaximumAgeDays ?? 7);
  const testMaximumBytes = Number(options.testMaximumBytes ?? 1024 ** 3);
  const bundleKeepCount = Number(options.bundleKeepCount ?? 3);
  const orphanOutputAgeDays = Number(options.orphanOutputAgeDays ?? 7);
  const now = Number(options.now ?? Date.now());
  const activeIds = new Set();
  const statuses = new Map();
  if (existsSync(jobsRoot)) {
    for (const entry of readdirSync(jobsRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const status = readJson(path.join(jobsRoot, entry.name));
      if (status?.jobId && JOB_ID_PATTERN.test(status.jobId)) {
        statuses.set(status.jobId, status);
        if (ACTIVE_STATES.has(status.state)) activeIds.add(status.jobId);
      }
    }
  }
  const cleaned = [];
  const expired = [];
  const candidates = [];
  if (existsSync(workRoot)) {
    for (const entry of readdirSync(workRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
      const target = resolveChild(workRoot, entry.name);
      const stats = statSync(target);
      const status = statuses.get(entry.name) || readWorkStatus(target, entry.name);
      if (activeIds.has(entry.name) || ACTIVE_STATES.has(status?.state)) continue;
      if (TERMINAL_STATES.has(status?.state)) {
        const removeJobRoot = status.state === 'completed' && hasVerifiedOutput(outputRoot, entry.name);
        cleaned.push(cleanupCompletedJob({ workRoot, jobId: entry.name, apply, removeJobRoot }));
        if (removeJobRoot) continue;
      }
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
  const tests = cleanDirectoryCollection({
    root: testsRoot,
    apply,
    now,
    maximumAgeDays: testMaximumAgeDays,
    maximumBytes: testMaximumBytes,
  });
  const bundles = cleanNewestDirectoryCollection({
    root: bundlesRoot,
    apply,
    keepCount: bundleKeepCount,
  });
  const orphanOutputs = cleanOrphanOutputs({
    outputRoot,
    apply,
    now,
    maximumAgeDays: orphanOutputAgeDays,
  });
  const orphanInputs = cleanOrphanInputs({
    inputRoot,
    statuses,
    apply,
    now,
    maximumAgeDays,
  });
  const directorCaches = ['director-cache', 'director-question-cache', 'director-edit-cache'].map((name) => cleanDirectorCaches({
    root: resolveChild(localRoot, name),
    apply,
    now,
    maximumAgeDays: Number(options.directorCacheMaximumAgeDays ?? 30),
    maximumBytes: Number(options.directorCacheMaximumBytes ?? 512 * 1024 ** 2),
    maximumEntries: Number(options.directorCacheMaximumEntries ?? 1_000),
  }));
  return {
    version: 1,
    applied: apply,
    localRoot,
    maximumAgeDays,
    maximumBytes,
    cleaned,
    expired,
    tests,
    bundles,
    orphanOutputs,
    orphanInputs,
    directorCaches,
    reclaimedBytes: cleaned.reduce((sum, item) => sum + item.removedBytes, 0)
      + expired.reduce((sum, item) => sum + item.bytes, 0)
      + tests.reduce((sum, item) => sum + item.bytes, 0)
      + bundles.reduce((sum, item) => sum + item.bytes, 0)
      + orphanOutputs.reduce((sum, item) => sum + item.bytes, 0)
      + orphanInputs.reduce((sum, item) => sum + item.bytes, 0)
      + directorCaches.flatMap((result) => result.removed).reduce((sum, item) => sum + item.bytes, 0),
  };
}

// Barrido de retención pensado para el arranque del servicio local: aplica políticas
// acotadas sobre work, tests, bundles, outputs incompletos e inputs huérfanos. Respeta
// trabajos activos y nunca toca outputs con MP4 o verificación. Jamás lanza: una
// limpieza fallida no puede impedir que el servidor levante.
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

function hasVerifiedOutput(outputRoot, jobId) {
  const jobOutput = resolveChild(outputRoot, jobId);
  return existsSync(path.join(jobOutput, 'render-1.mp4'))
    && existsSync(path.join(jobOutput, 'project-manifest.json'))
    && existsSync(path.join(jobOutput, 'verification.json'));
}

function cleanDirectoryCollection({ root, apply, now, maximumAgeDays, maximumBytes }) {
  if (!existsSync(root)) return [];
  const candidates = safeChildDirectories(root).map((target) => {
    const stats = statSync(target);
    return {
      target,
      name: path.basename(target),
      mtimeMs: stats.mtimeMs,
      ageDays: (now - stats.mtimeMs) / 86_400_000,
      bytes: directoryBytes(target),
    };
  });
  const selected = new Map();
  for (const candidate of candidates) {
    if (maximumAgeDays >= 0 && candidate.ageDays > maximumAgeDays) {
      selected.set(candidate.target, { ...candidate, reason: 'age' });
    }
  }
  let retainedBytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0)
    - [...selected.values()].reduce((sum, candidate) => sum + candidate.bytes, 0);
  if (maximumBytes >= 0 && retainedBytes > maximumBytes) {
    for (const candidate of candidates.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
      if (selected.has(candidate.target)) continue;
      selected.set(candidate.target, { ...candidate, reason: 'size' });
      retainedBytes -= candidate.bytes;
      if (retainedBytes <= maximumBytes) break;
    }
  }
  return removeCandidates(root, [...selected.values()], apply);
}

function cleanNewestDirectoryCollection({ root, apply, keepCount }) {
  if (!existsSync(root)) return [];
  const retained = Math.max(0, Math.trunc(keepCount));
  const candidates = safeChildDirectories(root)
    .map((target) => ({ target, name: path.basename(target), mtimeMs: statSync(target).mtimeMs, bytes: directoryBytes(target), reason: 'count' }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(retained);
  return removeCandidates(root, candidates, apply);
}

function cleanOrphanOutputs({ outputRoot, apply, now, maximumAgeDays }) {
  if (!existsSync(outputRoot)) return [];
  const candidates = [];
  for (const target of safeChildDirectories(outputRoot)) {
    const names = readdirSync(target);
    const hasMp4 = names.some((name) => name.endsWith('.mp4'));
    if (hasMp4 || names.includes('verification.json')) continue;
    const stats = statSync(target);
    const ageDays = (now - stats.mtimeMs) / 86_400_000;
    if (maximumAgeDays >= 0 && ageDays > maximumAgeDays) {
      candidates.push({ target, name: path.basename(target), ageDays, bytes: directoryBytes(target), reason: 'orphan' });
    }
  }
  return removeCandidates(outputRoot, candidates, apply);
}

function cleanOrphanInputs({ inputRoot, statuses, apply, now, maximumAgeDays }) {
  if (!existsSync(inputRoot)) return [];
  const candidates = [];
  for (const target of safeChildDirectories(inputRoot)) {
    const jobId = path.basename(target);
    if (!JOB_ID_PATTERN.test(jobId) || statuses.has(jobId)) continue;
    const stats = statSync(target);
    const ageDays = (now - stats.mtimeMs) / 86_400_000;
    if (maximumAgeDays >= 0 && ageDays > maximumAgeDays) {
      candidates.push({ target, name: jobId, ageDays, bytes: directoryBytes(target), reason: 'orphan' });
    }
  }
  return removeCandidates(inputRoot, candidates, apply);
}

function safeChildDirectories(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => resolveChild(root, entry.name));
}

function removeCandidates(root, candidates, apply) {
  for (const candidate of candidates) {
    assertWithin(root, candidate.target);
    if (apply) rmSync(candidate.target, { recursive: true, force: true });
  }
  return candidates.map(({ target, ...candidate }) => ({
    ...candidate,
    path: path.relative(root, target).replaceAll('\\', '/'),
  }));
}

function readWorkStatus(jobRoot, jobId) {
  const statusFile = path.join(jobRoot, 'status', 'job-status.json');
  if (!existsSync(statusFile) || lstatSync(statusFile).isSymbolicLink()) return null;
  try {
    const status = readJson(statusFile);
    return status?.jobId === jobId && typeof status.state === 'string' ? status : null;
  } catch {
    return null;
  }
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
