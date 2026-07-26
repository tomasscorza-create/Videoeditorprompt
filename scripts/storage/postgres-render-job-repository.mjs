import {
  assertJobId,
  storageError,
} from './contracts.mjs';
import { clone } from './filesystem-utils.mjs';
import { validateRenderJob } from './file-render-job-repository.mjs';
import {
  postgresStorageError,
  withPostgresTransaction,
} from './postgres-client.mjs';

export function createPostgresRenderJobRepository(options) {
  const pool = options?.pool;
  if (!pool?.query || !pool?.connect) {
    throw storageError('POSTGRES_POOL_INVALID', 'El repositorio de jobs requiere un pool PostgreSQL.');
  }

  async function reserve(job) {
    validateRenderJob(job);
    try {
      await pool.query(`
        INSERT INTO local_video.render_jobs (
          job_id,
          project_id,
          state,
          stage,
          document,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
      `, [
        job.jobId,
        job.projectId,
        job.state,
        job.stage,
        JSON.stringify(job),
        job.createdAt,
        job.updatedAt,
      ]);
    } catch (error) {
      if (error?.code === '23505') {
        throw storageError('RENDER_JOB_CONFLICT', 'El jobId ya está reservado.');
      }
      throw postgresStorageError(
        error,
        'RENDER_JOB_STORAGE_UNAVAILABLE',
        'No se pudo reservar el trabajo.',
      );
    }
  }

  async function get(jobId) {
    assertJobId(jobId);
    try {
      const result = await pool.query(`
        SELECT document
        FROM local_video.render_jobs
        WHERE job_id = $1
      `, [jobId]);
      return result.rowCount === 0 ? null : readJob(result.rows[0].document);
    } catch (error) {
      throw postgresStorageError(
        error,
        'RENDER_JOB_STORAGE_UNAVAILABLE',
        'No se pudo leer el trabajo.',
      );
    }
  }

  async function list(filter = {}) {
    const states = Array.isArray(filter.states) ? filter.states : null;
    try {
      const result = states
        ? await pool.query(`
          SELECT document
          FROM local_video.render_jobs
          WHERE state = ANY($1::text[])
          ORDER BY created_at DESC, job_id
        `, [states])
        : await pool.query(`
          SELECT document
          FROM local_video.render_jobs
          ORDER BY created_at DESC, job_id
        `);
      return result.rows.map((row) => readJob(row.document));
    } catch (error) {
      throw postgresStorageError(
        error,
        'RENDER_JOB_STORAGE_UNAVAILABLE',
        'No se pudieron listar los trabajos.',
      );
    }
  }

  async function transition(jobId, expectedState, event) {
    assertJobId(jobId);
    try {
      return await withPostgresTransaction(pool, async (client) => {
        const currentResult = await client.query(`
          SELECT document
          FROM local_video.render_jobs
          WHERE job_id = $1
          FOR UPDATE
        `, [jobId]);
        if (currentResult.rowCount === 0) {
          throw storageError('RENDER_JOB_NOT_FOUND', 'No se encontró el trabajo.');
        }
        const current = readJob(currentResult.rows[0].document);
        if (current.state !== expectedState) {
          throw storageError(
            'RENDER_JOB_STATE_CONFLICT',
            'El trabajo cambió de estado antes de aplicar la transición.',
            `expected=${expectedState}; actual=${current.state}`,
          );
        }
        const next = { ...current, ...clone(event) };
        validateRenderJob(next);
        await client.query(`
          UPDATE local_video.render_jobs
          SET
            project_id = $2,
            state = $3,
            stage = $4,
            document = $5::jsonb,
            updated_at = $6::timestamptz
          WHERE job_id = $1
        `, [
          jobId,
          next.projectId,
          next.state,
          next.stage,
          JSON.stringify(next),
          next.updatedAt,
        ]);
        return clone(next);
      });
    } catch (error) {
      throw postgresStorageError(
        error,
        'RENDER_JOB_STORAGE_UNAVAILABLE',
        'No se pudo actualizar el trabajo.',
      );
    }
  }

  return { reserve, get, list, transition };
}

function readJob(document) {
  const job = clone(document);
  validateRenderJob(job);
  return job;
}
