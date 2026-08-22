// Expansión pura de secuencias coordinadas a comandos semánticos existentes.
//
// Este módulo no lee archivos ni depende de Node o del DOM. Director y editor
// le entregan el mismo catálogo validado/publicado y reciben exactamente el
// mismo lote determinista de `apply-animation-preset`.

import { ANIMATION_PARAMETERS } from './animation-contract.js';
import {
  ANIMATION_PRESETS,
  animationPresetWindow,
} from './animation-presets.js';

export function listApplicableEffectSequences(recipeCatalog, element, resource) {
  const sequences = Array.isArray(recipeCatalog?.effectSequences) ? recipeCatalog.effectSequences : [];
  return sequences.filter((sequence) => sequence.directorAvailability !== 'legacy'
    && sequence.slots.length === 1
    && sequence.slots[0].elementTypes.includes(element.type)
    && sequence.slots[0].requiredParameters.every((parameterId) => (
      !ANIMATION_PARAMETERS[parameterId]?.requiresResourceSupport
      || resource?.capabilities?.parameters?.includes(parameterId)
    )));
}

export function effectSequenceWindow(sequence, intensityId = 'medium') {
  if (!sequence || !Array.isArray(sequence.actions) || sequence.actions.length === 0) {
    fail('DIRECTOR_RECIPE_INVALID', 'La secuencia coordinada no tiene acciones.');
  }
  const windows = sequence.actions.map((action) => {
    const intensity = action.intensity === 'inherit' ? intensityId : action.intensity;
    const window = animationPresetWindow(action.presetId, intensity);
    return {
      start: quantize(action.offsetSeconds + window.startOffsetSeconds),
      end: quantize(action.offsetSeconds + window.endOffsetSeconds),
    };
  });
  return {
    startOffsetSeconds: Math.min(...windows.map((window) => window.start)),
    endOffsetSeconds: Math.max(...windows.map((window) => window.end)),
  };
}

export function expandEffectSequenceCommands(request, project, catalog, recipeCatalog) {
  const sequence = recipeCatalog?.effectSequences?.find((entry) => entry.id === request.sequenceId);
  if (!sequence) fail('DIRECTOR_RECIPE_INVALID', 'La secuencia coordinada no existe.');
  if (!sequence.compatibleAnchorKinds.includes(request.anchor?.kind)) {
    fail('DIRECTOR_RECIPE_INVALID', 'El ancla no es compatible con la secuencia.');
  }
  const bindings = new Map((request.bindings ?? []).map((entry) => [entry.slotId, entry]));
  if (bindings.size !== sequence.slots.length) {
    fail('DIRECTOR_RECIPE_INVALID', 'Cada slot necesita exactamente un elemento.');
  }
  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const resolved = new Map();
  for (const slot of sequence.slots) {
    const binding = bindings.get(slot.id);
    const scene = project.scenes.find((entry) => entry.id === binding?.sceneId);
    const element = scene?.elements.find((entry) => entry.id === binding?.elementId);
    if (!scene || !element || !slot.elementTypes.includes(element.type)) {
      fail('DIRECTOR_RECIPE_INVALID', `El slot ${slot.id} no tiene un elemento compatible.`);
    }
    const resource = resources.get(element.resourceId);
    for (const parameterId of slot.requiredParameters) {
      const parameter = ANIMATION_PARAMETERS[parameterId];
      if (!parameter) fail('DIRECTOR_RECIPE_INVALID', `El parámetro ${parameterId} no existe.`);
      if (parameter.requiresResourceSupport
        && !resource?.capabilities?.parameters?.includes(parameterId)) {
        fail('DIRECTOR_RECIPE_INVALID', `${element.id} no soporta ${parameterId}.`);
      }
      if ((element.tracks ?? []).some((track) => track.parameterId === parameterId)) {
        fail('DIRECTOR_TRACK_CUSTOMIZED', `La secuencia no puede sobrescribir la pista ${parameterId}.`);
      }
    }
    resolved.set(slot.id, { scene, element });
  }
  return sequence.actions.map((action) => {
    const target = resolved.get(action.slotId);
    if (!target || !ANIMATION_PRESETS[action.presetId]) {
      fail('DIRECTOR_RECIPE_INVALID', `El preset ${action.presetId} no existe.`);
    }
    return {
      type: 'apply-animation-preset',
      sceneId: target.scene.id,
      elementId: target.element.id,
      presetId: action.presetId,
      anchor: structuredClone(request.anchor),
      offsetSeconds: quantize(action.offsetSeconds + (request.offsetSeconds ?? 0)),
      intensity: action.intensity === 'inherit' ? (request.intensity ?? 'medium') : action.intensity,
    };
  });
}

function quantize(value) {
  return Math.round(value * 1000) / 1000;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
