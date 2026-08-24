import { validateDirectorPreconfiguration } from './preconfiguration-store.mjs';

export function prepareDirectorPreconfiguration(preconfiguration, catalog) {
  if (!preconfiguration) return null;
  validateDirectorPreconfiguration(preconfiguration);
  if (preconfiguration.version !== 2) throw Object.assign(new Error('La configuración debe migrarse a V2.'), { code: 'DIRECTOR_PRECONFIGURATION_INCOMPLETE' });
  return structuredClone(preconfiguration);
}
export function applyPreconfigurationConstraints(constraints, preconfiguration) {
  if (!preconfiguration) return { ...constraints };
  return {
    ...constraints,
    ...(preconfiguration.structurePreference && preconfiguration.structurePreference !== 'automatic' ? { structure: preconfiguration.structurePreference } : {}),
    ...(preconfiguration.richnessProfile ? { richnessProfile: preconfiguration.richnessProfile } : {}),
    ...(preconfiguration.tonePreference ? { tone: preconfiguration.tonePreference } : {}),
  };
}
export function preconfigurationResourceIds(preconfiguration) {
  if (!preconfiguration) return [];
  return [...new Set([
    ...preconfiguration.characterBindings.flatMap((binding) => [binding.characterResourceId, binding.voiceResourceId]),
    ...(preconfiguration.narratorVoiceResourceId ? [preconfiguration.narratorVoiceResourceId] : []),
    preconfiguration.backgroundResourceId,
    ...(preconfiguration.preferredMusicResourceIds || []),
    ...(preconfiguration.preferredPropResourceIds || []),
    ...(preconfiguration.preferredTemplateResourceIds || []),
  ])].sort();
}
export function constrainPlanSchemaWithPreconfiguration(schema, preconfiguration) {
  if (!preconfiguration || schema?.properties?.version?.const !== 2) return schema;
  const constrained = structuredClone(schema);
  const bindings = preconfiguration.characterBindings;
  if (bindings.length > 0) {
    // Cada alternativa es una tupla cerrada: la IA no puede cruzar personaje, voz y animación.
    constrained.$defs.participant = {
      oneOf: bindings.map((binding) => ({
        type: 'object', additionalProperties: false,
        required: ['roleId', 'characterResourceId', 'voiceId', 'animationPresetId'],
        properties: {
          roleId: { const: binding.roleId },
          characterResourceId: { const: binding.characterResourceId },
          voiceId: { const: binding.voiceResourceId },
          animationPresetId: { const: binding.animationPresetId },
        },
      })),
    };
  }
  constrained.$defs.scene.properties.backgroundResourceId = { const: preconfiguration.backgroundResourceId };
  constrained.$defs.scene.properties.cameraPreset = { const: 'static' };
  constrained.$defs.scene.properties.transitionPreset = { const: 'fade' };
  constrained.$defs.scene.properties.transitionDurationSeconds = { const: 0.35 };
  if (preconfiguration.narratorVoiceResourceId) constrained.$defs.voiceoverTurn.properties.voiceId = { const: preconfiguration.narratorVoiceResourceId };
  const fixedMode = structureMode(preconfiguration.structurePreference);
  if (fixedMode) constrained.$defs.scene.properties.mode = { const: fixedMode };
  else {
    const modes = preconfiguration.narratorVoiceResourceId ? ['voiceover', 'visual-with-voiceover'] : [];
    if (bindings.length >= 1) modes.push('solo');
    if (bindings.length >= 2) modes.push('dialogue');
    constrained.$defs.scene.properties.mode = { type: 'string', enum: modes };
  }
  return constrained;
}
export function applyPreconfigurationToPlan(plan, preconfiguration) {
  if (!preconfiguration || plan?.version !== 2 || !Array.isArray(plan.scenes)) return plan;
  const result = structuredClone(plan);
  const bindings = preconfiguration.characterBindings;
  const fixedMode = structureMode(preconfiguration.structurePreference);
  for (const scene of result.scenes) {
    if (fixedMode) scene.mode = fixedMode;
    else if (!preconfiguration.narratorVoiceResourceId && ['voiceover', 'visual-with-voiceover'].includes(scene.mode)) scene.mode = bindings.length >= 2 ? 'dialogue' : 'solo';
    else if (bindings.length === 0 && ['solo', 'dialogue'].includes(scene.mode)) scene.mode = 'voiceover';
    else if (bindings.length === 1 && scene.mode === 'dialogue') scene.mode = 'solo';
    scene.backgroundResourceId = preconfiguration.backgroundResourceId;
    scene.cameraPreset = 'static'; scene.transitionPreset = 'fade'; scene.transitionDurationSeconds = 0.35;
    scene.participants = ['solo', 'dialogue'].includes(scene.mode) ? bindings.slice(0, scene.mode === 'dialogue' ? 2 : 1).map(boundParticipant) : [];
    let turnIndex = 0;
    scene.speech = (scene.speech || []).map((turn) => {
      if (['voiceover', 'visual-with-voiceover'].includes(scene.mode)) return { kind: 'voiceover', voiceId: preconfiguration.narratorVoiceResourceId, text: turn.text, ...(turn.pace ? { pace: turn.pace } : {}), gapAfterSeconds: turn.gapAfterSeconds };
      const participant = scene.participants[turnIndex++ % scene.participants.length];
      return { kind: 'character', speakerRoleId: participant.roleId, text: turn.text, gestureId: turn.kind === 'character' ? (turn.gestureId || 'neutral') : 'neutral', ...(turn.kind === 'character' && turn.gestureAtWord !== undefined ? { gestureAtWord: turn.gestureAtWord } : {}), ...(turn.pace ? { pace: turn.pace } : {}), gapAfterSeconds: turn.gapAfterSeconds };
    });
  }
  return result;
}
export function describeDirectorPreconfiguration(preconfiguration) {
  if (!preconfiguration) return null;
  return { id: preconfiguration.id, name: preconfiguration.name, version: 2, structure: preconfiguration.structurePreference || 'automatic', richness: preconfiguration.richnessProfile || 'automatic', backgroundResourceId: preconfiguration.backgroundResourceId, narratorVoiceResourceId: preconfiguration.narratorVoiceResourceId || null, cast: preconfiguration.characterBindings.map((binding) => ({ ...binding })) };
}
export function createPreconfigurationSnapshot(record) {
  if (!record?.preconfiguration || !Number.isInteger(record.revision)) return null;
  const preconfiguration = structuredClone(record.preconfiguration);
  const source = JSON.stringify(canonicalize({ preconfiguration, revision: record.revision }));
  return { preconfigurationId: preconfiguration.id, revision: record.revision, snapshotHash: createHash(source), preconfiguration };
}
function structureMode(structure) { return structure === 'narration' ? 'voiceover' : structure === 'one-character' ? 'solo' : structure === 'dialogue' ? 'dialogue' : null; }
function boundParticipant(binding) { return { roleId: binding.roleId, characterResourceId: binding.characterResourceId, voiceId: binding.voiceResourceId, animationPresetId: binding.animationPresetId }; }
function canonicalize(value) { if (Array.isArray(value)) return value.map(canonicalize); if (!value || typeof value !== 'object') return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])); }
function createHash(value) { const state = new TextEncoder().encode(value); let hash = 2166136261; for (const byte of state) hash = Math.imul(hash ^ byte, 16777619); return 'fnv1a-' + (hash >>> 0).toString(16).padStart(8, '0'); }
