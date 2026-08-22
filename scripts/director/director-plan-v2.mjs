import { createHash } from 'node:crypto';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { applyProjectEditorCommandBatch, createProjectEditor } from '../../shared/project-editor.js';
import { ANIMATION_PRESETS } from '../../shared/animation-presets.js';
import { effectSequenceWindow } from '../../shared/animation-sequences.js';
import { validateCreativeRecipeCatalog, loadCreativeRecipeCatalog } from './creative-contract.mjs';
import { listLayoutPresetIds, getLayoutPreset } from './director-plan.mjs';
import { expandEffectSequenceCommands } from './recipe-expander.mjs';
import { analyzeDirectorComposition } from './direction-quality.mjs';

const schema = readJson(path.join(projectRoot, 'schema', 'ai-video-plan-v2.schema.json'));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const MODES = new Set(['voiceover', 'solo', 'dialogue', 'visual-with-voiceover']);
const NARRATIVE_TEMPLATE_IDS = new Set(readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'narrative-templates.json')).templates.map((entry) => entry.id));
const DYNAMIC_CAMERA_PREFERENCE = Object.freeze(['push-in', 'drift-left', 'drift-right', 'rise', 'diagonal-glide', 'pull-back', 'slow-zoom', 'slow-pan']);

export function getDirectorPlanV2Schema() { return structuredClone(schema); }

// La gramática JSON garantiza la forma del plan, pero los modelos pequeños pueden
// combinar valores válidos que, juntos, contradicen el modo de una escena. Esta
// pasada conserva el contenido editorial y vuelve coherentes esas elecciones antes
// de la validación semántica estricta.
export function canonicalizeDirectorPlanV2(input, catalog, recipes = loadCreativeRecipeCatalog()) {
  const plan = structuredClone(input);
  const byType = (type) => catalog.entries.filter((entry) => entry.type === type);
  const characters = byType('character');
  const voices = byType('voice');
  const backgrounds = byType('background');
  const visualResources = [...byType('prop'), ...byType('template')];
  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const validSequences = new Set(recipes.effectSequences.map((entry) => entry.id));

  for (const [sceneIndex, scene] of (plan.scenes ?? []).entries()) {
    scene.effectSequenceIds = (scene.effectSequenceIds ?? []).filter((id) => validSequences.has(id));
    scene.visualElements = (scene.visualElements ?? []).flatMap((visual) => {
      const resource = resources.get(visual.resourceId);
      if (!resource || !['prop', 'template'].includes(resource.type)) return [];
      return [{ ...visual, type: resource.type }];
    });

    scene.participants = canonicalParticipants(scene, characters, voices, resources);
    if (scene.mode === 'dialogue' && (scene.speech?.length ?? 0) < 2) {
      scene.mode = 'solo';
      scene.participants = scene.participants.slice(0, 1);
    }
    scene.speech = canonicalSpeech(scene, voices, resources);

    const background = resources.get(scene.backgroundResourceId)?.type === 'background'
      ? resources.get(scene.backgroundResourceId)
      : backgrounds[0];
    if (background) {
      scene.backgroundResourceId = background.id;
      const cameras = background.capabilities?.cameraPresets ?? ['static'];
      if (!cameras.includes(scene.cameraPreset)) scene.cameraPreset = cameras[0];
      const shouldMoveBackground = scene.cameraPreset === 'static'
        && (plan.richnessProfile === 'dynamic'
          || (plan.richnessProfile !== 'simple' && plan.scenes.length > 1 && sceneIndex % 2 === 0));
      if (shouldMoveBackground) {
        const moving = DYNAMIC_CAMERA_PREFERENCE.filter((presetId) => cameras.includes(presetId));
        if (moving.length) scene.cameraPreset = moving[sceneIndex % moving.length];
      }
    }
    if (!listLayoutPresetIds().includes(scene.layoutPreset)) scene.layoutPreset = listLayoutPresetIds()[0];
    if (scene.transitionPreset === 'cut') scene.transitionDurationSeconds = 0;
    else scene.transitionDurationSeconds = Math.min(1, Math.max(0.15, scene.transitionDurationSeconds ?? 0.3));

    let recipe = findCompatibleRecipe(scene, recipes.sceneRecipes);
    if (!recipe && ['voiceover', 'visual-with-voiceover'].includes(scene.mode) && visualResources.length) {
      const resource = visualResources[0];
      scene.visualElements.push({ roleId: 'recurso-visual', type: resource.type, resourceId: resource.id, ...(resource.type === 'template' ? { word: 'IDEA' } : {}) });
      recipe = findCompatibleRecipe(scene, recipes.sceneRecipes);
    }
    if (recipe) {
      scene.sceneRecipeId = recipe.id;
      scene.effectSequenceIds = scene.effectSequenceIds.filter((id) => recipe.recommendedEffectSequenceIds.includes(id));
      scene.effectSequenceIds = completeSequenceCoverage(scene, recipe, recipes, plan.richnessProfile);
    }
  }
  return plan;
}

