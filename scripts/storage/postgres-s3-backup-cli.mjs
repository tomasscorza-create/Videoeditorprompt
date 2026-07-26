import path from 'node:path';
import { parseArguments, projectRoot } from '../stage1/common.mjs';
import { validateResourceLibraryRegistry } from '../local-app/resource-library.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createPostgresProjectRepository } from './postgres-project-repository.mjs';
import { createPostgresRenderJobRepository } from './postgres-render-job-repository.mjs';
import { createPostgresResourceRepository } from './postgres-resource-repository.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';
import {
  createPostgresS3Backup,
  restorePostgresS3Backup,
  verifyPostgresS3Backup,
} from './postgres-s3-backup.mjs';

const [operation, ...argv] = process.argv.slice(2);
const args = parseArguments(argv);
let pool = null;
let blobStorage = null;

try {
  if (operation === 'verify') {
    const result = await verifyPostgresS3Backup({
      backup: required(args.backup, '--backup'),
    });
    process.stdout.write(`${JSON.stringify({
      version: 1,
      state: 'completed',
      valid: result.valid,
      fingerprint: result.manifest.fingerprint,
      summary: result.manifest.summary,
    }, null, 2)}\n`);
  } else {
    ({ pool, blobStorage } = await destination());
    const repositories = {
      projects: createPostgresProjectRepository({ pool }),
      resources: await createPostgresResourceRepository({
        pool,
        validateRegistry: validateResourceLibraryRegistry,
      }),
      jobs: createPostgresRenderJobRepository({ pool }),
    };
    if (operation === 'backup') {
      const result = await createPostgresS3Backup({
        output: required(args.output, '--output'),
        repositories,
        blobStorage,
      });
      process.stdout.write(`${JSON.stringify({ version: 1, state: 'completed', ...result }, null, 2)}\n`);
    } else if (operation === 'restore') {
      if (args.apply !== true && args['dry-run'] !== true) {
        throw cliError(
          'RESTORE_CONFIRMATION_REQUIRED',
          'Use --dry-run para inspeccionar o --apply para restaurar.',
        );
      }
      if (args.apply === true && args['dry-run'] === true) {
        throw cliError('RESTORE_OPERATION_INVALID', 'Use solo --dry-run o --apply.');
      }
      const result = await restorePostgresS3Backup({
        backup: required(args.backup, '--backup'),
        apply: args.apply === true,
        repositories,
        blobStorage,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      throw cliError('BACKUP_OPERATION_INVALID', 'Use backup, verify o restore.');
    }
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    version: 1,
    state: 'failed',
    stage: error.stage || 'storage_backup',
    code: error.code || 'UNEXPECTED_ERROR',
    message: error.message,
    technicalDetail: error.technicalDetail,
  })}\n`);
  process.exitCode = 1;
} finally {
  await blobStorage?.close?.();
  await pool?.end?.();
}

async function destination() {
  const nextPool = createPostgresPool();
  const nextBlobStorage = createS3BlobStorage({
    materializationRoot: path.join(projectRoot, '.local-video', 'backup-materialized'),
  });
  try {
    await nextPool.query('SELECT 1');
    await nextBlobStorage.health();
    return { pool: nextPool, blobStorage: nextBlobStorage };
  } catch (error) {
    await nextBlobStorage.close();
    await nextPool.end().catch(() => {});
    throw error;
  }
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw cliError('BACKUP_ARGUMENT_REQUIRED', `Falta ${name}.`);
  }
  return value;
}

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.stage = 'storage_backup';
  return error;
}
