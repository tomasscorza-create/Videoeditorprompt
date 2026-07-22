import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureDirectory, projectRoot, readJson, writeJson } from './common.mjs';
import { createJobContext } from './job-context.mjs';
import { loadAndValidateJobConfig, validateMeasuredDuration } from './validate-scene-config.mjs';
import { evaluateScene } from '../../shared/scene-evaluator.js';
import { wrapSubtitleText } from './subtitle-renderer.mjs';

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'dialogue-contract', stamp);
const configRoot = ensureDirectory(path.join(testRoot, 'configs'));
const source = readJson(path.join(projectRoot, 'pilots', 'dialogo-monos-01', 'scene.config.json'));
const results = [];

function contextFor(name, config = source) {
  const configPath = path.join(configRoot, `${name}.json`);
  writeJson(configPath, config);
  return createJobContext({
    'job-id': `dialogue-${name}-${stamp}`,
    config: configPath,
    'assets-dir': path.join(projectRoot, 'public'),
    'work-dir': path.join(testRoot, 'work'),
    'output-dir': path.join(testRoot, 'output'),
  });
}

const context = contextFor('valid');
const config = loadAndValidateJobConfig(context);
assert.equal(config.version, 2);
assert.equal(context.resolvedCharacters.length, 2);
assert.deepEqual(context.resolvedCharacters.map((item) => item.id), ['presentador', 'invitado']);
assert.ok(context.resolvedCharacters.every((item) => Object.values(item.assets).every((value) => !path.isAbsolute(value))));
assert.deepEqual(validateMeasuredDuration(config, 12), { durationSeconds: 12, frameCount: 360 });
results.push({ name: 'v2-valid-portable', passed: true });

const missingSpeaker = structuredClone(source);
missingSpeaker.dialogue[1].speakerId = 'fantasma';
assert.throws(() => loadAndValidateJobConfig(contextFor('missing-speaker', missingSpeaker)), (error) => error.code === 'CONFIG_SEMANTIC_INVALID');
results.push({ name: 'speaker-reference-required', passed: true });

const duplicateCharacter = structuredClone(source);
duplicateCharacter.characters[1].id = duplicateCharacter.characters[0].id;
assert.throws(() => loadAndValidateJobConfig(contextFor('duplicate-character', duplicateCharacter)), (error) => error.code === 'CONFIG_SEMANTIC_INVALID');
results.push({ name: 'character-ids-unique', passed: true });

const duplicateTurn = structuredClone(source);
duplicateTurn.dialogue[1].id = duplicateTurn.dialogue[0].id;
assert.throws(() => loadAndValidateJobConfig(contextFor('duplicate-turn', duplicateTurn)), (error) => error.code === 'CONFIG_SEMANTIC_INVALID');
results.push({ name: 'turn-ids-unique', passed: true });

const absoluteManifest = structuredClone(source);
absoluteManifest.characters[0].characterManifest = 'C:\\outside\\character.json';
assert.throws(() => loadAndValidateJobConfig(contextFor('absolute-manifest', absoluteManifest)), (error) => error.code === 'ASSET_PATH_INVALID');
results.push({ name: 'absolute-manifest-rejected', passed: true });

assert.throws(() => validateMeasuredDuration(config, 121), (error) => error.code === 'AUDIO_DURATION_OUT_OF_RANGE');
results.push({ name: 'compiled-duration-limited', passed: true });

const runtime = {
  audio: { durationSeconds: 3 },
  characters: config.characters.map((character) => ({ id: character.id, transform: character.transform, blinks: [] })),
};
const dialogue = {
  turns: [
    { id: 'a', speakerId: 'presentador', startSeconds: 0, endSeconds: 1, durationSeconds: 1, subtitlePath: 'a.png', gesture: 'point', mouthCues: [{ start: 0, end: 1, state: 'medium' }] },
    { id: 'b', speakerId: 'invitado', startSeconds: 1.2, endSeconds: 2.2, durationSeconds: 1, subtitlePath: 'b.png', gesture: 'neutral', mouthCues: [{ start: 0, end: 1, state: 'open' }] },
  ],
};
const firstTurn = evaluateScene(config, runtime, dialogue, 0.5);
const pause = evaluateScene(config, runtime, dialogue, 1.1);
const secondTurn = evaluateScene(config, runtime, dialogue, 1.5);
assert.equal(firstTurn.activeSpeakerId, 'presentador');
assert.equal(firstTurn.characters.find((item) => item.id === 'presentador').mouth, 'medium');
assert.equal(firstTurn.characters.find((item) => item.id === 'presentador').gesture, 'point');
assert.equal(firstTurn.characters.find((item) => item.id === 'invitado').mouth, 'closed');
assert.equal(pause.activeSpeakerId, null);
assert.ok(pause.characters.every((item) => item.mouth === 'closed'));
assert.ok(pause.characters.every((item) => item.gesture === 'neutral'));
assert.equal(secondTurn.activeSpeakerId, 'invitado');
assert.equal(secondTurn.characters.find((item) => item.id === 'invitado').mouth, 'open');
results.push({ name: 'only-active-speaker-moves-mouth', passed: true });

const wrapped = wrapSubtitleText('Sí, pero seguimos usando una sola computadora.');
assert.ok(wrapped.includes('\n'));
assert.ok(wrapped.split('\n').every((line) => line.length <= 38));
results.push({ name: 'subtitle-wrap-bounded', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'dialogue-contract-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
