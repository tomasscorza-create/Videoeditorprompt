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
ajv.addFormat('date-time', (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
  && Number.isFinite(Date.parse(value)));
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
    const document = await readStore();
    return document.entries
      .map(publicRecord)
      .sort((left, right) => left.preconfiguration.name.localeCompare(right.preconfiguration.name, 'es'));
  }

  async function get(id) {
    assertId(id);
    const document = await readStore();
    const entry = document.entries.find((candidate) => candidate.preconfiguration.id === id);
    return entry ? publicRecord(entry) : null;
  }

  async function resolve(id) {
    const record = await get(id);
    if (!record) return null;
    validateDirectorPreconfiguration(record.preconfiguration, await resolveCatalog(catalogProvider));
    return record;
  }

  async function save(preconfiguration, expectedRevision) {
    return serializeMutation(async () => {
      validateDirectorPreconfiguration(preconfiguration, await resolveCatalog(catalogProvider));
      const document = await readStore();
      const index = document.entries.findIndex((entry) => entry.preconfiguration.id === preconfiguration.id);
      const existing = index >= 0 ? document.entries[index] : null;
      assertExpectedRevision(existing?.revision, expectedRevision);
      const timestamp = now();
      const entry = {
        revision: (existing?.revision || 0) + 1,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
        preconfiguration: clone(preconfiguration),
      };
      if (existing) document.entries[index] = entry;
      else document.entries.push(entry);
      document.entries.sort((left, right) => left.preconfiguration.id.localeCompare(right.preconfiguration.id));
      validateStoreDocument(document);
      await atomicWriteJson(storePath, document);
      return { created: !existing, ...publicRecord(entry) };
    });
  }

  async function remove(id, expectedRevision) {
    return serializeMutation(async () => {
      assertId(id);
      const document = await readStore();
      const index = document.entries.findIndex((entry) => entry.preconfiguration.id === id);
      if (index < 0) return false;
      assertExpectedRevision(document.entries[index].revision, expectedRevision);
      document.entries.splice(index, 1);
      await atomicWriteJson(storePath, document);
      return true;
    });
  }

  async function readStore() {
    await ready;
    if (!existsSync(storePath)) return { version: 1, entries: [] };
    let source;
    try {
      source = await readFile(storePath);
      if (source.byteLength > MAX_STORE_BYTES) fail('DIRECTOR_PRECONFIGURATION_STORE_INVALID', 'El archivo de preconfiguraciones supera el límite permitido.');
      const document = JSON.parse(source.toString('utf8'));
      validateStoreDocument(document);
      return clone(document);
    } catch (error) {
      if (error?.code?.startsWith('DIRECTOR_PRECONFIGURATION_')) throw error;
      fail('DIRECTOR_PRECONFIGURATION_STORE_INVALID', 'El archivo de preconfiguraciones no contiene JSON válido.');
    }
  }

  function serializeMutation(operation) {
    const result = mutation.then(operation, operation);
    mutation = result.catch(() => {});
    return result;
  }

  return { storageRoot, storePath, list, get, resolve, save, remove };
}

