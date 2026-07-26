import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { projectRoot } from '../stage1/common.mjs';
import {
  createRenderJobManager,
  streamVideoResponse,
} from '../local-app/render-job-manager.mjs';
import {
  createBlobMaterializer,
  publishRenderArtifacts,
} from './artifact-storage.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createPostgresProjectRepository } from './postgres-project-repository.mjs';
import { createPostgresRenderJobRepository } from './postgres-render-job-repository.mjs';
import { createPostgresResourceRepository } from './postgres-resource-repository.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';
import { createLocalS3Client } from './s3-client.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-p5-flow-'));
const prefix = `p5${randomBytes(4).toString('hex')}`;
const pool = createPostgresPool();
const connection = createLocalS3Client();
const blobStorage = createS3BlobStorage({
  connection,
  materializationRoot: path.join(root, 'materialized'),
  maximumBytes: 10 * 1024 * 1024,
});
const projectRepository = createPostgresProjectRepository({ pool });
const resourceRepository = await createPostgresResourceRepository({
  pool,
  validateRegistry,
});
const renderJobRepository = createPostgresRenderJobRepository({ pool });
let spawned = null;
let jobId = null;
let server = null;
const resourceKey = `resources/image/${prefix}/original/source.bin`;

try {
  const sourceBytes = Buffer.from('recurso portable P5');
  const sourceHash = sha256(sourceBytes);
  await blobStorage.put({
    key: resourceKey,
    bytes: sourceBytes,
    expectedSha256: sourceHash,
    mimeType: 'application/octet-stream',
  });
  await resourceRepository.register({
    id: `${prefix}-resource`,
    contentHash: sourceHash,
    registeredAt: '2026-07-26T00:00:00.000Z',
    entry: {
      id: `${prefix}-resource`,
      type: 'image',
      blob: { key: resourceKey, sha256: sourceHash, bytes: sourceBytes.length },
    },
  });
  const resource = await resourceRepository.get(`${prefix}-resource`);
  const hydrated = await createBlobMaterializer({ blobStorage }).materialize(
    `${prefix}-hydrate`,
    [{
      key: resource.entry.blob.key,
      sha256: resource.entry.blob.sha256,
      relativePath: 'assets/source.bin',
    }],
  );
  assert.equal(
    readFileSync(path.join(hydrated.root, 'assets', 'source.bin')).equals(sourceBytes),
    true,
  );

  const pilot = JSON.parse(readFileSync(
    path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'),
    'utf8',
  ));
  const project = { ...pilot, id: `${prefix}-project`, title: 'Flujo portable P5' };
  await projectRepository.save(project);
  const durableProject = (await projectRepository.get(project.id)).project;
  const manager = await createRenderJobManager({
    root: projectRoot,
    appJobsRoot: path.join(root, 'jobs'),
    appInputRoot: path.join(root, 'input'),
    workRoot: path.join(root, 'work'),
    outputRoot: path.join(root, 'output'),
    repository: renderJobRepository,
    blobStorage,
    spawnImpl: fakeSpawn,
  });
  const job = await manager.create(durableProject);
  jobId = job.jobId;
  const outputRoot = path.join(root, 'output', jobId);
  mkdirSync(outputRoot, { recursive: true });
  const videoFile = path.join(outputRoot, 'render-1.mp4');
  createVerifiedVideo(videoFile);
  const originalVideo = readFileSync(videoFile);
  writeFileSync(path.join(outputRoot, 'verification.json'), JSON.stringify({
    version: 1,
    verified: true,
  }));
  writeFileSync(path.join(outputRoot, 'project-manifest.json'), JSON.stringify({
    version: 2,
    jobId,
    projectId: durableProject.id,
    deterministic: true,
    timeline: {
      durationSeconds: 1,
      scenes: [{
        id: durableProject.scenes[0].id,
        startSeconds: 0,
        endSeconds: 1,
        audioDurationSeconds: 1,
        turns: [],
      }],
    },
  }));
  spawned.emit('close', 0);
  await waitFor(async () => (await renderJobRepository.get(jobId))?.state === 'completed');
  const durableJob = await renderJobRepository.get(jobId);
  assert.equal(durableJob.result.artifacts.video.sha256, sha256(originalVideo));
  assert.equal(durableJob.result.artifacts.manifest.mimeType, 'application/json');

  rmSync(outputRoot, { recursive: true, force: true });
  const video = await manager.video(jobId);
  assert.equal(video.key, `jobs/${jobId}/artifacts/render-1.mp4`);
  server = http.createServer(async (request, response) => {
    await streamVideoResponse(request, response, video);
  });
  const address = await listen(server);
  const full = await fetch(`http://127.0.0.1:${address.port}/video`);
  assert.equal(full.status, 200);
  assert.equal(sha256(Buffer.from(await full.arrayBuffer())), sha256(originalVideo));
  const partial = await fetch(`http://127.0.0.1:${address.port}/video`, {
    headers: { range: 'bytes=0-15' },
  });
  assert.equal(partial.status, 206);
  assert.equal((await partial.arrayBuffer()).byteLength, 16);

  writeFileSync(path.join(root, 'orphan-manifest.json'), '{}');
  writeFileSync(path.join(root, 'orphan-video.mp4'), 'video');
  let deleteCalls = 0;
  await assert.rejects(
    () => publishRenderArtifacts({
      blobStorage: {
        async put(input) {
          if (input.role === 'video') {
            const error = new Error('fallo simulado');
            error.code = 'BLOB_UPLOAD_FAILED';
            throw error;
          }
          return {
            key: input.key,
            sha256: '1'.repeat(64),
            bytes: 1,
            mimeType: input.mimeType,
          };
        },
        async delete() {
          deleteCalls += 1;
        },
      },
      jobId: `${prefix}-orphan`,
      manifestFile: path.join(root, 'orphan-manifest.json'),
      videoFile: path.join(root, 'orphan-video.mp4'),
    }),
    (error) => (
      error.code === 'ARTIFACT_PUBLICATION_FAILED'
      && error.orphanedKeys.length === 1
      && error.technicalDetail.includes('orphaned=jobs/')
    ),
  );
  assert.equal(deleteCalls, 0);

  process.stdout.write(`${JSON.stringify({
    version: 1,
    passed: 13,
    failed: 0,
    jobId,
    projectBackend: 'postgres',
    blobBackend: 's3',
    hydratedBytes: sourceBytes.length,
    videoBytes: originalVideo.length,
  })}\n`);
} finally {
  if (server) await closeServer(server);
  if (jobId) {
    await blobStorage.delete(`jobs/${jobId}/artifacts/project-manifest.json`).catch(() => {});
    await blobStorage.delete(`jobs/${jobId}/artifacts/render-1.mp4`).catch(() => {});
    await pool.query('DELETE FROM local_video.render_jobs WHERE job_id = $1', [jobId]).catch(() => {});
  }
  await blobStorage.delete(resourceKey).catch(() => {});
  await pool.query('DELETE FROM local_video.resources WHERE id = $1', [`${prefix}-resource`]).catch(() => {});
  await pool.query('DELETE FROM local_video.projects WHERE id = $1', [`${prefix}-project`]).catch(() => {});
  blobStorage.close();
  await pool.end();
  rmSync(root, { recursive: true, force: true });
}

