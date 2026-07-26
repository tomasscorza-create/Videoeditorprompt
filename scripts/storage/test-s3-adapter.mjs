import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { runBlobStorageContractSuite } from './blob-storage-contract-suite.mjs';
import { createBlobMaterializer } from './artifact-storage.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';
import { createLocalS3Client } from './s3-client.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-s3-'));
const connection = createLocalS3Client();
const storage = createS3BlobStorage({
  connection,
  materializationRoot: root,
  maximumBytes: 1024,
});
const prefix = `tests/p5/${randomBytes(6).toString('hex')}`;
const corruptKey = `${prefix}/corrupt.bin`;
const validKey = `${prefix}/valid.bin`;
const sandboxId = `p5${randomBytes(4).toString('hex')}`;

try {
  assert.throws(
    () => createLocalS3Client({ endpoint: 'http://usuario:secreto@127.0.0.1:8333' }),
    (error) => error.code === 'S3_CONFIG_INVALID',
  );
  const unavailable = createS3BlobStorage({
    client: {
      async send() {
        throw new Error('connect ECONNREFUSED clave-secreta@127.0.0.1');
      },
    },
    bucket: 'local-video-private',
    materializationRoot: path.join(root, 'unavailable'),
    maximumBytes: 1024,
  });
  await assert.rejects(
    () => unavailable.stat(`${prefix}/missing.bin`),
    (error) => (
      error.code === 'BLOB_STAT_FAILED'
      && !JSON.stringify({
        message: error.message,
        technicalDetail: error.technicalDetail,
      }).includes('clave-secreta')
    ),
  );
  const contract = await runBlobStorageContractSuite({
    backend: 's3',
    blobStorage: storage,
    materializationRoot: root,
    keyPrefix: `${prefix}/contract`,
  });
  await connection.client.send(new PutObjectCommand({
    Bucket: connection.bucket,
    Key: corruptKey,
    Body: Buffer.from('contenido-corrupto'),
    ContentLength: 18,
    ContentType: 'application/octet-stream',
    Metadata: { sha256: '0'.repeat(64) },
  }));
  const corruptDestination = path.join(root, 'corrupt', 'output.bin');
  await assert.rejects(
    () => storage.getToFile(corruptKey, corruptDestination, '0'.repeat(64)),
    (error) => error.code === 'BLOB_HASH_MISMATCH',
  );
  assert.equal(existsSync(corruptDestination), false);
  const valid = await storage.put({
    key: validKey,
    bytes: Buffer.from('válido'),
    mimeType: 'application/octet-stream',
  });
  await assert.rejects(
    () => createBlobMaterializer({ blobStorage: storage }).materialize(
      `${sandboxId}d`,
      [
        { key: validKey, sha256: valid.sha256, relativePath: 'assets/same.bin' },
        { key: validKey, sha256: valid.sha256, relativePath: 'assets/same.bin' },
      ],
    ),
    (error) => error.code === 'BLOB_MATERIALIZATION_INVALID',
  );
  assert.equal(existsSync(path.join(root, `${sandboxId}d`)), false);
  await assert.rejects(
    () => createBlobMaterializer({ blobStorage: storage }).materialize(sandboxId, [
      { key: validKey, sha256: valid.sha256, relativePath: 'assets/valid.bin' },
      { key: corruptKey, sha256: '0'.repeat(64), relativePath: 'assets/corrupt.bin' },
    ]),
    (error) => error.code === 'BLOB_HASH_MISMATCH',
  );
  assert.equal(existsSync(path.join(root, sandboxId)), false);
  const unsigned = await fetch(
    `${connection.endpoint}${connection.bucket}/${encodeURIComponent(corruptKey)}`,
    { redirect: 'manual' },
  );
  assert.ok([401, 403, 404].includes(unsigned.status));
  process.stdout.write(`${JSON.stringify({
    version: 1,
    backend: 's3',
    contractPassed: contract.passed,
    corruptionPassed: 1,
    atomicMaterializationPassed: 2,
    privateBucketPassed: 1,
    configAndSanitizationPassed: 2,
    passed: contract.passed + 6,
    failed: 0,
  })}\n`);
} finally {
  await connection.client.send(new DeleteObjectCommand({
    Bucket: connection.bucket,
    Key: corruptKey,
  })).catch(() => {});
  await connection.client.send(new DeleteObjectCommand({
    Bucket: connection.bucket,
    Key: validKey,
  })).catch(() => {});
  storage.close();
  rmSync(root, { recursive: true, force: true });
}