function completeSequenceCoverage(scene, recipe, recipes, richnessProfile) {
  const selected = [...scene.effectSequenceIds];
  if (richnessProfile === 'simple') return selected;
  const desiredPhases = richnessProfile === 'dynamic'
    ? ['opening', 'development', 'closing']
    : ['opening', 'development'];
  const byId = new Map(recipes.effectSequences.map((sequence) => [sequence.id, sequence]));
  const selectedPhases = new Set(selected.map((id) => byId.get(id)?.phase).filter(Boolean));
  for (const phase of desiredPhases) {
    if (selected.length >= 4 || selectedPhases.has(phase)) continue;
    const sequenceId = recipe.recommendedEffectSequenceIds.find((id) => {
      const sequence = byId.get(id);
      return sequence?.phase === phase && sequenceFitsPlannedElements(sequence, scene);
    });
    if (sequenceId && !selected.includes(sequenceId)) {
      selected.push(sequenceId);
      selectedPhases.add(phase);
    }
  }
  return selected;
}

function sequenceFitsPlannedElements(sequence, scene) {
  const counts = new Map();
  if (scene.participants.length) counts.set('character', scene.participants.length);
  for (const visual of scene.visualElements) counts.set(visual.type, (counts.get(visual.type) ?? 0) + 1);
  return sequence.slots.every((slot) => slot.elementTypes.some((type) => (counts.get(type) ?? 0) > 0));
}

function canonicalParticipants(scene, characters, voices, resources) {
  const required = scene.mode === 'dialogue' ? 2 : scene.mode === 'solo' ? 1 : scene.mode === 'voiceover' ? 0 : Math.min(2, scene.participants?.length ?? 0);
  if (required === 0) return [];
  const selected = [];
  for (let index = 0; index < required; index += 1) {
    const proposed = scene.participants?.[index];
    let character = resources.get(proposed?.characterResourceId);
    if (character?.type !== 'character' || selected.some((entry) => entry.characterResourceId === character.id)) {
      character = characters.find((entry) => !selected.some((selectedEntry) => selectedEntry.characterResourceId === entry.id)) ?? characters[0];
    }
    const voice = resources.get(proposed?.voiceId)?.type === 'voice' ? resources.get(proposed.voiceId) : voices[index % voices.length];
    if (!character || !voice) continue;
    const presets = character.capabilities?.animationPresets ?? ['idle-calm'];
    selected.push({
      roleId: proposed?.roleId && !selected.some((entry) => entry.roleId === proposed.roleId) ? proposed.roleId : `rol-${index + 1}`,
      characterResourceId: character.id,
      voiceId: voice.id,
      animationPresetId: presets.includes(proposed?.animationPresetId) ? proposed.animationPresetId : presets[0],
    });
  }
  return selected;
}

