import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { atomicWriteJson, clone, ensureDirectory } from '../storage/filesystem-utils.mjs';

const MAX_STORE_BYTES = 512 * 1024;
const preconfigurationSchema = readJson(path.join(projectRoot, 'schema', 'director-preconfiguration.schema.json'));
const storeSchema = readJson(path.join(projectRoot, 'schema', 'director-preconfiguration-store.schema.json'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)));
ajv.addSchema(preconfigurationSchema);
const validatePreconfigurationSchema = ajv.getSchema(preconfigurationSchema.$id);
const validateStoreSchema = ajv.compile(storeSchema);

export function createDirectorPreconfigurationStore(options = {}) {
  const storageRoot = path.resolve(options.storageRoot || path.join(projectRoot, '.local-video', 'director-preconfigurations'));
  const storePath = path.join(storageRoot, 'index.json');
  const catalogProvider = options.catalogProvider;
  const now = options.now || (() => new Date().toISOString());
  let mutation = Promise.resolve();
  const ready = ensureDirectory(storageRoot);
  async function list() {
    const catalog = await resolveCatalog(catalogProvider);
    return (await readStore()).entries.map((entry) => publicRecord(entry, catalog)).sort((left, right) => left.preconfiguration.name.localeCompare(right.preconfiguration.name, 'es'));
  }
  async function get(id) {
    assertId(id);
    const entry = (await readStore()).entries.find((candidate) => candidate.preconfiguration.id === id);
    return entry ? publicRecord(entry, await resolveCatalog(catalogProvider)) : null;
  }
  async function resolve(id) {
    const record = await get(id);
    if (!record) return null;
    if (record.health.status !== 'valid') fail('DIRECTOR_PRECONFIGURATION_INCOMPLETE', 'La configuración elegida necesita repararse antes de usarla.', record.health.issues.join(' '));
    return record;
  }
  async function create(preconfiguration) { return write('create', preconfiguration); }
  async function update(preconfiguration, expectedRevision) { return write('update', preconfiguration, expectedRevision); }
  async function save(preconfiguration, expectedRevision) { return expectedRevision === undefined || expectedRevision === null ? create(preconfiguration) : update(preconfiguration, expectedRevision); }
  async function write(kind, preconfiguration, expectedRevision) {
    return serializeMutation(async () => {
      const normalized = normalizeForWrite(preconfiguration);
      validateDirectorPreconfiguration(normalized);
      const document = await readStore();
      const index = document.entries.findIndex((entry) => entry.preconfiguration.id === normalized.id);
      const existing = index < 0 ? null : document.entries[index];
      if (kind === 'create' && existing) fail('DIRECTOR_PRECONFIGURATION_ALREADY_EXISTS', 'Ya existe una configuración con ese identificador.');
      if (kind === 'update' && !existing) fail('DIRECTOR_PRECONFIGURATION_NOT_FOUND', 'La configuración ya no existe.');
      if (kind === 'update') assertExpectedRevision(existing.revision, expectedRevision);
      const timestamp = now();
      const entry = { revision: (existing?.revision || 0) + 1, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp, preconfiguration: normalized, ...(existing?.legacyPreconfiguration ? { legacyPreconfiguration: existing.legacyPreconfiguration } : {}), ...(existing?.migrationWarnings ? { migrationWarnings: existing.migrationWarnings } : {}) };
      if (existing) document.entries[index] = entry; else document.entries.push(entry);
      document.version = 2; document.entries.sort((left, right) => left.preconfiguration.id.localeCompare(right.preconfiguration.id));
      validateStoreDocument(document); await atomicWriteJson(storePath, document);
      return { created: !existing, ...publicRecord(entry, await resolveCatalog(catalogProvider)) };
    });
  }
  async function migrate(id, expectedRevision) {
    return serializeMutation(async () => {
      assertId(id);
      const document = await readStore();
      const index = document.entries.findIndex((entry) => entry.preconfiguration.id === id);
      if (index < 0) fail('DIRECTOR_PRECONFIGURATION_NOT_FOUND', 'La configuración ya no existe.');
      const existing = document.entries[index]; assertExpectedRevision(existing.revision, expectedRevision);
      const result = migrateDirectorPreconfiguration(existing.preconfiguration, await resolveCatalog(catalogProvider));
      const entry = { ...existing, revision: existing.revision + 1, updatedAt: now(), preconfiguration: result.preconfiguration, legacyPreconfiguration: existing.legacyPreconfiguration || clone(existing.preconfiguration), ...(result.warnings.length ? { migrationWarnings: result.warnings } : {}) };
      document.entries[index] = entry; document.version = 2; validateStoreDocument(document); await atomicWriteJson(storePath, document);
      return publicRecord(entry, await resolveCatalog(catalogProvider));
    });
  }
  async function remove(id, expectedRevision) {
    return serializeMutation(async () => {
      assertId(id); const document = await readStore(); const index = document.entries.findIndex((entry) => entry.preconfiguration.id === id);
      if (index < 0) return false;
      assertExpectedRevision(document.entries[index].revision, expectedRevision);
      document.entries.splice(index, 1); document.version = 2; await atomicWriteJson(storePath, document); return true;
    });
  }
  async function readStore() {
    await ready; if (!existsSync(storePath)) return { version: 2, entries: [] };
    try {
      const source = await readFile(storePath);
      if (source.byteLength > MAX_STORE_BYTES) fail('DIRECTOR_PRECONFIGURATION_STORE_INVALID', 'El archivo de configuraciones supera el límite permitido.');
      const document = JSON.parse(source.toString('utf8')); validateStoreDocument(document); return clone(document);
    } catch (error) {
      if (error?.code?.startsWith('DIRECTOR_PRECONFIGURATION_')) throw error;
      fail('DIRECTOR_PRECONFIGURATION_STORE_INVALID', 'El archivo de configuraciones no contiene JSON válido.');
    }
  }
  function serializeMutation(operation) { const result = mutation.then(operation, operation); mutation = result.catch(() => {}); return result; }
  return { storageRoot, storePath, list, get, resolve, create, update, save, migrate, remove };
}

