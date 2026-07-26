import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectRepository } from '../local-app/project-repository.mjs';
import { createFileBlobStorage } from './file-blob-storage.mjs';
import { createFileRenderJobRepository } from './file-render-job-repository.mjs';
import { createFileResourceRepository } from './file-resource-repository.mjs';
import { runRepositoryContractSuite } from './repository-contract-suite.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-storage-'));
let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

try {
  const metadata = await runRepositoryContractSuite({
    backend: 'filesystem',
    prefix: 'fscontract',
    createProjectRepository: () => createProjectRepository({
      storageRoot: path.join(root, 'projects'),
    }),
    createResourceRepository: () => createFileResourceRepository({
      indexPath: path.join(root, 'library', 'library-index.json'),
      validateRegistry,
    }),
    createRenderJobRepository: () => createFileRenderJobRepository({
      storageRoot: path.join(root, 'jobs'),
    }),
  });
  passed += metadata.passed;

  const blobRoot = path.join(root, 'blobs');
  const sandboxRoot = path.join(root, 'sandbox');
  const blobStorage = createFileBlobStorage({
    storageRoot: blobRoot,
    materializationRoot: sandboxRoot,
    maximumBytes: 1024,
  });
  const bytes = Buffer.from('blob portable');
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await blobStorage.put({
    key: `resources/image/recurso-01/original/${expectedSha256}.bin`,
    bytes,
    expectedSha256,
    mimeType: 'application/octet-stream',
  });
  check(stored.sha256 === expectedSha256 && stored.bytes === bytes.length, 'blob almacenado');
  check((await blobStorage.stat(stored.key)).sha256 === expectedSha256, 'blob inspeccionado');
  const destination = path.join(sandboxRoot, 'job-01', 'input.bin');
  await blobStorage.getToFile(stored.key, destination, expectedSha256);
  check(readFileSync(destination).equals(bytes), 'blob materializado');
  check(
    (await blobStorage.put({ key: stored.key, bytes, expectedSha256 })).sha256 === expectedSha256,
    'put idempotente',
  );
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
  await assert.rejects(
    () => blobStorage.put({
      key: 'resources/image/recurso-02/original/hash.bin',
      bytes,
      expectedSha256: '0'.repeat(64),
    }),
    (error) => error.code === 'BLOB_HASH_MISMATCH',
  );
  passed += 1;
  check(!existsSync(path.join(blobRoot, 'resources', 'image', 'recurso-02', 'original', 'hash.bin')), 'hash incorrecto no publica');
  await assert.rejects(
    () => blobStorage.getToFile(stored.key, path.join(root, 'escape.bin'), expectedSha256),
    (error) => error.code === 'BLOB_DESTINATION_INVALID',
  );
  passed += 1;
  await assert.rejects(
    () => blobStorage.getToFile(
      stored.key,
      path.join(sandboxRoot, 'job-01', 'bad.bin'),
      '0'.repeat(64),
    ),
    (error) => error.code === 'BLOB_HASH_MISMATCH',
  );
  passed += 1;
  check(!existsSync(path.join(sandboxRoot, 'job-01', 'bad.bin')), 'descarga corrupta no publica');
  await blobStorage.delete(stored.key);
  await assert.rejects(
    () => blobStorage.stat(stored.key),
    (error) => error.code === 'BLOB_NOT_FOUND',
  );
  passed += 1;

  process.stdout.write(`${JSON.stringify({
    version: 1,
    backend: 'filesystem',
    metadataPassed: metadata.passed,
    passed,
    failed: 0,
  })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

function validateRegistry(registry) {
  assert.equal(registry.version, 1);
  assert.ok(Array.isArray(registry.entries));
  for (const record of registry.entries) {
    assert.equal(record.id, record.entry.id);
    assert.match(record.contentHash, /^[a-f0-9]{64}$/u);
  }
}
