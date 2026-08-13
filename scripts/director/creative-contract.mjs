// Fase V0 — validación estructural y semántica de variedad creativa.
//
// Los contratos son aditivos: todavía no compilan ni renderizan escenas
// flexibles. Su propósito es impedir que Director, editor y runtime inventen
// vocabularios diferentes durante las siguientes fases.

import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ANIMATION_PARAMETERS } from '../../shared/animation-contract.js';
import { ANIMATION_PRESETS } from '../../shared/animation-presets.js';
import {
  CREATIVE_LIMITS,
  CREATIVE_SCENE_MODES,
} from '../../shared/creative-capabilities.js';
import { projectRoot, readJson } from '../stage1/common.mjs';

export {
  CREATIVE_CAPABILITY_DEFINITIONS,
  CREATIVE_CAPABILITY_VERSION,
  CREATIVE_LIMITS,
  CREATIVE_SCENE_MODES,
  CREATIVE_SUPPORT_STATES,
  buildCreativeCapabilityMatrix,
  capabilityStatus,
} from '../../shared/creative-capabilities.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateBlueprintSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'creative-scene-blueprint.schema.json')));
const validateRecipeSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'creative-recipe-catalog.schema.json')));

export const CREATIVE_ERROR_CATALOG = Object.freeze({
  CREATIVE_DOCUMENT_INVALID: errorEntry(
    'El blueprint de escena no cumple el contrato creativo V1.',
    'Revisá la estructura contra creative-scene-blueprint.schema.json.',
  ),
  CREATIVE_RECIPE_CATALOG_INVALID: errorEntry(
    'El catálogo de recetas creativas no cumple el contrato V1.',
    'Revisá la estructura y las referencias del catálogo de recetas.',
  ),
  CREATIVE_ID_DUPLICATED: errorEntry(
    'Dos elementos del contrato creativo comparten el mismo identificador.',
    'Asigná identificadores únicos dentro de su alcance.',
  ),
  CREATIVE_MODE_PARTICIPANTS_INVALID: errorEntry(
    'La cantidad de personajes no corresponde al modo de escena.',
    'Ajustá los participantes o elegí otro modo de escena.',
  ),
  CREATIVE_MODE_SPEECH_INVALID: errorEntry(
    'El tipo de voz no corresponde al modo de escena.',
    'Usá narración fuera de campo o voz de personaje según el modo elegido.',
  ),
  CREATIVE_REFERENCE_INVALID: errorEntry(
    'Una referencia del blueprint creativo no existe.',
    'Elegí un rol, turno, receta o slot declarado en el mismo contexto.',
  ),
  CREATIVE_RESOURCE_INVALID: errorEntry(
    'Un recurso no existe o no tiene el tipo requerido.',
    'Elegí un recurso compatible del catálogo de autoría.',
  ),
  CREATIVE_RECIPE_INCOMPATIBLE: errorEntry(
    'La receta no es compatible con la estructura de la escena.',
    'Elegí una receta compatible con el modo, los participantes y los elementos presentes.',
  ),
  CREATIVE_SEQUENCE_INCOMPATIBLE: errorEntry(
    'La secuencia coordinada no es compatible con sus bindings o su ancla.',
    'Completá cada slot con un elemento compatible y una referencia temporal admitida.',
  ),
  CREATIVE_PARAMETER_UNSUPPORTED: errorEntry(
    'El recurso no soporta un parámetro requerido por la secuencia.',
    'Usá otra secuencia o un recurso que declare esa capacidad.',
  ),
});

export class CreativeContractError extends Error {
  constructor(code, pathValue = '/', technicalDetail = '') {
    const entry = CREATIVE_ERROR_CATALOG[code];
    super(entry?.message ?? 'Fallo desconocido del contrato creativo.');
    this.name = 'CreativeContractError';
    this.code = code;
    this.path = pathValue;
    this.suggestedAction = entry?.suggestedAction ?? '';
    if (technicalDetail) this.technicalDetail = technicalDetail;
  }
}

export function loadCreativeRecipeCatalog(
  catalogPath = path.join(projectRoot, 'public', 'assets', 'catalog', 'creative-recipes.json'),
) {
  return validateCreativeRecipeCatalog(readJson(catalogPath));
}

