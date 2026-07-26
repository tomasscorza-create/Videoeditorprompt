import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { storageError } from './contracts.mjs';
import { isWithin } from './filesystem-utils.mjs';

export const DEFAULT_MAXIMUM_BLOB_BYTES = 1024 * 1024 * 1024;

export function assertMaximumBlobBytes(value) {
  const maximumBytes = Number(value || DEFAULT_MAXIMUM_BLOB_BYTES);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw storageError('BLOB_SIZE_INVALID', 'El límite de blobs no es válido.');
  }
  return maximumBytes;
}

export async function blobInputStream(input) {
  if (Buffer.isBuffer(input?.bytes) || input?.bytes instanceof Uint8Array) {
    return Readable.from([Buffer.from(input.bytes)]);
  }
  if (typeof input?.sourceFile === 'string') {
    const source = path.resolve(input.sourceFile);
    await assertRegularFile(source);
    return createReadStream(source);
  }
  if (input?.stream && typeof input.stream.pipe === 'function') return input.stream;
  throw storageError('BLOB_INPUT_INVALID', 'El blob requiere bytes, stream o archivo fuente.');
}

export async function streamToFile(source, target, maximumBytes) {
  let bytes = 0;
  const hash = createHash('sha256');
  const measuring = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximumBytes) {
        callback(storageError('BLOB_TOO_LARGE', 'El blob supera el tamaño máximo permitido.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(source, measuring, createWriteStream(target, { flags: 'wx' }));
  if (bytes === 0) {
    throw storageError('BLOB_EMPTY', 'El blob no puede estar vacío.');
  }
  return { bytes, sha256: hash.digest('hex') };
}

export async function streamToHash(source, maximumBytes = DEFAULT_MAXIMUM_BLOB_BYTES) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of source) {
    bytes += chunk.length;
    if (bytes > maximumBytes) {
      throw storageError('BLOB_TOO_LARGE', 'El blob supera el tamaño máximo permitido.');
    }
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}

export function safeTemporaryPath(target) {
  return `${target}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
}

export function assertMaterializationDestination(materializationRoot, destination) {
  const target = path.resolve(destination);
  if (!isWithin(materializationRoot, target)) {
    throw storageError('BLOB_DESTINATION_INVALID', 'El destino sale del sandbox permitido.');
  }
  return target;
}

export async function ensureSafeParent(root, directory) {
  if (!isWithin(root, directory, true)) {
    throw storageError('BLOB_PATH_INVALID', 'La carpeta sale de la raíz permitida.');
  }
  const relative = path.relative(root, directory);
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    if (existsSync(current)) {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw storageError('BLOB_PATH_INVALID', 'La ruta contiene un enlace o archivo no permitido.');
      }
    } else {
      await mkdir(current);
    }
  }
}

export async function assertRegularFile(file) {
  if (!existsSync(file)) throw storageError('BLOB_NOT_FOUND', 'No se encontró el blob.');
  const stats = await lstat(file);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw storageError('BLOB_PATH_INVALID', 'El blob debe ser un archivo regular.');
  }
  return stats;
}

export async function removeTemporary(file) {
  await rm(file, { force: true });
}
