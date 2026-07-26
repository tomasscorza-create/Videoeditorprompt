import { existsSync } from 'node:fs';
import path from 'node:path';
import { storageError } from './contracts.mjs';
import {
  inspectArtifactFile,
  listRegularArtifactFiles,
} from './content-addressed-blobs.mjs';
import { isWithin } from './filesystem-utils.mjs';

export function createRemoteResourceRepository({
  repository,
  blobStorage,
  storageRoot,
}) {
  if (
    !repository?.list
    || !repository?.get
    || !repository?.register
    || !blobStorage?.put
    || !blobStorage?.stat
    || typeof storageRoot !== 'string'
  ) {
    throw storageError(
      'REMOTE_RESOURCE_REPOSITORY_INVALID',
      'La biblioteca remota requiere repositorio, blobs y sandbox local.',
    );
  }
  const root = path.resolve(storageRoot);

  async function register(record) {
    const packageRoot = managedPackageRoot(root, record);
    if (!packageRoot) return repository.register(record);
    if (!existsSync(packageRoot) || !isWithin(root, packageRoot)) {
      throw storageError(
        'LIBRARY_ASSET_MISSING',
        `Falta el paquete local del recurso «${record.id}».`,
      );
    }
    const files = await listRegularArtifactFiles(packageRoot);
    const artifacts = [];
    const newlyUploaded = [];
    try {
      for (const file of files) {
        const relativePath = portable(path.relative(root, file));
        const artifact = await inspectArtifactFile(
          file,
          relativePath,
          resourceArtifactRole(relativePath),
        );
        const existed = await optionalStat(blobStorage, artifact.key);
        const stored = await blobStorage.put({
          key: artifact.key,
          sourceFile: artifact.sourceFile,
          expectedSha256: artifact.sha256,
          mimeType: artifact.mimeType,
        });
        if (stored.sha256 !== artifact.sha256 || stored.bytes !== artifact.bytes) {
          throw storageError(
            'RESOURCE_BLOB_VERIFY_FAILED',
            `El blob del recurso «${record.id}» no coincide.`,
          );
        }
        if (!existed) newlyUploaded.push(artifact.key);
        const { sourceFile, ...durable } = artifact;
        artifacts.push(durable);
      }
      return await repository.register({
        ...structuredClone(record),
        blobStorage: {
          version: 1,
          backend: 's3',
          artifacts,
        },
      });
    } catch (error) {
      if (newlyUploaded.length > 0) error.orphanedKeys = newlyUploaded;
      throw error;
    }
  }

  return {
    list: () => repository.list(),
    get: (id) => repository.get(id),
    register,
  };
}

export function remoteResourceMaterializationInputs(records) {
  const inputs = [];
  const destinations = new Set();
  for (const record of records) {
    const artifacts = record?.blobStorage?.artifacts;
    if (!Array.isArray(artifacts)) continue;
    for (const artifact of artifacts) {
      if (destinations.has(artifact.relativePath)) {
        throw storageError(
          'REMOTE_RESOURCE_DUPLICATE_PATH',
          `Dos recursos usan la ruta «${artifact.relativePath}».`,
        );
      }
      destinations.add(artifact.relativePath);
      inputs.push({
        key: artifact.key,
        relativePath: artifact.relativePath,
        sha256: artifact.sha256,
      });
    }
  }
  return inputs.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function managedPackageRoot(storageRoot, record) {
  if (record?.entry?.type === 'background') {
    return path.join(storageRoot, 'assets', 'backgrounds', record.id);
  }
  if (record?.entry?.type === 'character') {
    return path.join(storageRoot, 'assets', 'characters', record.id);
  }
  return null;
}

async function optionalStat(blobStorage, key) {
  try {
    return await blobStorage.stat(key);
  } catch (error) {
    if (error?.code === 'BLOB_NOT_FOUND') return null;
    throw error;
  }
}

function resourceArtifactRole(relativePath) {
  if (relativePath.endsWith('.manifest.json')) return 'resource-manifest';
  if (relativePath.endsWith('.json')) return 'resource-metadata';
  return 'resource-binary';
}

function portable(value) {
  return value.split(path.sep).join('/');
}