export function validateCreativeRecipeCatalog(document) {
  if (!validateRecipeSchema(document)) {
    schemaFailure('CREATIVE_RECIPE_CATALOG_INVALID', validateRecipeSchema.errors);
  }

  uniqueIds(document.sceneRecipes, '/sceneRecipes');
  uniqueIds(document.effectSequences, '/effectSequences');
  const sequences = new Map(document.effectSequences.map((sequence) => [sequence.id, sequence]));

  for (const [recipeIndex, recipe] of document.sceneRecipes.entries()) {
    const recipePath = `/sceneRecipes/${recipeIndex}`;
    if (recipe.participantRange.minimum > recipe.participantRange.maximum) {
      fail('CREATIVE_RECIPE_CATALOG_INVALID', `${recipePath}/participantRange`, 'minimum no puede superar maximum');
    }
    uniqueIds(recipe.beats, `${recipePath}/beats`);
    const required = new Set(recipe.requiredElementTypes);
    const overlap = recipe.optionalElementTypes.find((type) => required.has(type));
    if (overlap) {
      fail('CREATIVE_RECIPE_CATALOG_INVALID', `${recipePath}/optionalElementTypes`, `${overlap} figura como requerido y opcional`);
    }
    for (const modeId of recipe.compatibleModes) {
      const mode = CREATIVE_SCENE_MODES[modeId];
      const overlaps = recipe.participantRange.maximum >= mode.participantRange.minimum
        && recipe.participantRange.minimum <= mode.participantRange.maximum;
      if (!overlaps) {
        fail('CREATIVE_RECIPE_CATALOG_INVALID', `${recipePath}/compatibleModes`, `${modeId} no intersecta participantRange`);
      }
    }
    for (const sequenceId of recipe.recommendedEffectSequenceIds) {
      if (!sequences.has(sequenceId)) {
        fail('CREATIVE_REFERENCE_INVALID', `${recipePath}/recommendedEffectSequenceIds`, sequenceId);
      }
    }
  }

  for (const [sequenceIndex, sequence] of document.effectSequences.entries()) {
    const sequencePath = `/effectSequences/${sequenceIndex}`;
    uniqueIds(sequence.slots, `${sequencePath}/slots`);
    const slots = new Map(sequence.slots.map((slot) => [slot.id, slot]));
    const exercisedParameters = new Map(sequence.slots.map((slot) => [slot.id, new Set()]));
    for (const [slotIndex, slot] of sequence.slots.entries()) {
      for (const parameterId of slot.requiredParameters) {
        if (!Object.hasOwn(ANIMATION_PARAMETERS, parameterId)) {
          fail('CREATIVE_RECIPE_CATALOG_INVALID', `${sequencePath}/slots/${slotIndex}/requiredParameters`, parameterId);
        }
        const parameter = ANIMATION_PARAMETERS[parameterId];
        if (!slot.elementTypes.some((type) => parameter.elementTypes.includes(type))) {
          fail('CREATIVE_RECIPE_CATALOG_INVALID', `${sequencePath}/slots/${slotIndex}`, `${parameterId} no aplica al slot`);
        }
      }
    }
    for (const [actionIndex, action] of sequence.actions.entries()) {
      const actionPath = `${sequencePath}/actions/${actionIndex}`;
      const slot = slots.get(action.slotId);
      if (!slot) fail('CREATIVE_REFERENCE_INVALID', `${actionPath}/slotId`, action.slotId);
      const preset = ANIMATION_PRESETS[action.presetId];
      if (!preset) fail('CREATIVE_REFERENCE_INVALID', `${actionPath}/presetId`, action.presetId);
      const parameter = ANIMATION_PARAMETERS[preset.parameterId];
      if (!slot.elementTypes.some((type) => parameter.elementTypes.includes(type))) {
        fail('CREATIVE_RECIPE_CATALOG_INVALID', actionPath, `${action.presetId} no aplica a ${action.slotId}`);
      }
      if (exercisedParameters.get(action.slotId).has(preset.parameterId)) {
        fail(
          'CREATIVE_RECIPE_CATALOG_INVALID',
          actionPath,
          `${action.slotId} repite una acción sobre ${preset.parameterId}`,
        );
      }
      exercisedParameters.get(action.slotId).add(preset.parameterId);
    }
    for (const [slotIndex, slot] of sequence.slots.entries()) {
      for (const parameterId of slot.requiredParameters) {
        if (!exercisedParameters.get(slot.id).has(parameterId)) {
          fail('CREATIVE_RECIPE_CATALOG_INVALID', `${sequencePath}/slots/${slotIndex}/requiredParameters`, `${parameterId} no tiene acción`);
        }
      }
    }
  }

  return document;
}

