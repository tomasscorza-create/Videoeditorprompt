import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { projectRoot } from '../stage1/common.mjs';
import { createRenderJobManager } from './render-job-manager.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'local-video-render-manager-'));
const project = JSON.parse(readFileSync(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'), 'utf8'));
let spawned = null;
const spawnImpl = (executable, args, options) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalled = false;
  child.kill = () => {
    child.killCalled = true;
    child.emit('close', null);
    return true;
  };
  spawned = { executable, args, options, child };
  return child;
};
const manager = createRenderJobManager({
  root: projectRoot,
  appJobsRoot: path.join(root, 'jobs'),
  appInputRoot: path.join(root, 'input'),
  workRoot: path.join(root, 'work'),
  outputRoot: path.join(root, 'output'),
  spawnImpl,
  renderTimeoutMs: 5000,
});

const job = manager.create(project);
assert.equal(job.state, 'rendering');
assert.equal(manager.activeJobId, job.jobId);
assert.equal(spawned.executable, process.execPath);
assert.equal(spawned.options.shell, false);
assert.equal(spawned.args.some((argument) => argument === `--job-id=${job.jobId}`), true);
assert.equal(spawned.args.some((argument) => argument.startsWith('--project=')), true);

assert.throws(
  () => manager.create(project),
  (error) => error.code === 'RENDER_BUSY',
);

spawned.child.stdout.write(`${JSON.stringify({
  version: 1,
  jobId: job.jobId,
  state: 'generating_voice',
  stage: 'generating_voice',
})}\n`);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(manager.get(job.jobId).progress.state, 'generating_voice');

const cancelled = manager.cancel(job.jobId);
assert.equal(cancelled.state, 'cancelled');
assert.equal(spawned.child.killCalled, true);
assert.equal(manager.activeJobId, null);
assert.equal(manager.video(job.jobId), null);

const failedJob = manager.create(project);
spawned.child.stdout.write(`${JSON.stringify({
  version: 1,
  jobId: failedJob.jobId,
  state: 'failed',
  stage: 'project_pipeline',
  code: 'ERR_ASSERTION',
  message: 'Duración compilada coincide',
})}\n`);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(manager.get(failedJob.jobId).state, 'rendering');
spawned.child.emit('close', 1);
const failedStatus = manager.get(failedJob.jobId);
assert.equal(failedStatus.state, 'failed');
assert.equal(failedStatus.error.code, 'ERR_ASSERTION');
assert.equal(failedStatus.error.message, 'Duración compilada coincide');

assert.throws(
  () => manager.get('../escape'),
  (error) => error.code === 'JOB_ID_INVALID',
);

process.stdout.write(`${JSON.stringify({ version: 1, passed: 19, failed: 0, jobId: job.jobId })}\n`);
