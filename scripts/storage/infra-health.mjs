import {
  assertS3Success,
  postgresContext,
  runCompose,
  runPsql,
  s3Context,
  serializeInfraError,
  signedS3Request,
} from './infra-common.mjs';

try {
  const runningServices = runCompose(
    ['ps', '--status', 'running', '--services'],
    {
      code: 'INFRA_SERVICES_UNAVAILABLE',
      message: 'No se pudieron inspeccionar los servicios.',
    },
  ).split(/\r?\n/gu).filter(Boolean);
  if (!runningServices.includes('postgres') || !runningServices.includes('seaweedfs')) {
    throw healthError('INFRA_SERVICES_UNAVAILABLE', 'PostgreSQL o SeaweedFS no están ejecutándose.');
  }
  const postgres = postgresContext();
  const postgresVersion = runPsql(
    'SHOW server_version;',
    { context: postgres, tuplesOnly: true },
  ).trim();
  const migrationCount = Number(runPsql(
    `SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'local_video_schema_migrations';`,
    { context: postgres, tuplesOnly: true },
  ).trim());
  if (migrationCount !== 1) {
    throw healthError('INFRA_MIGRATIONS_MISSING', 'La tabla de migraciones todavía no existe.');
  }
  const appliedMigrations = Number(runPsql(
    'SELECT count(*) FROM public.local_video_schema_migrations;',
    { context: postgres, tuplesOnly: true },
  ).trim());
  const s3 = s3Context();
  const bucketResponse = await signedS3Request({ context: s3, method: 'HEAD' });
  assertS3Success(bucketResponse, 'la inspección del bucket privado');

  process.stdout.write(`${JSON.stringify({
    version: 1,
    state: 'healthy',
    postgres: {
      version: postgresVersion,
      appliedMigrations,
    },
    s3: {
      provider: 'seaweedfs',
      bucket: s3.bucket,
      reachable: true,
    },
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(serializeInfraError(error))}\n`);
  process.exitCode = 1;
}

function healthError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.stage = 'infrastructure_health';
  return error;
}
