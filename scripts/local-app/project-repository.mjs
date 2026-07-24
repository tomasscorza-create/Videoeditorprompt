import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ensureDirectory } from '../stage1/common.mjs';

const PROJECT_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u;
const MAX_PROJECT_BYTES = 1024 * 1024;

export function createProjectRepository(options = {}) {
  const storageRoot = ensureDirectory(path.resolve(
    options.storageRoot || process.env.LOCAL_VIDEO_PROJECTS_ROOT || defaultProjectStorageRoot(),
  ));

  return {
    storageRoot,
    list() {
      return readdirSync(storageRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .flatMap((entry) => {
          try {
            const project = readProjectFile(path.join(storageRoot, entry.name));
            const stats = statSync(path.join(storageRoot, entry.name));
            return [{
              id: project.id,
              title: project.title,
              scenes: project.scenes.length,
              updatedAt: stats.mtime.toISOString(),
            }];
          } catch {
            return [];
          }
        })
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    get(id) {
      return readProjectFile(projectPath(storageRoot, id));
    },
    save(project) {
      validateDraftEnvelope(project);
      const target = projectPath(storageRoot, project.id);
      const created = !existsSync(target);
      atomicWriteJson(target, project);
      return {
        created,
        project: structuredClone(project),
        summary: {
          id: project.id,
          title: project.title,
          scenes: project.scenes.length,
          updatedAt: statSync(target).mtime.toISOString(),
        },
      };
    },
    remove(id) {
      const target = projectPath(storageRoot, id);
      if (!existsSync(target)) return false;
      rmSync(target);
      return true;
    },
  };
}

export function defaultProjectStorageRoot(environment = process.env, homeDirectory = homedir()) {
  if (process.platform === 'win32') {
    return path.join(environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local'), 'DisenadorVideosLocal', 'projects');
  }
  return path.join(environment.XDG_DATA_HOME || path.join(homeDirectory, '.local', 'share'), 'disenador-videos-local', 'projects');
}

function projectPath(storageRoot, id) {
  if (typeof id !== 'string' || !PROJECT_ID.test(id)) throw repositoryError('PROJECT_ID_INVALID', 'El ID del proyecto no es válido.');
  const target = path.resolve(storageRoot, `${id}.json`);
  if (path.dirname(target) !== path.resolve(storageRoot)) throw repositoryError('PROJECT_PATH_INVALID', 'La ruta del proyecto no es segura.');
  return target;
}

function validateDraftEnvelope(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) throw repositoryError('PROJECT_INVALID', 'El proyecto debe ser un objeto.');
  if (project.version !== 1 || !PROJECT_ID.test(project.id || '')) throw repositoryError('PROJECT_INVALID', 'El proyecto no cumple el contrato v1.');
  if (typeof project.title !== 'string' || project.title.length < 1 || project.title.length > 120) throw repositoryError('PROJECT_INVALID', 'El título del proyecto no es válido.');
  if (!Array.isArray(project.scenes) || project.scenes.length < 1 || project.scenes.length > 8) throw repositoryError('PROJECT_INVALID', 'El proyecto debe tener entre una y ocho escenas.');
  const serialized = JSON.stringify(project);
  if (Buffer.byteLength(serialized) > MAX_PROJECT_BYTES) throw repositoryError('PROJECT_TOO_LARGE', 'El proyecto supera 1 MB.');
}

function readProjectFile(file) {
  if (!existsSync(file)) throw repositoryError('PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
  const bytes = readFileSync(file);
  if (bytes.length > MAX_PROJECT_BYTES) throw repositoryError('PROJECT_TOO_LARGE', 'El proyecto guardado supera 1 MB.');
  let project;
  try {
    project = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw repositoryError('PROJECT_INVALID', 'El archivo del proyecto no contiene JSON válido.');
  }
  validateDraftEnvelope(project);
  return project;
}

function atomicWriteJson(file, value) {
  const temporary = `${file}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

function repositoryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
