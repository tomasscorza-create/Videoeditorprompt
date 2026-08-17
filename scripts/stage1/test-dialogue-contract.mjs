import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureDirectory, projectRoot, readJson, writeJson } from './common.mjs';
import { createJobContext } from './job-context.mjs';
import { loadAndValidateJobConfig, validateMeasuredDuration } from './validate-scene-config.mjs';
import { evaluateScene } from '../../shared/scene-evaluator.js';
import { buildSubtitleCues, segmentSubtitleText } from '../../shared/subtitle-cues.js';

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

const voiceover = structuredClone(source);
voiceover.characters = [];
voiceover.dialogue = [{
  id: 'narracion-1',
  speakerType: 'voiceover',
  text: 'Una voz guía la escena sin exigir personajes visibles.',
  voice: structuredClone(source.dialogue[0].voice),
  gesture: 'neutral',
  gapAfterSeconds: 0,
}];
const voiceoverContext = contextFor('voiceover-no-characters', voiceover);
const voiceoverConfig = loadAndValidateJobConfig(voiceoverContext);
assert.equal(voiceoverConfig.characters.length, 0);
assert.equal(voiceoverContext.resolvedCharacters.length, 0);
assert.equal(voiceoverConfig.dialogue[0].speakerId, undefined);
results.push({ name: 'voiceover-allows-zero-characters-and-one-turn', passed: true });

const elevenLabsVoiceover = structuredClone(voiceover);
elevenLabsVoiceover.dialogue[0].voice = {
  provider: 'elevenlabs', model: 'eleven_multilingual_v2', voiceId: 'VoiceTest1234567890', lengthScale: 1, volume: 1,
};
const elevenLabsConfig = loadAndValidateJobConfig(contextFor('elevenlabs-voiceover', elevenLabsVoiceover));
assert.equal(elevenLabsConfig.dialogue[0].voice.provider, 'elevenlabs');
assert.equal(elevenLabsConfig.dialogue[0].voice.voiceId, 'VoiceTest1234567890');
results.push({ name: 'elevenlabs-voice-contract', passed: true });

const missingElevenLabsVoiceId = structuredClone(elevenLabsVoiceover);
delete missingElevenLabsVoiceId.dialogue[0].voice.voiceId;
assert.throws(() => loadAndValidateJobConfig(contextFor('elevenlabs-missing-voice', missingElevenLabsVoiceId)), (error) => error.code === 'CONFIG_SCHEMA_INVALID');
results.push({ name: 'elevenlabs-requires-voice-id', passed: true });

const retiredPiperVoice = structuredClone(elevenLabsVoiceover);
retiredPiperVoice.dialogue[0].voice = {
  provider: 'piper', model: 'es_MX-claude-high', lengthScale: 1, volume: 1,
};
assert.throws(
  () => loadAndValidateJobConfig(contextFor('piper-retired', retiredPiperVoice)),
  (error) => error.code === 'CONFIG_SCHEMA_INVALID',
);
results.push({ name: 'piper-is-not-accepted-by-v2', passed: true });

const solo = structuredClone(source);
solo.characters = [solo.characters[0]];
solo.dialogue = [solo.dialogue[0]];
const soloContext = contextFor('solo-one-character', solo);
const soloConfig = loadAndValidateJobConfig(soloContext);
assert.equal(soloConfig.characters.length, 1);
assert.equal(soloContext.resolvedCharacters.length, 1);
results.push({ name: 'solo-allows-one-character-and-one-turn', passed: true });

const invalidVoiceover = structuredClone(voiceover);
invalidVoiceover.dialogue[0].speakerId = 'fantasma';
assert.throws(
  () => loadAndValidateJobConfig(contextFor('voiceover-with-character-reference', invalidVoiceover)),
  (error) => error.code === 'CONFIG_SEMANTIC_INVALID',
);
results.push({ name: 'voiceover-rejects-character-reference', passed: true });

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
    {
      id: 'a', speakerId: 'presentador', startSeconds: 0, endSeconds: 1, durationSeconds: 1,
      subtitlePath: 'a-1.png',
      subtitleCues: [
        { text: 'Hola a todos', wordCount: 3, startSeconds: 0, endSeconds: 0.5, subtitlePath: 'a-1.png' },
        { text: 'por aquí', wordCount: 2, startSeconds: 0.5, endSeconds: 1, subtitlePath: 'a-2.png' },
      ],
      gesture: 'point', mouthCues: [{ start: 0, end: 1, state: 'medium' }],
    },
    { id: 'b', speakerId: 'invitado', startSeconds: 1.2, endSeconds: 2.2, durationSeconds: 1, subtitlePath: 'b.png', gesture: 'neutral', mouthCues: [{ start: 0, end: 1, state: 'open' }] },
  ],
};
const firstTurn = evaluateScene(config, runtime, dialogue, 0.5);
const pause = evaluateScene(config, runtime, dialogue, 1.1);
const secondTurn = evaluateScene(config, runtime, dialogue, 1.5);
assert.equal(firstTurn.activeSpeakerId, 'presentador');
assert.equal(firstTurn.subtitlePath, 'a-2.png');
assert.equal(firstTurn.characters.find((item) => item.id === 'presentador').mouth, 'medium');
assert.equal(firstTurn.characters.find((item) => item.id === 'presentador').gesture, 'point');
assert.equal(firstTurn.characters.find((item) => item.id === 'invitado').mouth, 'closed');
assert.equal(pause.activeSpeakerId, null);
assert.ok(pause.characters.every((item) => item.mouth === 'closed'));
assert.ok(pause.characters.every((item) => item.gesture === 'neutral'));
assert.equal(secondTurn.activeSpeakerId, 'invitado');
assert.equal(secondTurn.characters.find((item) => item.id === 'invitado').mouth, 'open');
results.push({ name: 'only-active-speaker-moves-mouth', passed: true });

