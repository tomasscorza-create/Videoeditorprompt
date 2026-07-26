import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export async function runBlobStorageContractSuite({
  backend,
  blobStorage,
  materializationRoot,
  keyPrefix = `tests/contracts/${randomBytes(6).toString('hex')}`,
}) {
  let passed = 0;
  const check = (condition, message) => {
    assert.ok(condition, `${backend}: ${message}`);
    passed += 1;
  };
  const bytes = Buffer.from('blob portable');
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `${keyPrefix}/original/${expectedSha256}.bin`;
  const stored = await blobStorage.put({
    key,
    bytes,
    expectedSha256,
    mimeType: 'application/octet-stream',
  });
  check(stored.sha256 === expectedSha256 && stored.bytes === bytes.length, 'blob almacenado');
  check((await blobStorage.stat(key)).sha256 === expectedSha256, 'blob inspeccionado');
  const destination = path.join(materializationRoot, 'job-01', 'input.bin');
  await blobStorage.getToFile(key, destination, expectedSha256);
  check(readFileSync(destination).equals(bytes), 'blob materializado');
  check(
    (await blobStorage.put({ key, bytes, expectedSha256 })).sha256 === expectedSha256,
    'put idempotente',
  );
  await assert.rejects(
    () => blobStorage.put({ key, bytes: Buffer.from('diferente') }),
    (error) => error.code === 'BLOB_KEY_CONFLICT',
  );
  passed += 1;
  const concurrentKey = `${keyPrefix}/concurrent/same.bin`;
  const concurrentSame = await Promise.all([
    blobStorage.put({ key: concurrentKey, bytes }),
    blobStorage.put({ key: concurrentKey, bytes }),
  ]);
  check(
    concurrentSame[0].sha256 === concurrentSame[1].sha256,
    'uploads concurrentes idénticos convergen',
  );
  await blobStorage.delete(concurrentKey);
  const conflictKey = `${keyPrefix}/concurrent/conflict.bin`;
  const concurrentConflict = await Promise.allSettled([
    blobStorage.put({ key: conflictKey, bytes: Buffer.from('contenido-a') }),
    blobStorage.put({ key: conflictKey, bytes: Buffer.from('contenido-b') }),
  ]);
  check(
    concurrentConflict.filter((result) => result.status === 'fulfilled').length === 1
      && concurrentConflict.filter((result) => (
        result.status === 'rejected'
        && result.reason?.code === 'BLOB_KEY_CONFLICT'
      )).length === 1,
    'uploads concurrentes distintos no sobrescriben',
  );
  await blobStorage.delete(conflictKey);
  await assert.rejects(
    () => blobStorage.put({ key: '../escape.bin', bytes }),
    (error) => error.code === 'BLOB_KEY_INVALID',
  );
  passed += 1;
  await assert.rejects(
    () => blobStorage.put({ key: 'resources\\escape.bin', bytes }),
    (error) => error.code === 'BLOB_KEY_INVALID',
  );
  passed += 1;
  const rejectedKey = `${keyPrefix}/rejected/hash.bin`;
  await assert.rejects(
    () => blobStorage.put({
      key: rejectedKey,
      bytes,
      expectedSha256: '0'.repeat(64),
    }),
    (error) => error.code === 'BLOB_HASH_MISMATCH',
  );
  passed += 1;
  await assert.rejects(
    () => blobStorage.stat(rejectedKey),
    (error) => error.code === 'BLOB_NOT_FOUND',
  );
  passed += 1;
  await assert.rejects(
    () => blobStorage.getToFile(key, path.join(materializationRoot, '..', 'escape.bin'), expectedSha256),
    (error) => error.code === 'BLOB_DESTINATION_INVALID',
  );
  passed += 1;
  const badDestination = path.join(materializationRoot, 'job-01', 'bad.bin');
  await assert.rejects(
    () => blobStorage.getToFile(key, badDestination, '0'.repeat(64)),
    (error) => error.code === 'BLOB_HASH_MISMATCH',
  );
  passed += 1;
  check(!existsSync(badDestination), 'descarga rechazada no publica');
  const opened = await blobStorage.openRead(key, { start: 5, end: 8 });
  check(
    (await consume(opened.stream)).toString('utf8') === 'port'
      && opened.contentLength === 4,
    'lectura por rango',
  );
  const oversizedKey = `${keyPrefix}/rejected/oversized.bin`;
  await assert.rejects(
    () => blobStorage.put({ key: oversizedKey, bytes: Buffer.alloc(1025) }),
    (error) => error.code === 'BLOB_TOO_LARGE',
  );
  passed += 1;
  await assert.rejects(
    () => blobStorage.put({ key: `${keyPrefix}/rejected/empty.bin`, bytes: Buffer.alloc(0) }),
    (error) => error.code === 'BLOB_EMPTY',
  );
  passed += 1;
  await blobStorage.delete(key);
  await assert.rejects(
    () => blobStorage.stat(key),
    (error) => error.code === 'BLOB_NOT_FOUND',
  );
  passed += 1;

  return { version: 1, backend, passed, failed: 0 };
}

async function consume(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