function fakeSpawn() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  spawned = child;
  return child;
}

function createVerifiedVideo(file) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=160x284:r=30:d=1',
    '-f', 'lavfi',
    '-i', 'anullsrc=r=48000:cl=stereo',
    '-shortest',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    '-y',
    file,
  ], { shell: false, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_name',
    '-of', 'json',
    file,
  ], { shell: false, encoding: 'utf8', timeout: 10_000 });
  assert.equal(probe.status, 0, probe.stderr);
  const document = JSON.parse(probe.stdout);
  assert.ok(document.streams.some((stream) => stream.codec_name === 'h264'));
  assert.ok(document.streams.some((stream) => stream.codec_name === 'aac'));
}

function validateRegistry(registry) {
  assert.equal(registry.version, 1);
  assert.ok(Array.isArray(registry.entries));
  for (const record of registry.entries) {
    assert.equal(record.id, record.entry.id);
    assert.match(record.contentHash, /^[a-f0-9]{64}$/u);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail('El flujo P5 no terminó dentro del timeout.');
}

function listen(instance) {
  return new Promise((resolve, reject) => {
    instance.once('error', reject);
    instance.listen(0, '127.0.0.1', () => resolve(instance.address()));
  });
}

function closeServer(instance) {
  return new Promise((resolve, reject) => {
    instance.close((error) => error ? reject(error) : resolve());
  });
}