function canonicalSpeech(scene, voices, resources) {
  const speech = scene.speech ?? [];
  const voiceover = ['voiceover', 'visual-with-voiceover'].includes(scene.mode);
  const fallbackVoice = speech.map((turn) => resources.get(turn.voiceId)).find((entry) => entry?.type === 'voice') ?? voices[0];
  const turns = speech.map((turn, index) => {
    const common = { text: turn.text, ...(turn.pace ? { pace: turn.pace } : {}), gapAfterSeconds: turn.gapAfterSeconds ?? 0 };
    if (voiceover) {
      const voice = resources.get(turn.voiceId)?.type === 'voice' ? resources.get(turn.voiceId) : fallbackVoice;
      return { kind: 'voiceover', voiceId: voice.id, ...common };
    }
    const participant = scene.participants[index % scene.participants.length];
    const character = resources.get(participant.characterResourceId);
    const proposedRole = scene.participants.find((entry) => entry.roleId === turn.speakerRoleId);
    const speaker = scene.mode === 'dialogue' ? participant : (proposedRole ?? scene.participants[0]);
    const speakerCharacter = resources.get(speaker.characterResourceId) ?? character;
    const poses = speakerCharacter.capabilities?.poses ?? ['neutral'];
    const gestureId = poses.includes(turn.gestureId) ? turn.gestureId : (poses.includes('neutral') ? 'neutral' : poses[0]);
    const gestureAtWord = Number.isInteger(turn.gestureAtWord) && turn.gestureAtWord < wordCount(turn.text) ? { gestureAtWord: turn.gestureAtWord } : {};
    return { kind: 'character', speakerRoleId: speaker.roleId, ...common, gestureId, ...gestureAtWord };
  });
  if (turns.length) turns.at(-1).gapAfterSeconds = 0;
  return turns;
}

function findCompatibleRecipe(scene, recipes) {
  const present = new Set(scene.visualElements.map((entry) => entry.type));
  if (scene.participants.length) present.add('character');
  const compatible = (recipe) => {
    const allowed = new Set([...recipe.requiredElementTypes, ...recipe.optionalElementTypes]);
    return recipe.compatibleModes.includes(scene.mode)
      && scene.participants.length >= recipe.participantRange.minimum
      && scene.participants.length <= recipe.participantRange.maximum
      && recipe.requiredElementTypes.every((type) => present.has(type))
      && [...present].every((type) => allowed.has(type));
  };
  return recipes.find((entry) => entry.id === scene.sceneRecipeId && compatible(entry)) ?? recipes.find(compatible);
}

