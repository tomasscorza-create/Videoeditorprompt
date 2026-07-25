import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { lstat, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  assertBlobKey,
  assertSha256,
  storageError,
} from './contracts.mjs';
import { ensureDirectory, isWithin } from './filesystem-utils.mjs';

const DEFAULT_MAXIMUM_BYTES = 1024 * 1024 * 1024;

export function createFileBlobStorage(options) {
  const storageRoot = path.resolve(options.storageRoot);
  const materializationRoot = path.resolve(options.materializationRoot);
  const maximumBytes = Number(options.maximumBytes || DEFAULT_MAXIMUM_BYTES);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw storageError('BLOB_SIZE_INVALID', 'El límite de blobs no es válido.');
  }
  const ready = Promise.all([
    ensureDirectory(storageRoot),
    ensureDirectory(materializationRoot),
  ]);

  async function put(input) {
    await ready;
    const key = assertBlobKey(input?.key);
    const target = resolveKey(storageRoot, key);
    await ensureSafeParent(storageRoot, path.dirname(target));
    const temporary = `${target}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
    const expectedSha256 = input.expectedSha256 === undefined
      ? null
      : assertSha256(input.expectedSha256);
    try {
      const source = await inputStream(input);
      const measured = await streamToFile(source, temporary, maximumBytes);
      if (expectedSha256 && measured.sha256 !== expectedSha256) {
        throw storageError('BLOB_HASH_MISMATCH', 'El blob no coincide con el SHA-256 esperado.');
      }
      if (existsSync(target)) {
        const existing = await inspectFile(target, key);
        if (existing.sha256 !== measured.sha256 || existing.bytes !== measured.bytes) {
          throw storageError('BLOB_KEY_CONFLICT', 'La clave ya contiene un blob diferente.');
        }
        return { ...existing, mimeType: input.mimeType || null };
      }
      await rename(temporary, target);
      return {
        key,
        sha256: measured.sha256,
        bytes: measured.bytes,
        mimeType: input.mimeType || null,
      };
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function getToFile(key, destination, expectedSha256) {
    await ready;
    const source = resolveKey(storageRoot, assertBlobKey(key));
    await assertRegularFile(source);
    const target = path.resolve(destination);
    if (!isWithin(materializationRoot, target)) {
      throw storageError('BLOB_DESTINATION_INVALID', 'El destino sale del sandbox permitido.');
    }
    await ensureSafeParent(materializationRoot, path.dirname(target));
    const temporary = `${target}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`;
    try {
      const measured = await streamToFile(createReadStream(source), temporary, maximumBytes);
      if (expectedSha256 && measured.sha256 !== assertSha256(expectedSha256)) {
        throw storageError('BLOB_HASH_MISMATCH', 'El blob descargado no coincide con el SHA-256 esperado.');
      }
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function statBlob(key) {
    await ready;
    const portableKey = assertBlobKey(key);
    return inspectFile(resolveKey(storageRoot, portableKey), portableKey);
  }

  async function deleteBlob(key) {
    await ready;
    const target = resolveKey(storageRoot, assertBlobKey(key));
    await assertRegularFile(target);
    await rm(target);
  }

  return {
    storageRoot,
    materializationRoot,
    put,
    getToFile,
    stat: statBlob,
    delete: deleteBlob,
  };
}

async function inputStream(input) {
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

async function streamToFile(source, target, maximumBytes) {
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
  return { bytes, sha256: hash.digest('hex') };
}

function resolveKey(root, key) {
  const target = path.resolve(root, ...key.split('/'));
  if (!isWithin(root, target)) {
    throw storageError('BLOB_KEY_INVALID', 'La clave sale de la raíz de blobs.');
  }
  return target;
}

async function ensureSafeParent(root, directory) {
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
        throw storageError('BLOB_PATH_INVALID', 'La ruta de blobs contiene un enlace o archivo no permitido.');
      }
    } else {
      await mkdir(current);
    }
  }
}

async function assertRegularFile(file) {
  if (!existsSync(file)) throw storageError('BLOB_NOT_FOUND', 'No se encontró el blob.');
  const stats = await lstat(file);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw storageError('BLOB_PATH_INVALID', 'El blob debe ser un archivo regular.');
  }
}

async function inspectFile(file, key) {
  await assertRegularFile(file);
  const measured = await streamToHash(createReadStream(file));
  const stats = await stat(file);
  return { key, sha256: measured.sha256, bytes: stats.size, mimeType: null };
}

async function streamToHash(source) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of source) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest('hex') };
}
