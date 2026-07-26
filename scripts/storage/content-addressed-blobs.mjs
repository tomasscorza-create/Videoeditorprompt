import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { assertBlobKey, storageError } from './contracts.mjs';

export function contentAddressedBlobKey(sha256) {
  return `sha256/${sha256.slice(0, 2)}/${sha256}`;
}

export function artifactMimeType(file) {
  const extension = path.posix.extname(String(file).replaceAll('\\', '/')).toLowerCase();
  return {
    '.aac': 'audio/aac',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.webp': 'image/webp',
  }[extension] || 'application/octet-stream';
}

export async function inspectArtifactFile(file, relativePath, role) {
  const portablePath = assertBlobKey(relativePath);
  const stats = await lstat(file);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size < 1) {
    throw storageError('RESOURCE_BLOB_INVALID', 'El artefacto durable no es un archivo regular.');
  }
  const sha256 = await hashFile(file);
  return {
    role,
    relativePath: portablePath,
    key: contentAddressedBlobKey(sha256),
    bytes: stats.size,
    sha256,
    mimeType: artifactMimeType(portablePath),
    sourceFile: file,
  };
}

export async function listRegularArtifactFiles(root) {
  const files = [];
  await visit(root);
  return files.sort();

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw storageError('RESOURCE_BLOB_INVALID', 'Los paquetes remotos no admiten symlinks.');
      }
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(target);
      else throw storageError('RESOURCE_BLOB_INVALID', 'El paquete contiene un tipo no admitido.');
    }
  }
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