export function validateDirectorPlanV2(plan, catalog, recipes = loadCreativeRecipeCatalog()) {
  if (!validateSchema(plan)) fail('DIRECTOR_PLAN_SCHEMA_INVALID', formatErrors(validateSchema.errors));
  validateCreativeRecipeCatalog(recipes);
  if (plan.narrativeTemplateId && !NARRATIVE_TEMPLATE_IDS.has(plan.narrativeTemplateId)) fail('DIRECTOR_TEMPLATE_INVALID', '/narrativeTemplateId');
  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const recipeMap = new Map(recipes.sceneRecipes.map((entry) => [entry.id, entry]));
  const sequenceIds = new Set(recipes.effectSequences.map((entry) => entry.id));
  let totalWords = 0;
  const globalCharacters = new Set();
  for (const [sceneIndex, scene] of plan.scenes.entries()) {
    const base = `/scenes/${sceneIndex}`;
    if (!MODES.has(scene.mode)) fail('DIRECTOR_MODE_INVALID', `${base}/mode`);
    const recipe = recipeMap.get(scene.sceneRecipeId);
    if (!recipe || !recipe.compatibleModes.includes(scene.mode)) fail('DIRECTOR_RECIPE_INVALID', `${base}/sceneRecipeId`);
    if (scene.participants.length < recipe.participantRange.minimum || scene.participants.length > recipe.participantRange.maximum) fail('DIRECTOR_RECIPE_INVALID', `${base}/participants`);
    for (const [sequenceIndex, sequenceId] of (scene.effectSequenceIds ?? []).entries()) {
      if (!sequenceIds.has(sequenceId)) fail('DIRECTOR_RECIPE_INVALID', `${base}/effectSequenceIds/${sequenceIndex}`);
    }
    const roles = new Map();
    for (const [index, participant] of scene.participants.entries()) {
      if (roles.has(participant.roleId)) fail('DIRECTOR_CAST_INVALID', `${base}/participants/${index}/roleId`);
      const character = requireResource(resources, participant.characterResourceId, 'character', `${base}/participants/${index}/characterResourceId`);
      requireResource(resources, participant.voiceId, 'voice', `${base}/participants/${index}/voiceId`);
      if (!character.capabilities.animationPresets.includes(participant.animationPresetId)) fail('DIRECTOR_RESOURCE_UNSUPPORTED', `${base}/participants/${index}/animationPresetId`);
      roles.set(participant.roleId, participant);
      globalCharacters.add(participant.characterResourceId);
    }
    const expected = scene.mode === 'dialogue' ? 2 : scene.mode === 'solo' ? 1 : scene.mode === 'voiceover' ? 0 : null;
    if (expected !== null && scene.participants.length !== expected) fail('DIRECTOR_CAST_INVALID', `${base}/participants`);
    if (['voiceover', 'visual-with-voiceover'].includes(scene.mode) && scene.participants.length > 2) fail('DIRECTOR_CAST_INVALID', `${base}/participants`);
    if (scene.mode === 'dialogue' && new Set(scene.participants.map((entry) => entry.characterResourceId)).size !== 2) fail('DIRECTOR_CAST_INVALID', `${base}/participants`);
    const background = requireResource(resources, scene.backgroundResourceId, 'background', `${base}/backgroundResourceId`);
    if (!background.capabilities.cameraPresets.includes(scene.cameraPreset)) fail('DIRECTOR_RESOURCE_UNSUPPORTED', `${base}/cameraPreset`);
    if (!listLayoutPresetIds().includes(scene.layoutPreset)) fail('DIRECTOR_RESOURCE_UNSUPPORTED', `${base}/layoutPreset`);
    const presentTypes = new Set(scene.participants.length ? ['character'] : []);
    for (const [index, visual] of scene.visualElements.entries()) {
      requireResource(resources, visual.resourceId, visual.type, `${base}/visualElements/${index}/resourceId`);
      presentTypes.add(visual.type);
    }
    for (const required of recipe.requiredElementTypes) if (!presentTypes.has(required)) fail('DIRECTOR_RECIPE_INVALID', `${base}/visualElements`);
    const speaking = new Set();
    for (const [turnIndex, turn] of scene.speech.entries()) {
      totalWords += wordCount(turn.text);
      if (turn.kind === 'voiceover') {
        if (!['voiceover', 'visual-with-voiceover'].includes(scene.mode)) fail('DIRECTOR_SCENE_DIALOGUE_INVALID', `${base}/speech/${turnIndex}`);
        requireResource(resources, turn.voiceId, 'voice', `${base}/speech/${turnIndex}/voiceId`);
      } else {
        if (!['solo', 'dialogue'].includes(scene.mode)) fail('DIRECTOR_SCENE_DIALOGUE_INVALID', `${base}/speech/${turnIndex}`);
        const participant = roles.get(turn.speakerRoleId);
        if (!participant) fail('DIRECTOR_CAST_INVALID', `${base}/speech/${turnIndex}/speakerRoleId`);
        const character = resources.get(participant.characterResourceId);
        if (!character.capabilities.poses.includes(turn.gestureId)) fail('DIRECTOR_RESOURCE_UNSUPPORTED', `${base}/speech/${turnIndex}/gestureId`);
        if (turn.gestureAtWord !== undefined && turn.gestureAtWord >= wordCount(turn.text)) fail('DIRECTOR_GESTURE_TIMING_INVALID', `${base}/speech/${turnIndex}/gestureAtWord`);
        speaking.add(turn.speakerRoleId);
      }
    }
    if (scene.mode === 'dialogue' && speaking.size !== 2) fail('DIRECTOR_SCENE_DIALOGUE_INVALID', `${base}/speech`);
    if (scene.speech.at(-1).gapAfterSeconds !== 0) fail('DIRECTOR_SCENE_DIALOGUE_INVALID', `${base}/speech`);
    if (scene.transitionPreset === 'cut' && scene.transitionDurationSeconds !== 0) fail('DIRECTOR_TRANSITION_INVALID', `${base}/transitionDurationSeconds`);
    if (scene.transitionPreset === 'fade' && (scene.transitionDurationSeconds < 0.15 || scene.transitionDurationSeconds > 1)) fail('DIRECTOR_TRANSITION_INVALID', `${base}/transitionDurationSeconds`);
  }
  const composition = analyzeDirectorComposition({ plan, recipes });
  if (!composition.passed) fail('DIRECTOR_COMPOSITION_INVALID', JSON.stringify(composition.issues));
  const maximumWords = Math.max(40, Math.ceil(plan.targetDurationSeconds * 3.2));
  if (totalWords > maximumWords) fail('DIRECTOR_DURATION_BUDGET_EXCEEDED', `words=${totalWords}; maximum=${maximumWords}; targetSeconds=${plan.targetDurationSeconds}`);
  const totalWeight = plan.scenes.reduce((sum, scene) => sum + scene.durationWeight, 0);
  const sceneBudgets = plan.scenes.map((scene, index) => ({
    sceneIndex: index,
    durationWeight: scene.durationWeight,
    targetSeconds: round(plan.targetDurationSeconds * scene.durationWeight / totalWeight),
    maximumWords: Math.max(8, Math.ceil(maximumWords * scene.durationWeight / totalWeight)),
  }));
  return { totalWords, maximumWords, sceneBudgets, modes: [...new Set(plan.scenes.map((scene) => scene.mode))], globalCharacterCount: globalCharacters.size };
}

