import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot } from '../stage1/common.mjs';
import { validateDraftEnvelope } from '../local-app/project-repository.mjs';
import { validateResourceLibraryRegistry } from '../local-app/resource-library.mjs';
import { validateRenderJob } from './file-render-job-repository.mjs';
import {
  atomicWriteJson,
  canonicalize,
  isWithin,
  sha256Json,
} from './filesystem-utils.mjs';
import { inventoryLocalData } from './local-data-bundle.mjs';
import { assertBlobKey, storageError } from './contracts.mjs';
import {
  artifactMimeType,
  contentAddressedBlobKey,
} from './content-addressed-blobs.mjs';

const MAX_PLAN_BYTES = 32 * 1024 * 1024;
const planSchema = JSON.parse(await readFile(
  path.join(projectRoot, 'schema', 'storage-migration-plan.schema.json'),
  'utf8',
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) => (
    Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
  ),
});
const validatePlanSchema = ajv.compile(planSchema);

export async function createStorageMigrationPlan(options = {}) {
  const state = await migrationState(options);
  const body = {
    version: 1,
    format: 'local-video-storage-migration-plan',
    createdAt: isoTimestamp(options.now?.() ?? new Date()),
    source: {
      format: state.inventory.manifest.format,
      fingerprint: state.inventory.manifest.fingerprint,
      summary: structuredClone(state.inventory.manifest.summary),
    },
    destination: {
      metadata: 'postgresql',
      blobs: 's3',
      blobKeyPolicy: 'sha256-v1',
    },
    summary: summarizePlan(state.items),
    items: state.items,
  };
  const plan = canonicalize({ ...body, fingerprint: sha256Json(body) });
  assertPlan(plan);
  return plan;
}

export async function writeStorageMigrationPlan(options = {}) {
  if (typeof options.planFile !== 'string' || !options.planFile.trim()) {
    throw migrationError('MIGRATION_PLAN_PATH_REQUIRED', 'Debe indicar el archivo del plan.');
  }
  const planFile = path.resolve(options.planFile);
  assertPlanPathSafe(planFile, options.roots);
  const plan = await createStorageMigrationPlan(options);
  try {
    await atomicWriteJson(planFile, plan, { exclusive: true });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw migrationError('MIGRATION_PLAN_EXISTS', 'El plan ya existe y no será sobrescrito.');
    }
    throw error;
  }
  return plan;
}

export async function readStorageMigrationPlan(planFile) {
  if (typeof planFile !== 'string' || !planFile.trim()) {
    throw migrationError('MIGRATION_PLAN_PATH_REQUIRED', 'Debe indicar el archivo del plan.');
  }
  let bytes;
  try {
    bytes = await readFile(path.resolve(planFile));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw migrationError('MIGRATION_PLAN_NOT_FOUND', 'No se encontró el plan de migración.');
    }
    throw error;
  }
  if (bytes.length > MAX_PLAN_BYTES) {
    throw migrationError('MIGRATION_PLAN_TOO_LARGE', 'El plan supera 32 MB.');
  }
  let plan;
  try {
    plan = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw migrationError('MIGRATION_PLAN_INVALID', 'El plan no contiene JSON válido.');
  }
  assertPlan(plan);
  return canonicalize(plan);
}

