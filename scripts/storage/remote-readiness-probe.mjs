import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArguments, projectRoot } from '../stage1/common.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';

const args = parseArguments();
const probeId = `probe-${randomBytes(8).toString('hex')}`;
const materializationRoot = await mkdtemp(path.join(tmpdir(), 'local-video-p8-probe-'));
const sourceFile = path.resolve(
  args.asset || path.join(projectRoot, 'public', 'assets', 'stage1', 'background.png'),
);
const targetFile = path.join(materializationRoot, 'downloads', 'asset.bin');
const key = `p8-probes/${probeId}/asset.bin`;
const pool = createPostgresPool();
const blobs = createS3BlobStorage({ materializationRoot });
let uploaded = false;

try {
  const sourceStats = await lstat(sourceFile);
  if (!sourceStats.isFile() || sourceStats.size < 1) {
    throw probeError('PROBE_ASSET_INVALID', 'El asset real del probe no es válido.');
  }
  const sourceSha256 = sha256(await readFile(sourceFile));
  const postgresLatencies = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    await pool.query('SELECT 1');
    postgresLatencies.push(performance.now() - started);
  }
  const database = await pool.query(`
    SELECT
      current_setting('server_version') AS version,
      pg_database_size(current_database())::bigint AS bytes,
      (
        SELECT count(*)::int
        FROM public.local_video_schema_migrations
      ) AS migrations
  `);
  const healthStarted = performance.now();
  const s3Health = await blobs.health();
  const s3HealthMs = performance.now() - healthStarted;
  const uploadStarted = performance.now();
  const stored = await blobs.put({
    key,
    stream: createReadStream(sourceFile),
    expectedSha256: sourceSha256,
    mimeType: 'application/octet-stream',
  });
  uploaded = true;
  const uploadMs = performance.now() - uploadStarted;
  const downloadStarted = performance.now();
  await blobs.getToFile(key, targetFile, sourceSha256);
  const downloadMs = performance.now() - downloadStarted;
  const downloadedSha256 = sha256(await readFile(targetFile));
  if (downloadedSha256 !== sourceSha256) {
    throw probeError('PROBE_HASH_MISMATCH', 'El asset descargado no conserva su SHA-256.');
  }
  const [jobObjects, addressedObjects] = await Promise.all([
    blobs.list('jobs'),
    blobs.list('sha256'),
  ]);
  const objects = [...jobObjects, ...addressedObjects];
  const objectBytes = objects.reduce((total, item) => total + item.bytes, 0);
  const rates = costRates(args, process.env);
  const monthlyCost = rates ? estimateMonthlyCost({
    databaseMonthlyUsd: rates.databaseMonthlyUsd,
    storageBytes: objectBytes,
    storageGbMonthUsd: rates.storageGbMonthUsd,
    egressBytes: numericArg(args['monthly-egress-bytes'], 0),
    egressGbUsd: rates.egressGbUsd,
    putOperations: numericArg(args['monthly-put-operations'], 0),
    put1000Usd: rates.put1000Usd,
    getOperations: numericArg(args['monthly-get-operations'], 0),
    get1000Usd: rates.get1000Usd,
  }) : null;
  process.stdout.write(`${JSON.stringify({
    version: 1,
    state: 'completed',
    deployment: process.env.LOCAL_VIDEO_DEPLOYMENT || 'local',
    postgres: {
      reachable: true,
      version: database.rows[0].version,
      migrations: Number(database.rows[0].migrations),
      databaseBytes: Number(database.rows[0].bytes),
      latencyMs: summarize(postgresLatencies),
    },
    s3: {
      reachable: s3Health.ready,
      provider: blobs.connectionDiagnostic?.provider || process.env.LOCAL_VIDEO_S3_PROVIDER || 'seaweedfs',
      healthMs: rounded(s3HealthMs),
      managedObjects: objects.length,
      managedBytes: objectBytes,
      probeAssetBytes: stored.bytes,
      uploadMs: rounded(uploadMs),
      downloadMs: rounded(downloadMs),
      uploadMiBPerSecond: throughput(stored.bytes, uploadMs),
      downloadMiBPerSecond: throughput(stored.bytes, downloadMs),
      sha256Verified: true,
    },
    costScenario: monthlyCost,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    version: 1,
    state: 'failed',
    stage: 'remote_readiness',
    code: error.code || 'UNEXPECTED_ERROR',
    message: error.message,
    technicalDetail: error.technicalDetail,
  })}\n`);
  process.exitCode = 1;
} finally {
  if (uploaded) await blobs.delete(key).catch(() => {});
  blobs.close();
  await pool.end().catch(() => {});
  await rm(materializationRoot, { recursive: true, force: true });
}

export function estimateMonthlyCost(input) {
  const gib = 1024 ** 3;
  const storage = (input.storageBytes / gib) * input.storageGbMonthUsd;
  const egress = (input.egressBytes / gib) * input.egressGbUsd;
  const puts = (input.putOperations / 1000) * input.put1000Usd;
  const gets = (input.getOperations / 1000) * input.get1000Usd;
  return {
    currency: 'USD',
    database: rounded(input.databaseMonthlyUsd),
    storage: rounded(storage),
    egress: rounded(egress),
    putOperations: rounded(puts),
    getOperations: rounded(gets),
    total: rounded(input.databaseMonthlyUsd + storage + egress + puts + gets),
    ratesSuppliedByOperator: true,
  };
}

function costRates(cli, environment) {
  const values = {
    databaseMonthlyUsd: cli['database-monthly-usd'] ?? environment.LOCAL_VIDEO_COST_DATABASE_MONTHLY_USD,
    storageGbMonthUsd: cli['storage-gb-month-usd'] ?? environment.LOCAL_VIDEO_COST_STORAGE_GB_MONTH_USD,
    egressGbUsd: cli['egress-gb-usd'] ?? environment.LOCAL_VIDEO_COST_EGRESS_GB_USD,
    put1000Usd: cli['put-1000-usd'] ?? environment.LOCAL_VIDEO_COST_PUT_1000_USD,
    get1000Usd: cli['get-1000-usd'] ?? environment.LOCAL_VIDEO_COST_GET_1000_USD,
  };
  if (Object.values(values).every((value) => value === undefined)) return null;
  if (Object.values(values).some((value) => value === undefined)) {
    throw probeError('COST_RATES_INCOMPLETE', 'Debe proporcionar todas las tarifas del escenario.');
  }
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, numericArg(value, null)]),
  );
}

function numericArg(value, fallback) {
  if (value === undefined && fallback !== null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw probeError('COST_INPUT_INVALID', 'Los valores de costo y uso deben ser no negativos.');
  }
  return parsed;
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: values.length,
    minimum: rounded(sorted[0]),
    median: rounded(sorted[Math.floor(sorted.length / 2)]),
    maximum: rounded(sorted.at(-1)),
  };
}

function throughput(bytes, milliseconds) {
  return rounded((bytes / (1024 ** 2)) / (milliseconds / 1000));
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function probeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