export function migrateDirectorPreconfiguration(value, catalog) {
  if (value?.version === 2) return { preconfiguration: clone(value), warnings: [] };
  if (value?.version !== 1) fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La versión de configuración no puede migrarse.');
  const warnings = value.backgroundStrategy === 'beat-variation' ? ['La variación de fondo por beat se convirtió en un único fondo global.'] : [];
  const resources = new Map((catalog?.entries || []).map((entry) => [entry.id, entry]));
  return { preconfiguration: { version: 2, id: value.id, name: value.name, ...(value.description ? { description: value.description } : {}), ...(value.structurePreference ? { structurePreference: value.structurePreference } : {}), ...(value.richnessProfile ? { richnessProfile: value.richnessProfile } : {}), characterBindings: value.characterBindings.map((binding) => ({ ...binding, animationPresetId: binding.animationPresetId || resources.get(binding.characterResourceId)?.capabilities?.animationPresets?.[0] || 'idle-calm' })), ...(value.narratorVoiceResourceId ? { narratorVoiceResourceId: value.narratorVoiceResourceId } : {}), backgroundResourceId: value.preferredBackgroundResourceIds[0] }, warnings };
}
export function validateDirectorPreconfiguration(preconfiguration) {
  if (!validatePreconfigurationSchema(preconfiguration)) fail('DIRECTOR_PRECONFIGURATION_INVALID', schemaMessage(validatePreconfigurationSchema.errors));
  if (preconfiguration.version !== 2) return clone(preconfiguration);
  const roles = new Set(); const characters = new Set(); const voices = new Set();
  for (const binding of preconfiguration.characterBindings) {
    if (!binding.animationPresetId) fail('DIRECTOR_PRECONFIGURATION_INVALID', 'Cada personaje necesita una animación predeterminada.');
    if (roles.has(binding.roleId) || characters.has(binding.characterResourceId) || voices.has(binding.voiceResourceId)) fail('DIRECTOR_PRECONFIGURATION_INVALID', 'Cada rol, personaje y voz del reparto debe ser único.');
    roles.add(binding.roleId); characters.add(binding.characterResourceId); voices.add(binding.voiceResourceId);
  }
  if (preconfiguration.structurePreference === 'one-character' && preconfiguration.characterBindings.length < 1) fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La estructura de un personaje necesita un reparto.');
  if (preconfiguration.structurePreference === 'dialogue' && preconfiguration.characterBindings.length < 2) fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La estructura de diálogo necesita dos personajes.');
  if (preconfiguration.structurePreference === 'narration' && !preconfiguration.narratorVoiceResourceId) fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La estructura de narración necesita una voz narradora.');
  return clone(preconfiguration);
}
export function evaluateDirectorPreconfigurationHealth(preconfiguration, catalog) {
  const issues = [];
  try { validateDirectorPreconfiguration(preconfiguration); } catch (error) { issues.push(error.message); }
  if (!catalog || !Array.isArray(catalog.entries)) return { status: 'incompatible', issues: ['No hay un catálogo válido para comprobar la configuración.'] };
  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const expect = (id, type, label) => { const resource = byId.get(id); if (!resource) issues.push(label + ' «' + id + '» ya no existe.'); else if (type && resource.type !== type) issues.push(label + ' «' + id + '» no es un recurso ' + type + '.'); return resource; };
  if (preconfiguration.version !== 2) issues.push('La configuración usa el contrato V1 y debe migrarse.');
  else {
    expect(preconfiguration.backgroundResourceId, 'background', 'El fondo');
    for (const binding of preconfiguration.characterBindings) {
      const character = expect(binding.characterResourceId, 'character', 'El personaje'); expect(binding.voiceResourceId, 'voice', 'La voz');
      if (character && !character.capabilities?.animationPresets?.includes(binding.animationPresetId)) issues.push('El personaje «' + binding.characterResourceId + '» no admite «' + binding.animationPresetId + '».');
    }
    if (preconfiguration.narratorVoiceResourceId) expect(preconfiguration.narratorVoiceResourceId, 'voice', 'La voz narradora');
  }
  return { status: issues.length ? 'incomplete' : 'valid', issues };
}
function normalizeForWrite(value) { if (value?.version !== 2) fail('DIRECTOR_PRECONFIGURATION_VERSION_INVALID', 'Las configuraciones nuevas deben usar el contrato V2.'); return clone(value); }
function validateStoreDocument(document) { if (!validateStoreSchema(document)) fail('DIRECTOR_PRECONFIGURATION_STORE_INVALID', schemaMessage(validateStoreSchema.errors)); const ids = new Set(); for (const entry of document.entries) { if (ids.has(entry.preconfiguration.id)) fail('DIRECTOR_PRECONFIGURATION_STORE_INVALID', 'Hay una configuración duplicada.'); ids.add(entry.preconfiguration.id); } }
function assertId(id) { if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u.test(id)) fail('DIRECTOR_PRECONFIGURATION_INVALID', 'El identificador de la configuración no es válido.'); }
function assertExpectedRevision(current, expected) { if (!Number.isInteger(expected) || expected < 1) fail('DIRECTOR_PRECONFIGURATION_REVISION_REQUIRED', 'La actualización necesita la revisión que se leyó.'); if (current !== expected) fail('DIRECTOR_PRECONFIGURATION_REVISION_CONFLICT', 'La configuración cambió desde la revisión esperada.'); }
async function resolveCatalog(provider) { return typeof provider === 'function' ? provider() : provider; }
function publicRecord(entry, catalog) { return { ...clone(entry), health: evaluateDirectorPreconfigurationHealth(entry.preconfiguration, catalog) }; }
function schemaMessage(errors = []) { const first = errors[0]; return first ? 'La configuración no cumple el contrato.' : 'La configuración no cumple el contrato.'; }
function fail(code, message, technicalDetail) { const error = new Error(message); error.code = code; if (technicalDetail) error.technicalDetail = technicalDetail; throw error; }
