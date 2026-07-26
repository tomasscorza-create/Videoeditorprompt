import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRenderJobManager } from '../local-app/render-job-manager.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createPostgresProjectRepository } from './postgres-project-repository.mjs';
import { createPostgresRenderJobRepository } from './postgres-render-job-repository.mjs';
import { createPostgresResourceRepository } from './postgres-resource-repository.mjs';
import { runRepositoryContractSuite } from './repository-contract-suite.mjs';

const pool = createPostgresPool();
const prefix = `p4${randomBytes(4).toString('hex')}`;
const localRoot = mkdtempSync(path.join(tmpdir(), 'local-video-pg-recovery-'));

try {
  const result = await runRepositoryContractSuite({
    backend: 'postgres',
    prefix,
    createProjectRepository: () => createPostgresProjectRepository({ pool }),
    createResourceRepository: () => createPostgresResourceRepository({
      pool,
      validateRegistry,
    }),
    createRenderJobRepository: () => createPostgresRenderJobRepository({ pool }),
  });
  const recoveryJob = {
    version: 1,
    jobId: `${prefix}-recovery`,
    projectId: `${prefix}-project`,
    state: 'rendering',
    stage: 'rendering_frames',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:01.000Z',
    progress: null,
    error: null,
  };
  const recoveryRepository = createPostgresRenderJobRepository({ pool });
  await recoveryRepository.reserve(recoveryJob);
  const manager = await createRenderJobManager({
    repository: recoveryRepository,
    appJobsRoot: path.join(localRoot, 'jobs'),
    appInputRoot: path.join(localRoot, 'input'),
    workRoot: path.join(localRoot, 'work'),
    outputRoot: path.join(localRoot, 'output'),
  });
  const recovered = await manager.get(recoveryJob.jobId);
  assert.equal(recovered.state, 'failed');
  assert.equal(recovered.stage, 'recovery');
  assert.equal(recovered.error.code, 'RENDER_INTERRUPTED');
  const unavailableRepository = createPostgresProjectRepository({
    pool: {
      connect() {},
      async query() {
        const error = new Error('connect ECONNREFUSED secret-password@127.0.0.1');
        error.code = 'ECONNREFUSED';
        throw error;
      },
    },
  });
  await assert.rejects(
    () => unavailableRepository.list(),
    (error) => (
      error.code === 'PROJECT_STORAGE_UNAVAILABLE'
      && !JSON.stringify({
        message: error.message,
        technicalDetail: error.technicalDetail,
      }).includes('secret-password')
    ),
  );
  await assert.rejects(
    () => pool.query(`
      INSERT INTO local_video.projects (id, revision, document)
      VALUES ($1, $2, $3::jsonb)
    `, [
      `${prefix}-constraint`,
      '0'.repeat(64),
      JSON.stringify({
        version: 1,
        id: `${prefix}-different-id`,
        title: 'Inválido',
        scenes: [{}],
      }),
    ]),
    (error) => error.code === '23514',
  );
  process.stdout.write(`${JSON.stringify({
    ...result,
    contractPassed: result.passed,
    recoveryPassed: 1,
    sanitizedErrorPassed: 1,
    databaseConstraintPassed: 1,
    passed: result.passed + 3,
  })}\n`);
} finally {
  await pool.query(
    'DELETE FROM local_video.render_jobs WHERE job_id = ANY($1::text[])',
    [[`${prefix}-job`, `${prefix}-race-job`, `${prefix}-recovery`]],
  ).catch(() => {});
  await pool.query(
    'DELETE FROM local_video.resources WHERE id = ANY($1::text[])',
    [[
      `${prefix}-voice`,
      `${prefix}-alias`,
      `${prefix}-race-a`,
      `${prefix}-race-b`,
    ]],
  ).catch(() => {});
  await pool.query(
    'DELETE FROM local_video.projects WHERE id = $1',
    [`${prefix}-project`],
  ).catch(() => {});
  await pool.end();
  rmSync(localRoot, { recursive: true, force: true });
}

function validateRegistry(registry) {
  if (registry.version !== 1 || !Array.isArray(registry.entries)) {
    const error = new Error('Registro inválido.');
    error.code = 'LIBRARY_INDEX_INVALID';
    throw error;
  }
  for (const record of registry.entries) {
    if (
      record.id !== record.entry?.id
      || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u.test(record.id)
      || !/^[a-f0-9]{64}$/u.test(record.contentHash)
    ) {
      const error = new Error('Registro inválido.');
      error.code = 'LIBRARY_INDEX_INVALID';
      throw error;
    }
  }
}