export function normalizeDirectorPlanV2(plan, catalog, options = {}) {
  const recipes = options.recipes ?? loadCreativeRecipeCatalog();
  const budget = validateDirectorPlanV2(plan, catalog, recipes);
  const semanticHash = hashJson({ plan, promptHash: options.promptHash ?? null, normalizerVersion: 2 });
  let project = {
    version: 1,
    id: safeId(options.projectId || `${slug(plan.title)}-${semanticHash.slice(0, 8)}`),
    title: plan.title,
    video: { width: 1080, height: 1920, fps: 30 },
    seed: Number.parseInt(semanticHash.slice(0, 8), 16),
    resourceCatalog: options.resourceCatalog || 'assets/catalog/authoring-resources.json',
    ...(plan.musicResourceId ? { musicResourceId: plan.musicResourceId } : {}),
    scenes: plan.scenes.map((scene, index) => normalizeScene(scene, index, plan.scenes.length)),
  };
  project = materializeEffectSequences(project, plan, catalog, recipes);
  const composition = analyzeDirectorComposition({ project });
  if (!composition.passed) fail('DIRECTOR_COMPOSITION_INVALID', JSON.stringify(composition.issues));
  validateVideoProjectDocument({ project, catalog, assetsRoot: options.assetsRoot || path.join(projectRoot, 'public') });
  return { project, semanticHash, budget };
}

function materializeEffectSequences(project, plan, catalog, recipes) {
  let state = createProjectEditor(project, catalog);
  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  for (const [sceneIndex, plannedScene] of plan.scenes.entries()) {
    const recipe = recipes.sceneRecipes.find((entry) => entry.id === plannedScene.sceneRecipeId);
    const sequenceIds = plannedScene.effectSequenceIds ?? [];
    const developmentCount = sequenceIds.filter((id) => recipes.effectSequences.find((entry) => entry.id === id)?.phase === 'development').length;
    let developmentIndex = 0;
    const elementUseCounts = new Map();
    for (const sequenceId of sequenceIds) {
      const sequence = recipes.effectSequences.find((entry) => entry.id === sequenceId);
      if (!sequence) continue;
      const scene = state.project.scenes[sceneIndex];
      const bindings = resolveSequenceBindings(scene, sequence, resources, {
        preferredElementTypes: recipe?.requiredElementTypes ?? [],
        elementUseCounts,
      });
      if (bindings.length !== sequence.slots.length) continue;
      const placement = placeSequence(sequence, scene, developmentIndex, developmentCount);
      if (sequence.phase === 'development') developmentIndex += 1;
      if (!placement) continue;
      try {
        const commands = expandEffectSequenceCommands({
          sequenceId,
          anchor: placement.anchor,
          offsetSeconds: placement.offsetSeconds,
          intensity: 'medium',
          bindings,
        }, state.project, catalog, { recipeCatalog: recipes });
        state = applyProjectEditorCommandBatch(state, commands);
        for (const binding of bindings) {
          elementUseCounts.set(binding.elementId, (elementUseCounts.get(binding.elementId) ?? 0) + 1);
        }
      } catch (error) {
        if (!['DIRECTOR_TRACK_CUSTOMIZED', 'EDITOR_TRACK_CUSTOMIZED'].includes(error?.code)) throw error;
      }
    }
  }
  return state.project;
}