export async function applyStorageMigration(options = {}) {
  const context = await prepareExecution(options);
  const preflight = await inspectDestination(context);
  const conflict = preflight.find((item) => item.status === 'failed');
  if (conflict) {
    const error = migrationError(
      'MIGRATION_DESTINATION_CONFLICT',
      `El destino contiene datos incompatibles para ${conflict.target}.`,
    );
    error.report = report('apply', context.plan, preflight, false);
    throw error;
  }

  const results = [];
  try {
    for (const item of context.plan.items.filter((candidate) => candidate.kind === 'blob')) {
      const inspected = preflight.find((candidate) => candidate.target === item.target);
      if (inspected.status === 'skipped') {
        results.push(inspected);
        continue;
      }
      const sourceFile = context.state.inventory.sources.get(item.sourcePaths[0]);
      const stored = await context.blobStorage.put({
        key: item.key,
        sourceFile,
        expectedSha256: item.sha256,
        mimeType: item.mimeType,
      });
      assertBlobMatches(item, stored);
      results.push(resultItem(item, 'imported'));
    }
    for (const item of context.plan.items.filter((candidate) => candidate.kind !== 'blob')) {
      const inspected = preflight.find((candidate) => candidate.target === item.target);
      if (inspected.status === 'skipped') {
        results.push(inspected);
        continue;
      }
      const document = context.state.documents.get(item.target);
      if (item.kind === 'project-metadata') {
        await context.repositories.projects.insert(document);
      } else if (item.kind === 'resource-metadata') {
        const registered = await context.repositories.resources.register(document);
        if (!registered.created || sha256Json(registered.record) !== item.metadataSha256) {
          throw migrationError(
            'MIGRATION_DESTINATION_CONFLICT',
            `El recurso ${item.id} cambió durante la importación.`,
          );
        }
      } else {
        await context.repositories.jobs.reserve(document);
      }
      results.push(resultItem(item, 'imported'));
    }
  } catch (error) {
    const target = context.plan.items.find((item) => (
      !results.some((result) => result.target === item.target)
    ));
    if (target) results.push(resultItem(target, 'failed', error.code || 'UNEXPECTED_ERROR'));
    error.report = report('apply', context.plan, results, false);
    throw error;
  }
  return report('apply', context.plan, results, true);
}

export async function verifyStorageMigration(options = {}) {
  const context = await prepareExecution(options);
  const inspected = await inspectDestination(context);
  const results = inspected.map((item) => (
    item.status === 'skipped'
      ? { ...item, status: 'verified' }
      : item
  ));
  const valid = results.every((item) => item.status === 'verified');
  const verification = report('verify', context.plan, results, valid);
  if (!valid) {
    const error = migrationError(
      'MIGRATION_VERIFICATION_FAILED',
      'El destino no coincide completamente con el plan.',
    );
    error.report = verification;
    throw error;
  }
  return verification;
}

async function prepareExecution(options) {
  const plan = options.plan || await readStorageMigrationPlan(options.planFile);
  assertPlan(plan);
  const state = await migrationState(options);
  if (state.inventory.manifest.fingerprint !== plan.source.fingerprint) {
    throw migrationError(
      'MIGRATION_SOURCE_CHANGED',
      'El origen cambió desde que se creó el plan.',
    );
  }
  if (sha256Json(state.items) !== sha256Json(plan.items)) {
    throw migrationError(
      'MIGRATION_PLAN_SOURCE_MISMATCH',
      'El plan no coincide con la transformación vigente del origen.',
    );
  }
  if (sha256Json(state.inventory.manifest.summary) !== sha256Json(plan.source.summary)) {
    throw migrationError(
      'MIGRATION_PLAN_SOURCE_MISMATCH',
      'El resumen del plan no coincide con el inventario de origen.',
    );
  }
  const repositories = options.repositories;
  if (
    !repositories?.projects?.get
    || !repositories?.projects?.insert
    || !repositories?.resources?.get
    || !repositories?.resources?.list
    || !repositories?.resources?.register
    || !repositories?.jobs?.get
    || !repositories?.jobs?.reserve
    || !options.blobStorage?.stat
    || !options.blobStorage?.put
  ) {
    throw migrationError(
      'MIGRATION_DESTINATION_INVALID',
      'El importador requiere repositorios PostgreSQL y blob storage S3.',
    );
  }
  return { plan, state, repositories, blobStorage: options.blobStorage };
}

