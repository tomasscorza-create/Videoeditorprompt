import assert from 'node:assert/strict';
import path from 'node:path';
import { evaluateScene } from '../../shared/scene-evaluator.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from './common.mjs';
import { createJobContext } from './job-context.mjs';
import { loadAndValidateJobConfig, validateMeasuredDuration } from './validate-scene-config.mjs';

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'character-rig', stamp);
const configRoot = ensureDirectory(path.join(testRoot, 'configs'));
const sourceConfig = path.join(projectRoot, 'pilots', 'personaje-mono-01', 'scene.config.json');
const base = readJson(sourceConfig);
const results = [];

function contextFor(name, config = base) {
  const configPath = path.join(configRoot, `${name}.json`);
  writeJson(configPath, config);
  return createJobContext({
    'job-id': `rig-${name}-${stamp}`,
    config: configPath,
    'assets-dir': path.join(projectRoot, 'public'),
    'work-dir': path.join(testRoot, 'work'),
    'output-dir': path.join(testRoot, 'output'),
  });
}

const context = contextFor('valid');
const config = loadAndValidateJobConfig(context);
assert.equal(context.characterRig.id, 'mono-presentador-v1');
assert.equal(context.characterRig.version, 1);
assert.ok(Object.values(context.resolvedAssets).every((value) => !path.isAbsolute(value)));
assert.ok(context.resolvedAssets.handNeutral && context.resolvedAssets.handPoint);
results.push({ name: 'manifest-valid-and-portable', passed: true });

assert.deepEqual(validateMeasuredDuration(config, 7), { durationSeconds: 7, frameCount: 210 });
assert.throws(() => validateMeasuredDuration(config, 3.4), (error) => error.code === 'GESTURE_OUTSIDE_AUDIO');
results.push({ name: 'gesture-measured-duration', passed: true });

const runtime = { audio: { durationSeconds: 7 }, blinks: [{ start: 0.85, end: 0.98 }] };
const mouthCues = [{ start: 0, end: 7, state: 'medium' }];
const samples = [1.99, 2, 3.49, 3.5].map((time) => evaluateScene(config, runtime, mouthCues, time));
assert.deepEqual(samples.map((sample) => sample.gesture), ['neutral', 'point', 'point', 'neutral']);
assert.equal(evaluateScene(config, runtime, mouthCues, 0.9).eyes, 'closed');
results.push({ name: 'gesture-boundaries-and-blink', passed: true });

const firstPlan = Array.from({ length: 210 }, (_, frame) => evaluateScene(config, runtime, mouthCues, frame / 30));
const secondPlan = Array.from({ length: 210 }, (_, frame) => evaluateScene(config, runtime, mouthCues, frame / 30));
assert.deepEqual(firstPlan, secondPlan);
assert.equal(firstPlan.filter((state) => state.gesture === 'point').length, 45);
results.push({ name: 'temporal-plan-deterministic', passed: true });

const overlapping = structuredClone(base);
overlapping.gestures.push({ pose: 'point', startSeconds: 3, durationSeconds: 1 });
assert.throws(() => loadAndValidateJobConfig(contextFor('overlap', overlapping)), (error) => error.code === 'CONFIG_SEMANTIC_INVALID');
results.push({ name: 'overlapping-gestures-rejected', passed: true });

const duplicatedLayers = structuredClone(base);
duplicatedLayers.assets.body = 'assets/characters/mono-presentador-v1/body.png';
assert.throws(() => loadAndValidateJobConfig(contextFor('duplicated', duplicatedLayers)), (error) => error.code === 'CONFIG_SEMANTIC_INVALID');
results.push({ name: 'manifest-and-direct-layers-rejected', passed: true });

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  manifest: base.characterManifest,
  passed: results.length,
  failed: 0,
  results,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'character-rig-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
