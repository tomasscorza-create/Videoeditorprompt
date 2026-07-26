import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  assertBlobKey,
  assertJobId,
  storageError,
} from './contracts.mjs';
import {
  assertRegularFile,
  ensureSafeParent,
  safeTemporaryPath,
} from './blob-stream-utils.mjs';
import { isWithin } from './filesystem-utils.mjs';

const MAX_MATERIALIZED_INPUTS = 10_000;

export async function publishRenderArtifacts({
  blobStorage,
  jobId,
  manifestFile,
  videoFile,
}) {
  assertJobId(jobId);
  await Promise.all([
    assertRegularFile(manifestFile),
    assertRegularFile(videoFile),
  ]);
  const artifacts = [
    {
      role: 'project-manifest',
      key: `jobs/${jobId}/artifacts/project-manifest.json`,
      sourceFile: manifestFile,
      mimeType: 'application/json',
    },
    {
      role: 'video',
      key: `jobs/${jobId}/artifacts/render-1.mp4`,
      sourceFile: videoFile,
      mimeType: 'video/mp4',
    },
  ];
  const uploaded = [];
  let current = null;
  try {
    for (current of artifacts) {
      const stored = await blobStorage.put(current);
      uploaded.push({ role: current.role, ...stored });
    }
    return Object.fromEntries(uploaded.map((artifact) => [
      artifact.role === 'video' ? 'video' : 'manifest',
      artifact,
    ]));
  } catch (error) {
    const wrapped = storageError(
      'ARTIFACT_PUBLICATION_FAILED',
      'No se pudieron publicar todos los artefactos verificados.',
      `failed=${current?.key || 'unknown'}; orphaned=${uploaded.map((artifact) => artifact.key).join(',') || 'none'}`,
    );
    wrapped.orphanedKeys = uploaded.map((artifact) => artifact.key);
    wrapped.causeCode = error?.code || 'UNEXPECTED_ERROR';
    throw wrapped;
  }
}

export function createBlobMaterializer({
  blobStorage,
  materializationRoot = blobStorage?.materializationRoot,
}) {
  if (
    !blobStorage?.getToFile
    || !blobStorage?.stat
    || typeof materializationRoot !== 'string'
  ) {
    throw storageError(
      'BLOB_MATERIALIZATION_INVALID',
      'El materializador requiere un blob storage y una raíz válida.',
    );
  }
  const root = path.resolve(materializationRoot);
  if (
    blobStorage?.materializationRoot
    && path.resolve(blobStorage.materializationRoot) !== root
  ) {
    throw storageError(
      'BLOB_MATERIALIZATION_INVALID',
      'El materializador y el storage deben compartir la misma raíz.',
    );
  }

  async function materialize(sandboxId, inputs) {
    assertJobId(sandboxId);
    if (!Array.isArray(inputs) || inputs.length > MAX_MATERIALIZED_INPUTS) {
      throw storageError('BLOB_MATERIALIZATION_INVALID', 'La lista de blobs no es válida.');
    }
    const targetRoot = path.join(root, sandboxId);
    if (!isWithin(root, targetRoot) || existsSync(targetRoot)) {
      throw storageError(
        'BLOB_MATERIALIZATION_CONFLICT',
        'El sandbox de materialización ya existe o no es seguro.',
      );
    }
    const temporaryRoot = safeTemporaryPath(targetRoot);
    await ensureSafeParent(root, temporaryRoot);
    const files = [];
    const destinations = new Set();
    try {
      for (const input of inputs) {
        const key = assertBlobKey(input?.key);
        const relativePath = assertBlobKey(input?.relativePath);
        if (destinations.has(relativePath)) {
          throw storageError(
            'BLOB_MATERIALIZATION_INVALID',
            'La lista contiene destinos duplicados.',
          );
        }
        destinations.add(relativePath);
        const destination = path.join(temporaryRoot, ...relativePath.split('/'));
        await blobStorage.getToFile(key, destination, input.sha256);
        const metadata = await blobStorage.stat(key);
        files.push({
          key,
          relativePath,
          sha256: metadata.sha256,
          bytes: metadata.bytes,
        });
      }
      await rename(temporaryRoot, targetRoot);
      return { sandboxId, root: targetRoot, files };
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }

  return { materializationRoot: root, materialize };
}
