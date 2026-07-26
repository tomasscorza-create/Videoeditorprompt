import pg from 'pg';
import { storageError } from './contracts.mjs';

const {
  Pool,
  types,
} = pg;

types.setTypeParser(20, (value) => Number(value));

export function createPostgresPool(options = {}) {
  const environment = options.environment || process.env;
  const pool = new Pool({
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
    password: options.password ?? environment.LOCAL_VIDEO_POSTGRES_PASSWORD
      ?? 'local-video-dev-only-change-me',
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
  });
  pool.on('error', () => {
    // Los errores de clientes ociosos se observan al adquirir la siguiente conexión.
  });
  return pool;
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
