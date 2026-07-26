import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream, existsSync } from 'node:fs';
import {
  cp,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot } from '../stage1/common.mjs';
import { defaultProjectStorageRoot } from '../local-app/project-repository.mjs';
import { defaultLibraryStorageRoot } from '../local-app/resource-library.mjs';
import {
  assertBlobKey,
  assertJobId,
  assertProjectId,
  storageError,
} from './contracts.mjs';
import {
  canonicalize,
  isWithin,
  sha256Json,
} from './filesystem-utils.mjs';

const MANIFEST_NAME = 'manifest.json';
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_ENTRIES = 100000;
const POLICY = Object.freeze({
  includedJobStates: ['completed'],
  artifactPolicy: 'all-final-output-files',
  excluded: [
    'app-input',
    'cache',
    'frames',
    'library-publication',
    'temp',
    'work',
  ],
});
const schema = JSON.parse(await readFile(
  path.join(projectRoot, 'schema', 'local-data-bundle.schema.json'),
  'utf8',
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export async function inventoryLocalData(options = {}) {
  const roots = resolveRoots(options);
  const candidates = [];
  await inventoryProjects(roots.projectsRoot, candidates);
  const resources = await inventoryResources(roots.libraryRoot, candidates);
  await inventoryJobs(roots.jobsRoot, roots.outputRoot, candidates);
  candidates.sort((left, right) => left.entry.path.localeCompare(right.entry.path));
  if (candidates.length > MAX_ENTRIES) {
    throw bundleError('BUNDLE_TOO_MANY_FILES', `El inventario supera ${MAX_ENTRIES} archivos.`);
  }
  assertUniquePaths(candidates.map(({ entry }) => entry.path));
  const entries = candidates.map(({ entry }) => entry);
  const summary = summarize(entries, resources);
  const body = {
    version: 1,
    format: 'local-video-data-bundle',
    policy: structuredClone(POLICY),
    summary,
    entries,
  };
  const manifest = {
    ...body,
    fingerprint: sha256Json(body),
  };
  assertManifestSchema(manifest);
  return {
    manifest: canonicalize(manifest),
    sources: new Map(candidates.map(({ entry, source }) => [entry.path, source])),
  };
}

export async function exportLocalDataBundle(options = {}) {
  if (!options.output) {
    throw bundleError('BUNDLE_OUTPUT_REQUIRED', 'Debe indicar un directorio de salida.');
  }
  const output = path.resolve(options.output);
  const roots = resolveRoots(options);
  assertSafeOutput(output, roots);
  if (existsSync(output)) {
    throw bundleError('BUNDLE_OUTPUT_EXISTS', 'El directorio de salida ya existe.');
  }
  const { manifest, sources } = await inventoryLocalData({ ...options, ...roots });
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const staging = path.join(
    parent,
    `.${path.basename(output)}.${process.pid}.${createHash('sha256').update(output).digest('hex').slice(0, 12)}.tmp`,
  );
  if (existsSync(staging)) {
    throw bundleError('BUNDLE_STAGING_EXISTS', 'Ya existe un temporal de exportación.');
  }
  await mkdir(staging);
  try {
    for (const entry of manifest.entries) {
      const source = sources.get(entry.path);
      const destination = resolveBundlePath(staging, entry.path);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
      const copied = await inspectRegularFile(destination);
      if (copied.bytes !== entry.bytes || copied.sha256 !== entry.sha256) {
        throw bundleError(
          'BUNDLE_SOURCE_CHANGED',
          `El archivo cambió durante la exportación: ${entry.path}.`,
        );
      }
    }
    await writeFile(
      path.join(staging, MANIFEST_NAME),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    await verifyLocalDataBundle({ bundle: staging });
    await publishStaging(staging, output);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    fingerprint: manifest.fingerprint,
    summary: manifest.summary,
  };
}

export async function verifyLocalDataBundle(options = {}) {
  if (!options.bundle) {
    throw bundleError('BUNDLE_PATH_REQUIRED', 'Debe indicar el directorio del bundle.');
  }
  const bundle = path.resolve(options.bundle);
  const rootStats = await safeLstat(bundle, 'BUNDLE_NOT_FOUND');
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw bundleError('BUNDLE_PATH_INVALID', 'El bundle debe ser un directorio real.');
  }
  const manifestPath = path.join(bundle, MANIFEST_NAME);
  const manifest = await readJsonFile(manifestPath, 'BUNDLE_MANIFEST_INVALID');
  assertManifestSchema(manifest);
  const { fingerprint, ...body } = manifest;
  if (sha256Json(body) !== fingerprint) {
    throw bundleError('BUNDLE_FINGERPRINT_MISMATCH', 'El fingerprint del bundle no coincide.');
  }
  const paths = manifest.entries.map((entry) => entry.path);
  assertSorted(paths);
  assertUniquePaths(paths);
  const actualFiles = (await listRegularFiles(bundle))
    .map((file) => portable(path.relative(bundle, file)))
    .filter((relative) => relative !== MANIFEST_NAME)
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(paths)) {
    throw bundleError(
      'BUNDLE_FILE_SET_MISMATCH',
      'Los archivos presentes no coinciden con el manifiesto.',
    );
  }

  let resourceRegistry = null;
  const resourceIdsWithAssets = new Set();
  const jobIdsWithArtifacts = new Set();
  for (const entry of manifest.entries) {
    assertEntrySemantics(entry);
    const file = resolveBundlePath(bundle, entry.path);
    const inspected = await inspectRegularFile(file);
    if (inspected.bytes !== entry.bytes) {
      throw bundleError('BUNDLE_SIZE_MISMATCH', `Tamaño incorrecto: ${entry.path}.`);
    }
    if (inspected.sha256 !== entry.sha256) {
      throw bundleError('BUNDLE_HASH_MISMATCH', `Hash incorrecto: ${entry.path}.`);
    }
    if (entry.path.endsWith('.json')) {
      const value = await readJsonFile(file, 'BUNDLE_JSON_INVALID');
      assertNoAbsoluteHostPaths(value, entry.path);
      if (entry.kind === 'project') {
        validateProjectDocument(value, entry.path);
        if (value.id !== entry.id || sha256Json(value) !== entry.revision) {
          throw bundleError('BUNDLE_PROJECT_REVISION_MISMATCH', `Revisión incorrecta: ${entry.path}.`);
        }
      } else if (entry.kind === 'resource-registry') {
        resourceRegistry = value;
      } else if (entry.kind === 'job-record') {
        if (value.jobId !== entry.jobId || value.state !== 'completed') {
          throw bundleError('BUNDLE_JOB_INVALID', `Job no migrable: ${entry.path}.`);
        }
      }
    }
    if (entry.kind === 'resource-asset' && entry.id) resourceIdsWithAssets.add(entry.id);
    if (entry.kind === 'job-artifact' && entry.jobId) jobIdsWithArtifacts.add(entry.jobId);
  }
  verifyResourceReferences(resourceRegistry, resourceIdsWithAssets);
  verifyJobReferences(manifest.entries, jobIdsWithArtifacts);
  const resourceCount = Array.isArray(resourceRegistry?.entries)
    ? resourceRegistry.entries.length
    : 0;
  const expectedSummary = summarize(manifest.entries, resourceCount);
  if (sha256Json(expectedSummary) !== sha256Json(manifest.summary)) {
    throw bundleError('BUNDLE_SUMMARY_MISMATCH', 'El resumen no coincide con las entradas.');
  }
  return {
    valid: true,
    fingerprint,
    summary: structuredClone(manifest.summary),
  };
}

function resolveRoots(options) {
  return {
    projectsRoot: path.resolve(options.projectsRoot || defaultProjectStorageRoot()),
    libraryRoot: path.resolve(options.libraryRoot || defaultLibraryStorageRoot()),
    jobsRoot: path.resolve(options.jobsRoot || path.join(projectRoot, '.local-video', 'app-jobs')),
    outputRoot: path.resolve(options.outputRoot || path.join(projectRoot, '.local-video', 'output')),
  };
}

async function inventoryProjects(root, candidates) {
  for (const file of await listTopLevelJson(root)) {
    const project = await readJsonFile(file, 'BUNDLE_SOURCE_PROJECT_INVALID');
    validateProjectDocument(project, portable(path.basename(file)));
    const info = await inspectRegularFile(file);
    candidates.push({
      source: file,
      entry: {
        kind: 'project',
        role: 'editable-project',
        path: `projects/${project.id}.json`,
        bytes: info.bytes,
        sha256: info.sha256,
        id: project.id,
        revision: sha256Json(project),
      },
    });
  }
}

async function inventoryResources(root, candidates) {
  const indexPath = path.join(root, 'library-index.json');
  let resourceCount = 0;
  if (existsSync(indexPath)) {
    const registry = await readJsonFile(indexPath, 'BUNDLE_SOURCE_LIBRARY_INVALID');
    if (registry.version !== 1 || !Array.isArray(registry.entries)) {
      throw bundleError('BUNDLE_SOURCE_LIBRARY_INVALID', 'El registro durable no es válido.');
    }
    assertNoAbsoluteHostPaths(registry, 'resources/library-index.json');
    resourceCount = registry.entries.length;
    const info = await inspectRegularFile(indexPath);
    candidates.push({
      source: indexPath,
      entry: {
        kind: 'resource-registry',
        role: 'resource-registry',
        path: 'resources/library-index.json',
        bytes: info.bytes,
        sha256: info.sha256,
      },
    });
  }
  const assetsRoot = path.join(root, 'assets');
  for (const file of await listRegularFiles(assetsRoot)) {
    const relative = portable(path.relative(assetsRoot, file));
    const segments = relative.split('/');
    const resourceId = segments.length >= 3 ? segments[1] : undefined;
    const info = await inspectRegularFile(file);
    candidates.push({
      source: file,
      entry: compact({
        kind: 'resource-asset',
        role: resourceRole(relative),
        path: `resources/assets/${relative}`,
        bytes: info.bytes,
        sha256: info.sha256,
        id: resourceId,
      }),
    });
  }
  return resourceCount;
}

async function inventoryJobs(jobsRoot, outputRoot, candidates) {
  for (const file of await listTopLevelJson(jobsRoot)) {
    const job = await readJsonFile(file, 'BUNDLE_SOURCE_JOB_INVALID');
    if (job.state !== 'completed') continue;
    assertJobId(job.jobId);
    assertNoAbsoluteHostPaths(job, `jobs/${job.jobId}/job.json`);
    const artifactRoot = path.join(outputRoot, job.jobId);
    const artifacts = await listRegularFiles(artifactRoot);
    if (artifacts.length === 0) continue;
    const jobInfo = await inspectRegularFile(file);
    candidates.push({
      source: file,
      entry: {
        kind: 'job-record',
        role: 'completed-job-state',
        path: `jobs/${job.jobId}/job.json`,
        bytes: jobInfo.bytes,
        sha256: jobInfo.sha256,
        jobId: job.jobId,
      },
    });
    for (const artifact of artifacts) {
      const relative = portable(path.relative(artifactRoot, artifact));
      const info = await inspectRegularFile(artifact);
      candidates.push({
        source: artifact,
        entry: {
          kind: 'job-artifact',
          role: artifactRole(relative),
          path: `jobs/${job.jobId}/artifacts/${relative}`,
          bytes: info.bytes,
          sha256: info.sha256,
          jobId: job.jobId,
        },
      });
    }
  }
}

async function listTopLevelJson(root) {
  if (!existsSync(root)) return [];
  const rootStats = await safeLstat(root, 'BUNDLE_SOURCE_INVALID');
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw bundleError('BUNDLE_SOURCE_INVALID', 'Una raíz durable no es un directorio real.');
  }
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isSymbolicLink())) {
    throw bundleError('BUNDLE_SYMLINK_REJECTED', 'No se admiten symlinks en datos durables.');
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

async function listRegularFiles(root) {
  if (!existsSync(root)) return [];
  const rootStats = await safeLstat(root, 'BUNDLE_SOURCE_INVALID');
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw bundleError('BUNDLE_SOURCE_INVALID', 'La raíz inventariada no es un directorio real.');
  }
  const files = [];
  await walk(root, files);
  return files.sort();
}

