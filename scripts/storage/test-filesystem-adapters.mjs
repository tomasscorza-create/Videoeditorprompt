import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectRepository } from '../local-app/project-repository.mjs';
import { runBlobStorageContractSuite } from './blob-storage-contract-suite.mjs';
import { createFileBlobStorage } from './file-blob-storage.mjs';
import { createFileRenderJobRepository } from './file-render-job-repository.mjs';
import { createFileResourceRepository } from './file-resource-repository.mjs';
import { runRepositoryContractSuite } from './repository-contract-suite.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-storage-'));

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
  const materializationRoot = path.join(root, 'sandbox');
  const blobs = await runBlobStorageContractSuite({
    backend: 'filesystem',
    materializationRoot,
    blobStorage: createFileBlobStorage({
      storageRoot: path.join(root, 'blobs'),
      materializationRoot,
      maximumBytes: 1024,
    }),
    keyPrefix: 'tests/filesystem-contract',
  });
  process.stdout.write(`${JSON.stringify({
    version: 1,
    backend: 'filesystem',
    metadataPassed: metadata.passed,
    blobPassed: blobs.passed,
    passed: metadata.passed + blobs.passed,
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
