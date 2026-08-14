import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { composeDialogueAudio } from '../stage1/prepare-dialogue.mjs';
import { ffprobe, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { resolveSoundEffects } from '../stage1/sound-effects.mjs';
import { compileVideoProject } from '../stage3a/compile-video-project.mjs';
import { createProjectCompilationContext } from '../stage3a/project-compilation-context.mjs';
import { generateSfxAssets, SFX_PROFILES, SFX_SAMPLE_RATE } from './generate-sfx-assets.mjs';

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sfx-pack-'));
let passed = false;
process.on('exit', () => {
  if (passed) rmSync(temporaryRoot, { recursive: true, force: true });
});

const generatedA = generateSfxAssets({ outputRoot: path.join(temporaryRoot, 'a') });
const generatedB = generateSfxAssets({ outputRoot: path.join(temporaryRoot, 'b') });
assert.equal(generatedA.length, 8);
for (const [index, generated] of generatedA.entries()) {
  const profile = SFX_PROFILES[index];
  const committed = path.join(projectRoot, 'public', 'assets', 'audio', 'sfx', profile.file);
  assert.equal(hashOf(generated.file), hashOf(generatedB[index].file), `${profile.id} debe ser reproducible`);
  assert.equal(hashOf(generated.file), hashOf(committed), `${profile.id} debe coincidir con el WAV publicado`);
  const probe = ffprobe(committed);
  const stream = probe.streams.find((entry) => entry.codec_type === 'audio');
  assert.equal(stream.codec_name, 'pcm_s16le');
  assert.equal(Number(stream.sample_rate), SFX_SAMPLE_RATE);
  assert.equal(stream.channels, 1);
  assert.ok(Math.abs(Number(probe.format.duration) - profile.durationSeconds) < 0.002);
}

const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const licenses = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'resource-licenses.json'));
for (const profile of SFX_PROFILES) {
  const resource = catalog.entries.find((entry) => entry.id === profile.id);
  assert.equal(resource?.type, 'sfx');
  assert.equal(resource.asset, `assets/audio/sfx/${profile.file}`);
  const license = licenses.resources.find((entry) => entry.resourceId === profile.id);
  assert.equal(license?.status, 'cleared');
  assert.equal(license?.commercialUse, 'allowed');
  assert.equal(license?.redistribution, 'allowed');
}

const timeline = [
  { id: 'turno-a', startSeconds: 0, endSeconds: 0.8 },
  { id: 'turno-b', startSeconds: 1, endSeconds: 1.8 },
];
const resolved = resolveSoundEffects([
  { id: 'entrada', asset: 'click.wav', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0.1, gainDb: -8 },
  { id: 'acento', asset: 'pop.wav', anchor: { kind: 'turn', turnId: 'turno-b', edge: 'start' }, offsetSeconds: 0.2, gainDb: -6 },
], timeline, 2);
assert.deepEqual(resolved.map(({ startSeconds }) => startSeconds), [0.1, 1.2]);
assert.throws(
  () => resolveSoundEffects([{ id: 'fuera', asset: 'x.wav', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: -1, gainDb: -6 }], timeline, 2),
  (error) => error.code === 'SFX_EVENT_OUTSIDE_SCENE',
);

const mixedPath = path.join(temporaryRoot, 'mixed.wav');
composeDialogueAudio(
  [{ type: 'silence', durationSeconds: 2 }],
  mixedPath,
  null,
  2,
  timeline,
  [
    { id: 'click', file: path.join(projectRoot, 'public', 'assets', 'audio', 'sfx', 'click-soft-v1.wav'), startSeconds: 0.25, gainDb: -4 },
    { id: 'impact', file: path.join(projectRoot, 'public', 'assets', 'audio', 'sfx', 'impact-soft-v1.wav'), startSeconds: 1.2, gainDb: -6 },
  ],
);
assert.ok(segmentRms(mixedPath, 0.24, 0.4) > 0.01);
assert.ok(segmentRms(mixedPath, 1.19, 1.55) > 0.01);
assert.ok(segmentRms(mixedPath, 0.7, 1) < 0.0001);

const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
project.scenes[0].soundEffects = [
  { id: 'sfx-entrada', resourceId: 'sfx-whoosh-corto-v1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, gainDb: -7 },
  { id: 'sfx-dato', resourceId: 'sfx-pop-positivo-v1', anchor: { kind: 'turn', turnId: 'turno-presentacion-02', edge: 'start' }, offsetSeconds: 0.1, gainDb: -8 },
];
const projectPath = path.join(temporaryRoot, 'project.json');
writeJson(projectPath, project);
const context = createProjectCompilationContext({
  'job-id': 'test-sfx-pack-v1',
  project: projectPath,
  'assets-dir': path.join(projectRoot, 'public'),
  'work-dir': path.join(temporaryRoot, 'work'),
  'output-dir': path.join(temporaryRoot, 'output'),
});
const compilation = compileVideoProject(context, { report: () => undefined });
const sceneConfig = readJson(path.join(context.jobRoot, compilation.manifest.scenes[0].config));
assert.equal(sceneConfig.soundEffects.length, 2);
assert.equal(sceneConfig.soundEffects[0].asset, 'assets/audio/sfx/whoosh-short-v1.wav');
assert.ok(compilation.manifest.sourceHashes.some((entry) => entry.path === 'assets/audio/sfx/pop-positive-v1.wav'));

const summary = {
  version: 1,
  passed: 6,
  failed: 0,
  effects: SFX_PROFILES.length,
  sampleRate: SFX_SAMPLE_RATE,
  categories: [...new Set(SFX_PROFILES.map(({ category }) => category))],
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'sfx-pack-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;

function hashOf(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function segmentRms(file, startSeconds, endSeconds) {
  const buffer = readFileSync(file);
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const dataOffset = findDataOffset(buffer);
  const firstFrame = Math.floor(startSeconds * sampleRate);
  const lastFrame = Math.floor(endSeconds * sampleRate);
  let sumSquares = 0;
  let count = 0;
  for (let frame = firstFrame; frame < lastFrame; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = dataOffset + (frame * channels + channel) * 2;
      const sample = buffer.readInt16LE(offset) / 32768;
      sumSquares += sample * sample;
      count += 1;
    }
  }
  return Math.sqrt(sumSquares / count);
}

function findDataOffset(buffer) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4);
    if (buffer.toString('ascii', offset, offset + 4) === 'data') return offset + 8;
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV sin bloque data.');
}
