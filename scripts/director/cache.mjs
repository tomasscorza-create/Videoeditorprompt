import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory } from '../stage1/common.mjs';

export function readDirectorCache(file) {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value?.cacheMetadata && typeof value.cacheMetadata === 'object') {
      value.cacheMetadata.lastAccessedAt = new Date().toISOString();
      writeDirectorCache(file, value);
    }
    return value;
  } catch {
    quarantineDirectorCache(file);
    return null;
  }
}

export function writeDirectorCache(file, value) {
  ensureDirectory(path.dirname(file));
  const now = new Date().toISOString();
  const document = {
    ...value,
    cacheMetadata: {
      version: 1,
      createdAt: value?.cacheMetadata?.createdAt || now,
      lastAccessedAt: now,
      provider: value?.cacheMetadata?.provider || null,
      model: value?.cacheMetadata?.model || null,
      semanticHash: path.basename(file, '.json'),
    },
  };
  const temporary = `${file}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const previous = existsSync(file) ? `${file}.previous-${process.pid}-${randomBytes(4).toString('hex')}` : null;
  try {
    if (previous) renameSync(file, previous);
    renameSync(temporary, file);
    if (previous && existsSync(previous)) unlinkSync(previous);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    if (previous && existsSync(previous) && !existsSync(file)) renameSync(previous, file);
    throw error;
  }
}

/** Retención local y acotada de propuestas, preguntas y ediciones del Director. */
export function cleanDirectorCaches(options = {}) {
  const root = path.resolve(options.root);
  const apply = Boolean(options.apply);
  const now = Number(options.now ?? Date.now());
  const maximumAgeDays = Number(options.maximumAgeDays ?? 30);
  const maximumBytes = Number(options.maximumBytes ?? 512 * 1024 ** 2);
  const maximumEntries = Number(options.maximumEntries ?? 1_000);
  const files = listCacheFiles(root).map((file) => {
    const stats = statSync(file);
    return { file, bytes: stats.size, mtimeMs: stats.mtimeMs, ageDays: (now - stats.mtimeMs) / 86_400_000 };
  });
  const selected = new Map();
  for (const entry of files) {
    if ((maximumAgeDays >= 0 && entry.ageDays > maximumAgeDays) || entry.file.includes('.invalid-')) {
      selected.set(entry.file, { ...entry, reason: entry.file.includes('.invalid-') ? 'invalid' : 'age' });
    }
  }
  const remaining = () => files.filter((entry) => !selected.has(entry.file)).sort((left, right) => left.mtimeMs - right.mtimeMs);
  while ((maximumEntries >= 0 && remaining().length > maximumEntries)
    || (maximumBytes >= 0 && remaining().reduce((total, entry) => total + entry.bytes, 0) > maximumBytes)) {
    const oldest = remaining()[0];
    if (!oldest) break;
    selected.set(oldest.file, { ...oldest, reason: maximumEntries >= 0 && remaining().length > maximumEntries ? 'count' : 'size' });
  }
  for (const entry of selected.values()) {
    assertCacheChild(root, entry.file);
    if (apply) rmSync(entry.file, { force: true });
  }
  return { version: 1, root, applied: apply, entries: files.length, removed: [...selected.values()].map(({ file, ...entry }) => ({ ...entry, path: path.relative(root, file).replaceAll('\\', '/') })) };
}

function listCacheFiles(root) {
  if (!existsSync(root)) return [];
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.includes('.invalid-'))) found.push(file);
    }
  };
  visit(root);
  return found;
}

function assertCacheChild(root, file) {
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('La limpieza de caché intentó salir de .local-video.');
}

export function quarantineDirectorCache(file) {
  if (!existsSync(file)) return;
  try {
    renameSync(file, `${file}.invalid-${Date.now()}-${randomBytes(4).toString('hex')}`);
  } catch {
    // La caché es una optimización: si otro proceso la está usando, se ignora
    // y el resultado nuevo sigue devolviéndose aunque no pueda persistirse.
  }
}
