import { ANIMATION_PARAMETERS } from '../../shared/animation-contract.js';
import { ANIMATION_PRESETS } from '../../shared/animation-presets.js';
import { loadCreativeRecipeCatalog } from './creative-contract.mjs';

export function expandEffectSequenceCommands(request, project, catalog, options = {}) {
  const recipes = options.recipeCatalog ?? loadCreativeRecipeCatalog();
  const sequence = recipes.effectSequences.find((entry) => entry.id === request.sequenceId);
  if (!sequence) fail('DIRECTOR_RECIPE_INVALID', 'La secuencia coordinada no existe.');
  if (!sequence.compatibleAnchorKinds.includes(request.anchor?.kind)) fail('DIRECTOR_RECIPE_INVALID', 'El ancla no es compatible con la secuencia.');
  const bindings = new Map((request.bindings ?? []).map((entry) => [entry.slotId, entry]));
  if (bindings.size !== sequence.slots.length) fail('DIRECTOR_RECIPE_INVALID', 'Cada slot necesita exactamente un elemento.');
  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const resolved = new Map();
  for (const slot of sequence.slots) {
    const binding = bindings.get(slot.id);
    const scene = project.scenes.find((entry) => entry.id === binding?.sceneId);
    const element = scene?.elements.find((entry) => entry.id === binding?.elementId);
    if (!scene || !element || !slot.elementTypes.includes(element.type)) fail('DIRECTOR_RECIPE_INVALID', `El slot ${slot.id} no tiene un elemento compatible.`);
    const resource = resources.get(element.resourceId);
    for (const parameterId of slot.requiredParameters) {
      const parameter = ANIMATION_PARAMETERS[parameterId];
      if (parameter.requiresResourceSupport && !resource?.capabilities?.parameters?.includes(parameterId)) fail('DIRECTOR_RECIPE_INVALID', `${element.id} no soporta ${parameterId}.`);
      const active = (element.tracks ?? []).find((track) => track.parameterId === parameterId);
      if (active) fail('DIRECTOR_TRACK_CUSTOMIZED', `La secuencia no puede sobrescribir la pista ${parameterId}.`);
    }
    resolved.set(slot.id, { scene, element });
  }
  return sequence.actions.map((action) => {
    const target = resolved.get(action.slotId);
    const preset = ANIMATION_PRESETS[action.presetId];
    if (!preset) fail('DIRECTOR_RECIPE_INVALID', `El preset ${action.presetId} no existe.`);
    return {
      type: 'apply-animation-preset', sceneId: target.scene.id, elementId: target.element.id,
      presetId: action.presetId, anchor: structuredClone(request.anchor),
      offsetSeconds: quantize(action.offsetSeconds + (request.offsetSeconds ?? 0)),
      intensity: action.intensity === 'inherit' ? (request.intensity ?? 'medium') : action.intensity,
    };
  });
}

function quantize(value) { return Math.round(value * 1000) / 1000; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
