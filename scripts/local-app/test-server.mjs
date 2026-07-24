import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalAppServer } from './server.mjs';
import { projectRoot } from '../stage1/common.mjs';

const project = JSON.parse(readFileSync(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'), 'utf8'));
const completedJob = {
  version: 1,
  jobId: 'render-test-01',
  projectId: project.id,
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
};
let receivedConstraints = null;
const director = async ({ prompt, signal, constraints }) => {
  receivedConstraints = constraints;
  if (prompt === 'slow') {
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
const app = createLocalAppServer({
  port: 0,
  manager,
  library,
  director,
  ollamaInspector: async () => ({ available: true, modelInstalled: true, model: 'qwen3:8b', version: 'test' }),
});
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
  }),
});
assert.equal(constrainedProposalResponse.status, 200);
assert.deepEqual(receivedConstraints, { tone: 'serious', targetDurationSeconds: 30, sceneCount: 2 });

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

const slowProposal = request('/api/director/proposals', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'slow' }),
});
await new Promise((resolve) => setImmediate(resolve));
const concurrentProposal = await request('/api/director/proposals', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'second' }),
});
assert.equal(concurrentProposal.status, 409);
const cancelSlow = await request('/api/director/cancel', { method: 'POST' });
assert.equal(cancelSlow.status, 200);
assert.equal((await cancelSlow.json()).cancelled, true);
assert.equal((await slowProposal).status, 500);

const missing = await request('/api/render-jobs/render-missing');
assert.equal(missing.status, 404);

await app.close();
process.stdout.write(`${JSON.stringify({ version: 1, passed: 32, failed: 0, url: listening.url })}\n`);