async function walk(directory, files) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === '.work') continue;
    const target = path.join(directory, entry.name);
    const info = await lstat(target);
    if (info.isSymbolicLink()) {
      throw bundleError('BUNDLE_SYMLINK_REJECTED', 'No se admiten symlinks en datos durables.');
    }
    if (info.isDirectory()) await walk(target, files);
    else if (info.isFile()) files.push(target);
  }
}

async function inspectRegularFile(file) {
  const info = await safeLstat(file, 'BUNDLE_FILE_MISSING');
  if (info.isSymbolicLink() || !info.isFile()) {
    throw bundleError('BUNDLE_FILE_INVALID', 'Solo se admiten archivos regulares.');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return {
    bytes: info.size,
    sha256: hash.digest('hex'),
  };
}

async function readJsonFile(file, code) {
  const info = await inspectRegularFile(file);
  if (info.bytes > MAX_JSON_BYTES) {
    throw bundleError(code, 'Un documento JSON supera 1 MB.');
  }
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw bundleError(code, 'Un documento durable no contiene JSON válido.');
  }
}

function summarize(entries, resourceCount) {
  return {
    projects: entries.filter((entry) => entry.kind === 'project').length,
    resources: resourceCount,
    resourceFiles: entries.filter((entry) => entry.kind === 'resource-asset').length,
    jobs: entries.filter((entry) => entry.kind === 'job-record').length,
    jobArtifacts: entries.filter((entry) => entry.kind === 'job-artifact').length,
    totalFiles: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
  };
}

