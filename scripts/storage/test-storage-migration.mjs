import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateResourceLibraryRegistry } from '../local-app/resource-library.mjs';
import { sha256Json } from './filesystem-utils.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createPostgresProjectRepository } from './postgres-project-repository.mjs';
import { createPostgresRenderJobRepository } from './postgres-render-job-repository.mjs';
import { createPostgresResourceRepository } from './postgres-resource-repository.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';
import {
  applyStorageMigration,
  createStorageMigrationPlan,
  readStorageMigrationPlan,
  verifyStorageMigration,
  writeStorageMigrationPlan,
} from './storage-migration.mjs';

const prefix = `p6${randomBytes(5).toString('hex')}`;
const testRoot = await mkdtemp(path.join(tmpdir(), 'local-video-p6-'));
const pool = createPostgresPool();
const blobStorage = createS3BlobStorage({
  materializationRoot: path.join(testRoot, 'materialized'),
});
const repositories = {
  projects: createPostgresProjectRepository({ pool }),
  resources: await createPostgresResourceRepository({
    pool,
    validateRegistry: validateResourceLibraryRegistry,
  }),
  jobs: createPostgresRenderJobRepository({ pool }),
};
const cleanup = {
  projectIds: [],
  resourceIds: [],
  jobIds: [],
  blobKeys: new Set(),
};
let passed = 0;

try {
  const empty = await fixture('empty');
  const emptyPlan = await createStorageMigrationPlan({
    roots: empty.roots,
    now: () => new Date('2026-07-26T00:00:00.000Z'),
  });
  assert.equal(emptyPlan.summary.items, 0);
  passed += 1;
  const emptyApplied = await applyStorageMigration({
    roots: empty.roots,
    plan: emptyPlan,
    repositories,
    blobStorage,
  });
  assert.deepEqual(emptyApplied.summary, {
    failed: 0,
    imported: 0,
    planned: 0,
    skipped: 0,
    total: 0,
    verified: 0,
  });
  passed += 1;
  assert.equal((await verifyStorageMigration({
    roots: empty.roots,
    plan: emptyPlan,
    repositories,
    blobStorage,
  })).state, 'completed');
  passed += 1;

  const partialId = `${prefix}-partial`;
  const partial = await fixture('partial', { projectId: partialId });
  cleanup.projectIds.push(partialId);
  const partialPlanFile = path.join(testRoot, 'plans', 'partial.json');
  const partialPlan = await writeStorageMigrationPlan({
    roots: partial.roots,
    planFile: partialPlanFile,
    now: () => new Date('2026-07-26T00:01:00.000Z'),
  });
  assert.equal(partialPlan.summary.projects, 1);
  assert.equal((await readStorageMigrationPlan(partialPlanFile)).fingerprint, partialPlan.fingerprint);
  passed += 1;
  await assert.rejects(
    () => writeStorageMigrationPlan({
      roots: partial.roots,
      planFile: partialPlanFile,
      now: () => new Date('2026-07-26T00:01:00.000Z'),
    }),
    (error) => error.code === 'MIGRATION_PLAN_EXISTS',
  );
  passed += 1;
  const partialApplied = await applyStorageMigration({
    roots: partial.roots,
    plan: partialPlan,
    repositories,
    blobStorage,
  });
  assert.equal(partialApplied.summary.imported, 1);
  assert.equal((await repositories.projects.get(partialId)).project.title, 'Proyecto parcial');
  passed += 1;

  const fullIds = {
    projectId: `${prefix}-full`,
    resourceId: `${prefix}-background`,
    jobId: `${prefix}-job`,
  };
  cleanup.projectIds.push(fullIds.projectId);
  cleanup.resourceIds.push(fullIds.resourceId);
  cleanup.jobIds.push(fullIds.jobId);
  const full = await fixture('full', fullIds);
  const fullPlan = await createStorageMigrationPlan({
    roots: full.roots,
    now: () => new Date('2026-07-26T00:02:00.000Z'),
  });
  fullPlan.items
    .filter((item) => item.kind === 'blob')
    .forEach((item) => cleanup.blobKeys.add(item.key));
  assert.equal(fullPlan.summary.projects, 1);
  assert.equal(fullPlan.summary.resources, 1);
  assert.equal(fullPlan.summary.jobs, 1);
  assert.equal(fullPlan.summary.blobs, 2);
  passed += 1;

  const first = await applyStorageMigration({
    roots: full.roots,
    plan: fullPlan,
    repositories,
    blobStorage,
  });
  assert.equal(first.summary.imported, 5);
  assert.equal(first.summary.failed, 0);
  passed += 1;
  const resource = await repositories.resources.get(fullIds.resourceId);
  assert.equal(resource.blobStorage.backend, 's3');
  assert.equal(resource.blobStorage.artifacts.length, 1);
  const job = await repositories.jobs.get(fullIds.jobId);
  assert.equal(job.blobStorage.artifacts.length, 1);
  passed += 1;

  const second = await applyStorageMigration({
    roots: full.roots,
    plan: fullPlan,
    repositories,
    blobStorage,
  });
  assert.equal(second.summary.imported, 0);
  assert.equal(second.summary.skipped, 5);
  passed += 1;
  const verified = await verifyStorageMigration({
    roots: full.roots,
    plan: fullPlan,
    repositories,
    blobStorage,
  });
  assert.equal(verified.summary.verified, 5);
  assert.equal(verified.state, 'completed');
  passed += 1;

  const corruptIds = {
    projectId: `${prefix}-corrupt`,
    resourceId: `${prefix}-corrupt-bg`,
    jobId: `${prefix}-corrupt-job`,
  };
  const corrupt = await fixture('corrupt', corruptIds);
  const corruptPlan = await createStorageMigrationPlan({
    roots: corrupt.roots,
    now: () => new Date('2026-07-26T00:03:00.000Z'),
  });
  await writeFile(corrupt.assetFile, 'contenido-corrupto');
  await assert.rejects(
    () => applyStorageMigration({
      roots: corrupt.roots,
      plan: corruptPlan,
      repositories,
      blobStorage,
    }),
    (error) => error.code === 'MIGRATION_SOURCE_CHANGED',
  );
  assert.equal(await optionalProject(corruptIds.projectId), null);
  passed += 1;

  const conflictId = `${prefix}-conflict`;
  cleanup.projectIds.push(conflictId);
  const conflict = await fixture('conflict', { projectId: conflictId });
  const conflictPlan = await createStorageMigrationPlan({
    roots: conflict.roots,
    now: () => new Date('2026-07-26T00:04:00.000Z'),
  });
  await repositories.projects.insert(sampleProject(conflictId, 'Destino diferente'));
  await assert.rejects(
    () => applyStorageMigration({
      roots: conflict.roots,
      plan: conflictPlan,
      repositories,
      blobStorage,
    }),
    (error) => (
      error.code === 'MIGRATION_DESTINATION_CONFLICT'
      && error.report?.summary.failed === 1
    ),
  );
  assert.equal((await repositories.projects.get(conflictId)).project.title, 'Destino diferente');
  passed += 1;

  const tampered = structuredClone(fullPlan);
  tampered.summary.items += 1;
  await assert.rejects(
    () => applyStorageMigration({
      roots: full.roots,
      plan: tampered,
      repositories,
      blobStorage,
    }),
    (error) => error.code === 'MIGRATION_PLAN_FINGERPRINT_MISMATCH',
  );
  passed += 1;

  process.stdout.write(`${JSON.stringify({
    version: 1,
    backend: 'postgresql-s3',
    passed,
    cases: [
      'empty',
      'partial',
      'full',
      'second-apply-idempotent',
      'verify',
      'source-corruption',
      'destination-conflict',
      'plan-tampering',
    ],
  })}\n`);
} finally {
  if (cleanup.jobIds.length) {
    await pool.query(
      'DELETE FROM local_video.render_jobs WHERE job_id = ANY($1::text[])',
      [cleanup.jobIds],
    ).catch(() => {});
  }
  if (cleanup.resourceIds.length) {
    await pool.query(
      'DELETE FROM local_video.resources WHERE id = ANY($1::text[])',
      [cleanup.resourceIds],
    ).catch(() => {});
  }
  if (cleanup.projectIds.length) {
    await pool.query(
      'DELETE FROM local_video.projects WHERE id = ANY($1::text[])',
      [cleanup.projectIds],
    ).catch(() => {});
  }
  for (const key of cleanup.blobKeys) {
    await blobStorage.delete(key).catch(() => {});
  }
  await blobStorage.close();
  await pool.end();
  await rm(testRoot, { recursive: true, force: true });
}

