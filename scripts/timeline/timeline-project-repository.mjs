import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { exportTimelineDocument, validateTimelineDocument } from '../../shared/timeline-clip-core.js';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u;

export async function createTimelineProjectRepository(options = {}) {
  const storageRoot = path.resolve(options.storageRoot || path.join(process.cwd(), '.local-video', 'timeline-v2', 'projects'));
  await mkdir(storageRoot, { recursive: true });

  function list() {
    return readdirSync(storageRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readStored(path.join(storageRoot, entry.name)))
      .filter(Boolean)
      .map(({ project, revision, updatedAt }) => ({ id: project.id, revision, updatedAt, clips: project.clips.length }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function get(id) {
    assertId(id);
    const stored = readStored(fileFor(storageRoot, id));
    if (!stored) throw timelineProjectError('TIMELINE_PROJECT_NOT_FOUND', 'No existe el montaje V2 solicitado.');
    return stored;
  }

  function save(project, expectedRevision) {
    validateTimelineDocument(project);
    const file = fileFor(storageRoot, project.id);
    const previous = readStored(file);
    if (expectedRevision && previous?.revision !== expectedRevision) {
      throw timelineProjectError('TIMELINE_PROJECT_REVISION_CONFLICT', 'El montaje cambió en otra sesión.');
    }
    const canonical = exportTimelineDocument(project);
    const revision = createHash('sha256').update(canonical).digest('hex');
    const stored = { version: 1, project: JSON.parse(canonical), revision, updatedAt: new Date().toISOString() };
    const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    renameSync(temporary, file);
    return { created: !previous, ...stored };
  }

  return { storageRoot, list, get, save };
}

function fileFor(root, id) {
  assertId(id);
  return path.join(root, `${id}.json`);
}

function readStored(file) {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    validateTimelineDocument(value.project);
    if (value.version !== 1 || typeof value.revision !== 'string') throw new Error('invalid');
    return value;
  } catch {
    throw timelineProjectError('TIMELINE_PROJECT_STORAGE_INVALID', 'Un montaje V2 guardado está dañado.');
  }
}

function assertId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw timelineProjectError('TIMELINE_PROJECT_ID_INVALID', 'El ID del montaje no es portable.');
}

function timelineProjectError(code, message) {
  return Object.assign(new Error(message), { code, stage: 'timeline_project' });
}
