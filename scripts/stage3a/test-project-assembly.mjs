import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRoot, writeJson } from '../stage1/common.mjs';
import { buildAssemblyPlan } from './project-pipeline.mjs';

const results = [];

const fade = buildAssemblyPlan([
  { id: 'scene-a', renderDurationSeconds: 10, transitionToNext: { preset: 'fade', durationSeconds: 0.5 } },
  { id: 'scene-b', renderDurationSeconds: 8 },
]);
assert.equal(fade.durationSeconds, 17.5);
assert.equal(fade.scenes[1].startSeconds, 9.5);
assert.equal(fade.scenes[0].transitionToNext.startSeconds, 9.5);
assert.ok(fade.filters.some((filter) => filter.includes('xfade=transition=fade')));
assert.ok(fade.filters.some((filter) => filter.includes('acrossfade=d=0.5')));
results.push({ name: 'fade-overlaps-video-and-audio', passed: true });

const cut = buildAssemblyPlan([
  { id: 'scene-a', renderDurationSeconds: 4, transitionToNext: { preset: 'cut', durationSeconds: 0 } },
  { id: 'scene-b', renderDurationSeconds: 3 },
]);
assert.equal(cut.durationSeconds, 7);
assert.equal(cut.scenes[1].startSeconds, 4);
assert.ok(cut.filters.filter((filter) => filter.includes('concat=n=2')).length === 2);
results.push({ name: 'cut-concatenates-without-overlap', passed: true });

const mixed = buildAssemblyPlan([
  { id: 'scene-a', renderDurationSeconds: 5, transitionToNext: { preset: 'fade', durationSeconds: 0.25 } },
  { id: 'scene-b', renderDurationSeconds: 4, transitionToNext: { preset: 'cut', durationSeconds: 0 } },
  { id: 'scene-c', renderDurationSeconds: 3 },
]);
assert.equal(mixed.durationSeconds, 11.75);
assert.deepEqual(mixed.scenes.map((scene) => scene.startSeconds), [0, 4.75, 8.75]);
results.push({ name: 'mixed-transitions-preserve-timeline', passed: true });

assert.throws(() => buildAssemblyPlan([
  { id: 'scene-a', renderDurationSeconds: 1, transitionToNext: { preset: 'fade', durationSeconds: 1 } },
  { id: 'scene-b', renderDurationSeconds: 2 },
]), (error) => error.code === 'PROJECT_TRANSITION_INVALID');
results.push({ name: 'fade-must-fit-both-scenes', passed: true });

assert.throws(() => buildAssemblyPlan([]), (error) => error.code === 'PROJECT_SCENES_EMPTY');
results.push({ name: 'empty-project-rejected', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'project-assembly-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
