import { validateDirectorPreconfiguration } from './preconfiguration-store.mjs';

export function prepareDirectorPreconfiguration(preconfiguration, catalog) {
  if (!preconfiguration) return null;
  const validated = validateDirectorPreconfiguration(preconfiguration, catalog);
  const bindings = validated.characterBindings.map((binding) => {
    const character = catalog.entries.find((entry) => entry.id === binding.characterResourceId);
    return {
      ...binding,
      animationPresetId: binding.animationPresetId || character.capabilities?.animationPresets?.[0] || 'idle-calm',
    };
  });
  return { ...validated, characterBindings: bindings };
}

export function applyPreconfigurationConstraints(constraints, preconfiguration) {
  if (!preconfiguration) return { ...constraints };
  return {
    ...constraints,
    ...(preconfiguration.structurePreference && preconfiguration.structurePreference !== 'automatic'
      ? { structure: preconfiguration.structurePreference }
      : {}),
    ...(preconfiguration.richnessProfile ? { richnessProfile: preconfiguration.richnessProfile } : {}),
  };
}

export function preconfigurationResourceIds(preconfiguration) {
  if (!preconfiguration) return [];
  return [...new Set([
    ...preconfiguration.characterBindings.flatMap((binding) => [binding.characterResourceId, binding.voiceResourceId]),
    ...(preconfiguration.narratorVoiceResourceId ? [preconfiguration.narratorVoiceResourceId] : []),
    ...preconfiguration.preferredBackgroundResourceIds,
  ])].sort();
}

export function constrainPlanSchemaWithPreconfiguration(schema, preconfiguration) {
  if (!preconfiguration || schema?.properties?.version?.const !== 2) return schema;
  const constrained = structuredClone(schema);
  const bindings = preconfiguration.characterBindings;
  if (bindings.length > 0) {
    const participant = constrained.$defs.participant;
    participant.properties.roleId = { type: 'string', enum: bindings.map((binding) => binding.roleId) };
    participant.properties.characterResourceId = { type: 'string', enum: bindings.map((binding) => binding.characterResourceId) };
    participant.properties.voiceId = { type: 'string', enum: bindings.map((binding) => binding.voiceResourceId) };
    participant.properties.animationPresetId = { type: 'string', enum: bindings.map((binding) => binding.animationPresetId) };
  }
  constrained.$defs.scene.properties.backgroundResourceId = {
    type: 'string',
    enum: preconfiguration.preferredBackgroundResourceIds,
  };
  if (preconfiguration.narratorVoiceResourceId) {
    constrained.$defs.voiceoverTurn.properties.voiceId = { const: preconfiguration.narratorVoiceResourceId };
  }
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
  const bindingByRole = new Map(bindings.map((binding) => [binding.roleId, binding]));
  const fixedMode = structureMode(preconfiguration.structurePreference);
  const sceneCount = result.scenes.length;

  for (const [sceneIndex, scene] of result.scenes.entries()) {
    if (fixedMode) scene.mode = fixedMode;
    else if (!preconfiguration.narratorVoiceResourceId && ['voiceover', 'visual-with-voiceover'].includes(scene.mode)) scene.mode = bindings.length >= 2 ? 'dialogue' : 'solo';
    else if (bindings.length === 0 && ['solo', 'dialogue'].includes(scene.mode)) scene.mode = 'voiceover';
    else if (bindings.length === 1 && scene.mode === 'dialogue') scene.mode = 'solo';

    scene.backgroundResourceId = selectBackground(preconfiguration, sceneIndex, sceneCount);
    const originalParticipants = Array.isArray(scene.participants) ? scene.participants : [];
    const usedRoles = new Set();
    scene.participants = ['solo', 'dialogue'].includes(scene.mode)
      ? originalParticipants.slice(0, scene.mode === 'dialogue' ? 2 : 1).map((participant, index) => {
        const preferred = bindingByRole.get(participant.roleId);
        const binding = preferred && !usedRoles.has(preferred.roleId)
          ? preferred
          : bindings.find((candidate) => !usedRoles.has(candidate.roleId)) || bindings[index % bindings.length];
        if (!binding) return null;
        usedRoles.add(binding.roleId);
        return boundParticipant(binding);
      }).filter(Boolean)
      : [];

    if (scene.mode === 'dialogue' && scene.participants.length < 2) {
      for (const binding of bindings) {
        if (scene.participants.length >= 2) break;
        if (!usedRoles.has(binding.roleId)) {
          scene.participants.push(boundParticipant(binding));
          usedRoles.add(binding.roleId);
        }
      }
    }
    if (scene.mode === 'solo' && scene.participants.length === 0 && bindings[0]) {
      scene.participants.push(boundParticipant(bindings[0]));
    }

    const originalRoleOrder = originalParticipants.map((participant) => participant.roleId);
    let characterTurnIndex = 0;
    scene.speech = (scene.speech ?? []).map((turn) => {
      if (['voiceover', 'visual-with-voiceover'].includes(scene.mode)) {
        return {
          kind: 'voiceover',
          voiceId: preconfiguration.narratorVoiceResourceId,
          text: turn.text,
          ...(turn.pace ? { pace: turn.pace } : {}),
          gapAfterSeconds: turn.gapAfterSeconds,
        };
      }
      if (scene.participants.length === 0) return turn;
      const originalIndex = originalRoleOrder.indexOf(turn.speakerRoleId);
      const participantIndex = scene.mode === 'dialogue'
        ? characterTurnIndex
        : originalIndex >= 0 ? originalIndex : characterTurnIndex;
      const participant = scene.participants[participantIndex % scene.participants.length];
      characterTurnIndex += 1;
      return {
        kind: 'character',
        speakerRoleId: participant.roleId,
        text: turn.text,
        gestureId: turn.kind === 'character' ? (turn.gestureId || 'neutral') : 'neutral',
        ...(turn.kind === 'character' && turn.gestureAtWord !== undefined ? { gestureAtWord: turn.gestureAtWord } : {}),
        ...(turn.pace ? { pace: turn.pace } : {}),
        gapAfterSeconds: turn.gapAfterSeconds,
      };
    });
  }
  return result;
}

