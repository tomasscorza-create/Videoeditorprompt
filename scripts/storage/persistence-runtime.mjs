import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { validateResourceLibraryRegistry } from '../local-app/resource-library.mjs';
import { createBlobMaterializer } from './artifact-storage.mjs';
import { storageError } from './contracts.mjs';
import { createPostgresPool } from './postgres-client.mjs';
import { createPostgresProjectRepository } from './postgres-project-repository.mjs';
import { createPostgresRenderJobRepository } from './postgres-render-job-repository.mjs';
import { createPostgresResourceRepository } from './postgres-resource-repository.mjs';
import {
  createRemoteResourceRepository,
  remoteResourceMaterializationInputs,
} from './remote-resource-repository.mjs';
import { createS3BlobStorage } from './s3-blob-storage.mjs';

const BACKENDS = new Set(['filesystem', 'postgres-s3']);

export async function createPersistenceRuntime(options = {}) {
  const backend = resolvePersistenceBackend(
    options.persistence ?? options.environment?.LOCAL_VIDEO_PERSISTENCE,
  );
  if (backend === 'filesystem') {
    return {
      backend,
      diagnostic: {
        version: 1,
        backend,
        ready: true,
        metadata: 'filesystem',
        blobs: 'filesystem',
      },
      close: async () => {},
    };
  }
  return createPostgresS3Runtime(options);
}

export function resolvePersistenceBackend(value) {
  const backend = String(value || 'filesystem');
  if (!BACKENDS.has(backend)) {
    throw persistenceError(
      'PERSISTENCE_BACKEND_UNSUPPORTED',
      `Backend de persistencia no soportado: ${backend}.`,
    );
  }
  return backend;
}

async function createPostgresS3Runtime(options) {
  const root = path.resolve(options.root);
  const pool = options.pool || createPostgresPool({
    environment: options.environment,
  });
  const ownsPool = !options.pool;
  const materializationRoot = path.resolve(
    options.materializationRoot
      || path.join(root, '.local-video', 'postgres-s3-materialized'),
  );
  const blobStorage = options.blobStorage || createS3BlobStorage({
    environment: options.environment,
    materializationRoot,
  });
  const ownsBlobStorage = !options.blobStorage;
  let libraryStorageRoot = null;
  try {
    const migrations = await inspectPostgres(pool);
    const s3 = await blobStorage.health();
    const projects = createPostgresProjectRepository({ pool });
    const baseResources = await createPostgresResourceRepository({
      pool,
      validateRegistry: validateResourceLibraryRegistry,
    });
    const renderJobs = createPostgresRenderJobRepository({ pool });
    const records = await baseResources.list();
    const sandboxId = `library-${randomBytes(10).toString('hex')}`;
    const materialized = await createBlobMaterializer({ blobStorage }).materialize(
      sandboxId,
      remoteResourceMaterializationInputs(records),
    );
    libraryStorageRoot = materialized.root;
    const resources = createRemoteResourceRepository({
      repository: baseResources,
      blobStorage,
      storageRoot: libraryStorageRoot,
    });
    let closed = false;
    return {
      backend: 'postgres-s3',
      projects,
      resources,
      renderJobs,
      blobStorage,
      libraryStorageRoot,
      diagnostic: {
        version: 1,
        backend: 'postgres-s3',
        ready: true,
        metadata: 'postgresql',
        blobs: 's3',
        migrations,
        bucket: s3.bucket,
        hydratedResources: records.length,
        hydratedFiles: materialized.files.length,
      },
      async close() {
        if (closed) return;
        closed = true;
        await rm(libraryStorageRoot, { recursive: true, force: true }).catch(() => {});
        if (ownsBlobStorage) await blobStorage.close?.();
        if (ownsPool) await pool.end();
      },
    };
  } catch (error) {
    if (libraryStorageRoot) {
      await rm(libraryStorageRoot, { recursive: true, force: true }).catch(() => {});
    }
    if (ownsBlobStorage) await blobStorage.close?.();
    if (ownsPool) await pool.end().catch(() => {});
    if (error?.code === 'PERSISTENCE_STARTUP_FAILED') throw error;
    throw persistenceError(
      'PERSISTENCE_STARTUP_FAILED',
      'No se pudo iniciar el backend postgres-s3.',
      safeCause(error),
    );
  }
}

async function inspectPostgres(pool) {
  try {
    const result = await pool.query(`
      SELECT count(*)::int AS count
      FROM public.local_video_schema_migrations
    `);
    const count = Number(result.rows[0]?.count);
    if (!Number.isInteger(count) || count < 3) {
      throw persistenceError(
        'PERSISTENCE_MIGRATIONS_MISSING',
        'Faltan migraciones PostgreSQL requeridas.',
      );
    }
    return count;
  } catch (error) {
    if (error?.code === 'PERSISTENCE_MIGRATIONS_MISSING') throw error;
    throw persistenceError(
      'PERSISTENCE_POSTGRES_UNAVAILABLE',
      'PostgreSQL no está disponible o no está migrado.',
      safeCause(error),
    );
  }
}

function safeCause(error) {
  const code = String(error?.code || '');
  return /^[A-Z0-9_]{2,80}$/u.test(code) ? `cause=${code}` : undefined;
}

function persistenceError(code, message, technicalDetail) {
  const error = storageError(code, message, technicalDetail);
  error.stage = 'persistence_startup';
  return error;
}
