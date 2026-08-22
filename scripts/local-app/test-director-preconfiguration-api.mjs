import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDirectorPreconfigurationStore } from '../director/preconfiguration-store.mjs';
import { createLocalAppServer } from './server.mjs';

const catalog = {
  version: 1,
  entries: [
    { id: 'personaje-api', type: 'character', label: 'Personaje API', capabilities: { animationPresets: ['idle-calm'] } },
    { id: 'voz-api', type: 'voice', label: 'Voz API' },
    { id: 'fondo-api', type: 'background', label: 'Fondo API' },
  ],
};
const preconfiguration = {
  version: 1,
  id: 'preset-api',
  name: 'Preset API',
  structurePreference: 'one-character',
  characterBindings: [{
    roleId: 'presentador',
    characterResourceId: 'personaje-api',
    voiceResourceId: 'voz-api',
    animationPresetId: 'idle-calm',
  }],
  preferredBackgroundResourceIds: ['fondo-api'],
  backgroundStrategy: 'single-location',
  continuity: {
    preserveCharacterVoices: true,
    preserveNarratorVoice: true,
    preserveCastAcrossScenes: true,
  },
};

const temporary = await mkdtemp(path.join(tmpdir(), 'director-preconfiguration-api-'));
const persistenceRuntime = {
  backend: 'filesystem',
  diagnostic: { backend: 'filesystem', ready: true },
  libraryStorageRoot: path.join(temporary, 'library'),
  resources: null,
  projects: null,
  renderJobs: null,
  blobStorage: null,
  close: async () => {},
};
const library = {
  catalogRelative: 'assets/catalog/test.json',
  catalog: () => catalog,
};
const projects = { list: async () => [] };
const manager = {
  activeJobId: null,
  cancelActive: async () => false,
};
const store = createDirectorPreconfigurationStore({
  storageRoot: path.join(temporary, 'preconfigurations'),
  catalogProvider: () => catalog,
  now: () => '2026-08-22T12:00:00.000Z',
});
const app = await createLocalAppServer({
  port: 0,
  persistenceRuntime,
  library,
  projects,
  manager,
  directorPreconfigurations: store,
  retentionOnStartup: false,
});

try {
  const listening = await app.listen();
  const request = (pathname, options = {}) => fetch(`${listening.url}${pathname}`, {
    ...options,
    headers: {
      origin: 'http://127.0.0.1:5173',
      'x-local-video-token': app.sessionToken,
      ...(options.headers || {}),
    },
  });

  const createdResponse = await request(`/api/director/preconfigurations/${preconfiguration.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preconfiguration }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.created, true);
  assert.equal(created.revision, 1);

  const listResponse = await request('/api/director/preconfigurations');
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).preconfigurations.length, 1);

  const getResponse = await request(`/api/director/preconfigurations/${preconfiguration.id}`);
  assert.equal(getResponse.status, 200);
  assert.deepEqual((await getResponse.json()).preconfiguration, preconfiguration);

  const mismatchResponse = await request('/api/director/preconfigurations/otro-id', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preconfiguration }),
  });
  assert.equal(mismatchResponse.status, 400);

  const conflictResponse = await request(`/api/director/preconfigurations/${preconfiguration.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preconfiguration: { ...preconfiguration, name: 'Cambiado' }, expectedRevision: 9 }),
  });
  assert.equal(conflictResponse.status, 409);

  const deletedResponse = await request(`/api/director/preconfigurations/${preconfiguration.id}?expectedRevision=1`, { method: 'DELETE' });
  assert.equal(deletedResponse.status, 200);
  assert.equal((await deletedResponse.json()).removed, true);
  assert.equal((await request(`/api/director/preconfigurations/${preconfiguration.id}`)).status, 404);

  process.stdout.write('API de preconfiguraciones del Director verificada (7 casos).\n');
} finally {
  await app.close().catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
