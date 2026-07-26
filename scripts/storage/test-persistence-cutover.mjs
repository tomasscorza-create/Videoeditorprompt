import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { validateResourceLibraryRegistry } from '../local-app/resource-library.mjs';
import { createLocalAppServer } from '../local-app/server.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createPostgresRenderJobRepository } from './postgres-render-job-repository.mjs';
import { createPostgresResourceRepository } from './postgres-resource-repository.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';
import { contentAddressedBlobKey } from './content-addressed-blobs.mjs';

const prefix = `p7${randomBytes(5).toString('hex')}`;
const root = await mkdtemp(path.join(tmpdir(), 'local-video-p7-'));
const assetsRoot = path.join(root, 'public');
const cleanupPool = createPostgresPool();
const cleanupBlobs = createS3BlobStorage({
  materializationRoot: path.join(root, 'cleanup-materialized'),
});
const initialKeys = new Set((await managedObjects(cleanupBlobs)).map((item) => item.key));
const projectId = `${prefix}-project`;
const jobId = `${prefix}-job`;
let resourceId = null;
let passed = 0;

try {
  await mkdir(path.join(assetsRoot, 'assets', 'catalog'), { recursive: true });
  const catalog = {
    version: 1,
    entries: [{
      id: 'voz-prueba-p7',
      type: 'voice',
      label: 'Voz de prueba',
      tags: ['prueba'],
      voice: {
        provider: 'piper',
        model: 'test_voice',
        locale: 'es_AR',
        lengthScale: 1,
        volume: 1,
      },
      provenance: {
        source: 'Fixture P7.',
        license: 'Solo pruebas.',
      },
    }],
  };
  const first = await createLocalAppServer({
    root,
    assetsRoot,
    catalog,
    persistence: 'postgres-s3',
    port: 0,
    retentionOnStartup: false,
  });
  const firstListening = await first.listen();
  const firstRequest = requestFactory(firstListening.url, first.sessionToken);
  const health = await (await firstRequest('/api/health')).json();
  assert.equal(health.persistence.backend, 'postgres-s3');
  assert.equal(health.persistence.ready, true);
  passed += 1;

  const project = {
    version: 1,
    id: projectId,
    title: 'Proyecto cutover',
    scenes: [{ id: 'scene-1' }],
  };
  const projectResponse = await firstRequest(`/api/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  assert.equal(projectResponse.status, 201);
  passed += 1;

  const backgroundResponse = await firstRequest('/api/library/backgrounds', {
    method: 'POST',
    headers: {
      'content-type': 'image/png',
      'x-resource-file-name': encodeURIComponent('p7-cutover.png'),
    },
    body: png64(prefix),
  });
  assert.equal(backgroundResponse.status, 201);
  const background = await backgroundResponse.json();
  resourceId = background.resource.id;
  passed += 1;
  await first.close();

  const resourceRepository = await createPostgresResourceRepository({
    pool: cleanupPool,
    validateRegistry: validateResourceLibraryRegistry,
  });
  const storedResource = await resourceRepository.get(resourceId);
  assert.ok(storedResource.blobStorage.artifacts.length >= 3);
  for (const artifact of storedResource.blobStorage.artifacts) {
    const remote = await cleanupBlobs.stat(artifact.key);
    assert.equal(remote.sha256, artifact.sha256);
  }
  passed += 1;

  const videoBytes = Buffer.from(`p7-video-${prefix}`);
  const videoSha256 = createHash('sha256').update(videoBytes).digest('hex');
  const videoKey = contentAddressedBlobKey(videoSha256);
  await cleanupBlobs.put({
    key: videoKey,
    bytes: videoBytes,
    expectedSha256: videoSha256,
    mimeType: 'video/mp4',
  });
  const jobs = createPostgresRenderJobRepository({ pool: cleanupPool });
  await jobs.reserve({
    version: 1,
    jobId,
    projectId,
    state: 'completed',
    stage: 'completed',
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:01.000Z',
    progress: null,
    error: null,
    result: {
      downloadName: 'cutover.mp4',
      videoUrl: `/api/render-jobs/${jobId}/video`,
    },
    blobStorage: {
      version: 1,
      backend: 's3',
      artifacts: [{
        role: 'rendered-video',
        relativePath: 'render-1.mp4',
        key: videoKey,
        bytes: videoBytes.length,
        sha256: videoSha256,
        mimeType: 'video/mp4',
      }],
    },
  });

  const reopened = await createLocalAppServer({
    root,
    assetsRoot,
    catalog,
    persistence: 'postgres-s3',
    port: 0,
    retentionOnStartup: false,
  });
  const reopenedListening = await reopened.listen();
  const reopenedRequest = requestFactory(reopenedListening.url, reopened.sessionToken);
  const storedProjectResponse = await reopenedRequest(`/api/projects/${projectId}`);
  assert.equal(storedProjectResponse.status, 200);
  assert.equal((await storedProjectResponse.json()).project.title, 'Proyecto cutover');
  passed += 1;
  const resources = await (await reopenedRequest('/api/library/resources')).json();
  assert.ok(resources.resources.some((resource) => resource.id === resourceId));
  passed += 1;
  const rangeResponse = await reopenedRequest(`/api/render-jobs/${jobId}/video`, {
    headers: { range: 'bytes=3-8' },
  });
  assert.equal(rangeResponse.status, 206);
  assert.deepEqual(Buffer.from(await rangeResponse.arrayBuffer()), videoBytes.subarray(3, 9));
  passed += 1;
  await reopened.close();

  const rollbackId = `${prefix}-rollback`;
  const rollbackProjects = path.join(root, 'rollback-projects');
  await mkdir(rollbackProjects, { recursive: true });
  await writeFile(
    path.join(rollbackProjects, `${rollbackId}.json`),
    `${JSON.stringify({
      version: 1,
      id: rollbackId,
      title: 'Filesystem intacto',
      scenes: [{ id: 'scene-1' }],
    })}\n`,
  );
  const rollback = await createLocalAppServer({
    root,
    assetsRoot,
    catalog,
    persistence: 'filesystem',
    projectStorageRoot: rollbackProjects,
    libraryStorageRoot: path.join(root, 'rollback-library'),
    libraryPublishRoot: path.join(assetsRoot, 'rollback-publication'),
    appJobsRoot: path.join(root, 'rollback-jobs'),
    appInputRoot: path.join(root, 'rollback-input'),
    workRoot: path.join(root, 'rollback-work'),
    outputRoot: path.join(root, 'rollback-output'),
    port: 0,
    retentionOnStartup: false,
  });
  const rollbackListening = await rollback.listen();
  const rollbackRequest = requestFactory(rollbackListening.url, rollback.sessionToken);
  const rollbackProjectsResponse = await (await rollbackRequest('/api/projects')).json();
  assert.ok(rollbackProjectsResponse.projects.some((item) => item.id === rollbackId));
  assert.ok(!rollbackProjectsResponse.projects.some((item) => item.id === projectId));
  assert.equal((await (await rollbackRequest('/api/health')).json()).persistence.backend, 'filesystem');
  passed += 1;
  await rollback.close();

  const finalReopen = await createLocalAppServer({
    root,
    assetsRoot,
    catalog,
    persistence: 'postgres-s3',
    port: 0,
    retentionOnStartup: false,
  });
  const finalListening = await finalReopen.listen();
  const finalRequest = requestFactory(finalListening.url, finalReopen.sessionToken);
  assert.equal((await finalRequest(`/api/projects/${projectId}`)).status, 200);
  passed += 1;
  await finalReopen.close();

  await assert.rejects(
    () => createLocalAppServer({
      root,
      assetsRoot,
      catalog,
      persistence: 'postgres-s3',
      postgresPool: {
        async query() {
          const error = new Error('secret-password@host');
          error.code = 'ECONNREFUSED';
          throw error;
        },
        async end() {},
      },
      blobStorage: cleanupBlobs,
    }),
    (error) => (
      error.code === 'PERSISTENCE_STARTUP_FAILED'
      && !JSON.stringify(error).includes('secret-password')
    ),
  );
  passed += 1;

  process.stdout.write(`${JSON.stringify({
    version: 1,
    backend: 'postgres-s3',
    passed,
    cases: [
      'startup-diagnostic',
      'project-create',
      'resource-upload',
      'resource-integrity',
      'restart-project',
      'restart-resource',
      'private-range-stream',
      'filesystem-rollback',
      'postgres-reopen-after-rollback',
      'no-silent-fallback',
    ],
  })}\n`);
} finally {
  await cleanupPool.query(
    'DELETE FROM local_video.render_jobs WHERE job_id = $1',
    [jobId],
  ).catch(() => {});
  if (resourceId) {
    await cleanupPool.query(
      'DELETE FROM local_video.resources WHERE id = $1',
      [resourceId],
    ).catch(() => {});
  }
  await cleanupPool.query(
    'DELETE FROM local_video.projects WHERE id = $1',
    [projectId],
  ).catch(() => {});
  for (const object of await managedObjects(cleanupBlobs).catch(() => [])) {
    if (!initialKeys.has(object.key)) await cleanupBlobs.delete(object.key).catch(() => {});
  }
  await cleanupBlobs.close();
  await cleanupPool.end();
  await rm(root, { recursive: true, force: true });
}

function requestFactory(baseUrl, token) {
  return (pathname, options = {}) => fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      origin: 'http://127.0.0.1:5173',
      'x-local-video-token': token,
      ...(options.headers || {}),
    },
  });
}

async function managedObjects(blobStorage) {
  return [
    ...await blobStorage.list('jobs'),
    ...await blobStorage.list('sha256'),
  ];
}

function png64(seed) {
  const color = createHash('sha256').update(seed).digest();
  const row = Buffer.alloc(1 + (64 * 4));
  for (let index = 0; index < 64; index += 1) {
    row[1 + (index * 4)] = color[0];
    row[2 + (index * 4)] = color[1];
    row[3 + (index * 4)] = color[2];
    row[4 + (index * 4)] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: 64 }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', Buffer.from([
      0, 0, 0, 64,
      0, 0, 0, 64,
      8, 6, 0, 0, 0,
    ])),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
