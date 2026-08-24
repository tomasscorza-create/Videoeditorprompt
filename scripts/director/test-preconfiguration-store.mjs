import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDirectorPreconfigurationStore, evaluateDirectorPreconfigurationHealth, migrateDirectorPreconfiguration } from './preconfiguration-store.mjs';

const catalog = { entries: [
  { id: 'personaje-a', type: 'character', capabilities: { animationPresets: ['talk-calm', 'idle-calm'] } },
  { id: 'voz-a', type: 'voice' }, { id: 'voz-n', type: 'voice' }, { id: 'fondo-a', type: 'background' },
] };
const v2 = { version: 2, id: 'equipo-principal', name: 'Equipo principal', structurePreference: 'one-character', characterBindings: [{ roleId: 'presentador', characterResourceId: 'personaje-a', voiceResourceId: 'voz-a', animationPresetId: 'talk-calm' }], narratorVoiceResourceId: 'voz-n', backgroundResourceId: 'fondo-a' };
const v1 = { version: 1, id: 'historica', name: 'Histórica', characterBindings: [{ roleId: 'presentador', characterResourceId: 'personaje-a', voiceResourceId: 'voz-a', animationPresetId: 'talk-calm' }], preferredBackgroundResourceIds: ['fondo-a'], backgroundStrategy: 'beat-variation', continuity: { preserveCharacterVoices: false, preserveNarratorVoice: false, preserveCastAcrossScenes: false } };
const temporary = await mkdtemp(path.join(tmpdir(), 'director-preconfiguration-'));
try {
  const store = createDirectorPreconfigurationStore({ storageRoot: temporary, catalogProvider: () => catalog, now: () => '2026-08-24T10:00:00.000Z' });
  const created = await store.create(v2);
  assert.equal(created.created, true); assert.equal(created.health.status, 'valid');
  await assert.rejects(() => store.create(v2), hasCode('DIRECTOR_PRECONFIGURATION_ALREADY_EXISTS'));
  await assert.rejects(() => store.update({ ...v2, name: 'Nuevo' }), hasCode('DIRECTOR_PRECONFIGURATION_REVISION_REQUIRED'));
  const updated = await store.update({ ...v2, name: 'Nuevo' }, created.revision);
  assert.equal(updated.revision, 2);
  await assert.rejects(() => store.update(v2, 1), hasCode('DIRECTOR_PRECONFIGURATION_REVISION_CONFLICT'));
  assert.equal(await store.remove(v2.id, 2), true);
  const migration = migrateDirectorPreconfiguration(v1);
  assert.equal(migration.preconfiguration.backgroundResourceId, 'fondo-a');
  assert.equal(migration.warnings.length, 1);
  assert.deepEqual(migration, migrateDirectorPreconfiguration(v1));
  await writeFile(path.join(temporary, 'index.json'), JSON.stringify({ version: 1, entries: [{ revision: 1, createdAt: '2026-08-24T10:00:00.000Z', updatedAt: '2026-08-24T10:00:00.000Z', preconfiguration: v1 }] }));
  const migrated = await store.migrate(v1.id, 1);
  assert.equal(migrated.preconfiguration.version, 2); assert.equal(migrated.legacyPreconfiguration.version, 1);
  const persisted = JSON.parse(await readFile(path.join(temporary, 'index.json'), 'utf8'));
  assert.equal(persisted.version, 2); assert.equal(persisted.entries[0].legacyPreconfiguration.version, 1);
  const damaged = { ...v2, characterBindings: [{ ...v2.characterBindings[0], voiceResourceId: 'eliminada' }] };
  assert.equal(evaluateDirectorPreconfigurationHealth(damaged, catalog).status, 'incomplete');
  process.stdout.write('Preconfiguraciones V2: CRUD, migración, salud y concurrencia verificados (10 casos).\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
function hasCode(code) { return (error) => error?.code === code; }
