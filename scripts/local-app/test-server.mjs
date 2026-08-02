import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalAppServer } from './server.mjs';
import { projectRoot } from '../stage1/common.mjs';

const project = JSON.parse(readFileSync(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'), 'utf8'));
const completedJob = {
  version: 1,
  jobId: 'render-test-01',
  projectId: project.id,
  projectRevision: 'project-v1-test',
  state: 'completed',
  stage: 'project_pipeline',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  progress: null,
  error: null,
  result: {
    durationSeconds: 10,
    scenes: 2,
    deterministic: true,
    videoUrl: '/api/render-jobs/render-test-01/video',
    downloadName: 'test.mp4',
  },
};
const manager = {
  activeJobId: null,
  create: (value) => {
    assert.equal(value.id, project.id);
    return { ...completedJob, state: 'queued' };
  },
  get: (id) => id === completedJob.jobId ? completedJob : null,
  list: () => [completedJob],
  cancel: (id) => id === completedJob.jobId ? { ...completedJob, state: 'cancelled' } : null,
  video: () => null,
};
const library = {
  catalogRelative: project.resourceCatalog,
  catalog: () => catalog,
  list: () => catalog.entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    label: entry.label,
    origin: 'builtin',
    entry,
  })),
  register: (entry) => ({
    created: true,
    resource: { id: entry.id, type: entry.type, label: entry.label, origin: 'local', entry },
  }),
  importBackground: ({ bytes, mimeType, fileName }) => {
    assert.ok(bytes.length > 0);
    assert.equal(mimeType, 'image/png');
    assert.equal(fileName, 'fondo prueba.png');
    return {
      created: true,
      resource: { id: 'fondo-local-prueba', type: 'background', label: 'fondo prueba', origin: 'local' },
      image: { width: 1080, height: 1920, mimeType, bytes: bytes.length },
    };
  },
  characterDesigns: () => [{
    id: 'personaje-local-prueba',
    name: 'Personaje prueba',
    design: { version: 1, preset: 'mono-parametrico-v1' },
    thumbnail: '/assets/library/characters/personaje-local-prueba/pose_neutral.png',
  }],
  saveCharacterDesign: (design) => ({
    created: true,
    resource: {
      id: 'personaje-local-prueba',
      type: 'character',
      label: design.name,
      origin: 'local',
    },
  }),
};
let receivedConstraints = null;
let receivedGenerationOptions = null;
let receivedModelIdentity = null;
const director = async ({ prompt, signal, constraints, think, bestOf, modelIdentity, onProgress }) => {
  receivedConstraints = constraints;
  receivedGenerationOptions = { think, bestOf };
  receivedModelIdentity = modelIdentity;
  onProgress?.({ stage: 'preparing_context' });
  if (prompt === 'slow') {
    onProgress?.({ stage: 'generating', candidateIndex: 1, candidateCount: 1, attempt: 1 });
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
    });
  }
  return {
    cacheHit: false,
    model: 'qwen3:8b',
    plan: { title: prompt },
    project,
    budget: { totalWords: 20, maximumWords: 60 },
  };
};
let savedProject = project;
let savedRevision = 'a'.repeat(64);
const projects = {
  list: () => [{
    id: savedProject.id,
    title: savedProject.title,
    scenes: savedProject.scenes.length,
    revision: savedRevision,
    updatedAt: new Date(0).toISOString(),
  }],
  get: (id) => {
    if (id !== savedProject.id) throw Object.assign(new Error('No existe.'), { code: 'PROJECT_NOT_FOUND' });
    return { project: savedProject, revision: savedRevision };
  },
  save: (value, expectedRevision) => {
    if (expectedRevision && expectedRevision !== savedRevision) {
      throw Object.assign(new Error('Conflicto de revisión.'), { code: 'PROJECT_REVISION_CONFLICT' });
    }
    savedProject = value;
    savedRevision = 'b'.repeat(64);
    return {
      created: false,
      project: value,
      revision: savedRevision,
      summary: {
        id: value.id,
        title: value.title,
        scenes: value.scenes.length,
        revision: savedRevision,
        updatedAt: new Date(0).toISOString(),
      },
    };
  },
  remove: (id) => id === savedProject.id,
};
const app = await createLocalAppServer({
  port: 0,
  manager,
  library,
  director,
  projectDirector: async ({ instruction, project: value }) => ({
    version: 1,
    model: 'qwen3:8b',
    cacheHit: false,
    commands: [{ type: 'set-project-title', title: instruction }],
    project: { ...value, title: instruction },
  }),
  projects,
  ollamaInspector: async () => ({
    available: true,
    modelInstalled: true,
    model: 'qwen3:8b',
    version: 'test',
    digest: 'sha256:qwen3-test',
  }),
});
assert.equal(app.persistence, 'filesystem');
await assert.rejects(
  () => createLocalAppServer({ persistence: 'unknown-backend' }),
  (error) => error.code === 'PERSISTENCE_BACKEND_UNSUPPORTED',
);
const listening = await app.listen();
const request = (pathname, options = {}) => fetch(`${listening.url}${pathname}`, {
  ...options,
  headers: {
    origin: 'http://127.0.0.1:5173',
    'x-local-video-token': app.sessionToken,
    ...(options.headers || {}),
  },
});