function assertManifestSchema(manifest) {
  if (!validateSchema(manifest)) {
    const detail = (validateSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw bundleError('BUNDLE_MANIFEST_INVALID', 'El manifiesto no cumple el contrato.', detail);
  }
}

function assertEntrySemantics(entry) {
  try {
    assertBlobKey(entry.path);
  } catch {
    throw bundleError('BUNDLE_PATH_INVALID', `Ruta no portable: ${entry.path}.`);
  }
  if (entry.path === MANIFEST_NAME) {
    throw bundleError('BUNDLE_PATH_INVALID', 'El manifiesto no puede listarse a sí mismo.');
  }
  if (entry.kind === 'project') {
    assertProjectId(entry.id);
    if (entry.path !== `projects/${entry.id}.json` || !entry.revision) {
      throw bundleError('BUNDLE_PROJECT_INVALID', `Entrada de proyecto inválida: ${entry.path}.`);
    }
  }
  if (entry.kind === 'job-record' || entry.kind === 'job-artifact') {
    assertJobId(entry.jobId);
    if (!entry.path.startsWith(`jobs/${entry.jobId}/`)) {
      throw bundleError('BUNDLE_JOB_INVALID', `Entrada de job inválida: ${entry.path}.`);
    }
  }
}

function verifyResourceReferences(registry, resourceIdsWithAssets) {
  if (!registry) return;
  if (registry.version !== 1 || !Array.isArray(registry.entries)) {
    throw bundleError('BUNDLE_RESOURCE_REGISTRY_INVALID', 'El registro de recursos es inválido.');
  }
  const registryIds = new Set();
  for (const record of registry.entries) {
    if (
      typeof record.id !== 'string'
      || registryIds.has(record.id)
      || record.id !== record.entry?.id
      || !/^[a-f0-9]{64}$/u.test(record.contentHash)
    ) {
      throw bundleError('BUNDLE_RESOURCE_REFERENCE_INVALID', 'Un registro no coincide con su recurso.');
    }
    registryIds.add(record.id);
    const managed = record.entry.type === 'background'
      || (
        record.entry.type === 'character'
        && String(record.entry.characterRef?.catalog || '').includes('/library/')
      );
    if (managed && !resourceIdsWithAssets.has(record.id)) {
      throw bundleError(
        'BUNDLE_RESOURCE_ASSET_MISSING',
        `Faltan archivos durables del recurso ${record.id}.`,
      );
    }
  }
  for (const resourceId of resourceIdsWithAssets) {
    if (!registryIds.has(resourceId)) {
      throw bundleError(
        'BUNDLE_RESOURCE_REFERENCE_INVALID',
        `El paquete durable ${resourceId} no tiene registro.`,
      );
    }
  }
}

function verifyJobReferences(entries, jobIdsWithArtifacts) {
  const records = new Set(
    entries
      .filter((candidate) => candidate.kind === 'job-record')
      .map((entry) => entry.jobId),
  );
  for (const jobId of records) {
    if (!jobIdsWithArtifacts.has(jobId)) {
      throw bundleError('BUNDLE_JOB_ARTIFACT_MISSING', `Faltan artefactos del job ${jobId}.`);
    }
  }
  for (const jobId of jobIdsWithArtifacts) {
    if (!records.has(jobId)) {
      throw bundleError('BUNDLE_JOB_INVALID', `Falta el estado durable del job ${jobId}.`);
    }
  }
}

function validateProjectDocument(project, relativePath) {
  if (
    !project
    || typeof project !== 'object'
    || Array.isArray(project)
    || project.version !== 1
    || typeof project.title !== 'string'
    || !Array.isArray(project.scenes)
    || project.scenes.length < 1
    || project.scenes.length > 8
  ) {
    throw bundleError('BUNDLE_PROJECT_INVALID', `Proyecto inválido: ${relativePath}.`);
  }
  assertProjectId(project.id);
  assertNoAbsoluteHostPaths(project, relativePath);
}

function assertNoAbsoluteHostPaths(value, relativePath) {
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoAbsoluteHostPaths(item, relativePath));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => assertNoAbsoluteHostPaths(item, relativePath));
    return;
  }
  if (
    typeof value === 'string'
    && (
      /^[a-zA-Z]:[\\/]/u.test(value)
      || /^\/(?:home|Users|var|tmp|opt|srv|mnt|root)\//u.test(value)
    )
  ) {
    throw bundleError('BUNDLE_ABSOLUTE_PATH', `Ruta absoluta detectada en ${relativePath}.`);
  }
}