function placeSequence(sequence, scene, developmentIndex, developmentCount) {
  if (sequence.phase === 'closing') {
    const anchor = sequence.compatibleAnchorKinds.includes('scene')
      ? { kind: 'scene', edge: 'end' }
      : scene.dialogue.length && sequence.compatibleAnchorKinds.includes('turn')
        ? { kind: 'turn', turnId: scene.dialogue.at(-1).id, edge: 'end' }
        : null;
    if (!anchor) return null;
    return { anchor, offsetSeconds: -effectSequenceWindow(sequence, 'medium').endOffsetSeconds };
  }
  if (sequence.phase === 'development' && scene.dialogue.length) {
    const position = Math.min(
      scene.dialogue.length - 1,
      Math.floor(((developmentIndex + 1) * scene.dialogue.length) / (developmentCount + 1)),
    );
    const turn = scene.dialogue[position];
    const words = wordCount(turn.text);
    if (sequence.compatibleAnchorKinds.includes('word') && words >= 3) {
      return { anchor: { kind: 'word', turnId: turn.id, wordIndex: Math.floor(words / 2) }, offsetSeconds: 0 };
    }
    if (sequence.compatibleAnchorKinds.includes('turn')) {
      return { anchor: { kind: 'turn', turnId: turn.id, edge: 'start' }, offsetSeconds: 0 };
    }
  }
  if (sequence.compatibleAnchorKinds.includes('scene')) {
    return { anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0 };
  }
  if (scene.dialogue.length && sequence.compatibleAnchorKinds.includes('turn')) {
    return { anchor: { kind: 'turn', turnId: scene.dialogue[0].id, edge: 'start' }, offsetSeconds: 0 };
  }
  return null;
}

function resolveSequenceBindings(scene, sequence, resources, options = {}) {
  const actionParameters = new Map(sequence.slots.map((slot) => [slot.id, new Set(slot.requiredParameters)]));
  for (const action of sequence.actions) {
    const parameterId = ANIMATION_PRESETS[action.presetId]?.parameterId;
    if (parameterId) actionParameters.get(action.slotId)?.add(parameterId);
  }
  const preferredTypes = new Set(options.preferredElementTypes ?? []);
  const useCounts = options.elementUseCounts ?? new Map();
  const candidates = sequence.slots.map((slot, index) => ({
    slot,
    index,
    elements: scene.elements.filter((element) => slot.elementTypes.includes(element.type)
      && supportsParameters(element, resources.get(element.resourceId), [...actionParameters.get(slot.id)])
      && !(element.tracks ?? []).some((track) => actionParameters.get(slot.id).has(track.parameterId)))
      .sort((left, right) => {
        const leftPreferred = preferredTypes.has(left.type) ? 0 : 1;
        const rightPreferred = preferredTypes.has(right.type) ? 0 : 1;
        return leftPreferred - rightPreferred
          || (useCounts.get(left.id) ?? 0) - (useCounts.get(right.id) ?? 0)
          || left.id.localeCompare(right.id);
      }),
  })).sort((left, right) => left.elements.length - right.elements.length || left.index - right.index);
  const selected = new Map();
  const used = new Set();
  const visit = (index) => {
    if (index === candidates.length) return true;
    const candidate = candidates[index];
    for (const element of candidate.elements) {
      if (used.has(element.id)) continue;
      selected.set(candidate.slot.id, element.id);
      used.add(element.id);
      if (visit(index + 1)) return true;
      selected.delete(candidate.slot.id);
      used.delete(element.id);
    }
    return false;
  };
  if (!visit(0)) return [];
  return sequence.slots.map((slot) => ({ slotId: slot.id, sceneId: scene.id, elementId: selected.get(slot.id) }));
}

function supportsParameters(element, resource, parameterIds) {
  return parameterIds.every((parameterId) => {
    if (['position.x', 'position.y', 'scale', 'rotationDegrees', 'opacity'].includes(parameterId)) return ['character', 'prop'].includes(element.type);
    return resource?.capabilities?.parameters?.includes(parameterId);
  });
}

