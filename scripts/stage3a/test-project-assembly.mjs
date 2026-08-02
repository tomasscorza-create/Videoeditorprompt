import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRoot, writeJson } from '../stage1/common.mjs';
import { buildAssemblyPlan, buildRenderedTurnTimeline, sceneCacheKey } from './project-pipeline.mjs';

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

const renderedTurns = buildRenderedTurnTimeline([
  { id: 'turn-a', speakerId: 'speaker-a', startSeconds: 0, endSeconds: 1.25, durationSeconds: 1.25, gapAfterSeconds: 0.5 },
  { id: 'turn-b', speakerId: 'speaker-b', startSeconds: 1.75, endSeconds: 3, durationSeconds: 1.25, gapAfterSeconds: 0 },
], 9.5, 3);
assert.deepEqual(renderedTurns, [
  { id: 'turn-a', speakerId: 'speaker-a', startSeconds: 9.5, endSeconds: 10.75, durationSeconds: 1.25, gapAfterSeconds: 0.5 },
  { id: 'turn-b', speakerId: 'speaker-b', startSeconds: 11.25, endSeconds: 12.5, durationSeconds: 1.25, gapAfterSeconds: 0 },
]);
results.push({ name: 'turn-timeline-uses-absolute-project-time', passed: true });

assert.throws(() => buildRenderedTurnTimeline([
  { id: 'turn-a', speakerId: 'speaker-a', startSeconds: 0, endSeconds: 1, durationSeconds: 1, gapAfterSeconds: 0.5 },
  { id: 'turn-b', speakerId: 'speaker-b', startSeconds: 1.25, endSeconds: 2, durationSeconds: 0.75, gapAfterSeconds: 0 },
], 0, 2), (error) => error.code === 'RENDERED_TURN_TIMELINE_INVALID');
results.push({ name: 'turn-timeline-rejects-inconsistent-gaps', passed: true });

const cacheManifest = {
  video: { width: 1080, height: 1920, fps: 30 },
  catalogSha256: 'a'.repeat(64),
  sourceHashes: [{ path: 'assets/character.png', sha256: 'b'.repeat(64) }],
};
const cacheScene = { configSha256: 'c'.repeat(64) };
const cacheKey = sceneCacheKey(cacheManifest, cacheScene, 'scene-001-a', 'interactive');
assert.equal(cacheKey, sceneCacheKey(structuredClone(cacheManifest), structuredClone(cacheScene), 'scene-001-a', 'interactive'));
results.push({ name: 'scene-cache-key-is-deterministic', passed: true });
assert.notEqual(cacheKey, sceneCacheKey(cacheManifest, { configSha256: 'd'.repeat(64) }, 'scene-001-a', 'interactive'));
results.push({ name: 'scene-cache-invalidates-visual-change', passed: true });
assert.notEqual(cacheKey, sceneCacheKey({ ...cacheManifest, sourceHashes: [{ path: 'assets/character.png', sha256: 'e'.repeat(64) }] }, cacheScene, 'scene-001-a', 'interactive'));
results.push({ name: 'scene-cache-invalidates-resource-change', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'project-assembly-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
