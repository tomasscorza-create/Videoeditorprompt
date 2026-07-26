import {
  assertProjectId,
  storageError,
} from './contracts.mjs';
import {
  clone,
  sha256Json,
} from './filesystem-utils.mjs';
import {
  assertExpectedRevision,
  validateDraftEnvelope,
} from '../local-app/project-repository.mjs';
import {
  postgresStorageError,
  withPostgresTransaction,
} from './postgres-client.mjs';

export function createPostgresProjectRepository(options) {
  const pool = options?.pool;
  if (!pool?.query || !pool?.connect) {
    throw storageError('POSTGRES_POOL_INVALID', 'El repositorio de proyectos requiere un pool PostgreSQL.');
  }

  async function list() {
    try {
      const result = await pool.query(`
        SELECT document, revision, updated_at
        FROM local_video.projects
        ORDER BY updated_at DESC, id
      `);
      return result.rows.map((row) => storedProject(row).summary);
    } catch (error) {
      throw postgresStorageError(
        error,
        'PROJECT_STORAGE_UNAVAILABLE',
        'No se pudieron listar los proyectos.',
      );
    }
  }

  async function get(id) {
    assertProjectId(id);
    try {
      const result = await pool.query(`
        SELECT document, revision, updated_at
        FROM local_video.projects
        WHERE id = $1
      `, [id]);
      if (result.rowCount === 0) {
        throw storageError('PROJECT_NOT_FOUND', 'No se encontró el proyecto.');
      }
      return storedProject(result.rows[0]);
    } catch (error) {
      throw postgresStorageError(
        error,
        'PROJECT_STORAGE_UNAVAILABLE',
        'No se pudo leer el proyecto.',
      );
    }
  }

  async function save(project, expectedRevision) {
    validateDraftEnvelope(project);
    const revision = sha256Json(project);
    try {
      return await withPostgresTransaction(pool, async (client) => {
        await lockProject(client, project.id);
        const current = await client.query(`
          SELECT revision
          FROM local_video.projects
          WHERE id = $1
          FOR UPDATE
        `, [project.id]);
        const previousRevision = current.rows[0]?.revision;
        assertExpectedRevision(previousRevision, expectedRevision);
        const created = current.rowCount === 0;
        const result = await client.query(`
          INSERT INTO local_video.projects (id, revision, document)
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            revision = EXCLUDED.revision,
            document = EXCLUDED.document,
            updated_at = now()
          RETURNING document, revision, updated_at
        `, [project.id, revision, JSON.stringify(project)]);
        const stored = storedProject(result.rows[0]);
        return {
          created,
          project: stored.project,
          revision: stored.revision,
          summary: stored.summary,
        };
      });
    } catch (error) {
      throw postgresStorageError(
        error,
        'PROJECT_STORAGE_UNAVAILABLE',
        'No se pudo guardar el proyecto.',
      );
    }
  }

  async function insert(project) {
    validateDraftEnvelope(project);
    const revision = sha256Json(project);
    try {
      const result = await pool.query(`
        INSERT INTO local_video.projects (id, revision, document)
        VALUES ($1, $2, $3::jsonb)
        RETURNING document, revision, updated_at
      `, [project.id, revision, JSON.stringify(project)]);
      const stored = storedProject(result.rows[0]);
      return {
        created: true,
        project: stored.project,
        revision: stored.revision,
        summary: stored.summary,
      };
    } catch (error) {
      if (error?.code === '23505') {
        throw storageError(
          'PROJECT_IMPORT_CONFLICT',
          'El proyecto ya existe y no será sobrescrito durante la importación.',
        );
      }
      throw postgresStorageError(
        error,
        'PROJECT_STORAGE_UNAVAILABLE',
        'No se pudo importar el proyecto.',
      );
    }
  }

  async function remove(id, expectedRevision) {
    assertProjectId(id);
    try {
      return await withPostgresTransaction(pool, async (client) => {
        await lockProject(client, id);
        const current = await client.query(`
          SELECT revision
          FROM local_video.projects
          WHERE id = $1
          FOR UPDATE
        `, [id]);
        if (current.rowCount === 0) return false;
        assertExpectedRevision(current.rows[0].revision, expectedRevision);
        await client.query('DELETE FROM local_video.projects WHERE id = $1', [id]);
        return true;
      });
    } catch (error) {
      throw postgresStorageError(
        error,
        'PROJECT_STORAGE_UNAVAILABLE',
        'No se pudo eliminar el proyecto.',
      );
    }
  }

  return { list, get, save, insert, remove };
}

async function lockProject(client, id) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`project:${id}`],
  );
}

function storedProject(row) {
  const project = clone(row.document);
  validateDraftEnvelope(project);
  const revision = sha256Json(project);
  if (revision !== row.revision) {
    throw storageError('PROJECT_REVISION_INVALID', 'La revisión durable del proyecto no coincide.');
  }
  const updatedAt = new Date(row.updated_at).toISOString();
  return {
    project,
    revision,
    summary: {
      id: project.id,
      title: project.title,
      scenes: project.scenes.length,
      revision,
      updatedAt,
    },
  };
}