async function fixture(name, ids = {}) {
  const root = path.join(testRoot, name);
  const roots = {
    projectsRoot: path.join(root, 'projects'),
    libraryRoot: path.join(root, 'library'),
    jobsRoot: path.join(root, 'jobs'),
    outputRoot: path.join(root, 'output'),
  };
  await Promise.all(Object.values(roots).map((directory) => mkdir(directory, { recursive: true })));
  if (ids.projectId) {
    await writeJson(
      path.join(roots.projectsRoot, `${ids.projectId}.json`),
      sampleProject(ids.projectId, name === 'partial' ? 'Proyecto parcial' : 'Proyecto migrable'),
    );
  }
  let assetFile = null;
  if (ids.resourceId) {
    const backgroundManifest = `assets/library/backgrounds/${ids.resourceId}/background.manifest.json`;
    const entry = {
      id: ids.resourceId,
      type: 'background',
      label: 'Fondo migrable',
      backgroundManifest,
    };
    const record = {
      id: ids.resourceId,
      contentHash: sha256Json({ type: 'background', backgroundManifest }),
      registeredAt: '2026-07-26T00:00:00.000Z',
      entry,
    };
    await writeJson(path.join(roots.libraryRoot, 'library-index.json'), {
      version: 1,
      entries: [record],
    });
    assetFile = path.join(
      roots.libraryRoot,
      'assets',
      'backgrounds',
      ids.resourceId,
      'background.png',
    );
    await mkdir(path.dirname(assetFile), { recursive: true });
    await writeFile(assetFile, Buffer.from(`png-fixture-${ids.resourceId}`));
  }
  if (ids.jobId) {
    await writeJson(path.join(roots.jobsRoot, `${ids.jobId}.json`), {
      version: 1,
      jobId: ids.jobId,
      projectId: ids.projectId,
      state: 'completed',
      stage: 'completed',
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:01.000Z',
      result: { output: `output/${ids.jobId}/render.mp4` },
      error: null,
    });
    const video = path.join(roots.outputRoot, ids.jobId, 'render.mp4');
    await mkdir(path.dirname(video), { recursive: true });
    await writeFile(video, Buffer.from(`mp4-fixture-${ids.jobId}`));
  }
  return { roots, assetFile };
}

function sampleProject(id, title) {
  return {
    version: 1,
    id,
    title,
    scenes: [{ id: 'scene-1' }],
  };
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function optionalProject(id) {
  try {
    return await repositories.projects.get(id);
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return null;
    throw error;
  }
}
