import {
  clone,
  sha256Json,
} from './filesystem-utils.mjs';
import {
  PROJECT_ID_PATTERN,
  SHA256_PATTERN,
  storageError,
} from './contracts.mjs';
import {
  postgresStorageError,
  withPostgresTransaction,
} from './postgres-client.mjs';

export async function createPostgresResourceRepository(options) {
  const pool = options?.pool;
  if (!pool?.query || !pool?.connect) {
    throw storageError('POSTGRES_POOL_INVALID', 'El repositorio de recursos requiere un pool PostgreSQL.');
  }
  await normalizeStoredRegistry(pool, options);

  async function list() {
    try {
      const result = await pool.query(`
        SELECT document
        FROM local_video.resources
        ORDER BY registered_at, id
      `);
      return validatedRecords(result.rows.map((row) => clone(row.document)), options);
    } catch (error) {
      throw postgresStorageError(
        error,
        'LIBRARY_STORAGE_UNAVAILABLE',
        'No se pudieron listar los recursos.',
      );
    }
  }

  async function get(id) {
    try {
      const result = await pool.query(`
        SELECT document
        FROM local_video.resources
        WHERE id = $1
      `, [id]);
      if (result.rowCount === 0) return null;
      return validatedRecords([clone(result.rows[0].document)], options)[0];
    } catch (error) {
      throw postgresStorageError(
        error,
        'LIBRARY_STORAGE_UNAVAILABLE',
        'No se pudo leer el recurso.',
      );
    }
  }

  async function register(input) {
    const record = clone(input);
    validateRecord(record, options);
    try {
      return await withPostgresTransaction(pool, async (client) => {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`resource:id:${record.id}`],
        );
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`resource:hash:${record.contentHash}`],
        );
        const existing = await client.query(`
          SELECT document
          FROM local_video.resources
          WHERE id = $1 OR content_hash = $2
          FOR UPDATE
        `, [record.id, record.contentHash]);
        const idConflict = existing.rows
          .map((row) => row.document)
          .find((candidate) => candidate.id === record.id);
        if (idConflict) {
          if (idConflict.contentHash === record.contentHash) {
            return { created: false, record: clone(idConflict) };
          }
          throw storageError(
            'LIBRARY_RESOURCE_ID_CONFLICT',
            `Ya existe un recurso diferente con el ID «${record.id}».`,
          );
        }
        const duplicate = existing.rows
          .map((row) => row.document)
          .find((candidate) => candidate.contentHash === record.contentHash);
        if (duplicate) return { created: false, record: clone(duplicate) };
        await client.query(`
          INSERT INTO local_video.resources (
            id,
            content_hash,
            registered_at,
            document
          )
          VALUES ($1, $2, $3::timestamptz, $4::jsonb)
        `, [
          record.id,
          record.contentHash,
          record.registeredAt,
          JSON.stringify(record),
        ]);
        return { created: true, record: clone(record) };
      });
    } catch (error) {
      throw postgresStorageError(
        error,
        'LIBRARY_STORAGE_UNAVAILABLE',
        'No se pudo registrar el recurso.',
      );
    }
  }

  return { list, get, register };
}

async function normalizeStoredRegistry(pool, options) {
  try {
    await withPostgresTransaction(pool, async (client) => {
      const result = await client.query(`
        SELECT document
        FROM local_video.resources
        ORDER BY registered_at, id
        FOR UPDATE
      `);
      const current = { version: 1, entries: result.rows.map((row) => clone(row.document)) };
      const normalized = options.normalizeRegistry
        ? options.normalizeRegistry(clone(current))
        : current;
      options.validateRegistry?.(normalized);
      if (sha256Json(normalized) === sha256Json(current)) return;
      if (
        normalized.entries.length !== current.entries.length
        || normalized.entries.some((record, index) => (
          record.id !== current.entries[index].id
          || record.contentHash !== current.entries[index].contentHash
        ))
      ) {
        throw storageError(
          'LIBRARY_INDEX_INVALID',
          'La normalización no puede cambiar identidades durables.',
        );
      }
      for (const record of normalized.entries) {
        await client.query(`
          UPDATE local_video.resources
          SET document = $2::jsonb
          WHERE id = $1
        `, [record.id, JSON.stringify(record)]);
      }
    });
  } catch (error) {
    throw postgresStorageError(
      error,
      'LIBRARY_STORAGE_UNAVAILABLE',
      'No se pudo preparar el registro de recursos.',
    );
  }
}

function validatedRecords(records, options) {
  records.forEach(assertResourceRecord);
  options.validateRegistry?.({ version: 1, entries: records });
  return records;
}

function validateRecord(record, options) {
  assertResourceRecord(record);
  options.validateRegistry?.({ version: 1, entries: [record] });
}

function assertResourceRecord(record) {
  if (
    !record
    || typeof record !== 'object'
    || Array.isArray(record)
    || typeof record.id !== 'string'
    || !PROJECT_ID_PATTERN.test(record.id)
    || typeof record.contentHash !== 'string'
    || !SHA256_PATTERN.test(record.contentHash)
    || !isIsoDate(record.registeredAt)
    || !record.entry
    || typeof record.entry !== 'object'
    || Array.isArray(record.entry)
    || record.entry.id !== record.id
  ) {
    throw storageError('LIBRARY_RESOURCE_INVALID', 'El registro del recurso no es válido.');
  }
}

function isIsoDate(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
