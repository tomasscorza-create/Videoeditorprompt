export const CONTINUITY_BIBLE_VERSION = 1;

export function buildContinuityBible(plan) {
  const cast = [];
  const seenCharacters = new Set();
  const narratorVoices = [];
  const backgrounds = [];
  for (const scene of plan?.scenes ?? []) {
    for (const participant of scene.participants ?? []) {
      if (seenCharacters.has(participant.characterResourceId)) continue;
      seenCharacters.add(participant.characterResourceId);
      cast.push({
        roleId: participant.roleId,
        characterResourceId: participant.characterResourceId,
        voiceId: participant.voiceId,
      });
    }
    for (const turn of scene.speech ?? []) {
      if (turn.kind === 'voiceover' && !narratorVoices.includes(turn.voiceId)) narratorVoices.push(turn.voiceId);
    }
    if (scene.backgroundResourceId && !backgrounds.includes(scene.backgroundResourceId)) {
      backgrounds.push(scene.backgroundResourceId);
    }
  }
  return {
    version: CONTINUITY_BIBLE_VERSION,
    cast,
    narratorVoiceId: narratorVoices[0] ?? null,
    backgroundStrategy: backgrounds.length <= 1 ? 'single-location' : 'beat-variation',
    backgroundResourceIds: backgrounds,
  };
}

export function analyzeDirectorContinuity(plan, options = {}) {
  const issues = [];
  const roles = new Map();
  const characters = new Map();
  const voices = new Map();
  let narratorVoiceId = null;
  for (const [sceneIndex, scene] of (plan?.scenes ?? []).entries()) {
    for (const [participantIndex, participant] of (scene.participants ?? []).entries()) {
      const path = `/scenes/${sceneIndex}/participants/${participantIndex}`;
      const binding = `${participant.characterResourceId}|${participant.voiceId}`;
      if (roles.has(participant.roleId) && roles.get(participant.roleId) !== binding) {
        add(issues, 'ROLE_BINDING_CHANGED', path, `El rol ${participant.roleId} cambia de personaje o voz.`);
      }
      if (characters.has(participant.characterResourceId)) {
        const known = characters.get(participant.characterResourceId);
        if (known.voiceId !== participant.voiceId) add(issues, 'CHARACTER_VOICE_CHANGED', path, `El personaje ${participant.characterResourceId} cambia de voz.`);
        if (known.roleId !== participant.roleId) add(issues, 'CHARACTER_ROLE_CHANGED', path, `El personaje ${participant.characterResourceId} cambia de rol.`);
      }
      if (voices.has(participant.voiceId) && voices.get(participant.voiceId) !== participant.characterResourceId) {
        add(issues, 'VOICE_SHARED_BY_CHARACTERS', path, `La voz ${participant.voiceId} está asignada a más de un personaje.`);
      }
      roles.set(participant.roleId, binding);
      characters.set(participant.characterResourceId, { roleId: participant.roleId, voiceId: participant.voiceId });
      voices.set(participant.voiceId, participant.characterResourceId);
    }
    for (const [turnIndex, turn] of (scene.speech ?? []).entries()) {
      if (turn.kind !== 'voiceover') continue;
      narratorVoiceId ??= turn.voiceId;
      if (turn.voiceId !== narratorVoiceId) {
        add(issues, 'NARRATOR_VOICE_CHANGED', `/scenes/${sceneIndex}/speech/${turnIndex}/voiceId`, 'La voz narradora cambia sin una decisión editorial explícita.');
      }
    }
  }
  const bible = buildContinuityBible(plan);
  return {
    version: CONTINUITY_BIBLE_VERSION,
    passed: issues.length === 0,
    hardPassed: issues.every((issue) => issue.severity !== 'error'),
    bible,
    issues,
    metrics: {
      castSize: bible.cast.length,
      uniqueVoices: new Set(bible.cast.map((entry) => entry.voiceId)).size,
      backgroundCount: bible.backgroundResourceIds.length,
    },
  };
}

function add(issues, code, path, message) {
  issues.push({
    code,
    path,
    message,
    severity: 'error',
  });
}
