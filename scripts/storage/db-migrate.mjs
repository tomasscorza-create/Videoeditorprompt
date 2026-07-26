import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';
import {
  postgresContext,
  runPsql,
  serializeInfraError,
} from './infra-common.mjs';

const migrationsRoot = path.join(projectRoot, 'infra', 'postgres', 'migrations');

try {
  const context = postgresContext();
  runPsql(`
CREATE TABLE IF NOT EXISTS public.local_video_schema_migrations (
  version text PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
`, { context });

  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const match = entry.name.match(/^([0-9]{4})_[a-z0-9_-]+\.sql$/u);
      if (!match) throw migrationError('DB_MIGRATION_NAME_INVALID', `Nombre inválido: ${entry.name}.`);
      const sql = readFileSync(path.join(migrationsRoot, entry.name), 'utf8');
      return {
        version: match[1],
        name: entry.name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));

  const seen = new Set();
  let applied = 0;
  let skipped = 0;
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw migrationError('DB_MIGRATION_VERSION_DUPLICATE', `Versión duplicada: ${migration.version}.`);
    }
    seen.add(migration.version);
    const existing = runPsql(
      `SELECT checksum FROM public.local_video_schema_migrations WHERE version = '${migration.version}';`,
      { context, tuplesOnly: true },
    ).trim();
    if (existing) {
      if (existing !== migration.checksum) {
        throw migrationError(
          'DB_MIGRATION_CHECKSUM_CONFLICT',
          `La migración ${migration.version} cambió después de aplicarse.`,
        );
      }
      skipped += 1;
      continue;
    }
    runPsql(`
BEGIN;
${migration.sql}
INSERT INTO public.local_video_schema_migrations (version, checksum)
VALUES ('${migration.version}', '${migration.checksum}');
COMMIT;
`, { context });
    applied += 1;
  }

  process.stdout.write(`${JSON.stringify({
    version: 1,
    state: 'completed',
    applied,
    skipped,
    total: migrations.length,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(serializeInfraError(error))}\n`);
  process.exitCode = 1;
}

function migrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.stage = 'database_migration';
  return error;
}
