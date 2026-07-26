import { createReadStream, existsSync } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  assertBlobKey,
  assertSha256,
  storageError,
} from './contracts.mjs';
import { ensureDirectory, isWithin } from './filesystem-utils.mjs';
import {
  assertMaterializationDestination,
  assertMaximumBlobBytes,
  assertRegularFile,
  blobInputStream,
  ensureSafeParent,
  removeTemporary,
  safeTemporaryPath,
  streamToFile,
  streamToHash,
} from './blob-stream-utils.mjs';

export function createFileBlobStorage(options) {
  const storageRoot = path.resolve(options.storageRoot);
  const materializationRoot = path.resolve(options.materializationRoot);
  const maximumBytes = assertMaximumBlobBytes(options.maximumBytes);
  const ready = Promise.all([
    ensureDirectory(storageRoot),
    ensureDirectory(materializationRoot),
  ]);
  let mutation = Promise.resolve();

  async function put(input) {
    const result = mutation.then(() => putUnsafe(input), () => putUnsafe(input));
    mutation = result.catch(() => {});
    return result;
  }

  async function putUnsafe(input) {
    await ready;
    const key = assertBlobKey(input?.key);
    const target = resolveKey(storageRoot, key);
    await ensureSafeParent(storageRoot, path.dirname(target));
    const temporary = safeTemporaryPath(target);
    const expectedSha256 = input.expectedSha256 === undefined
      ? null
      : assertSha256(input.expectedSha256);
    try {
      const source = await blobInputStream(input);
      const measured = await streamToFile(source, temporary, maximumBytes);
      if (expectedSha256 && measured.sha256 !== expectedSha256) {
        throw storageError('BLOB_HASH_MISMATCH', 'El blob no coincide con el SHA-256 esperado.');
      }
      if (existsSync(target)) {
        const existing = await inspectFile(target, key, maximumBytes);
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
      await removeTemporary(temporary);
    }
  }

  async function getToFile(key, destination, expectedSha256) {
    await ready;
    const source = resolveKey(storageRoot, assertBlobKey(key));
    await assertRegularFile(source);
    const target = assertMaterializationDestination(materializationRoot, destination);
    await ensureSafeParent(materializationRoot, path.dirname(target));
    const temporary = safeTemporaryPath(target);
    try {
      const measured = await streamToFile(createReadStream(source), temporary, maximumBytes);
      if (expectedSha256 && measured.sha256 !== assertSha256(expectedSha256)) {
        throw storageError('BLOB_HASH_MISMATCH', 'El blob descargado no coincide con el SHA-256 esperado.');
      }
      await rename(temporary, target);
    } finally {
      await removeTemporary(temporary);
    }
  }

  async function statBlob(key) {
    await ready;
    const portableKey = assertBlobKey(key);
    return inspectFile(resolveKey(storageRoot, portableKey), portableKey, maximumBytes);
  }

  async function deleteBlob(key) {
    await ready;
    const target = resolveKey(storageRoot, assertBlobKey(key));
    await assertRegularFile(target);
    await rm(target);
  }

  async function openRead(key, range = {}) {
    await ready;
    const source = resolveKey(storageRoot, assertBlobKey(key));
    const stats = await assertRegularFile(source);
    const start = range.start ?? 0;
    const end = range.end ?? stats.size - 1;
    assertReadRange(start, end, stats.size);
    return {
      stream: createReadStream(source, { start, end }),
      bytes: stats.size,
      contentLength: end - start + 1,
      contentRange: start === 0 && end === stats.size - 1
        ? null
        : `bytes ${start}-${end}/${stats.size}`,
      mimeType: null,
    };
  }

  return {
    storageRoot,
    materializationRoot,
    put,
    getToFile,
    stat: statBlob,
    delete: deleteBlob,
    openRead,
  };
}

function resolveKey(root, key) {
  const target = path.resolve(root, ...key.split('/'));
  if (!isWithin(root, target)) {
    throw storageError('BLOB_KEY_INVALID', 'La clave sale de la raíz de blobs.');
  }
  return target;
}

async function inspectFile(file, key, maximumBytes) {
  await assertRegularFile(file);
  const measured = await streamToHash(createReadStream(file), maximumBytes);
  const stats = await stat(file);
  return { key, sha256: measured.sha256, bytes: stats.size, mimeType: null };
}

function assertReadRange(start, end, size) {
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || end >= size
  ) {
    throw storageError('BLOB_RANGE_INVALID', 'El rango solicitado no es válido.');
  }
}
