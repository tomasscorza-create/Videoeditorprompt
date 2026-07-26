import { createReadStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  assertBlobKey,
  assertSha256,
  storageError,
} from './contracts.mjs';
import { ensureDirectory } from './filesystem-utils.mjs';
import {
  assertMaterializationDestination,
  assertMaximumBlobBytes,
  blobInputStream,
  ensureSafeParent,
  removeTemporary,
  safeTemporaryPath,
  streamToFile,
} from './blob-stream-utils.mjs';
import { createLocalS3Client } from './s3-client.mjs';

export function createS3BlobStorage(options = {}) {
  const connection = options.connection || (
    options.client
      ? { client: options.client, bucket: options.bucket, close() {} }
      : createLocalS3Client(options)
  );
  const client = connection.client;
  const bucket = String(options.bucket || connection.bucket || '');
  if (
    !client?.send
    || bucket.length < 3
    || bucket.length > 63
    || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(bucket)
    || bucket.includes('..')
    || typeof options.materializationRoot !== 'string'
  ) {
    throw storageError('S3_CONFIG_INVALID', 'La configuración del blob storage S3 no es válida.');
  }
  const materializationRoot = path.resolve(options.materializationRoot);
  const stagingRoot = path.join(materializationRoot, '.s3-upload');
  const maximumBytes = assertMaximumBlobBytes(options.maximumBytes);
  const ready = Promise.all([
    ensureDirectory(materializationRoot),
    ensureDirectory(stagingRoot),
  ]);

  async function put(input) {
    await ready;
    const key = assertBlobKey(input?.key);
    const expectedSha256 = input.expectedSha256 === undefined
      ? null
      : assertSha256(input.expectedSha256);
    const temporary = safeTemporaryPath(path.join(stagingRoot, path.basename(key)));
    try {
      const measured = await streamToFile(
        await blobInputStream(input),
        temporary,
        maximumBytes,
      );
      if (expectedSha256 && measured.sha256 !== expectedSha256) {
        throw storageError('BLOB_HASH_MISMATCH', 'El blob no coincide con el SHA-256 esperado.');
      }
      const existing = await optionalStat(key);
      if (existing) {
        assertSameBlob(existing, measured);
        return { ...existing, mimeType: input.mimeType || existing.mimeType };
      }
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(temporary),
          ContentLength: measured.bytes,
          ContentType: input.mimeType || 'application/octet-stream',
          Metadata: { sha256: measured.sha256 },
          IfNoneMatch: '*',
        }));
      } catch (error) {
        if (isPreconditionFailure(error)) {
          const raced = await statBlob(key);
          assertSameBlob(raced, measured);
          return raced;
        }
        throw error;
      }
      const stored = await statBlob(key);
      assertSameBlob(stored, measured);
      return stored;
    } catch (error) {
      throw s3StorageError(error, 'BLOB_UPLOAD_FAILED', 'No se pudo almacenar el blob.');
    } finally {
      await removeTemporary(temporary);
    }
  }

  async function getToFile(key, destination, expectedSha256) {
    await ready;
    const portableKey = assertBlobKey(key);
    const expected = expectedSha256 === undefined
      ? null
      : assertSha256(expectedSha256);
    const target = assertMaterializationDestination(materializationRoot, destination);
    await ensureSafeParent(materializationRoot, path.dirname(target));
    const temporary = safeTemporaryPath(target);
    try {
      const remote = await statBlob(portableKey);
      if (expected && remote.sha256 !== expected) {
        throw storageError('BLOB_HASH_MISMATCH', 'El blob remoto no coincide con el SHA-256 esperado.');
      }
      const opened = await openRead(portableKey);
      const measured = await streamToFile(opened.stream, temporary, maximumBytes);
      if (
        measured.sha256 !== remote.sha256
        || measured.bytes !== remote.bytes
        || (expected && measured.sha256 !== expected)
      ) {
        throw storageError('BLOB_HASH_MISMATCH', 'El blob descargado no coincide con su metadata.');
      }
      await rename(temporary, target);
    } catch (error) {
      throw s3StorageError(error, 'BLOB_DOWNLOAD_FAILED', 'No se pudo materializar el blob.');
    } finally {
      await removeTemporary(temporary);
    }
  }

  async function statBlob(key) {
    const portableKey = assertBlobKey(key);
    try {
      const response = await client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: portableKey,
      }));
      return objectMetadata(portableKey, response, maximumBytes);
    } catch (error) {
      throw s3StorageError(error, 'BLOB_STAT_FAILED', 'No se pudo inspeccionar el blob.');
    }
  }

  async function optionalStat(key) {
    try {
      return await statBlob(key);
    } catch (error) {
      if (error.code === 'BLOB_NOT_FOUND') return null;
      throw error;
    }
  }

  async function deleteBlob(key) {
    const portableKey = assertBlobKey(key);
    await statBlob(portableKey);
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: portableKey }));
    } catch (error) {
      throw s3StorageError(error, 'BLOB_DELETE_FAILED', 'No se pudo eliminar el blob.');
    }
  }

  async function openRead(key, range = {}) {
    const portableKey = assertBlobKey(key);
    const metadata = await statBlob(portableKey);
    const start = range.start ?? 0;
    const end = range.end ?? metadata.bytes - 1;
    assertReadRange(start, end, metadata.bytes);
    const partial = start !== 0 || end !== metadata.bytes - 1;
    try {
      const response = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: portableKey,
        ...(partial ? { Range: `bytes=${start}-${end}` } : {}),
      }));
      if (!response.Body || typeof response.Body[Symbol.asyncIterator] !== 'function') {
        throw storageError('BLOB_RESPONSE_INVALID', 'S3 no devolvió un stream de contenido.');
      }
      const responseHash = response.Metadata?.sha256;
      const expectedLength = end - start + 1;
      if (
        responseHash !== metadata.sha256
        || Number(response.ContentLength) !== expectedLength
      ) {
        response.Body.destroy?.();
        throw storageError('BLOB_METADATA_INVALID', 'La metadata S3 del blob es inconsistente.');
      }
      return {
        stream: response.Body,
        bytes: metadata.bytes,
        contentLength: expectedLength,
        contentRange: partial ? `bytes ${start}-${end}/${metadata.bytes}` : null,
        mimeType: response.ContentType || metadata.mimeType,
        sha256: metadata.sha256,
      };
    } catch (error) {
      throw s3StorageError(error, 'BLOB_DOWNLOAD_FAILED', 'No se pudo abrir el blob.');
    }
  }

  async function health() {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return { ready: true, bucket };
    } catch (error) {
      throw s3StorageError(error, 'S3_UNAVAILABLE', 'El bucket S3 no está disponible.');
    }
  }

  async function list(prefix = '') {
    const portablePrefix = prefix === '' ? '' : assertBlobKey(prefix);
    const objects = [];
    let continuationToken;
    try {
      do {
        const response = await client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: portablePrefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }));
        for (const object of response.Contents || []) {
          if (typeof object.Key !== 'string') {
            throw storageError('BLOB_METADATA_INVALID', 'S3 devolvió una clave inválida.');
          }
          objects.push(await statBlob(object.Key));
          if (objects.length > 100_000) {
            throw storageError('BLOB_LIST_TOO_LARGE', 'El bucket supera 100000 objetos.');
          }
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        if (response.IsTruncated && !continuationToken) {
          throw storageError('BLOB_METADATA_INVALID', 'S3 truncó la lista sin cursor.');
        }
      } while (continuationToken);
      return objects.sort((left, right) => left.key.localeCompare(right.key));
    } catch (error) {
      throw s3StorageError(error, 'BLOB_LIST_FAILED', 'No se pudieron listar los blobs.');
    }
  }

  return {
    bucket,
    materializationRoot,
    maximumBytes,
    put,
    getToFile,
    stat: statBlob,
    delete: deleteBlob,
    openRead,
    health,
    list,
    close: () => connection.close?.(),
  };
}

