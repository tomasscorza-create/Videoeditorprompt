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
import { createFileBlobStorage } from './file-blob-storage.mjs';
import { createFileRenderJobRepository } from './file-render-job-repository.mjs';
import { createFileResourceRepository } from './file-resource-repository.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-storage-'));
let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

try {
  const resourceRepository = await createFileResourceRepository({
    indexPath: path.join(root, 'library', 'library-index.json'),
    validateRegistry: validateRegistry,
  });
  const resource = {
    id: 'voz-storage-v1',
    contentHash: '1'.repeat(64),
    registeredAt: '2026-07-25T00:00:00.000Z',
    entry: { id: 'voz-storage-v1', type: 'voice' },
  };
  check((await resourceRepository.list()).length === 0, 'registro inicialmente vacío');
  check((await resourceRepository.register(resource)).created, 'recurso creado');
  check((await resourceRepository.get(resource.id)).contentHash === resource.contentHash, 'recurso recuperado');
  check(!(await resourceRepository.register({ ...resource, id: 'voz-alias-v1', entry: { ...resource.entry, id: 'voz-alias-v1' } })).created, 'hash deduplicado');
  await assert.rejects(
    () => resourceRepository.register({ ...resource, contentHash: '2'.repeat(64) }),
    (error) => error.code === 'LIBRARY_RESOURCE_ID_CONFLICT',
  );
  passed += 1;

  const jobRepository = createFileRenderJobRepository({
    storageRoot: path.join(root, 'jobs'),
  });
  const queuedJob = {
    version: 1,
    jobId: 'render-storage-01',
    projectId: 'proyecto-storage',
    state: 'queued',
    stage: 'queueing',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    progress: null,
    error: null,
  };
  await jobRepository.reserve(queuedJob);
  await assert.rejects(
    () => jobRepository.reserve(queuedJob),
    (error) => error.code === 'RENDER_JOB_CONFLICT',
  );
  passed += 1;
  const renderingJob = await jobRepository.transition(
    queuedJob.jobId,
    'queued',
    { state: 'rendering', stage: 'rendering_frames' },
  );
  check(renderingJob.state === 'rendering', 'transición atómica aplicada');
  await assert.rejects(
    () => jobRepository.transition(queuedJob.jobId, 'queued', { state: 'failed' }),
    (error) => error.code === 'RENDER_JOB_STATE_CONFLICT',
  );
  passed += 1;
  check((await jobRepository.list({ states: ['rendering'] })).length === 1, 'filtro de jobs');
  await assert.rejects(
    () => jobRepository.transition(queuedJob.jobId, 'rendering', {
      technicalDetail: 'C:\\datos\\privados\\archivo.json',
    }),
    (error) => error.code === 'RENDER_JOB_PATH_INVALID',
  );
  passed += 1;

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

  process.stdout.write(`${JSON.stringify({ version: 1, passed, failed: 0 })}\n`);
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
