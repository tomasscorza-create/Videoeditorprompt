import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateResourceLibraryRegistry } from '../local-app/resource-library.mjs';
import { contentAddressedBlobKey } from './content-addressed-blobs.mjs';
import { sha256Json } from './filesystem-utils.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createPostgresProjectRepository } from './postgres-project-repository.mjs';
import { createPostgresRenderJobRepository } from './postgres-render-job-repository.mjs';
import { createPostgresResourceRepository } from './postgres-resource-repository.mjs';
import {
  createPostgresS3Backup,
  restorePostgresS3Backup,
  verifyPostgresS3Backup,
} from './postgres-s3-backup.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';

const prefix = `p7backup${randomBytes(4).toString('hex')}`;
const projectId = `${prefix}-project`;
const resourceId = `${prefix}-voice`;
const jobId = `${prefix}-job`;
const root = await mkdtemp(path.join(tmpdir(), 'local-video-p7-backup-'));
const backup = path.join(root, 'backup');
const pool = createPostgresPool();
const blobStorage = createS3BlobStorage({
  materializationRoot: path.join(root, 'materialized'),
});
const repositories = {
  projects: createPostgresProjectRepository({ pool }),
  resources: await createPostgresResourceRepository({
    pool,
    validateRegistry: validateResourceLibraryRegistry,
  }),
  jobs: createPostgresRenderJobRepository({ pool }),
};
const bytes = Buffer.from(`backup-object-${prefix}`);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const key = contentAddressedBlobKey(sha256);
let passed = 0;

try {
  const project = {
    version: 1,
    id: projectId,
    title: 'Backup P7',
    scenes: [{ id: 'scene-1' }],
  };
  const voice = {
    provider: 'piper',
    model: 'backup_voice',
    locale: 'es_AR',
    lengthScale: 1,
    volume: 1,
  };
  const resource = {
    id: resourceId,
    contentHash: sha256Json({ type: 'voice', voice }),
    registeredAt: '2026-07-26T00:00:00.000Z',
    entry: {
      id: resourceId,
      type: 'voice',
      label: 'Voz backup',
      tags: ['backup'],
      voice,
      provenance: { source: 'Fixture P7.', license: 'Solo pruebas.' },
    },
  };
  const job = {
    version: 1,
    jobId,
    projectId,
    state: 'completed',
    stage: 'completed',
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:01.000Z',
    result: { downloadName: 'backup.mp4' },
    error: null,
    blobStorage: {
      version: 1,
      backend: 's3',
      artifacts: [{
        role: 'rendered-video',
        relativePath: 'render-1.mp4',
        key,
        bytes: bytes.length,
        sha256,
        mimeType: 'video/mp4',
      }],
    },
  };
  await repositories.projects.insert(project);
  await repositories.resources.register(resource);
  await repositories.jobs.reserve(job);
  await blobStorage.put({ key, bytes, expectedSha256: sha256, mimeType: 'video/mp4' });

  const created = await createPostgresS3Backup({
    output: backup,
    repositories,
    blobStorage,
    now: () => new Date('2026-07-26T01:00:00.000Z'),
  });
  assert.ok(created.summary.projects >= 1);
  assert.ok(created.summary.objects >= 1);
  passed += 1;
  const verified = await verifyPostgresS3Backup({ backup });
  assert.equal(verified.valid, true);
  passed += 1;

  const dryRun = await restorePostgresS3Backup({
    backup,
    apply: false,
    repositories,
    blobStorage,
  });
  assert.equal(dryRun.summary.planned, 0);
  assert.equal(dryRun.summary.skipped, dryRun.summary.total);
  passed += 1;

  await pool.query('DELETE FROM local_video.render_jobs WHERE job_id = $1', [jobId]);
  await pool.query('DELETE FROM local_video.resources WHERE id = $1', [resourceId]);
  await pool.query('DELETE FROM local_video.projects WHERE id = $1', [projectId]);
  await blobStorage.delete(key);
  const restored = await restorePostgresS3Backup({
    backup,
    apply: true,
    repositories,
    blobStorage,
  });
  assert.ok(restored.summary.restored >= 4);
  passed += 1;
  assert.equal((await repositories.projects.get(projectId)).project.title, project.title);
  assert.equal((await repositories.resources.get(resourceId)).contentHash, resource.contentHash);
  assert.equal((await repositories.jobs.get(jobId)).state, 'completed');
  assert.equal((await blobStorage.stat(key)).sha256, sha256);
  passed += 1;

  const repeated = await restorePostgresS3Backup({
    backup,
    apply: true,
    repositories,
    blobStorage,
  });
  assert.equal(repeated.summary.restored, 0);
  assert.equal(repeated.summary.skipped, repeated.summary.total);
  passed += 1;

  const manifest = JSON.parse(await readFile(path.join(backup, 'manifest.json'), 'utf8'));
  const targetObject = manifest.objects.find((object) => object.key === key);
  await writeFile(path.join(backup, ...targetObject.path.split('/')), Buffer.from('corrupto'));
  await assert.rejects(
    () => verifyPostgresS3Backup({ backup }),
    (error) => error.code === 'BACKUP_FILE_MISMATCH',
  );
  passed += 1;

  process.stdout.write(`${JSON.stringify({
    version: 1,
    backend: 'postgres-s3',
    passed,
    cases: [
      'logical-backup',
      'offline-verify',
      'restore-dry-run',
      'restore-apply',
      'restored-metadata-and-blob',
      'restore-idempotent',
      'corruption-rejected',
    ],
  })}\n`);
} finally {
  await pool.query('DELETE FROM local_video.render_jobs WHERE job_id = $1', [jobId]).catch(() => {});
  await pool.query('DELETE FROM local_video.resources WHERE id = $1', [resourceId]).catch(() => {});
  await pool.query('DELETE FROM local_video.projects WHERE id = $1', [projectId]).catch(() => {});
  await blobStorage.delete(key).catch(() => {});
  await blobStorage.close();
  await pool.end();
  await rm(root, { recursive: true, force: true });
}
