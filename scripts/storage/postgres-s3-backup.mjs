import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot } from '../stage1/common.mjs';
import { validateDraftEnvelope } from '../local-app/project-repository.mjs';
import { validateResourceLibraryRegistry } from '../local-app/resource-library.mjs';
import { validateRenderJob } from './file-render-job-repository.mjs';
import {
  canonicalize,
  isWithin,
  sha256Json,
} from './filesystem-utils.mjs';
import { assertBlobKey, storageError } from './contracts.mjs';

const MANIFEST_NAME = 'manifest.json';
const METADATA_NAME = 'postgres-metadata.json';
const schema = JSON.parse(await readFile(
  path.join(projectRoot, 'schema', 'storage-backup.schema.json'),
  'utf8',
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export async function createPostgresS3Backup(options) {
  const output = safeOutput(options.output);
  if (existsSync(output)) throw backupError('BACKUP_OUTPUT_EXISTS', 'El backup ya existe.');
  const metadata = await collectMetadata(options.repositories);
  const objects = [
    ...await options.blobStorage.list('jobs'),
    ...await options.blobStorage.list('sha256'),
  ].sort((left, right) => left.key.localeCompare(right.key));
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(output)}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`);
  await mkdir(staging);
  try {
    const metadataFile = path.join(staging, METADATA_NAME);
    await writeFile(metadataFile, `${JSON.stringify(canonicalize(metadata), null, 2)}\n`, { flag: 'wx' });
    const metadataInfo = await inspectFile(metadataFile);
    const objectEntries = [];
    for (const object of objects) {
      const relativePath = `objects/${object.key}`;
      const destination = resolveBackupPath(staging, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      const opened = await options.blobStorage.openRead(object.key);
      await pipeline(opened.stream, createWriteStream(destination, { flags: 'wx' }));
      const copied = await inspectFile(destination);
      if (copied.bytes !== object.bytes || copied.sha256 !== object.sha256) {
        throw backupError('BACKUP_OBJECT_MISMATCH', `No se pudo copiar ${object.key}.`);
      }
      objectEntries.push({
        key: object.key,
        path: relativePath,
        bytes: copied.bytes,
        sha256: copied.sha256,
        mimeType: object.mimeType,
      });
    }
    const body = {
      version: 1,
      format: 'local-video-postgres-s3-backup',
      createdAt: (options.now?.() || new Date()).toISOString(),
      summary: {
        projects: metadata.projects.length,
        resources: metadata.resources.length,
        jobs: metadata.jobs.length,
        objects: objectEntries.length,
        objectBytes: objectEntries.reduce((total, item) => total + item.bytes, 0),
      },
      metadata: {
        path: METADATA_NAME,
        bytes: metadataInfo.bytes,
        sha256: metadataInfo.sha256,
      },
      objects: objectEntries,
    };
    const manifest = canonicalize({ ...body, fingerprint: sha256Json(body) });
    assertManifest(manifest);
    await writeFile(
      path.join(staging, MANIFEST_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { flag: 'wx' },
    );
    await verifyPostgresS3Backup({ backup: staging });
    await publishBackup(staging, output);
    return { output, fingerprint: manifest.fingerprint, summary: manifest.summary };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyPostgresS3Backup(options) {
  const backup = path.resolve(options.backup);
  const rootStats = await lstat(backup).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    throw backupError('BACKUP_NOT_FOUND', 'El backup no es un directorio real.');
  }
  const manifest = JSON.parse(await readFile(path.join(backup, MANIFEST_NAME), 'utf8'));
  assertManifest(manifest);
  const expected = [
    MANIFEST_NAME,
    manifest.metadata.path,
    ...manifest.objects.map((object) => object.path),
  ].sort();
  const actual = await listFiles(backup);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw backupError('BACKUP_FILE_SET_MISMATCH', 'Los archivos del backup no coinciden.');
  }
  await assertFileEntry(backup, manifest.metadata);
  for (const object of manifest.objects) await assertFileEntry(backup, object);
  const metadata = JSON.parse(await readFile(
    resolveBackupPath(backup, manifest.metadata.path),
    'utf8',
  ));
  validateMetadata(metadata);
  if (
    manifest.summary.projects !== metadata.projects.length
    || manifest.summary.resources !== metadata.resources.length
    || manifest.summary.jobs !== metadata.jobs.length
    || manifest.summary.objects !== manifest.objects.length
    || manifest.summary.objectBytes !== manifest.objects.reduce((total, item) => total + item.bytes, 0)
  ) {
    throw backupError('BACKUP_SUMMARY_MISMATCH', 'El resumen del backup no coincide.');
  }
  return { valid: true, manifest, metadata };
}

export async function restorePostgresS3Backup(options) {
  const { manifest, metadata } = await verifyPostgresS3Backup(options);
  const preflight = [];
  for (const project of metadata.projects) {
    const current = await optionalProject(options.repositories.projects, project.id);
    preflight.push(compareItem(`projects/${project.id}`, current?.project, project));
  }
  const resources = await options.repositories.resources.list();
  for (const resource of metadata.resources) {
    const current = await options.repositories.resources.get(resource.id);
    const hashConflict = resources.find((item) => (
      item.contentHash === resource.contentHash && item.id !== resource.id
    ));
    preflight.push(hashConflict
      ? { target: `resources/${resource.id}`, status: 'failed' }
      : compareItem(`resources/${resource.id}`, current, resource));
  }
  for (const job of metadata.jobs) {
    preflight.push(compareItem(
      `jobs/${job.jobId}`,
      await options.repositories.jobs.get(job.jobId),
      job,
    ));
  }
  for (const object of manifest.objects) {
    const current = await optionalBlob(options.blobStorage, object.key);
    preflight.push(!current
      ? { target: `blobs/${object.key}`, status: 'planned' }
      : current.sha256 === object.sha256 && current.bytes === object.bytes
        ? { target: `blobs/${object.key}`, status: 'skipped' }
        : { target: `blobs/${object.key}`, status: 'failed' });
  }
  if (preflight.some((item) => item.status === 'failed')) {
    throw backupError('RESTORE_DESTINATION_CONFLICT', 'El destino contiene datos incompatibles.');
  }
  if (!options.apply) {
    return restoreReport(manifest, preflight, 'planned');
  }
  const results = [];
  for (const object of manifest.objects) {
    const inspected = preflight.find((item) => item.target === `blobs/${object.key}`);
    if (inspected.status === 'skipped') {
      results.push(inspected);
      continue;
    }
    const stored = await options.blobStorage.put({
      key: object.key,
      sourceFile: resolveBackupPath(path.resolve(options.backup), object.path),
      expectedSha256: object.sha256,
      mimeType: object.mimeType,
    });
    if (stored.sha256 !== object.sha256 || stored.bytes !== object.bytes) {
      throw backupError('RESTORE_OBJECT_MISMATCH', `No se restauró ${object.key}.`);
    }
    results.push({ target: `blobs/${object.key}`, status: 'restored' });
  }
  for (const project of metadata.projects) {
    await restoreMetadata(
      preflight,
      results,
      `projects/${project.id}`,
      () => options.repositories.projects.insert(project),
    );
  }
  for (const resource of metadata.resources) {
    await restoreMetadata(
      preflight,
      results,
      `resources/${resource.id}`,
      () => options.repositories.resources.register(resource),
    );
  }
  for (const job of metadata.jobs) {
    await restoreMetadata(
      preflight,
      results,
      `jobs/${job.jobId}`,
      () => options.repositories.jobs.reserve(job),
    );
  }
  return restoreReport(manifest, results, 'completed');
}

async function restoreMetadata(preflight, results, target, operation) {
  const inspected = preflight.find((item) => item.target === target);
  if (inspected.status === 'skipped') {
    results.push(inspected);
    return;
  }
  await operation();
  results.push({ target, status: 'restored' });
}

async function collectMetadata(repositories) {
  const projects = [];
  for (const summary of await repositories.projects.list()) {
    projects.push((await repositories.projects.get(summary.id)).project);
  }
  projects.sort((left, right) => left.id.localeCompare(right.id));
  const resources = await repositories.resources.list();
  resources.sort((left, right) => left.id.localeCompare(right.id));
  const jobs = await repositories.jobs.list();
  jobs.sort((left, right) => left.jobId.localeCompare(right.jobId));
  const metadata = canonicalize({ version: 1, projects, resources, jobs });
  validateMetadata(metadata);
  return metadata;
}

function validateMetadata(metadata) {
  if (
    metadata?.version !== 1
    || !Array.isArray(metadata.projects)
    || !Array.isArray(metadata.resources)
    || !Array.isArray(metadata.jobs)
  ) throw backupError('BACKUP_METADATA_INVALID', 'La metadata del backup no es válida.');
  metadata.projects.forEach(validateDraftEnvelope);
  validateResourceLibraryRegistry({ version: 1, entries: metadata.resources });
  metadata.jobs.forEach(validateRenderJob);
}

function assertManifest(manifest) {
  if (!validateSchema(manifest)) {
    const detail = (validateSchema.errors || []).slice(0, 10)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw backupError('BACKUP_MANIFEST_INVALID', 'El manifiesto del backup no es válido.', detail);
  }
  const { fingerprint, ...body } = manifest;
  if (sha256Json(body) !== fingerprint) {
    throw backupError('BACKUP_FINGERPRINT_MISMATCH', 'El fingerprint del backup no coincide.');
  }
  const keys = manifest.objects.map((object) => object.key);
  if (
    new Set(keys).size !== keys.length
    || JSON.stringify(keys) !== JSON.stringify([...keys].sort())
  ) throw backupError('BACKUP_OBJECT_ORDER_INVALID', 'Los objetos no tienen orden estable.');
  for (const object of manifest.objects) {
    assertBlobKey(object.key);
    if (object.path !== `objects/${object.key}`) {
      throw backupError('BACKUP_OBJECT_PATH_INVALID', `Ruta inválida: ${object.path}.`);
    }
  }
}

async function assertFileEntry(root, entry) {
  const inspected = await inspectFile(resolveBackupPath(root, entry.path));
  if (inspected.bytes !== entry.bytes || inspected.sha256 !== entry.sha256) {
    throw backupError('BACKUP_FILE_MISMATCH', `Archivo corrupto: ${entry.path}.`);
  }
}

async function inspectFile(file) {
  const bytes = await readFile(file);
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function listFiles(root) {
  const files = [];
  await visit(root);
  return files.sort();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw backupError('BACKUP_SYMLINK_REJECTED', 'No se admiten symlinks.');
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(portable(path.relative(root, target)));
    }
  }
}

async function publishBackup(staging, output) {
  try {
    await rename(staging, output);
  } catch (error) {
    if (!['EPERM', 'EBUSY'].includes(error?.code)) throw error;
    let ownsOutput = false;
    try {
      await mkdir(output);
      ownsOutput = true;
      for (const entry of (await readdir(staging)).sort()) {
        await cp(path.join(staging, entry), path.join(output, entry), {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      }
      await verifyPostgresS3Backup({ backup: output });
      await rm(staging, { recursive: true, force: true });
    } catch (copyError) {
      if (ownsOutput) await rm(output, { recursive: true, force: true });
      throw copyError;
    }
  }
}

function resolveBackupPath(root, relativePath) {
  assertBlobKey(relativePath);
  const target = path.resolve(root, ...relativePath.split('/'));
  if (!isWithin(root, target)) throw backupError('BACKUP_PATH_INVALID', 'La ruta sale del backup.');
  return target;
}

function safeOutput(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw backupError('BACKUP_OUTPUT_REQUIRED', 'Debe indicar el directorio de backup.');
  }
  const output = path.resolve(value);
  if (output === path.parse(output).root) {
    throw backupError('BACKUP_OUTPUT_INVALID', 'La salida de backup no es segura.');
  }
  return output;
}

async function optionalProject(repository, id) {
  try {
    return await repository.get(id);
  } catch (error) {
    if (error?.code === 'PROJECT_NOT_FOUND') return null;
    throw error;
  }
}

async function optionalBlob(blobStorage, key) {
  try {
    return await blobStorage.stat(key);
  } catch (error) {
    if (error?.code === 'BLOB_NOT_FOUND') return null;
    throw error;
  }
}

function compareItem(target, current, expected) {
  if (!current) return { target, status: 'planned' };
  return {
    target,
    status: sha256Json(current) === sha256Json(expected) ? 'skipped' : 'failed',
  };
}

function restoreReport(manifest, items, state) {
  return canonicalize({
    version: 1,
    state,
    fingerprint: manifest.fingerprint,
    summary: {
      planned: items.filter((item) => item.status === 'planned').length,
      restored: items.filter((item) => item.status === 'restored').length,
      skipped: items.filter((item) => item.status === 'skipped').length,
      total: items.length,
    },
    items: [...items].sort((left, right) => left.target.localeCompare(right.target)),
  });
}

function portable(value) {
  return value.split(path.sep).join('/');
}

function backupError(code, message, technicalDetail) {
  const error = storageError(code, message, technicalDetail);
  error.stage = 'storage_backup';
  return error;
}
