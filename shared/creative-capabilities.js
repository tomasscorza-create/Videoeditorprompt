// Registro puro de capacidades creativas V1.
//
// Este módulo no afirma que el runtime flexible ya exista. Congela el objetivo
// de V0 y distingue, por consumidor, qué está disponible hoy y qué sigue
// planificado. Entra en shared/ para que Director, editor y UI puedan derivar la
// misma matriz sin importar Node, DOM ni Ajv.

import { ANIMATION_PARAMETERS } from './animation-contract.js';
import { ANIMATION_PRESETS, listApplicablePresets } from './animation-presets.js';

export const CREATIVE_CAPABILITY_VERSION = 1;

export const CREATIVE_SUPPORT_STATES = Object.freeze([
  'available',
  'limited',
  'draft-only',
  'planned',
  'excluded',
]);

export const CREATIVE_LIMITS = deepFreeze({
  scenesPerProject: 8,
  visibleCharactersPerScene: { minimum: 0, maximum: 2 },
  spokenTurnsPerScene: 20,
  visualElementsPerScene: 8,
  effectSequencesPerScene: 8,
  sequenceSlots: 4,
  sequenceActions: 12,
});

export const CREATIVE_SCENE_MODES = deepFreeze({
  voiceover: {
    label: 'Narración sin personajes',
    participantRange: { minimum: 0, maximum: 0 },
    speechKinds: ['voiceover'],
  },
  solo: {
    label: 'Monólogo de un personaje',
    participantRange: { minimum: 1, maximum: 1 },
    speechKinds: ['character'],
  },
  dialogue: {
    label: 'Diálogo de dos personajes',
    participantRange: { minimum: 2, maximum: 2 },
    speechKinds: ['character'],
  },
  'visual-with-voiceover': {
    label: 'Composición visual con narración',
    participantRange: { minimum: 0, maximum: 2 },
    speechKinds: ['voiceover'],
  },
});

export const CREATIVE_CAPABILITY_DEFINITIONS = deepFreeze([
  capability('scene.multiple', 'Varias escenas', allAvailable()),
  capability('scene.dialogue', 'Diálogo con dos personajes', allAvailable()),
  capability('scene.solo', 'Monólogo con un personaje', flexibleScenePlanned()),
  capability('scene.voiceover', 'Narración fuera de campo', flexibleScenePlanned()),
  capability('scene.visual-with-voiceover', 'Escena visual narrada', flexibleScenePlanned()),
  capability('duration.measured-speech', 'Duración medida desde voz real', allAvailable()),
  capability('speech.character', 'Voz de personaje visible', allAvailable()),
  capability('speech.voiceover', 'Voz fuera de campo', flexibleScenePlanned()),
  capability('element.character', 'Personajes', allAvailable()),
  capability('element.prop', 'Props', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'planned', directorEditing: 'limited',
  }),
  capability('element.template', 'Plantillas visuales', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'planned', directorEditing: 'planned',
  }),
  capability('element.image', 'Imágenes como elementos', allExcluded()),
  capability('element.visibility', 'Ventana temporal de elementos', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'planned', directorEditing: 'planned',
  }),
  capability('transform.position-scale-depth', 'Posición, escala y capa', allAvailable()),
  capability('transform.rotation', 'Rotación', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'planned', directorEditing: 'planned',
  }),
  capability('transform.opacity', 'Opacidad', {
    authoring: 'available', preview: 'available', export: 'limited',
    directorCreation: 'planned', directorEditing: 'planned',
  }),
  capability('animation.preset', 'Presets individuales de animación', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'planned', directorEditing: 'available',
  }),
  capability('animation.manual-keyframes', 'Pistas y keyframes manuales', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'excluded', directorEditing: 'planned',
  }),
  capability('animation.sequence', 'Secuencias coordinadas', allPlanned()),
  capability('character.gesture', 'Gestos temporizados', allAvailable()),
  capability('layout.preset', 'Composición y foco por preset', allAvailable()),
  capability('background.camera', 'Fondo, paneo, zoom y parallax', allAvailable()),
  capability('subtitle.turn', 'Subtítulos por turno hablado', allAvailable()),
  capability('audio.music', 'Música del proyecto', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'available', directorEditing: 'planned',
  }),
  capability('transition.scene', 'Cortes y fundidos', allAvailable()),
  capability('structure.turn-editing', 'Alta, baja, orden y división de turnos', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'available', directorEditing: 'limited',
  }),
  capability('resource.local-library', 'Recursos creados o importados localmente', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'limited', directorEditing: 'limited',
  }),
  capability('montage.commands', 'Montaje profesional V2', {
    authoring: 'available', preview: 'available', export: 'available',
    directorCreation: 'excluded', directorEditing: 'planned',
  }),
]);

/**
 * Construye una proyección portable para prompts, UI y diagnósticos.
 * Los catálogos entran como datos ya validados por sus adaptadores Node.
 */
export function buildCreativeCapabilityMatrix({ resourceCatalog, recipeCatalog } = {}) {
  const entries = Array.isArray(resourceCatalog?.entries) ? resourceCatalog.entries : [];
  const sceneRecipes = Array.isArray(recipeCatalog?.sceneRecipes) ? recipeCatalog.sceneRecipes : [];
  const effectSequences = Array.isArray(recipeCatalog?.effectSequences) ? recipeCatalog.effectSequences : [];

  const resources = entries.map((entry) => {
    const declaredParameters = Array.isArray(entry.capabilities?.parameters)
      ? entry.capabilities.parameters
      : [];
    return {
      id: entry.id,
      type: entry.type,
      label: entry.label,
      parameters: declaredParameters.filter((id) => Object.hasOwn(ANIMATION_PARAMETERS, id)),
      animationPresetIds: ['character', 'prop'].includes(entry.type)
        ? listApplicablePresets(declaredParameters).map((preset) => preset.id)
        : [],
    };
  });

  return deepFreeze({
    version: CREATIVE_CAPABILITY_VERSION,
    limits: structuredClone(CREATIVE_LIMITS),
    sceneModes: Object.entries(CREATIVE_SCENE_MODES).map(([id, mode]) => ({ id, ...structuredClone(mode) })),
    capabilities: structuredClone(CREATIVE_CAPABILITY_DEFINITIONS),
    animation: {
      parameterIds: Object.keys(ANIMATION_PARAMETERS),
      presetIds: Object.keys(ANIMATION_PRESETS),
    },
    resources,
    recipes: {
      sceneRecipeIds: sceneRecipes.map((recipe) => recipe.id),
      effectSequenceIds: effectSequences.map((sequence) => sequence.id),
    },
  });
}

export function capabilityStatus(matrix, capabilityId, consumer) {
  const capabilityEntry = matrix?.capabilities?.find((entry) => entry.id === capabilityId);
  return capabilityEntry?.support?.[consumer] ?? null;
}

function capability(id, label, support) {
  return { id, label, support };
}

function allAvailable() {
  return consumerStates('available');
}

function allPlanned() {
  return consumerStates('planned');
}

function allExcluded() {
  return consumerStates('excluded');
}

function flexibleScenePlanned() {
  return {
    authoring: 'draft-only', preview: 'planned', export: 'planned',
    directorCreation: 'planned', directorEditing: 'planned',
  };
}

function consumerStates(status) {
  return {
    authoring: status,
    preview: status,
    export: status,
    directorCreation: status,
    directorEditing: status,
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