function assertSafeOutput(output, roots) {
  for (const root of Object.values(roots)) {
    if (output === root || isWithin(root, output, true) || isWithin(output, root, true)) {
      throw bundleError(
        'BUNDLE_OUTPUT_UNSAFE',
        'La salida no puede contener ni estar dentro de una raíz durable.',
      );
    }
  }
}

function resolveBundlePath(root, relativePath) {
  try {
    assertBlobKey(relativePath);
  } catch {
    throw bundleError('BUNDLE_PATH_INVALID', `Ruta no portable: ${relativePath}.`);
  }
  const target = path.resolve(root, ...relativePath.split('/'));
  if (!isWithin(root, target)) {
    throw bundleError('BUNDLE_PATH_INVALID', `La ruta sale del bundle: ${relativePath}.`);
  }
  return target;
}

function assertSorted(paths) {
  const sorted = [...paths].sort();
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) {
    throw bundleError('BUNDLE_ORDER_INVALID', 'Las entradas no están en orden estable.');
  }
}

function assertUniquePaths(paths) {
  if (new Set(paths).size !== paths.length) {
    throw bundleError('BUNDLE_PATH_DUPLICATE', 'El bundle contiene rutas duplicadas.');
  }
}

function resourceRole(relative) {
  if (relative.endsWith('.manifest.json')) return 'resource-manifest';
  if (relative.endsWith('.json')) return 'resource-metadata';
  return 'resource-binary';
}