const healthResponse = await request('/api/health');
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.ollama.modelInstalled, true);

const libraryResponse = await request('/api/library/resources');
assert.equal(libraryResponse.status, 200);
assert.equal((await libraryResponse.json()).resources.length, catalog.entries.length);

const catalogResponse = await request('/api/library/catalog');
assert.equal(catalogResponse.status, 200);
assert.equal((await catalogResponse.json()).catalog.entries.length, catalog.entries.length);

const designsResponse = await request('/api/library/character-designs');
assert.equal(designsResponse.status, 200);
assert.equal((await designsResponse.json()).designs[0].id, 'personaje-local-prueba');

const libraryEntry = {
  id: 'voz-servidor-prueba',
  type: 'voice',
  label: 'Voz servidor prueba',
};
const registerResponse = await request('/api/library/resources', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ entry: libraryEntry }),
});
assert.equal(registerResponse.status, 201);
assert.equal((await registerResponse.json()).resource.id, libraryEntry.id);

const backgroundResponse = await request('/api/library/backgrounds', {
  method: 'POST',
  headers: {
    'content-type': 'image/png',
    'x-resource-file-name': encodeURIComponent('fondo prueba.png'),
  },
  body: Buffer.from([137, 80, 78, 71]),
});
assert.equal(backgroundResponse.status, 201);
assert.equal((await backgroundResponse.json()).resource.type, 'background');

const unsupportedBackgroundResponse = await request('/api/library/backgrounds', {
  method: 'POST',
  headers: { 'content-type': 'image/gif' },
  body: Buffer.from('GIF89a'),
});
assert.equal(unsupportedBackgroundResponse.status, 400);

const characterResponse = await request('/api/library/characters', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ design: { name: 'Personaje prueba' } }),
});
assert.equal(characterResponse.status, 201);
assert.equal((await characterResponse.json()).resource.type, 'character');

const proposalResponse = await request('/api/director/proposals', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'Un video educativo sobre inteligencia artificial.' }),
});
assert.equal(proposalResponse.status, 200);
assert.equal((await proposalResponse.json()).project.id, project.id);

const constrainedProposalResponse = await request('/api/director/proposals', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    prompt: 'Una propuesta seria.',
    constraints: { tone: 'serious', targetDurationSeconds: 30, sceneCount: 2 },
    think: true,
    bestOf: 2,
  }),
});
assert.equal(constrainedProposalResponse.status, 200);
assert.deepEqual(receivedConstraints, { tone: 'serious', targetDurationSeconds: 30, sceneCount: 2 });
assert.deepEqual(receivedGenerationOptions, { think: true, bestOf: 2 });
assert.deepEqual(receivedModelIdentity, { digest: 'sha256:qwen3-test', runtimeVersion: 'test' });

const editResponse = await request('/api/director/edits', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ instruction: 'Título editado', project }),
});
assert.equal(editResponse.status, 200);
assert.equal((await editResponse.json()).commands[0].type, 'set-project-title');

const projectsResponse = await request('/api/projects');
assert.equal(projectsResponse.status, 200);
assert.equal((await projectsResponse.json()).projects[0].id, project.id);

const projectResponse = await request(`/api/projects/${project.id}`);
assert.equal(projectResponse.status, 200);
assert.equal((await projectResponse.json()).project.id, project.id);