export function describeDirectorPreconfiguration(preconfiguration) {
  if (!preconfiguration) return null;
  return {
    id: preconfiguration.id,
    name: preconfiguration.name,
    structure: preconfiguration.structurePreference || 'automatic',
    richness: preconfiguration.richnessProfile || 'automatic',
    backgroundStrategy: preconfiguration.backgroundStrategy,
    backgrounds: [...preconfiguration.preferredBackgroundResourceIds],
    narratorVoiceResourceId: preconfiguration.narratorVoiceResourceId || null,
    cast: preconfiguration.characterBindings.map((binding) => ({
      roleId: binding.roleId,
      characterResourceId: binding.characterResourceId,
      voiceResourceId: binding.voiceResourceId,
      animationPresetId: binding.animationPresetId,
    })),
  };
}

function structureMode(structure) {
  return structure === 'narration' ? 'voiceover'
    : structure === 'one-character' ? 'solo'
      : structure === 'dialogue' ? 'dialogue' : null;
}

function boundParticipant(binding) {
  return {
    roleId: binding.roleId,
    characterResourceId: binding.characterResourceId,
    voiceId: binding.voiceResourceId,
    animationPresetId: binding.animationPresetId,
  };
}

function selectBackground(preconfiguration, sceneIndex, sceneCount) {
  const backgrounds = preconfiguration.preferredBackgroundResourceIds;
  if (preconfiguration.backgroundStrategy === 'single-location' || backgrounds.length === 1) return backgrounds[0];
  const beatIndex = Math.min(backgrounds.length - 1, Math.floor((sceneIndex * backgrounds.length) / Math.max(1, sceneCount)));
  return backgrounds[beatIndex];
}