function artifactRole(relative) {
  if (relative === 'project-manifest.json') return 'project-manifest';
  if (relative === 'verification.json') return 'verification';
  if (relative.endsWith('.mp4')) return 'rendered-video';
  return 'final-artifact';
}

function portable(value) {
  return value.split(path.sep).join('/');
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function safeLstat(target, code) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw bundleError(code, 'No se encontró el archivo requerido.');
    throw error;
  }
}

async function renameWithRetry(source, destination) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const retryable = error?.code === 'EPERM' || error?.code === 'EBUSY';
      if (!retryable || attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

async function publishStaging(source, destination) {
  try {
    await renameWithRetry(source, destination);
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error;
    let ownsDestination = false;
    try {
      await mkdir(destination);
      ownsDestination = true;
      const entries = await readdir(source);
      for (const entry of entries.sort()) {
        await cp(path.join(source, entry), path.join(destination, entry), {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      }
      await verifyLocalDataBundle({ bundle: destination });
      await rm(source, { recursive: true, force: true });
    } catch (copyError) {
      if (ownsDestination) await rm(destination, { recursive: true, force: true });
      throw copyError;
    }
  }
}

function bundleError(code, message, technicalDetail) {
  const error = storageError(code, message, technicalDetail);
  error.stage = 'storage_bundle';
  return error;
}