export function validateCreativeSceneBlueprint(document, options = {}) {
  if (!validateBlueprintSchema(document)) {
    schemaFailure('CREATIVE_DOCUMENT_INVALID', validateBlueprintSchema.errors);
  }
  const resourceCatalog = options.resourceCatalog;
  if (!resourceCatalog || resourceCatalog.version !== 1 || !Array.isArray(resourceCatalog.entries)) {
    fail('CREATIVE_RESOURCE_INVALID', '/resourceCatalog', 'se necesita un catálogo de autoría V1');
  }
  const recipeCatalog = options.recipeCatalog ?? loadCreativeRecipeCatalog();
  validateCreativeRecipeCatalog(recipeCatalog);
  const resources = new Map((resourceCatalog?.entries ?? []).map((entry) => [entry.id, entry]));
  const recipes = new Map(recipeCatalog.sceneRecipes.map((recipe) => [recipe.id, recipe]));
  const sequences = new Map(recipeCatalog.effectSequences.map((sequence) => [sequence.id, sequence]));
  const mode = CREATIVE_SCENE_MODES[document.mode];

  if (document.participants.length < mode.participantRange.minimum
    || document.participants.length > mode.participantRange.maximum) {
    fail(
      'CREATIVE_MODE_PARTICIPANTS_INVALID',
      '/participants',
      `${document.mode} admite ${mode.participantRange.minimum}..${mode.participantRange.maximum}; recibió ${document.participants.length}`,
    );
  }

  const roleEntries = [
    ...document.participants.map((participant, index) => ({
      roleId: participant.roleId,
      type: 'character',
      resourceId: participant.characterResourceId,
      path: `/participants/${index}`,
    })),
    ...document.visualElements.map((element, index) => ({
      roleId: element.roleId,
      type: element.type,
      resourceId: element.resourceId,
      path: `/visualElements/${index}`,
    })),
  ];
  uniqueRoleEntries(roleEntries);
  const roles = new Map(roleEntries.map((entry) => [entry.roleId, entry]));

  for (const [index, participant] of document.participants.entries()) {
    const participantPath = `/participants/${index}`;
    const character = requireResource(resources, participant.characterResourceId, 'character', `${participantPath}/characterResourceId`);
    requireResource(resources, participant.voiceId, 'voice', `${participantPath}/voiceId`);
    if (!character.capabilities?.animationPresets?.includes(participant.animationPresetId)) {
      fail('CREATIVE_PARAMETER_UNSUPPORTED', `${participantPath}/animationPresetId`, participant.animationPresetId);
    }
  }
  for (const [index, element] of document.visualElements.entries()) {
    requireResource(resources, element.resourceId, element.type, `/visualElements/${index}/resourceId`);
  }

  uniqueIds(document.speech, '/speech');
  const turnById = new Map(document.speech.map((turn) => [turn.id, turn]));
  const speakingRoles = new Set();
  for (const [index, turn] of document.speech.entries()) {
    const turnPath = `/speech/${index}`;
    if (!mode.speechKinds.includes(turn.kind)) {
      fail('CREATIVE_MODE_SPEECH_INVALID', `${turnPath}/kind`, `${document.mode} no admite ${turn.kind}`);
    }
    requireResource(resources, turn.voiceId, 'voice', `${turnPath}/voiceId`);
    if (turn.kind === 'character') {
      const role = roles.get(turn.speakerRoleId);
      if (!role || role.type !== 'character') {
        fail('CREATIVE_REFERENCE_INVALID', `${turnPath}/speakerRoleId`, turn.speakerRoleId);
      }
      const participant = document.participants.find((entry) => entry.roleId === turn.speakerRoleId);
      if (participant.voiceId !== turn.voiceId) {
        fail('CREATIVE_RESOURCE_INVALID', `${turnPath}/voiceId`, 'la voz no coincide con la del participante');
      }
      speakingRoles.add(turn.speakerRoleId);
      if (turn.gestureId !== undefined) {
        const character = resources.get(participant.characterResourceId);
        if (resourceCatalog && !character.capabilities?.poses?.includes(turn.gestureId)) {
          fail('CREATIVE_PARAMETER_UNSUPPORTED', `${turnPath}/gestureId`, turn.gestureId);
        }
      }
      if (turn.gestureAtWord !== undefined && turn.gestureAtWord >= wordCount(turn.text)) {
        fail('CREATIVE_REFERENCE_INVALID', `${turnPath}/gestureAtWord`, String(turn.gestureAtWord));
      }
    }
  }
  if (document.mode === 'dialogue' && speakingRoles.size !== document.participants.length) {
    fail('CREATIVE_MODE_SPEECH_INVALID', '/speech', 'cada participante del diálogo debe hablar al menos una vez');
  }

  const recipe = recipes.get(document.sceneRecipeId);
  if (!recipe) fail('CREATIVE_REFERENCE_INVALID', '/sceneRecipeId', document.sceneRecipeId);
  if (!recipe.compatibleModes.includes(document.mode)
    || document.participants.length < recipe.participantRange.minimum
    || document.participants.length > recipe.participantRange.maximum) {
    fail('CREATIVE_RECIPE_INCOMPATIBLE', '/sceneRecipeId', document.sceneRecipeId);
  }
  const presentTypes = new Set(roleEntries.map((entry) => entry.type));
  for (const type of recipe.requiredElementTypes) {
    if (!presentTypes.has(type)) fail('CREATIVE_RECIPE_INCOMPATIBLE', '/visualElements', `falta ${type}`);
  }

  uniqueIds(document.effectSequences, '/effectSequences');
  for (const [index, request] of document.effectSequences.entries()) {
    validateSequenceRequest(request, `/effectSequences/${index}`, { roles, turnById, resources, sequences, resourceCatalog });
  }

  if (document.speech.at(-1).gapAfterSeconds !== 0) {
    fail('CREATIVE_DOCUMENT_INVALID', `/speech/${document.speech.length - 1}/gapAfterSeconds`, 'el último turno debe cerrar con pausa 0');
  }
  return document;
}

