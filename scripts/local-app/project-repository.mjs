import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { lstat, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  assertProjectId,
  assertSha256,
  storageError,
} from '../storage/contracts.mjs';
import {
  atomicWriteJson,
  clone,
  ensureDirectory,
  sha256Json,
} from '../storage/filesystem-utils.mjs';

const MAX_PROJECT_BYTES = 1024 * 1024;

export function createProjectRepository(options = {}) {
  const storageRoot = path.resolve(
    options.storageRoot || process.env.LOCAL_VIDEO_PROJECTS_ROOT || defaultProjectStorageRoot(),
  );
  let mutation = Promise.resolve();

  const ready = ensureDirectory(storageRoot);

  async function list() {
    await ready;
    const entries = await readdir(storageRoot, { withFileTypes: true });
    const summaries = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        try {
          return (await readStoredProject(path.join(storageRoot, entry.name))).summary;
        } catch {
          return null;
        }
      }));
    return summaries
      .filter(Boolean)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function get(id) {
    await ready;
    return readStoredProject(projectPath(storageRoot, id));
  }

  async function save(project, expectedRevision) {
    return serializeMutation(async () => {
      await ready;
      validateDraftEnvelope(project);
      const target = projectPath(storageRoot, project.id);
      const existing = existsSync(target) ? await readStoredProject(target) : null;
      assertExpectedRevision(existing?.revision, expectedRevision);
      await atomicWriteJson(target, project);
      const stored = await readStoredProject(target);
      return {
        created: !existing,
        project: stored.project,
        revision: stored.revision,
        summary: stored.summary,
      };
    });
  }

  async function remove(id, expectedRevision) {
    return serializeMutation(async () => {
      await ready;
      const target = projectPath(storageRoot, id);
      if (!existsSync(target)) return false;
      const existing = await readStoredProject(target);
      assertExpectedRevision(existing.revision, expectedRevision);
      await rm(target);
      return true;
    });
  }

  function serializeMutation(operation) {
    const result = mutation.then(operation, operation);
    mutation = result.catch(() => {});
    return result;
  }

  return { storageRoot, list, get, save, remove };
}

export function defaultProjectStorageRoot(environment = process.env, homeDirectory = homedir()) {
  if (process.platform === 'win32') {
    return path.join(environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local'), 'DisenadorVideosLocal', 'projects');
  }
  return path.join(environment.XDG_DATA_HOME || path.join(homeDirectory, '.local', 'share'), 'disenador-videos-local', 'projects');
}

function projectPath(storageRoot, id) {
  assertProjectId(id);
  const target = path.resolve(storageRoot, `${id}.json`);
  if (path.dirname(target) !== path.resolve(storageRoot)) {
    throw storageError('PROJECT_PATH_INVALID', 'La ruta del proyecto no es segura.');
  }
  return target;
}

function validateDraftEnvelope(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw storageError('PROJECT_INVALID', 'El proyecto debe ser un objeto.');
  }
  try {
    assertProjectId(project.id);
  } catch {
    throw storageError('PROJECT_INVALID', 'El proyecto no cumple el contrato v1.');
  }
  if (project.version !== 1) {
    throw storageError('PROJECT_INVALID', 'El proyecto no cumple el contrato v1.');
  }
  if (typeof project.title !== 'string' || project.title.length < 1 || project.title.length > 120) {
    throw storageError('PROJECT_INVALID', 'El título del proyecto no es válido.');
  }
  if (!Array.isArray(project.scenes) || project.scenes.length < 1 || project.scenes.length > 8) {
    throw storageError('PROJECT_INVALID', 'El proyecto debe tener entre una y ocho escenas.');
  }
  if (Buffer.byteLength(JSON.stringify(project)) > MAX_PROJECT_BYTES) {
    throw storageError('PROJECT_TOO_LARGE', 'El proyecto supera 1 MB.');
  }
}

async function readStoredProject(file) {
  if (!existsSync(file)) throw storageError('PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  const fileStats = await lstat(file);
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw storageError('PROJECT_PATH_INVALID', 'El proyecto debe ser un archivo regular.');
  }
  if (fileStats.size > MAX_PROJECT_BYTES) {
    throw storageError('PROJECT_TOO_LARGE', 'El proyecto guardado supera 1 MB.');
  }
  let project;
  try {
    project = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw storageError('PROJECT_INVALID', 'El archivo del proyecto no contiene JSON válido.');
  }
  validateDraftEnvelope(project);
  const revision = sha256Json(project);
  const stats = await stat(file);
  return {
    project: clone(project),
    revision,
    summary: {
      id: project.id,
      title: project.title,
      scenes: project.scenes.length,
      revision,
      updatedAt: stats.mtime.toISOString(),
    },
  };
}

function assertExpectedRevision(currentRevision, expectedRevision) {
  if (expectedRevision === undefined || expectedRevision === null) return;
  assertSha256(expectedRevision, 'PROJECT_REVISION_INVALID');
  if (!currentRevision || currentRevision !== expectedRevision) {
    throw storageError(
      'PROJECT_REVISION_CONFLICT',
      'El proyecto cambió desde la revisión esperada.',
    );
  }
}