async function migrationState(options) {
  const inventory = await inventoryLocalData(options.roots || options);
  const entries = inventory.manifest.entries;
  const registryEntry = entries.find((entry) => entry.kind === 'resource-registry');
  const registry = registryEntry
    ? await readJson(inventory.sources.get(registryEntry.path), 'MIGRATION_SOURCE_INVALID')
    : { version: 1, entries: [] };
  validateResourceLibraryRegistry(registry);

  const resourceArtifacts = groupArtifacts(
    entries.filter((entry) => entry.kind === 'resource-asset'),
    (entry) => entry.id,
    (entry) => entry.path.slice('resources/'.length),
  );
  const jobArtifacts = groupArtifacts(
    entries.filter((entry) => entry.kind === 'job-artifact'),
    (entry) => entry.jobId,
    (entry) => entry.path.slice(`jobs/${entry.jobId}/artifacts/`.length),
  );
  const items = [];
  const documents = new Map();

  for (const entry of entries.filter((candidate) => candidate.kind === 'project')) {
    const document = await readJson(inventory.sources.get(entry.path), 'MIGRATION_SOURCE_INVALID');
    validateDraftEnvelope(document);
    addMetadata(items, documents, {
      kind: 'project-metadata',
      id: entry.id,
      entry,
      document,
      target: `projects/${entry.id}`,
    });
  }
  for (const record of registry.entries) {
    const artifacts = resourceArtifacts.get(record.id) || [];
    const document = artifacts.length === 0
      ? structuredClone(record)
      : {
        ...structuredClone(record),
        blobStorage: { version: 1, backend: 's3', artifacts },
      };
    validateResourceLibraryRegistry({ version: 1, entries: [document] });
    addMetadata(items, documents, {
      kind: 'resource-metadata',
      id: record.id,
      entry: registryEntry,
      document,
      target: `resources/${record.id}`,
    });
  }
  for (const entry of entries.filter((candidate) => candidate.kind === 'job-record')) {
    const source = await readJson(inventory.sources.get(entry.path), 'MIGRATION_SOURCE_INVALID');
    const artifacts = jobArtifacts.get(entry.jobId) || [];
    const document = {
      ...structuredClone(source),
      blobStorage: { version: 1, backend: 's3', artifacts },
    };
    validateRenderJob(document);
    addMetadata(items, documents, {
      kind: 'job-metadata',
      id: entry.jobId,
      entry,
      document,
      target: `jobs/${entry.jobId}`,
    });
  }

  const blobGroups = new Map();
  for (const entry of entries.filter((candidate) => (
    candidate.kind === 'resource-asset' || candidate.kind === 'job-artifact'
  ))) {
    const key = contentAddressedBlobKey(entry.sha256);
    const current = blobGroups.get(key) || {
      kind: 'blob',
      key,
      sourcePaths: [],
      bytes: entry.bytes,
      sha256: entry.sha256,
      mimeType: artifactMimeType(entry.path),
      target: `blobs/${key}`,
      action: 'planned',
    };
    if (current.bytes !== entry.bytes || current.sha256 !== entry.sha256) {
      throw migrationError('MIGRATION_BLOB_IDENTITY_INVALID', `Identidad inconsistente: ${key}.`);
    }
    current.sourcePaths.push(entry.path);
    current.sourcePaths.sort();
    blobGroups.set(key, current);
  }
  items.push(...blobGroups.values());
  items.sort((left, right) => left.target.localeCompare(right.target));
  assertUniqueTargets(items);
  return { inventory, items: canonicalize(items), documents };
}

function groupArtifacts(entries, owner, relativePath) {
  const groups = new Map();
  for (const entry of entries) {
    const id = owner(entry);
    if (!id) {
      throw migrationError('MIGRATION_SOURCE_INVALID', `El asset no tiene propietario: ${entry.path}.`);
    }
    const artifact = {
      role: entry.role,
      relativePath: relativePath(entry),
      key: contentAddressedBlobKey(entry.sha256),
      bytes: entry.bytes,
      sha256: entry.sha256,
      mimeType: artifactMimeType(entry.path),
    };
    const current = groups.get(id) || [];
    current.push(artifact);
    current.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    groups.set(id, current);
  }
  return groups;
}

