import assert from 'node:assert/strict';
import { getDirectorPlanV2Schema } from './director-plan-v2.mjs';
import { applyPreconfigurationConstraints, applyPreconfigurationToPlan, constrainPlanSchemaWithPreconfiguration, createPreconfigurationSnapshot, preconfigurationResourceIds } from './preconfiguration-director.mjs';
const config = { version: 2, id: 'dupla', name: 'Dupla', structurePreference: 'dialogue', richnessProfile: 'varied', characterBindings: [
  { roleId: 'presentador', characterResourceId: 'personaje-a', voiceResourceId: 'voz-a', animationPresetId: 'talk-calm' },
  { roleId: 'analista', characterResourceId: 'personaje-b', voiceResourceId: 'voz-b', animationPresetId: 'idle-calm' },
], narratorVoiceResourceId: 'voz-n', backgroundResourceId: 'fondo-a' };
assert.deepEqual(applyPreconfigurationConstraints({ planVersion: 2 }, config), { planVersion: 2, structure: 'dialogue', richnessProfile: 'varied' });
assert.deepEqual(preconfigurationResourceIds(config), ['fondo-a', 'personaje-a', 'personaje-b', 'voz-a', 'voz-b', 'voz-n']);
const schema = constrainPlanSchemaWithPreconfiguration(getDirectorPlanV2Schema(), config);
assert.equal(schema.$defs.participant.oneOf.length, 2);
assert.equal(schema.$defs.participant.oneOf[0].properties.voiceId.const, 'voz-a');
assert.equal(schema.$defs.scene.properties.backgroundResourceId.const, 'fondo-a');
assert.equal(schema.$defs.scene.properties.cameraPreset.const, 'static');
const plan = { version: 2, scenes: [{ mode: 'solo', backgroundResourceId: 'otro', cameraPreset: 'slow-pan', transitionPreset: 'cut', transitionDurationSeconds: 0, participants: [], speech: [{ kind: 'character', text: 'Hola', gapAfterSeconds: 0 }] }] };
const applied = applyPreconfigurationToPlan(plan, config);
assert.equal(applied.scenes[0].participants[0].voiceId, 'voz-a');
assert.equal(applied.scenes[0].backgroundResourceId, 'fondo-a');
assert.equal(applied.scenes[0].cameraPreset, 'static');
const snapshot = createPreconfigurationSnapshot({ revision: 3, preconfiguration: config });
assert.deepEqual(snapshot, createPreconfigurationSnapshot({ revision: 3, preconfiguration: config }));
assert.notEqual(snapshot.snapshotHash, createPreconfigurationSnapshot({ revision: 4, preconfiguration: config }).snapshotHash);
process.stdout.write('Aplicación V2: tuplas cerradas, invariantes y snapshot verificados (8 casos).\n');
