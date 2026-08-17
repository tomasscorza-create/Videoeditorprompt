import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory } from '../stage1/common.mjs';

export function readDirectorCache(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    quarantineDirectorCache(file);
    return null;
  }
}

export function writeDirectorCache(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

export function quarantineDirectorCache(file) {
  if (!existsSync(file)) return;
  try {
    renameSync(file, `${file}.invalid-${Date.now()}-${randomBytes(4).toString('hex')}`);
  } catch {
    // La caché es una optimización: si otro proceso la está usando, se ignora
    // y el resultado nuevo sigue devolviéndose aunque no pueda persistirse.
  }
}