const saveProjectResponse = await request(`/api/projects/${project.id}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ project: { ...project, title: 'Guardado durable' } }),
});
assert.equal(saveProjectResponse.status, 200);
assert.equal((await saveProjectResponse.json()).summary.title, 'Guardado durable');

const staleProjectResponse = await request(`/api/projects/${project.id}`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ project, expectedRevision: 'a'.repeat(64) }),
});
assert.equal(staleProjectResponse.status, 409);

const validationResponse = await request('/api/projects/validate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ project }),
});
assert.equal(validationResponse.status, 200);
assert.equal((await validationResponse.json()).valid, true);

const renderResponse = await request('/api/render-jobs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ project }),
});
assert.equal(renderResponse.status, 202);

const statusResponse = await request(`/api/render-jobs/${completedJob.jobId}`);
assert.equal(statusResponse.status, 200);
assert.equal((await statusResponse.json()).state, 'completed');

const forbidden = await fetch(`${listening.url}/api/render-jobs`, {
  method: 'POST',
  headers: {
    origin: 'https://example.com',
    'x-local-video-token': app.sessionToken,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ project }),
});
assert.equal(forbidden.status, 403);

const missingOrigin = await fetch(`${listening.url}/api/render-jobs`, {
  method: 'POST',
  headers: { 'x-local-video-token': app.sessionToken, 'content-type': 'application/json' },
  body: JSON.stringify({ project }),
});
assert.equal(missingOrigin.status, 403);

const badToken = await fetch(`${listening.url}/api/render-jobs`, {
  method: 'POST',
  headers: { origin: 'http://127.0.0.1:5173', 'x-local-video-token': 'wrong', 'content-type': 'application/json' },
  body: JSON.stringify({ project }),
});
assert.equal(badToken.status, 403);

const badContentType = await request('/api/render-jobs', { method: 'POST', body: JSON.stringify({ project }) });
assert.equal(badContentType.status, 400);

const badHostStatus = await new Promise((resolve, reject) => {
  const target = new URL('/api/health', listening.url);
  const hostRequest = http.request({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    headers: { host: 'example.com' },
  }, (response) => {
    response.resume();
    response.on('end', () => resolve(response.statusCode));
  });
  hostRequest.on('error', reject);
  hostRequest.end();
});
assert.equal(badHostStatus, 403);

const cancelDirector = await request('/api/director/cancel', { method: 'POST' });
assert.equal(cancelDirector.status, 200);
assert.equal((await cancelDirector.json()).cancelled, false);
const idleDirectorStatus = await request('/api/director/status');
assert.equal(idleDirectorStatus.status, 200);
assert.deepEqual(
  (({ state, stage }) => ({ state, stage }))(await idleDirectorStatus.json()),
  { state: 'idle', stage: 'idle' },
);

const slowProposal = request('/api/director/proposals', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'slow' }),
});
await new Promise((resolve) => setImmediate(resolve));
const runningDirectorStatus = await request('/api/director/status');
assert.deepEqual(
  (({ state, stage, candidateIndex, candidateCount, attempt }) => ({ state, stage, candidateIndex, candidateCount, attempt }))(await runningDirectorStatus.json()),
  { state: 'running', stage: 'generating', candidateIndex: 1, candidateCount: 1, attempt: 1 },
);
const concurrentProposal = await request('/api/director/proposals', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'second' }),
});
assert.equal(concurrentProposal.status, 409);
const concurrentError = (await concurrentProposal.json()).error;
assert.equal(concurrentError.code, 'DIRECTOR_BUSY');
assert.match(concurrentError.suggestedAction, /cancelá/u);
const cancelSlow = await request('/api/director/cancel', { method: 'POST' });
assert.equal(cancelSlow.status, 200);
assert.equal((await cancelSlow.json()).cancelled, true);
assert.equal((await slowProposal).status, 500);
const finalDirectorStatus = await request('/api/director/status');
assert.equal((await finalDirectorStatus.json()).state, 'idle');

const missing = await request('/api/render-jobs/render-missing');
assert.equal(missing.status, 404);

// Medición: el endpoint corre el medidor de verdad en un proceso aparte y
// devuelve los mismos tiempos que produciría un render, sin producir un MP4.
// Sin runtime de voz local no hay nada que medir y la prueba se omite.
const ttsRoot = process.env.LOCAL_VIDEO_TTS_ROOT || 'C:\\LocalVideoTTS';
let medicionProbada = 0;
if (existsSync(ttsRoot)) {
  const medicion = await request('/api/measurements', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  assert.equal(medicion.status, 200);
  const cuerpo = await medicion.json();
  assert.equal(cuerpo.projectId, project.id);
  assert.equal(cuerpo.timeline.scenes.length, project.scenes.length);
  assert.equal(cuerpo.timeline.durationSeconds > 0, true);
  assert.match(cuerpo.audioUrl, /^\/api\/measurement-audio\/measure-/u);
  const previewAudio = await request(cuerpo.audioUrl);
  assert.equal(previewAudio.status, 200);
  assert.match(previewAudio.headers.get('content-type'), /^audio\/wav/u);
  assert.equal((await previewAudio.arrayBuffer()).byteLength > 44, true);
  // Cada escena trae sus turnos medidos, que es lo que la timeline necesita
  // para ubicar el cabezal, un keyframe o un corte.
  for (const scene of cuerpo.timeline.scenes) {
    assert.equal(Array.isArray(scene.turns) && scene.turns.length >= 2, true);
    assert.equal(scene.endSeconds > scene.startSeconds, true);
  }
  // No debe existir un MP4: medir no renderiza.
  assert.equal(Object.hasOwn(cuerpo, 'videoUrl'), false);
  medicionProbada = 9;
}

// Un proyecto inválido no llega a gastar Piper.
const medicionInvalida = await request('/api/measurements', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ project: { id: 'roto' } }),
});
assert.equal(medicionInvalida.status >= 400, true);

await app.close();
process.stdout.write(`${JSON.stringify({ version: 1, passed: 48 + medicionProbada, failed: 0, url: listening.url })}\n`);
