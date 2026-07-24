import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, projectRoot } from '../stage1/common.mjs';
import { validateResourceCatalogSemantics } from '../stage3a/validate-video-project.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) => !Number.isNaN(Date.parse(value)),
});
const validateLibrarySchema = ajv.compile(JSON.parse(
  readFileSync(path.join(projectRoot, 'schema', 'local-resource-library.schema.json'), 'utf8'),
));
const validateCatalogSchema = ajv.compile(JSON.parse(
  readFileSync(path.join(projectRoot, 'schema', 'authoring-resource-catalog.schema.json'), 'utf8'),
));

export function createResourceLibrary(options = {}) {
  const assetsRoot = path.resolve(options.assetsRoot || path.join(projectRoot, 'public'));
  const storageRoot = ensureDirectory(path.resolve(
    options.storageRoot
      || process.env.LOCAL_VIDEO_LIBRARY_ROOT
      || path.join(projectRoot, '.local-video-library'),
  ));
  const publishRoot = ensureDirectory(path.resolve(
    options.publishRoot || path.join(assetsRoot, 'assets', 'library'),
  ));
  assertWithin(assetsRoot, publishRoot, 'publicación de biblioteca');
  const indexPath = path.join(storageRoot, 'library-index.json');
  const catalogPath = path.join(publishRoot, 'authoring-resources.json');
  const catalogRelative = portable(path.relative(assetsRoot, catalogPath));
  const builtinCatalog = clone(options.builtinCatalog || JSON.parse(
    readFileSync(path.join(assetsRoot, 'assets', 'catalog', 'authoring-resources.json'), 'utf8'),
  ));
  validateCatalog(builtinCatalog, assetsRoot);
  let registry = readRegistry(indexPath);
  validateRegistry(registry);
  publish();

  return {
    storageRoot,
    publishRoot,
    indexPath,
    catalogPath,
    catalogRelative,
    catalog: () => mergedCatalog(),
    list: () => [
      ...builtinCatalog.entries.map((entry) => summary(entry, 'builtin', null)),
      ...registry.entries.map((record) => summary(record.entry, 'local', record)),
    ],
    register(input) {
      const entry = clone(input);
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw libraryError('LIBRARY_RESOURCE_INVALID', 'El recurso debe ser un objeto compatible.');
      }
      try {
        validateCatalog({ version: 1, entries: [entry] }, assetsRoot);
      } catch (error) {
        const wrapped = libraryError('LIBRARY_RESOURCE_INVALID', 'El recurso no cumple el contrato o referencia archivos inválidos.');
        wrapped.cause = error;
        throw wrapped;
      }
      const idConflict = [...builtinCatalog.entries, ...registry.entries.map((record) => record.entry)]
        .find((candidate) => candidate.id === entry.id);
      const contentHash = resourceFingerprint(entry);
      if (idConflict) {
        if (resourceFingerprint(idConflict) === contentHash) {
          return { created: false, resource: findSummary(idConflict.id) };
        }
        throw libraryError('LIBRARY_RESOURCE_ID_CONFLICT', `Ya existe un recurso diferente con el ID «${entry.id}».`);
      }
      const duplicate = [...builtinCatalog.entries, ...registry.entries.map((record) => record.entry)]
        .find((candidate) => resourceFingerprint(candidate) === contentHash);
      if (duplicate) return { created: false, resource: findSummary(duplicate.id) };

      const candidateCatalog = {
        version: 1,
        entries: [...builtinCatalog.entries, ...registry.entries.map((record) => record.entry), entry],
      };
      try {
        validateCatalog(candidateCatalog, assetsRoot);
      } catch (error) {
        const wrapped = libraryError('LIBRARY_RESOURCE_INVALID', 'El recurso no cumple el contrato o referencia archivos inválidos.');
        wrapped.cause = error;
        throw wrapped;
      }
      const record = {
        id: entry.id,
        contentHash,
        registeredAt: (options.now ? options.now() : new Date()).toISOString(),
        entry,
      };
      const next = { version: 1, entries: [...registry.entries, record] };
      validateRegistry(next);
      atomicWriteJson(indexPath, next);
      registry = next;
      publish();
      return { created: true, resource: summary(entry, 'local', record) };
    },
  };

  function mergedCatalog() {
    return {
      version: 1,
      entries: clone([...builtinCatalog.entries, ...registry.entries.map((record) => record.entry)]),
    };
  }

  function publish() {
    const catalog = mergedCatalog();
    validateCatalog(catalog, assetsRoot);
    atomicWriteJson(catalogPath, catalog);
  }

  function findSummary(id) {
    return [
      ...builtinCatalog.entries.map((entry) => summary(entry, 'builtin', null)),
      ...registry.entries.map((record) => summary(record.entry, 'local', record)),
    ].find((resource) => resource.id === id);
  }
}

function validateCatalog(catalog, assetsRoot) {
  if (!validateCatalogSchema(catalog)) {
    const detail = (validateCatalogSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    const error = libraryError('LIBRARY_RESOURCE_INVALID', 'El catálogo de recursos no cumple el contrato versión 1.');
    error.technicalDetail = detail;
    throw error;
  }
  validateResourceCatalogSemantics(catalog, assetsRoot);
}

function readRegistry(indexPath) {
  if (!existsSync(indexPath)) return { version: 1, entries: [] };
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (error) {
    const wrapped = libraryError('LIBRARY_INDEX_INVALID', 'El índice de la biblioteca local no contiene JSON válido.');
    wrapped.cause = error;
    throw wrapped;
  }
}

function validateRegistry(registry) {
  if (!validateLibrarySchema(registry)) {
    const detail = (validateLibrarySchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    const error = libraryError('LIBRARY_INDEX_INVALID', 'El índice de la biblioteca local no cumple el contrato versión 1.');
    error.technicalDetail = detail;
    throw error;
  }
  const ids = new Set();
  for (const record of registry.entries) {
    if (record.id !== record.entry.id || record.contentHash !== resourceFingerprint(record.entry) || ids.has(record.id)) {
      throw libraryError('LIBRARY_INDEX_INVALID', 'El índice de la biblioteca local contiene un registro inconsistente.');
    }
    ids.add(record.id);
  }
}

function summary(entry, origin, record) {
  return {
    id: entry.id,
    type: entry.type,
    label: entry.label,
    origin,
    contentHash: record?.contentHash || resourceFingerprint(entry),
    registeredAt: record?.registeredAt || null,
    entry: clone(entry),
  };
}

function resourceFingerprint(entry) {
  const identity = entry?.type === 'character' ? { type: entry.type, characterRef: entry.characterRef }
    : entry?.type === 'background' ? { type: entry.type, backgroundManifest: entry.backgroundManifest }
      : entry?.type === 'voice' ? { type: entry.type, voice: entry.voice }
        : entry?.type === 'image' ? { type: entry.type, asset: entry.asset }
          : entry;
  return createHash('sha256').update(JSON.stringify(canonicalize(identity))).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function atomicWriteJson(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function assertWithin(root, target, label) {
  const relative = path.relative(realpathSync(root), realpathSync(target));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw libraryError('LIBRARY_PATH_INVALID', `La ${label} debe permanecer dentro de la raíz de assets.`);
}

function portable(value) {
  return value.split(path.sep).join('/');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function libraryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
