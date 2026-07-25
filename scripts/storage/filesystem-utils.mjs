import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function atomicWriteJson(file, value, options = {}) {
  await ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    if (options.exclusive) {
      await writeFile(file, await readFile(temporary), { flag: 'wx' });
      await rm(temporary, { force: true });
      return;
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

export function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function clone(value) {
  return structuredClone(value);
}

export function isWithin(root, target, allowRoot = false) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (allowRoot && relative === '')
    || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}