function objectMetadata(key, response, maximumBytes) {
  const bytes = Number(response.ContentLength);
  const sha256 = response.Metadata?.sha256;
  if (
    !Number.isSafeInteger(bytes)
    || bytes < 0
    || bytes > maximumBytes
    || typeof sha256 !== 'string'
  ) {
    throw storageError('BLOB_METADATA_INVALID', 'La metadata S3 del blob no es válida.');
  }
  assertSha256(sha256, 'BLOB_METADATA_INVALID');
  return {
    key,
    sha256,
    bytes,
    mimeType: response.ContentType || null,
  };
}

function assertSameBlob(existing, measured) {
  if (existing.sha256 !== measured.sha256 || existing.bytes !== measured.bytes) {
    throw storageError('BLOB_KEY_CONFLICT', 'La clave ya contiene un blob diferente.');
  }
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

function isPreconditionFailure(error) {
  return error?.$metadata?.httpStatusCode === 412
    || error?.name === 'PreconditionFailed';
}

function s3StorageError(error, fallbackCode, fallbackMessage) {
  if (
    typeof error?.code === 'string'
    && /^(?:BLOB|ARTIFACT|S3)_[A-Z0-9_]+$/u.test(error.code)
  ) return error;
  if (
    error?.$metadata?.httpStatusCode === 404
    || ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(error?.name)
  ) {
    return storageError('BLOB_NOT_FOUND', 'No se encontró el blob.');
  }
  const wrapped = storageError(fallbackCode, fallbackMessage);
  const status = error?.$metadata?.httpStatusCode;
  if (Number.isInteger(status)) wrapped.technicalDetail = `s3Status=${status}`;
  return wrapped;
}
