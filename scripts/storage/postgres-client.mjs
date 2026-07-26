import pg from 'pg';
import { storageError } from './contracts.mjs';
import {
  readCertificateAuthority,
  resolveConfiguredSecret,
} from './configuration-secrets.mjs';

const {
  Pool,
  types,
} = pg;

types.setTypeParser(20, (value) => Number(value));

export function createPostgresPool(options = {}) {
  const config = buildPostgresConfig(options);
  const pool = new Pool(config);
  pool.on('error', () => {
    // Los errores de clientes ociosos se observan al adquirir la siguiente conexión.
  });
  return pool;
}

export function buildPostgresConfig(options = {}) {
  const environment = options.environment || process.env;
  const deployment = deploymentMode(options.deployment || environment.LOCAL_VIDEO_DEPLOYMENT);
  const connectionString = options.connectionString || environment.LOCAL_VIDEO_DATABASE_URL;
  if (connectionString) validateConnectionString(connectionString);
  const sslMode = String(
    options.sslMode
      || environment.LOCAL_VIDEO_POSTGRES_SSL_MODE
      || (deployment === 'remote' ? 'verify-full' : 'disable'),
  );
  if (!['disable', 'require', 'verify-full'].includes(sslMode)) {
    throw storageError('POSTGRES_CONFIG_INVALID', 'El modo TLS de PostgreSQL no es válido.');
  }
  if (deployment === 'remote' && sslMode !== 'verify-full') {
    throw storageError(
      'POSTGRES_TLS_REQUIRED',
      'El despliegue remoto exige PostgreSQL TLS con verificación completa.',
    );
  }
  const password = options.password ?? resolveConfiguredSecret({
    environment,
    valueName: 'LOCAL_VIDEO_POSTGRES_PASSWORD',
    fileName: 'LOCAL_VIDEO_POSTGRES_PASSWORD_FILE',
    fallback: deployment === 'local' ? 'local-video-dev-only-change-me' : undefined,
    required: !connectionString,
    label: 'la contraseña PostgreSQL',
  });
  const ca = readCertificateAuthority(
    options.caFile || environment.LOCAL_VIDEO_POSTGRES_SSL_CA_FILE,
  );
  const ssl = sslMode === 'disable'
    ? false
    : {
      rejectUnauthorized: sslMode === 'verify-full',
      ...(ca ? { ca } : {}),
    };
  return {
    ...(connectionString ? { connectionString } : {
      host: options.host || environment.LOCAL_VIDEO_POSTGRES_HOST || '127.0.0.1',
      port: boundedInteger(
        options.port ?? environment.LOCAL_VIDEO_POSTGRES_PORT,
        1,
        65535,
        54329,
        'POSTGRES_CONFIG_INVALID',
      ),
      database: options.database || environment.LOCAL_VIDEO_POSTGRES_DB || 'local_video',
      user: options.user || environment.LOCAL_VIDEO_POSTGRES_USER || 'local_video',
      password,
    }),
    ssl,
    max: boundedInteger(
      options.max ?? environment.LOCAL_VIDEO_POSTGRES_POOL_MAX,
      1,
      20,
      5,
      'POSTGRES_CONFIG_INVALID',
    ),
    connectionTimeoutMillis: boundedInteger(
      options.connectionTimeoutMillis,
      100,
      30_000,
      5_000,
      'POSTGRES_CONFIG_INVALID',
    ),
    idleTimeoutMillis: boundedInteger(
      options.idleTimeoutMillis,
      1_000,
      120_000,
      30_000,
      'POSTGRES_CONFIG_INVALID',
    ),
    statement_timeout: boundedInteger(
      options.statementTimeoutMillis,
      100,
      60_000,
      10_000,
      'POSTGRES_CONFIG_INVALID',
    ),
    query_timeout: boundedInteger(
      options.queryTimeoutMillis,
      100,
      60_000,
      12_000,
      'POSTGRES_CONFIG_INVALID',
    ),
    application_name: 'disenador-videos-local',
  };
}

export async function withPostgresTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Se conserva el error original y no se exponen datos de conexión.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function postgresStorageError(error, fallbackCode, fallbackMessage) {
  if (
    typeof error?.code === 'string'
    && /^(?:PROJECT|LIBRARY|RENDER_JOB|BLOB|POSTGRES)_[A-Z0-9_]+$/u.test(error.code)
  ) return error;
  const wrapped = storageError(fallbackCode, fallbackMessage);
  if (typeof error?.code === 'string' && /^[0-9A-Z]{5}$/u.test(error.code)) {
    wrapped.technicalDetail = `postgresCode=${error.code}`;
  }
  return wrapped;
}

function boundedInteger(value, minimum, maximum, fallback, code) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw storageError(code, 'La configuración de PostgreSQL no es válida.');
  }
  return parsed;
}

function deploymentMode(value) {
  const mode = String(value || 'local');
  if (!['local', 'remote'].includes(mode)) {
    throw storageError('DEPLOYMENT_MODE_INVALID', 'El modo de despliegue no es válido.');
  }
  return mode;
}

function validateConnectionString(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw storageError('POSTGRES_CONFIG_INVALID', 'LOCAL_VIDEO_DATABASE_URL no es válida.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.hash
    || parsed.searchParams.has('sslmode')
  ) {
    throw storageError(
      'POSTGRES_CONFIG_INVALID',
      'La URL PostgreSQL es inválida o intenta sobreescribir la política TLS.',
    );
  }
}
