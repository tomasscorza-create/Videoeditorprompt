import assert from 'node:assert/strict';
import { getDirectorPlanV2Schema } from './director-plan-v2.mjs';
import {
  applyPreconfigurationConstraints,
  applyPreconfigurationToPlan,
  constrainPlanSchemaWithPreconfiguration,
  describeDirectorPreconfiguration,
  preconfigurationResourceIds,
  prepareDirectorPreconfiguration,
} from './preconfiguration-director.mjs';

const catalog = {
  version: 1,
  entries: [
    { id: 'personaje-a', type: 'character', label: 'A', capabilities: { animationPresets: ['talk-calm'] } },
    { id: 'personaje-b', type: 'character', label: 'B', capabilities: { animationPresets: ['idle-calm'] } },
    { id: 'voz-a', type: 'voice', label: 'Voz A' },
    { id: 'voz-b', type: 'voice', label: 'Voz B' },
    { id: 'voz-narrador', type: 'voice', label: 'Narrador' },
    { id: 'fondo-a', type: 'background', label: 'Fondo A' },
    { id: 'fondo-b', type: 'background', label: 'Fondo B' },
  ],
};
const source = {
  version: 1,
  id: 'dupla-editorial',
  name: 'Dupla editorial',
  structurePreference: 'dialogue',
  richnessProfile: 'varied',
  characterBindings: [
    { roleId: 'presentador', characterResourceId: 'personaje-a', voiceResourceId: 'voz-a' },
    { roleId: 'analista', characterResourceId: 'personaje-b', voiceResourceId: 'voz-b', animationPresetId: 'idle-calm' },
  ],
  narratorVoiceResourceId: 'voz-narrador',
  preferredBackgroundResourceIds: ['fondo-a', 'fondo-b'],
  backgroundStrategy: 'beat-variation',
  continuity: { preserveCharacterVoices: true, preserveNarratorVoice: true, preserveCastAcrossScenes: true },
};

let passed = 0;
const preconfiguration = prepareDirectorPreconfiguration(source, catalog);
assert.equal(preconfiguration.characterBindings[0].animationPresetId, 'talk-calm');
assert.equal(source.characterBindings[0].animationPresetId, undefined);
passed += 1;

assert.deepEqual(
  applyPreconfigurationConstraints({ planVersion: 2, sceneCount: 4, structure: 'automatic' }, preconfiguration),
  { planVersion: 2, sceneCount: 4, structure: 'dialogue', richnessProfile: 'varied' },
);
passed += 1;

assert.deepEqual(preconfigurationResourceIds(preconfiguration), [
  'fondo-a', 'fondo-b', 'personaje-a', 'personaje-b', 'voz-a', 'voz-b', 'voz-narrador',
]);
passed += 1;

const constrainedSchema = constrainPlanSchemaWithPreconfiguration(getDirectorPlanV2Schema(), preconfiguration);
assert.deepEqual(constrainedSchema.$defs.scene.properties.mode, { const: 'dialogue' });
assert.deepEqual(constrainedSchema.$defs.scene.properties.backgroundResourceId.enum, ['fondo-a', 'fondo-b']);
assert.deepEqual(constrainedSchema.$defs.participant.properties.roleId.enum, ['presentador', 'analista']);
assert.deepEqual(constrainedSchema.$defs.voiceoverTurn.properties.voiceId, { const: 'voz-narrador' });
passed += 1;

const plan = {
  version: 2,
  scenes: Array.from({ length: 4 }, (_, index) => ({
    mode: index === 0 ? 'solo' : 'dialogue',
    backgroundResourceId: 'fondo-ajeno',
    participants: [
      { roleId: 'rol-inventado-a', characterResourceId: 'otro-a', voiceId: 'otra-a', animationPresetId: 'otra' },
      { roleId: 'rol-inventado-b', characterResourceId: 'otro-b', voiceId: 'otra-b', animationPresetId: 'otra' },
    ],
    speech: [
      { kind: 'character', speakerRoleId: 'rol-inventado-a', text: `A ${index}`, gestureId: 'neutral', gapAfterSeconds: 0 },
      { kind: 'character', speakerRoleId: 'rol-inventado-b', text: `B ${index}`, gestureId: 'neutral', gapAfterSeconds: 0 },
      { kind: 'voiceover', voiceId: 'otra-voz', text: `N ${index}`, gapAfterSeconds: 0 },
    ],
  })),
};
const applied = applyPreconfigurationToPlan(plan, preconfiguration);
assert.deepEqual(applied.scenes.map((scene) => scene.backgroundResourceId), ['fondo-a', 'fondo-a', 'fondo-b', 'fondo-b']);
assert.ok(applied.scenes.every((scene) => scene.mode === 'dialogue'));
assert.ok(applied.scenes.every((scene) => scene.participants[0].roleId === 'presentador'));
assert.ok(applied.scenes.every((scene) => scene.participants[0].voiceId === 'voz-a'));
assert.ok(applied.scenes.every((scene) => scene.participants[1].roleId === 'analista'));
assert.ok(applied.scenes.every((scene) => scene.speech[0].speakerRoleId === 'presentador'));
assert.ok(applied.scenes.every((scene) => scene.speech[1].speakerRoleId === 'analista'));
assert.ok(applied.scenes.every((scene) => scene.speech[2].speakerRoleId === 'presentador'));
assert.equal(plan.scenes[0].backgroundResourceId, 'fondo-ajeno');
passed += 1;

const summary = describeDirectorPreconfiguration(preconfiguration);
assert.equal(summary.id, source.id);
assert.equal(summary.cast[0].voiceResourceId, 'voz-a');
passed += 1;

const narratorOnly = prepareDirectorPreconfiguration({
  ...source,
  id: 'narrador-editorial',
  structurePreference: 'automatic',
  characterBindings: [],
}, catalog);
const narratorSchema = constrainPlanSchemaWithPreconfiguration(getDirectorPlanV2Schema(), narratorOnly);
assert.deepEqual(narratorSchema.$defs.scene.properties.mode.enum, ['voiceover', 'visual-with-voiceover']);
assert.equal(narratorSchema.$defs.participant.properties.roleId.$ref, '#/$defs/id');
const narrated = applyPreconfigurationToPlan({
  version: 2,
  scenes: [{
    mode: 'solo',
    participants: [{ roleId: 'inventado' }],
    speech: [{ kind: 'character', speakerRoleId: 'inventado', text: 'Texto', gestureId: 'neutral', gapAfterSeconds: 0 }],
  }],
}, narratorOnly);
assert.equal(narrated.scenes[0].mode, 'voiceover');
assert.equal(narrated.scenes[0].participants.length, 0);
assert.equal(narrated.scenes[0].speech[0].voiceId, 'voz-narrador');
passed += 1;

process.stdout.write(`Aplicación de preconfiguraciones verificada (${passed} casos).\n`);
