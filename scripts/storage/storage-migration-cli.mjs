import path from 'node:path';
import { parseArguments, projectRoot } from '../stage1/common.mjs';
import { defaultProjectStorageRoot } from '../local-app/project-repository.mjs';
import {
  defaultLibraryStorageRoot,
  validateResourceLibraryRegistry,
} from '../local-app/resource-library.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createPostgresProjectRepository } from './postgres-project-repository.mjs';
import { createPostgresRenderJobRepository } from './postgres-render-job-repository.mjs';
import { createPostgresResourceRepository } from './postgres-resource-repository.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';
import {
  applyStorageMigration,
  createStorageMigrationPlan,
  verifyStorageMigration,
  writeStorageMigrationPlan,
} from './storage-migration.mjs';

const args = parseArguments();
const roots = {
  projectsRoot: path.resolve(args['projects-root'] || defaultProjectStorageRoot()),
  libraryRoot: path.resolve(args['library-root'] || defaultLibraryStorageRoot()),
  jobsRoot: path.resolve(args['jobs-root'] || path.join(projectRoot, '.local-video', 'app-jobs')),
  outputRoot: path.resolve(args['output-root'] || path.join(projectRoot, '.local-video', 'output')),
};

let pool = null;
let blobStorage = null;
try {
  const mode = migrationMode(args);
  if (mode === 'dry-run') {
    const plan = await createStorageMigrationPlan({ roots });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else if (mode === 'plan') {
    const plan = await writeStorageMigrationPlan({ roots, planFile: args.plan });
    process.stdout.write(`${JSON.stringify({
      version: 1,
      state: 'completed',
      operation: 'plan',
      plan: path.resolve(args.plan),
      fingerprint: plan.fingerprint,
      summary: plan.summary,
    }, null, 2)}\n`);
  } else {
    pool = createPostgresPool();
    blobStorage = createS3BlobStorage({
      materializationRoot: path.join(projectRoot, '.local-video', 'migration-materialized'),
    });
    const repositories = {
      projects: createPostgresProjectRepository({ pool }),
      resources: await createPostgresResourceRepository({
        pool,
        validateRegistry: validateResourceLibraryRegistry,
      }),
      jobs: createPostgresRenderJobRepository({ pool }),
    };
    const operation = mode === 'apply' ? applyStorageMigration : verifyStorageMigration;
    const result = await operation({
      roots,
      planFile: args.plan,
      repositories,
      blobStorage,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    version: 1,
    state: 'failed',
    stage: error.stage || 'storage_migration',
    code: error.code || 'UNEXPECTED_ERROR',
    message: error.message,
    technicalDetail: error.technicalDetail,
    report: error.report,
  })}\n`);
  process.exitCode = 1;
} finally {
  await blobStorage?.close?.();
  await pool?.end?.();
}

function migrationMode(values) {
  const dryRun = values['dry-run'] === true;
  const apply = values.apply === true;
  const verify = values.verify === true;
  const selected = [dryRun, apply, verify].filter(Boolean).length;
  if (selected > 1) {
    throw cliError(
      'MIGRATION_OPERATION_INVALID',
      'Use solo una operación: --dry-run, --apply o --verify.',
    );
  }
  if (dryRun) {
    if (values.plan) {
      throw cliError('MIGRATION_OPERATION_INVALID', '--dry-run no escribe ni consume un plan.');
    }
    return 'dry-run';
  }
  if (typeof values.plan !== 'string' || !values.plan.trim()) {
    throw cliError('MIGRATION_PLAN_PATH_REQUIRED', 'Falta --plan=<archivo.json>.');
  }
  if (apply) return 'apply';
  if (verify) return 'verify';
  return 'plan';
}

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.stage = 'storage_migration';
  return error;
}
