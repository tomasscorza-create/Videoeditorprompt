import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from './common.mjs';
import { createJobContext } from './job-context.mjs';
import { publishPreview } from './publish-preview.mjs';

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'preview-publishing', stamp);
const publishRoot = path.join(testRoot, 'published');
const preview = createJobContext({
  'job-id': 'preview',
  config: 'public/scene.config.json',
  'assets-dir': 'public',
  'publish-dir': publishRoot,
});
const pilot = createJobContext({
  'job-id': 'piloto-monos-mundial-01',
  config: 'pilots/monos-mundial-01/scene.config.json',
  'assets-dir': 'public',
  'publish-dir': publishRoot,
});

const previewManifest = publishPreview(preview);
const staleFile = path.join(preview.publishRoot, 'stale.txt');
writeFileSync(staleFile, 'debe desaparecer', 'utf8');
publishPreview(preview);
assert.equal(existsSync(staleFile), false, 'Republicar debe retirar derivados obsoletos del mismo job.');
const pilotManifest = publishPreview(pilot);
const index = readJson(path.join(publishRoot, 'index.json'));
const previewPublishedConfig = readJson(path.join(preview.publishRoot, 'scene.config.json'));
const pilotPublishedConfig = readJson(path.join(pilot.publishRoot, 'scene.config.json'));
const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

const checks = {
  rootsDistinct: preview.publishRoot !== pilot.publishRoot,
  rootsInsideBase: [preview, pilot].every((context) => {
    const relative = path.relative(publishRoot, context.publishRoot);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  }),
  indexHasBothJobs: index.jobs.length === 2 && ['preview', 'piloto-monos-mundial-01'].every((jobId) => index.jobs.some((job) => job.jobId === jobId)),
  latestIsDefault: index.defaultJobId === 'piloto-monos-mundial-01',
  configurationsPreserved: previewPublishedConfig.voice.text !== pilotPublishedConfig.voice.text,
  previewFilesPresent: [preview, pilot].every((context) => ['scene.config.json', 'scene-runtime.json', 'preview-manifest.json', 'video.mp4'].every((name) => existsSync(path.join(context.publishRoot, name)))),
  sourceVideosUnchanged: [preview, pilot].every((context) => sha256File(path.join(context.resultRoot, 'render-1.mp4')) === sha256File(path.join(context.publishRoot, 'video.mp4'))),
  firstJobSurvivesSecondPublish: existsSync(path.join(preview.publishRoot, 'video.mp4')),
  manifestsPortable: JSON.stringify({ index, previewManifest, pilotManifest }).includes(projectRoot) === false,
  deterministicMetadata: previewManifest.deterministic === true && pilotManifest.deterministic === true,
};
for (const [name, passed] of Object.entries(checks)) assert.ok(passed, name);

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  testRoot: path.relative(projectRoot, testRoot).replaceAll('\\', '/'),
  passed: Object.keys(checks).length,
  failed: 0,
  checks,
  jobs: index.jobs,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'preview-publishing-latest.json'), summary);
console.log(JSON.stringify(summary, null, 2));