function addMetadata(items, documents, { kind, id, entry, document, target }) {
  if (!entry) {
    throw migrationError('MIGRATION_SOURCE_INVALID', `Falta el origen durable de ${target}.`);
  }
  const metadataSha256 = sha256Json(document);
  items.push({
    kind,
    id,
    sourcePath: entry.path,
    sourceSha256: entry.sha256,
    metadataSha256,
    target,
    action: 'planned',
  });
  documents.set(target, canonicalize(document));
}

async function inspectDestination(context) {
  const results = [];
  const allResources = await context.repositories.resources.list();
  for (const item of context.plan.items) {
    if (item.kind === 'blob') {
      const existing = await optionalBlobStat(context.blobStorage, item.key);
      results.push(!existing
        ? resultItem(item, 'planned')
        : blobEquals(item, existing)
          ? resultItem(item, 'skipped')
          : resultItem(item, 'failed', 'MIGRATION_BLOB_CONFLICT'));
      continue;
    }
    const expected = context.state.documents.get(item.target);
    let existing = null;
    if (item.kind === 'project-metadata') {
      existing = await optionalProject(context.repositories.projects, item.id);
      existing = existing?.project || null;
    } else if (item.kind === 'resource-metadata') {
      existing = await context.repositories.resources.get(item.id);
      const hashConflict = allResources.find((record) => (
        record.contentHash === expected.contentHash && record.id !== item.id
      ));
      if (hashConflict) {
        results.push(resultItem(item, 'failed', 'MIGRATION_RESOURCE_HASH_CONFLICT'));
        continue;
      }
    } else {
      existing = await context.repositories.jobs.get(item.id);
    }
    results.push(!existing
      ? resultItem(item, 'planned')
      : sha256Json(existing) === item.metadataSha256
        ? resultItem(item, 'skipped')
        : resultItem(item, 'failed', 'MIGRATION_METADATA_CONFLICT'));
  }
  return results;
}

async function optionalProject(repository, id) {
  try {
    return await repository.get(id);
  } catch (error) {
    if (error?.code === 'PROJECT_NOT_FOUND') return null;
    throw error;
  }
}

async function optionalBlobStat(blobStorage, key) {
  try {
    return await blobStorage.stat(key);
  } catch (error) {
    if (error?.code === 'BLOB_NOT_FOUND') return null;
    throw error;
  }
}

function report(operation, plan, items, completed) {
  const ordered = [...items].sort((left, right) => left.target.localeCompare(right.target));
  return canonicalize({
    version: 1,
    state: completed ? 'completed' : 'failed',
    stage: 'storage_migration',
    operation,
    planFingerprint: plan.fingerprint,
    sourceFingerprint: plan.source.fingerprint,
    summary: {
      planned: ordered.filter((item) => item.status === 'planned').length,
      skipped: ordered.filter((item) => item.status === 'skipped').length,
      imported: ordered.filter((item) => item.status === 'imported').length,
      verified: ordered.filter((item) => item.status === 'verified').length,
      failed: ordered.filter((item) => item.status === 'failed').length,
      total: ordered.length,
    },
    items: ordered,
  });
}

function resultItem(item, status, code) {
  return {
    kind: item.kind,
    target: item.target,
    status,
    ...(code ? { code } : {}),
  };
}

