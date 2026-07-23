import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalAppServer } from './server.mjs';
import { projectRoot } from '../stage1/common.mjs';

const project = JSON.parse(readFileSync(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'), 'utf8'));
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
const director = async ({ prompt }) => ({
  cacheHit: false,
  model: 'qwen3:8b',
  plan: { title: prompt },
  project,
  budget: { totalWords: 20, maximumWords: 60 },
});
const app = createLocalAppServer({
  port: 0,
  manager,
  director,
  ollamaInspector: async () => ({ available: true, modelInstalled: true, model: 'qwen3:8b', version: 'test' }),
});
const listening = await app.listen();
const request = (pathname, options = {}) => fetch(`${listening.url}${pathname}`, {
  ...options,
  headers: { origin: 'http://127.0.0.1:5173', ...(options.headers || {}) },
});

const healthResponse = await request('/api/health');
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.ollama.modelInstalled, true);

const proposalResponse = await request('/api/director/proposals', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'Un video educativo sobre inteligencia artificial.' }),
});
assert.equal(proposalResponse.status, 200);
assert.equal((await proposalResponse.json()).project.id, project.id);

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

const forbidden = await fetch(`${listening.url}/api/health`, {
  headers: { origin: 'https://example.com' },
});
assert.equal(forbidden.status, 403);

const missing = await request('/api/render-jobs/render-missing');
assert.equal(missing.status, 404);

await app.close();
process.stdout.write(`${JSON.stringify({ version: 1, passed: 13, failed: 0, url: listening.url })}\n`);
