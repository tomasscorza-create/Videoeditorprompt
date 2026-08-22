import assert from 'node:assert/strict';
import path from 'node:path';
import { evaluateScene } from '../../shared/scene-evaluator.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from './common.mjs';
import { createJobContext } from './job-context.mjs';
import { loadAndValidateJobConfig } from './validate-scene-config.mjs';

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'background-animation', stamp);
const configRoot = ensureDirectory(path.join(testRoot, 'configs'));
const source = readJson(path.join(projectRoot, 'pilots', 'fondo-parallax-01', 'scene.config.json'));
const results = [];

function contextFor(name, config = source) {
  const configPath = path.join(configRoot, `${name}.json`);
  writeJson(configPath, config);
  return createJobContext({
    'job-id': `background-${name}-${stamp}`,
    config: configPath,
    'assets-dir': path.join(projectRoot, 'public'),
    'work-dir': path.join(testRoot, 'work'),
    'output-dir': path.join(testRoot, 'output'),
  });
}

const context = contextFor('valid');
const config = loadAndValidateJobConfig(context);
assert.equal(context.resolvedBackgroundAnimation.layers.length, 3);
assert.ok(context.resolvedBackgroundAnimation.layers.every((layer) => !path.isAbsolute(layer.asset)));
results.push({ name: 'three-portable-layers', passed: true });

const runtime = {
  audio: { durationSeconds: 10 },
  backgroundAnimation: context.resolvedBackgroundAnimation,
  characters: config.characters.map((character) => ({ id: character.id, transform: character.transform, blinks: [] })),
};
const dialogue = { turns: [] };
const start = evaluateScene(config, runtime, dialogue, 0).background;
const middle = evaluateScene(config, runtime, dialogue, 5).background;
const end = evaluateScene(config, runtime, dialogue, 10).background;
assert.deepEqual(start.camera, { x: -35, y: 6, zoom: 1 });
assert.equal(middle.camera.x, 0);
assert.deepEqual(end.camera, { x: 35, y: -10, zoom: 1.035 });
assert.notEqual(end.layers[0].x, end.layers[2].x);
assert.ok(end.layers[2].scale > end.layers[0].scale);
results.push({ name: 'camera-and-parallax-deterministic', passed: true });

const duplicate = structuredClone(source);
duplicate.backgroundAnimation.layers[1].id = duplicate.backgroundAnimation.layers[0].id;
assert.throws(() => loadAndValidateJobConfig(contextFor('duplicate', duplicate)), (error) => error.code === 'CONFIG_SEMANTIC_INVALID');
results.push({ name: 'layer-ids-unique', passed: true });

const traversal = structuredClone(source);
traversal.backgroundAnimation.layers[0].asset = '../outside.png';
assert.throws(() => loadAndValidateJobConfig(contextFor('traversal', traversal)), (error) => error.code === 'ASSET_PATH_INVALID');
results.push({ name: 'layer-traversal-rejected', passed: true });

const repeated = evaluateScene(config, runtime, dialogue, 7.25).background;
assert.deepEqual(repeated, evaluateScene(config, runtime, dialogue, 7.25).background);
results.push({ name: 'same-time-same-background', passed: true });

const videoState = evaluateScene(
  { version: 2 },
  {
    audio: { durationSeconds: 10 },
    backgroundVideo: { durationSeconds: 2, fps: 30, loop: true },
    characters: [],
  },
  dialogue,
  2.5,
);
assert.deepEqual(videoState.backgroundVideo, { sourceFrameIndex: 15, sourceSeconds: 0.5 });
assert.deepEqual(
  videoState.backgroundVideo,
  evaluateScene(
    { version: 2 },
    { audio: { durationSeconds: 10 }, backgroundVideo: { durationSeconds: 2, fps: 30, loop: true }, characters: [] },
    dialogue,
    2.5,
  ).backgroundVideo,
);
results.push({ name: 'video-background-loops-from-frame-index', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'background-animation-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