function assertPlan(plan) {
  if (!validatePlanSchema(plan)) {
    const detail = (validatePlanSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw migrationError('MIGRATION_PLAN_INVALID', 'El plan no cumple el contrato.', detail);
  }
  const { fingerprint, ...body } = plan;
  if (sha256Json(body) !== fingerprint) {
    throw migrationError('MIGRATION_PLAN_FINGERPRINT_MISMATCH', 'El fingerprint del plan no coincide.');
  }
  const targets = plan.items.map((item) => item.target);
  if (JSON.stringify(targets) !== JSON.stringify([...targets].sort())) {
    throw migrationError('MIGRATION_PLAN_ORDER_INVALID', 'Los ítems del plan no tienen orden estable.');
  }
  assertUniqueTargets(plan.items);
  if (sha256Json(summarizePlan(plan.items)) !== sha256Json(plan.summary)) {
    throw migrationError('MIGRATION_PLAN_SUMMARY_INVALID', 'El resumen del plan no coincide.');
  }
  for (const item of plan.items) {
    assertPortablePlanPath(item.target);
    if (item.kind === 'blob') {
      assertPortablePlanPath(item.key);
      item.sourcePaths.forEach(assertPortablePlanPath);
      if (
        item.target !== `blobs/${item.key}`
        || item.key !== contentAddressedBlobKey(item.sha256)
        || JSON.stringify(item.sourcePaths) !== JSON.stringify([...item.sourcePaths].sort())
      ) {
        throw migrationError('MIGRATION_PLAN_ITEM_INVALID', `Ítem de blob inválido: ${item.target}.`);
      }
    } else {
      assertPortablePlanPath(item.sourcePath);
      const prefix = item.kind.replace('-metadata', '');
      if (item.target !== `${prefix}s/${item.id}` && item.kind !== 'job-metadata') {
        throw migrationError('MIGRATION_PLAN_ITEM_INVALID', `Ítem de metadata inválido: ${item.target}.`);
      }
      if (item.kind === 'job-metadata' && item.target !== `jobs/${item.id}`) {
        throw migrationError('MIGRATION_PLAN_ITEM_INVALID', `Ítem de metadata inválido: ${item.target}.`);
      }
    }
  }
}

function assertUniqueTargets(items) {
  const targets = items.map((item) => item.target);
  if (new Set(targets).size !== targets.length) {
    throw migrationError('MIGRATION_PLAN_TARGET_DUPLICATE', 'El plan contiene destinos duplicados.');
  }
}

function assertPortablePlanPath(value) {
  try {
    assertBlobKey(value);
  } catch {
    throw migrationError('MIGRATION_PLAN_ITEM_INVALID', `Ruta no portable en el plan: ${value}.`);
  }
}

function assertPlanPathSafe(planFile, roots = {}) {
  for (const root of Object.values(roots || {})) {
    if (typeof root !== 'string') continue;
    const resolved = path.resolve(root);
    if (
      planFile === resolved
      || isWithin(resolved, planFile, true)
      || isWithin(planFile, resolved, true)
    ) {
      throw migrationError(
        'MIGRATION_PLAN_PATH_UNSAFE',
        'El plan no puede contener ni estar dentro de una raíz durable.',
      );
    }
  }
}

function summarizePlan(items) {
  return {
    projects: items.filter((item) => item.kind === 'project-metadata').length,
    resources: items.filter((item) => item.kind === 'resource-metadata').length,
    jobs: items.filter((item) => item.kind === 'job-metadata').length,
    blobs: items.filter((item) => item.kind === 'blob').length,
    blobBytes: items
      .filter((item) => item.kind === 'blob')
      .reduce((total, item) => total + item.bytes, 0),
    items: items.length,
  };
}

function blobEquals(item, stored) {
  return item.sha256 === stored.sha256 && item.bytes === stored.bytes;
}

function assertBlobMatches(item, stored) {
  if (!blobEquals(item, stored)) {
    throw migrationError('MIGRATION_BLOB_VERIFY_FAILED', `El blob no coincide: ${item.key}.`);
  }
}

async function readJson(file, code) {
  let value;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw migrationError(code, 'El origen contiene JSON inválido.');
  }
  return value;
}

function isoTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw migrationError('MIGRATION_TIMESTAMP_INVALID', 'El timestamp del inventario no es válido.');
  }
  return date.toISOString();
}

function migrationError(code, message, technicalDetail) {
  const error = storageError(code, message, technicalDetail);
  error.stage = 'storage_migration';
  return error;
}
