import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDirectorPreconfigurationStore,
  validateDirectorPreconfiguration,
} from './preconfiguration-store.mjs';

const catalog = {
  version: 1,
  entries: [
    resource('personaje-a', 'character', { animationPresets: ['idle-calm', 'talk-calm'] }),
    resource('personaje-b', 'character', { animationPresets: ['idle-calm'] }),
    resource('voz-a', 'voice'),
    resource('voz-b', 'voice'),
    resource('voz-narrador', 'voice'),
    resource('fondo-a', 'background'),
    resource('fondo-b', 'background'),
  ],
};

const base = {
  version: 1,
  id: 'equipo-principal',
  name: 'Equipo principal',
  description: 'Reparto, voces y locación habitual del canal.',
  structurePreference: 'dialogue',
  richnessProfile: 'varied',
  characterBindings: [
    { roleId: 'presentador', characterResourceId: 'personaje-a', voiceResourceId: 'voz-a', animationPresetId: 'talk-calm' },
    { roleId: 'analista', characterResourceId: 'personaje-b', voiceResourceId: 'voz-b', animationPresetId: 'idle-calm' },
  ],
  narratorVoiceResourceId: 'voz-narrador',
  preferredBackgroundResourceIds: ['fondo-a'],
  backgroundStrategy: 'single-location',
  continuity: {
    preserveCharacterVoices: true,
    preserveNarratorVoice: true,
    preserveCastAcrossScenes: true,
  },
};

let passed = 0;
const temporary = await mkdtemp(path.join(tmpdir(), 'director-preconfiguration-'));
try {
  assert.deepEqual(validateDirectorPreconfiguration(base, catalog), base);
  passed += 1;

  const timestamps = ['2026-08-22T10:00:00.000Z', '2026-08-22T10:01:00.000Z', '2026-08-22T10:02:00.000Z'];
  const store = createDirectorPreconfigurationStore({
    storageRoot: temporary,
    catalogProvider: () => catalog,
    now: () => timestamps.shift(),
  });
  const created = await store.save(base);
  assert.equal(created.created, true);
  assert.equal(created.revision, 1);
  assert.equal(created.createdAt, '2026-08-22T10:00:00.000Z');
  assert.deepEqual((await store.get(base.id)).preconfiguration, base);
  passed += 1;

  const updatedDocument = { ...base, name: 'Equipo principal actualizado' };
  const updated = await store.save(updatedDocument, 1);
  assert.equal(updated.created, false);
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, '2026-08-22T10:01:00.000Z');
  assert.equal((await store.list())[0].preconfiguration.name, updatedDocument.name);
  passed += 1;

  await assert.rejects(() => store.save(base, 1), hasCode('DIRECTOR_PRECONFIGURATION_REVISION_CONFLICT'));
  assert.equal((await store.get(base.id)).revision, 2);
  passed += 1;

  const restored = createDirectorPreconfigurationStore({ storageRoot: temporary, catalogProvider: catalog });
  assert.equal((await restored.get(base.id)).revision, 2);
  const persisted = JSON.parse(await readFile(path.join(temporary, 'index.json'), 'utf8'));
  assert.equal(persisted.entries.length, 1);
  passed += 1;

  const invalidCases = [
    { ...base, characterBindings: [{ ...base.characterBindings[0], voiceResourceId: 'fondo-a' }, base.characterBindings[1]] },
    { ...base, characterBindings: [base.characterBindings[0], { ...base.characterBindings[1], voiceResourceId: 'voz-a' }] },
    { ...base, characterBindings: [{ ...base.characterBindings[0], animationPresetId: 'fly' }, base.characterBindings[1]] },
    { ...base, preferredBackgroundResourceIds: ['fondo-a', 'fondo-b'] },
    { ...base, structurePreference: 'narration', narratorVoiceResourceId: undefined },
  ];
  for (const candidate of invalidCases) {
    await assert.rejects(() => store.save(candidate), (error) => [
      'DIRECTOR_PRECONFIGURATION_INVALID',
      'DIRECTOR_PRECONFIGURATION_RESOURCE_INVALID',
    ].includes(error?.code));
  }
  passed += 1;

  assert.equal(await store.remove(base.id, 2), true);
  assert.equal(await store.get(base.id), null);
  assert.equal(await store.remove(base.id), false);
  passed += 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write(`Preconfiguraciones del Director verificadas (${passed} casos).\n`);

function resource(id, type, capabilities) {
  return { id, type, label: id, ...(capabilities ? { capabilities } : {}) };
}

function hasCode(code) {
  return (error) => error?.code === code;
}