export function validateDirectorPreconfiguration(preconfiguration, catalog) {
  if (!validatePreconfigurationSchema(preconfiguration)) {
    fail('DIRECTOR_PRECONFIGURATION_INVALID', schemaMessage(validatePreconfigurationSchema.errors));
  }
  if (!catalog || !Array.isArray(catalog.entries)) {
    fail('DIRECTOR_PRECONFIGURATION_CATALOG_INVALID', 'No hay un catálogo de recursos válido para comprobar la preconfiguración.');
  }
  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const roles = new Set();
  const characters = new Set();
  const voices = new Set();
  for (const binding of preconfiguration.characterBindings) {
    if (roles.has(binding.roleId)) fail('DIRECTOR_PRECONFIGURATION_INVALID', `El rol ${binding.roleId} está repetido.`);
    if (characters.has(binding.characterResourceId)) fail('DIRECTOR_PRECONFIGURATION_INVALID', `El personaje ${binding.characterResourceId} está repetido.`);
    if (voices.has(binding.voiceResourceId)) fail('DIRECTOR_PRECONFIGURATION_INVALID', `La voz ${binding.voiceResourceId} está asignada a más de un personaje.`);
    roles.add(binding.roleId);
    characters.add(binding.characterResourceId);
    voices.add(binding.voiceResourceId);
    const character = assertResource(byId, binding.characterResourceId, 'character');
    assertResource(byId, binding.voiceResourceId, 'voice');
    if (binding.animationPresetId && !character.capabilities?.animationPresets?.includes(binding.animationPresetId)) {
      fail('DIRECTOR_PRECONFIGURATION_INVALID', `El personaje ${binding.characterResourceId} no admite la animación ${binding.animationPresetId}.`);
    }
  }
  if (preconfiguration.narratorVoiceResourceId) assertResource(byId, preconfiguration.narratorVoiceResourceId, 'voice');
  if (preconfiguration.characterBindings.length === 0 && !preconfiguration.narratorVoiceResourceId) {
    fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La preconfiguración necesita una voz narradora o al menos un vínculo personaje-voz.');
  }
  for (const id of preconfiguration.preferredBackgroundResourceIds) assertResource(byId, id, 'background');
  if (preconfiguration.backgroundStrategy === 'single-location' && preconfiguration.preferredBackgroundResourceIds.length !== 1) {
    fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La estrategia de locación única requiere exactamente un fondo.');
  }
  if (preconfiguration.backgroundStrategy === 'beat-variation' && preconfiguration.preferredBackgroundResourceIds.length < 2) {
    fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La variación por beats requiere al menos dos fondos.');
  }
  if (preconfiguration.structurePreference === 'one-character' && preconfiguration.characterBindings.length < 1) {
    fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La estructura de un personaje requiere al menos un vínculo personaje-voz.');
  }
  if (preconfiguration.structurePreference === 'dialogue' && preconfiguration.characterBindings.length < 2) {
    fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La estructura de diálogo requiere al menos dos vínculos personaje-voz.');
  }
  if (preconfiguration.structurePreference === 'narration' && !preconfiguration.narratorVoiceResourceId) {
    fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La estructura de narración requiere una voz narradora.');
  }
  return clone(preconfiguration);
}

function validateStoreDocument(document) {
  if (!validateStoreSchema(document)) fail('DIRECTOR_PRECONFIGURATION_STORE_INVALID', schemaMessage(validateStoreSchema.errors));
  const ids = new Set();
  for (const entry of document.entries) {
    const id = entry.preconfiguration.id;
    if (ids.has(id)) fail('DIRECTOR_PRECONFIGURATION_STORE_INVALID', `La preconfiguración ${id} está duplicada.`);
    ids.add(id);
  }
}

function assertResource(byId, id, type) {
  const resource = byId.get(id);
  if (!resource || resource.type !== type) fail('DIRECTOR_PRECONFIGURATION_RESOURCE_INVALID', `El recurso ${id} no existe o no es de tipo ${type}.`);
  return resource;
}

function assertId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u.test(id)) {
    fail('DIRECTOR_PRECONFIGURATION_INVALID', 'El identificador de la preconfiguración no es válido.');
  }
}

function assertExpectedRevision(current, expected) {
  if (expected === undefined || expected === null) return;
  if (!Number.isInteger(expected) || expected < 1) fail('DIRECTOR_PRECONFIGURATION_INVALID', 'La revisión esperada no es válida.');
  if (current !== expected) fail('DIRECTOR_PRECONFIGURATION_REVISION_CONFLICT', 'La preconfiguración cambió desde la revisión esperada.');
}

async function resolveCatalog(provider) {
  const catalog = typeof provider === 'function' ? await provider() : provider;
  return catalog;
}

function publicRecord(entry) {
  return clone(entry);
}

function schemaMessage(errors = []) {
  const first = errors[0];
  return first ? `La preconfiguración no cumple el contrato (${first.instancePath || '/'} ${first.message}).` : 'La preconfiguración no cumple el contrato.';
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