const voiceoverState = evaluateScene(
  voiceoverConfig,
  { audio: { durationSeconds: 1 }, characters: [] },
  { turns: [{ id: 'narracion-1', speakerType: 'voiceover', startSeconds: 0, endSeconds: 1, durationSeconds: 1, subtitlePath: 'n.png', mouthCues: [] }] },
  0.5,
);
assert.equal(voiceoverState.activeTurnId, 'narracion-1');
assert.equal(voiceoverState.activeSpeakerId, null);
assert.deepEqual(voiceoverState.characters, []);
results.push({ name: 'voiceover-evaluator-has-subtitle-without-mouth-or-character', passed: true });

const phase2Runtime = {
  audio: { durationSeconds: 3 },
  characters: config.characters.map((character, index) => ({
    id: character.id,
    transform: {
      ...character.transform,
      idleProfile: index === 0 ? 'breathing' : 'organic',
      motionSeed: 1234 + index,
    },
    blinks: [],
  })),
};
const phase2Dialogue = {
  turns: [
    {
      ...dialogue.turns[0],
      gesture: 'celebrate',
      gestureCue: { pose: 'celebrate', startSeconds: 0.4, durationSeconds: 0.4 },
      mouthCues: [{ start: 0, end: 1, state: 'bilabial' }],
      layout: [
        { characterId: 'presentador', x: -190, y: 120, scale: 0.78 },
        { characterId: 'invitado', x: 260, y: 170, scale: 0.62 },
      ],
    },
    dialogue.turns[1],
  ],
};
const beforeGesture = evaluateScene(config, phase2Runtime, phase2Dialogue, 0.2);
const duringGesture = evaluateScene(config, phase2Runtime, phase2Dialogue, 0.5);
const afterGesture = evaluateScene(config, phase2Runtime, phase2Dialogue, 0.9);
const repeatedFrame = evaluateScene(config, phase2Runtime, phase2Dialogue, 0.5);
assert.equal(duringGesture.characters.find((item) => item.id === 'presentador').mouth, 'bilabial');
assert.equal(beforeGesture.characters.find((item) => item.id === 'presentador').gesture, 'neutral');
assert.equal(duringGesture.characters.find((item) => item.id === 'presentador').gesture, 'celebrate');
assert.equal(afterGesture.characters.find((item) => item.id === 'presentador').gesture, 'neutral');
assert.notEqual(
  duringGesture.characters.find((item) => item.id === 'presentador').character.x,
  phase2Runtime.characters[0].transform.toX,
);
assert.deepEqual(duringGesture, repeatedFrame);
results.push({ name: 'phase2-viseme-gesture-idle-layout-deterministic', passed: true });

const subtitleSegments = segmentSubtitleText('Sí, pero seguimos usando una sola computadora potente.');
assert.deepEqual(subtitleSegments, ['Sí, pero seguimos', 'usando una sola', 'computadora potente.']);
assert.ok(subtitleSegments.every((segment) => !/[\r\n]/u.test(segment)));
assert.ok(subtitleSegments.every((segment) => segment.split(/\s+/u).length >= 2 && segment.split(/\s+/u).length <= 3));
const subtitleCues = buildSubtitleCues('uno dos tres cuatro cinco', 2.5);
assert.deepEqual(subtitleCues.map((cue) => cue.text), ['uno dos tres', 'cuatro cinco']);
assert.equal(subtitleCues[0].startSeconds, 0);
assert.equal(subtitleCues[0].endSeconds, 1.5);
assert.equal(subtitleCues[1].endSeconds, 2.5);
for (let wordCount = 2; wordCount <= 30; wordCount += 1) {
  const text = Array.from({ length: wordCount }, (_, index) => `p${index + 1}`).join(' ');
  const segments = segmentSubtitleText(text);
  assert.equal(segments.join(' '), text);
  assert.ok(segments.every((segment) => {
    const count = segment.split(/\s+/u).length;
    return count === 2 || count === 3;
  }), `segmentación inválida para ${wordCount} palabras`);
}
results.push({ name: 'short-subtitle-cues-single-line', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'dialogue-contract-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
