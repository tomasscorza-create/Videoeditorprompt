import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { storageError } from './contracts.mjs';

const MAX_SECRET_BYTES = 16 * 1024;
const MAX_CA_BYTES = 1024 * 1024;

export function resolveConfiguredSecret({
  environment,
  valueName,
  fileName,
  fallback,
  required = false,
  label,
}) {
  const direct = environment[valueName];
  const secretFile = environment[fileName];
  if (direct !== undefined && secretFile !== undefined) {
    throw storageError(
      'SECRET_CONFIG_CONFLICT',
      `Configure ${label} mediante valor o archivo, no ambos.`,
    );
  }
  let value = direct;
  if (secretFile !== undefined) {
    value = readBoundedFile(secretFile, MAX_SECRET_BYTES, 'SECRET_FILE_INVALID')
      .replace(/\r?\n$/u, '');
  }
  if (value === undefined) value = fallback;
  if (required && (typeof value !== 'string' || value.length === 0)) {
    throw storageError('SECRET_REQUIRED', `Falta ${label}.`);
  }
  return value;
}

export function readCertificateAuthority(file) {
  if (file === undefined || file === '') return undefined;
  const value = readBoundedFile(file, MAX_CA_BYTES, 'TLS_CA_FILE_INVALID');
  if (!value.includes('-----BEGIN CERTIFICATE-----')) {
    throw storageError('TLS_CA_FILE_INVALID', 'El archivo CA no contiene un certificado PEM.');
  }
  return value;
}

function readBoundedFile(file, maximumBytes, code) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) {
    throw storageError(code, 'La ruta del secreto debe ser absoluta.');
  }
  try {
    const stats = statSync(file);
    if (!stats.isFile() || stats.size < 1 || stats.size > maximumBytes) {
      throw storageError(code, 'El archivo de secreto no es regular o supera el límite.');
    }
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === code) throw error;
    throw storageError(code, 'No se pudo leer el archivo de secreto.');
  }
}
