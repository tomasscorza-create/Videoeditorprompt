import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertJobId, storageError } from './contracts.mjs';
import { atomicWriteJson, clone, ensureDirectory } from './filesystem-utils.mjs';

const MAX_JOB_BYTES = 1024 * 1024;

export function createFileRenderJobRepository(options) {
  const storageRoot = path.resolve(options.storageRoot);
  const ready = ensureDirectory(storageRoot);
  let mutation = Promise.resolve();

  async function reserve(job) {
    return serializeMutation(async () => {
      await ready;
      validateJob(job);
      const target = statusPath(storageRoot, job.jobId);
      try {
        await writeFile(target, `${JSON.stringify(job, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
        });
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw storageError('RENDER_JOB_CONFLICT', 'El jobId ya está reservado.');
        }
        throw error;
      }
    });
  }

  async function get(jobId) {
    await ready;
    assertJobId(jobId);
    const target = statusPath(storageRoot, jobId);
    if (!existsSync(target)) return null;
    return readJob(target);
  }

  async function list(filter = {}) {
    await ready;
    const entries = await readdir(storageRoot, { withFileTypes: true });
    const jobs = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        try {
          return await readJob(path.join(storageRoot, entry.name));
        } catch {
          return null;
        }
      }));
    const states = Array.isArray(filter.states) ? new Set(filter.states) : null;
    return jobs
      .filter((job) => job && (!states || states.has(job.state)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async function transition(jobId, expectedState, event) {
    return serializeMutation(async () => {
      const current = await get(jobId);
      if (!current) throw storageError('RENDER_JOB_NOT_FOUND', 'No se encontró el trabajo.');
      if (current.state !== expectedState) {
        throw storageError(
          'RENDER_JOB_STATE_CONFLICT',
          'El trabajo cambió de estado antes de aplicar la transición.',
          `expected=${expectedState}; actual=${current.state}`,
        );
      }
      const next = { ...current, ...clone(event) };
      validateJob(next);
      await atomicWriteJson(statusPath(storageRoot, jobId), next);
      return clone(next);
    });
  }

  function serializeMutation(operation) {
    const result = mutation.then(operation, operation);
    mutation = result.catch(() => {});
    return result;
  }

  return { storageRoot, reserve, get, list, transition };
}

function statusPath(storageRoot, jobId) {
  assertJobId(jobId);
  return path.join(storageRoot, `${jobId}.json`);
}

async function readJob(file) {
  const bytes = await readFile(file);
  if (bytes.length > MAX_JOB_BYTES) {
    throw storageError('RENDER_JOB_INVALID', 'El estado del trabajo supera 1 MB.');
  }
  let job;
  try {
    job = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw storageError('RENDER_JOB_INVALID', 'El estado del trabajo no contiene JSON válido.');
  }
  validateJob(job);
  return clone(job);
}

function validateJob(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) {
    throw storageError('RENDER_JOB_INVALID', 'El estado del trabajo no es válido.');
  }
  assertJobId(job.jobId);
  if (
    job.version !== 1
    || typeof job.projectId !== 'string'
    || typeof job.state !== 'string'
    || typeof job.stage !== 'string'
    || typeof job.createdAt !== 'string'
    || typeof job.updatedAt !== 'string'
  ) {
    throw storageError('RENDER_JOB_INVALID', 'El estado del trabajo está incompleto.');
  }
  if (Buffer.byteLength(JSON.stringify(job)) > MAX_JOB_BYTES) {
    throw storageError('RENDER_JOB_INVALID', 'El estado del trabajo supera 1 MB.');
  }
  assertNoHostPaths(job);
}

function assertNoHostPaths(value) {
  if (Array.isArray(value)) {
    value.forEach(assertNoHostPaths);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(assertNoHostPaths);
    return;
  }
  if (
    typeof value === 'string'
    && (/^[a-zA-Z]:[\\/]/u.test(value) || /^\/(?:home|Users|var|tmp|opt|srv|mnt|root)\//u.test(value))
  ) {
    throw storageError('RENDER_JOB_PATH_INVALID', 'El estado durable no admite rutas absolutas.');
  }
}
