import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDirectorPreconfigurationStore } from '../director/preconfiguration-store.mjs';
import { createLocalAppServer } from './server.mjs';

const catalog = {
  version: 2,
  entries: [
    { id: 'personaje-api', type: 'character', label: 'Personaje API', capabilities: { animationPresets: ['idle-calm'] } },
    { id: 'voz-api', type: 'voice', label: 'Voz API' },
    { id: 'fondo-api', type: 'background', label: 'Fondo API' },
  ],
};
const preconfiguration = {
  version: 2,
  id: 'preset-api',
  name: 'Preset API',
  structurePreference: 'one-character',
  characterBindings: [{
    roleId: 'presentador',
    characterResourceId: 'personaje-api',
    voiceResourceId: 'voz-api',
    animationPresetId: 'idle-calm',
  }],
  backgroundResourceId: 'fondo-api',
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
let receivedQuestionConstraints = null;
let receivedProposalPreconfiguration = null;
const app = await createLocalAppServer({
  port: 0,
  persistenceRuntime,
  library,
  projects,
  manager,
  directorPreconfigurations: store,
  retentionOnStartup: false,
  ollamaInspector: async () => ({ available: true, modelInstalled: true, model: 'test', version: 'test', digest: 'sha256:test' }),
  questionDirector: async ({ constraints }) => {
    receivedQuestionConstraints = constraints;
    return {
      questionContract: 2,
      cacheHit: false,
      model: 'test',
      questions: Array.from({ length: 3 }, (_, index) => ({
        id: `pregunta-${index}`,
        kind: 'choice',
        prompt: `Pregunta ${index}`,
        multiple: false,
        options: Array.from({ length: 3 }, (_unused, optionIndex) => ({ id: `opcion-${index}-${optionIndex}`, label: `Opción ${optionIndex}` })),
        otherPlaceholder: 'Otra respuesta',
      })),
    };
  },
  director: async ({ preconfiguration: selected }) => {
    receivedProposalPreconfiguration = selected;
    return {
      cacheHit: false,
      model: 'test',
      plan: { version: 2, title: 'Plan test', scenes: [] },
      project: { version: 1, id: 'project-test', title: 'Proyecto test', scenes: [] },
      budget: { totalWords: 0, maximumWords: 0 },
      selection: { bestOf: 1, winnerIndex: 0, judgeVersion: null, scores: null },
      context: { version: 2, resourceIds: [], totalCatalogEntries: 3, shortlistedEntries: 3 },
    };
  },
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
    method: 'POST',
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

  const questionsResponse = await request('/api/director/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Una idea válida', constraints: { planVersion: 2 }, preconfigurationId: preconfiguration.id }),
  });
  assert.equal(questionsResponse.status, 200);
  const questions = await questionsResponse.json();
  assert.equal(questions.preconfigurationSnapshot.preconfigurationId, preconfiguration.id);
  assert.deepEqual(receivedQuestionConstraints, { planVersion: 2, structure: 'one-character' });

  const changedResponse = await request(`/api/director/preconfigurations/${preconfiguration.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preconfiguration: { ...preconfiguration, name: 'Cambiado durante la creación' }, expectedRevision: 1 }),
  });
  assert.equal(changedResponse.status, 200);

  const proposalResponse = await request('/api/director/proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Una idea válida', constraints: { planVersion: 2 }, preconfigurationId: preconfiguration.id, preconfigurationSnapshot: questions.preconfigurationSnapshot }),
  });
  assert.equal(proposalResponse.status, 200);
  assert.deepEqual(receivedProposalPreconfiguration, preconfiguration);

  const mismatchResponse = await request('/api/director/preconfigurations/otro-id', {
    method: 'POST',
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

  const deletedResponse = await request(`/api/director/preconfigurations/${preconfiguration.id}?expectedRevision=2`, { method: 'DELETE' });
  assert.equal(deletedResponse.status, 200);
  assert.equal((await deletedResponse.json()).removed, true);
  assert.equal((await request(`/api/director/preconfigurations/${preconfiguration.id}`)).status, 404);

  const missingSelection = await request('/api/director/proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Una idea válida', constraints: { planVersion: 2 }, preconfigurationId: preconfiguration.id }),
  });
  assert.equal(missingSelection.status, 404);

  process.stdout.write('API de preconfiguraciones del Director verificada (10 casos).\n');
} finally {
  await app.close().catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