function validateSequenceRequest(request, requestPath, context) {
  const sequence = context.sequences.get(request.sequenceId);
  if (!sequence) fail('CREATIVE_REFERENCE_INVALID', `${requestPath}/sequenceId`, request.sequenceId);
  if (!sequence.compatibleAnchorKinds.includes(request.anchor.kind)) {
    fail('CREATIVE_SEQUENCE_INCOMPATIBLE', `${requestPath}/anchor`, request.anchor.kind);
  }
  validateAnchor(request.anchor, `${requestPath}/anchor`, context.turnById);
  const slotById = new Map(sequence.slots.map((slot) => [slot.id, slot]));
  const bindings = new Map();
  for (const [bindingIndex, binding] of request.bindings.entries()) {
    const bindingPath = `${requestPath}/bindings/${bindingIndex}`;
    if (bindings.has(binding.slotId)) fail('CREATIVE_ID_DUPLICATED', `${bindingPath}/slotId`, binding.slotId);
    const slot = slotById.get(binding.slotId);
    if (!slot) fail('CREATIVE_REFERENCE_INVALID', `${bindingPath}/slotId`, binding.slotId);
    const role = context.roles.get(binding.elementRoleId);
    if (!role) fail('CREATIVE_REFERENCE_INVALID', `${bindingPath}/elementRoleId`, binding.elementRoleId);
    if (!slot.elementTypes.includes(role.type)) {
      fail('CREATIVE_SEQUENCE_INCOMPATIBLE', bindingPath, `${role.type} no aplica a ${slot.id}`);
    }
    const resource = context.resources.get(role.resourceId);
    for (const parameterId of slot.requiredParameters) {
      const parameter = ANIMATION_PARAMETERS[parameterId];
      const supported = !parameter.requiresResourceSupport
        || resource?.capabilities?.parameters?.includes(parameterId);
      if (!supported) fail('CREATIVE_PARAMETER_UNSUPPORTED', bindingPath, `${role.resourceId}:${parameterId}`);
    }
    bindings.set(binding.slotId, role.roleId);
  }
  for (const slot of sequence.slots) {
    if (!bindings.has(slot.id)) fail('CREATIVE_SEQUENCE_INCOMPATIBLE', `${requestPath}/bindings`, `falta slot ${slot.id}`);
  }
  if (bindings.size !== sequence.slots.length) {
    fail('CREATIVE_SEQUENCE_INCOMPATIBLE', `${requestPath}/bindings`, 'hay bindings adicionales');
  }
}

function validateAnchor(anchor, anchorPath, turns) {
  if (anchor.kind === 'scene') return;
  const turn = turns.get(anchor.turnId);
  if (!turn) fail('CREATIVE_REFERENCE_INVALID', `${anchorPath}/turnId`, anchor.turnId);
  if (anchor.kind === 'word' && anchor.wordIndex >= wordCount(turn.text)) {
    fail('CREATIVE_REFERENCE_INVALID', `${anchorPath}/wordIndex`, String(anchor.wordIndex));
  }
}

function requireResource(resources, id, type, pathValue) {
  const resource = resources.get(id);
  if (!resource || resource.type !== type) fail('CREATIVE_RESOURCE_INVALID', pathValue, `${id}:${type}`);
  return resource;
}

function uniqueRoleEntries(entries) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.roleId)) fail('CREATIVE_ID_DUPLICATED', `${entry.path}/roleId`, entry.roleId);
    seen.add(entry.roleId);
  }
}

function uniqueIds(entries, pathValue) {
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.id)) fail('CREATIVE_ID_DUPLICATED', `${pathValue}/${index}/id`, entry.id);
    seen.add(entry.id);
  }
}

function wordCount(text) {
  return String(text).trim().split(/\s+/u).filter(Boolean).length;
}

function schemaFailure(code, errors) {
  const first = errors?.[0];
  fail(code, first?.instancePath || '/', `${first?.instancePath ?? ''} ${first?.message ?? ''}`.trim());
}

function fail(code, pathValue, detail) {
  throw new CreativeContractError(code, pathValue, detail);
}

function errorEntry(message, suggestedAction) {
  return Object.freeze({ message, suggestedAction });
}

export const CREATIVE_CONTRACT_LIMITS = CREATIVE_LIMITS;