function normalizeScene(scene, sceneIndex, sceneCount) {
  const sceneId = `escena-${String(sceneIndex + 1).padStart(2, '0')}`;
  const layout = getLayoutPreset(scene.layoutPreset);
  const roleToElement = new Map();
  const elements = scene.participants.map((participant, index) => {
    const slot = layout?.[index === 0 ? 'a' : 'b'] ?? { x: index === 0 ? 360 : 720, y: 1180, scale: 0.75, zIndex: 20 + index };
    const id = `${sceneId}-personaje-${index + 1}`;
    roleToElement.set(participant.roleId, id);
    return { id, type: 'character', resourceId: participant.characterResourceId, transform: transform(slot.x, slot.y, slot.scale, slot.zIndex), poseId: 'neutral', animationPreset: participant.animationPresetId };
  });
  let propIndex = 0;
  scene.visualElements.forEach((visual, index) => {
    if (visual.type === 'prop') {
      const placement = placeProp(scene.participants.length, propIndex, elements);
      propIndex += 1;
      elements.push({ id: `${sceneId}-prop-${index + 1}`, type: 'prop', resourceId: visual.resourceId, transform: transform(placement.x, placement.y, placement.scale, placement.zIndex) });
    }
    else elements.push({ id: `${sceneId}-plantilla-${index + 1}`, type: 'template', templateId: visual.resourceId, values: { word: visual.word || 'IDEA' }, transform: transform(540, 780, 1, 40 + index) });
  });
  const participantByRole = new Map(scene.participants.map((entry) => [entry.roleId, entry]));
  const normalized = {
    id: sceneId, title: scene.title,
    background: { resourceId: scene.backgroundResourceId, cameraPreset: scene.cameraPreset },
    elements,
    dialogue: scene.speech.map((turn, index) => turn.kind === 'voiceover' ? {
      id: `${sceneId}-turno-${index + 1}`, speakerType: 'voiceover', text: turn.text.trim(), voiceId: turn.voiceId, gestureId: 'neutral', ...(turn.pace ? { pace: turn.pace } : {}), gapAfterSeconds: index === scene.speech.length - 1 ? 0 : turn.gapAfterSeconds,
    } : {
      id: `${sceneId}-turno-${index + 1}`, speakerElementId: roleToElement.get(turn.speakerRoleId), text: turn.text.trim(), voiceId: participantByRole.get(turn.speakerRoleId).voiceId, gestureId: turn.gestureId, ...(turn.gestureAtWord !== undefined ? { gestureAtWord: turn.gestureAtWord } : {}), ...(turn.pace ? { pace: turn.pace } : {}), gapAfterSeconds: index === scene.speech.length - 1 ? 0 : turn.gapAfterSeconds,
    }),
  };
  if (sceneIndex < sceneCount - 1) normalized.transitionToNext = { preset: scene.transitionPreset, durationSeconds: scene.transitionPreset === 'fade' ? scene.transitionDurationSeconds : 0 };
  return normalized;
}

function placeProp(characterCount, propIndex, elements) {
  const noCharacter = [
    { x: 540, y: 860, scale: 0.74 }, { x: 300, y: 620, scale: 0.58 },
    { x: 780, y: 620, scale: 0.58 }, { x: 300, y: 1100, scale: 0.52 },
    { x: 780, y: 1100, scale: 0.52 },
  ];
  const oneCharacter = [
    { x: 820, y: 720, scale: 0.54 }, { x: 540, y: 470, scale: 0.48 },
    { x: 870, y: 1080, scale: 0.44 }, { x: 190, y: 520, scale: 0.42 },
  ];
  const twoCharacters = [
    { x: 540, y: 470, scale: 0.48 }, { x: 160, y: 610, scale: 0.4 },
    { x: 920, y: 610, scale: 0.4 }, { x: 540, y: 270, scale: 0.36 },
  ];
  const placements = characterCount === 0 ? noCharacter : characterCount === 1 ? oneCharacter : twoCharacters;
  const placement = { ...placements[propIndex % placements.length] };
  if (characterCount === 1) {
    const character = elements.find((element) => element.type === 'character');
    if (character?.transform.x > 540) placement.x = 1080 - placement.x;
  }
  return { ...placement, zIndex: 10 + propIndex };
}

function transform(x, y, scale, zIndex) { return { x, y, anchorX: 0.5, anchorY: 0.5, scale, rotationDegrees: 0, opacity: 1, zIndex }; }
function requireResource(resources, id, type, pathValue) { const resource = resources.get(id); if (!resource || resource.type !== type) fail('DIRECTOR_RESOURCE_INVALID', pathValue); return resource; }
function wordCount(text) { return text.trim().split(/\s+/u).filter(Boolean).length; }
function round(value) { return Math.round(value * 1000) / 1000; }
function hashJson(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function slug(value) { return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'video-generado'; }
function safeId(value) { return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64); }
function formatErrors(errors) { return (errors || []).slice(0, 12).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; '); }
function fail(code, detail) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message: 'El Director produjo un plan flexible inválido.',
    technicalDetail: detail,
    suggestedAction: 'Reintentá la propuesta para que el Director repare el plan.',
  });
}
