// Vocabulario congelado de animación V1 (Fase 0) en forma pura.
//
// Vive en `shared/` porque lo necesitan tres lados: el evaluador temporal, la
// interfaz y la validación de autoría. No puede importar nada de Node ni ajv:
// este módulo entra en el bundle del navegador.
//
// La validación contra el schema JSON vive en `scripts/animation/animation-contract.mjs`,
// que reexporta todo lo de acá para que los consumidores existentes no cambien.

/**
 * Parámetros animables V1 con su rango y a qué tipo de elemento aplican.
 *
 * `requiresResourceSupport` distingue los dos orígenes: los parámetros del
 * transform del elemento están disponibles siempre, mientras que los que mueven
 * una articulación solo existen si el recurso declara la pieza y el binding en
 * su manifest v3.
 */
export const ANIMATION_PARAMETERS = Object.freeze({
  'position.x': { unit: 'px', minimum: -1080, maximum: 2160, elementTypes: ['character', 'prop'], requiresResourceSupport: false },
  'position.y': { unit: 'px', minimum: -1920, maximum: 3840, elementTypes: ['character', 'prop'], requiresResourceSupport: false },
  scale: { unit: 'factor', exclusiveMinimum: 0, maximum: 10, elementTypes: ['character', 'prop'], requiresResourceSupport: false },
  rotationDegrees: { unit: 'grados', minimum: -180, maximum: 180, elementTypes: ['character', 'prop'], requiresResourceSupport: false },
  opacity: { unit: 'normalizado', minimum: 0, maximum: 1, elementTypes: ['character', 'prop'], requiresResourceSupport: false },
  armRaise: { unit: 'normalizado', minimum: 0, maximum: 1, elementTypes: ['character'], requiresResourceSupport: true },
  leftArmRaise: { unit: 'normalizado', minimum: 0, maximum: 1, elementTypes: ['character'], requiresResourceSupport: true },
  rightElbowBend: { unit: 'normalizado', minimum: 0, maximum: 1, elementTypes: ['character'], requiresResourceSupport: true },
  leftElbowBend: { unit: 'normalizado', minimum: 0, maximum: 1, elementTypes: ['character'], requiresResourceSupport: true },
  headTilt: { unit: 'normalizado', minimum: -1, maximum: 1, elementTypes: ['character'], requiresResourceSupport: true },
  headNod: { unit: 'normalizado', minimum: 0, maximum: 1, elementTypes: ['character'], requiresResourceSupport: true },
  bodyLean: { unit: 'normalizado', minimum: -1, maximum: 1, elementTypes: ['character'], requiresResourceSupport: true },
  bodyBounce: { unit: 'normalizado', minimum: 0, maximum: 1, elementTypes: ['character'], requiresResourceSupport: true },
});

/** Parámetros que un recurso tiene que declarar para que estén disponibles. */
export const RESOURCE_DECLARED_PARAMETERS = Object.freeze(
  Object.entries(ANIMATION_PARAMETERS)
    .filter(([, parameter]) => parameter.requiresResourceSupport)
    .map(([id]) => id),
);

export const ANIMATION_INTERPOLATIONS = Object.freeze(['linear', 'ease', 'hold']);

export const ANIMATION_PRESET_IDS = Object.freeze([
  'enter-left', 'enter-right', 'fade-in', 'fade-out', 'emphasis-pulse', 'arm-raise',
  'left-arm-raise', 'right-elbow-bend', 'left-elbow-bend', 'head-tilt', 'head-nod',
  'body-lean', 'body-bounce',
]);

export const ANIMATION_LIMITS = Object.freeze({
  tracksPerElement: 8,
  keyframesPerTrack: 32,
  keyframesPerScene: 256,
  minimumKeyframesPerTrack: 2,
  offsetSecondsMinimum: -5,
  offsetSecondsMaximum: 5,
});

/**
 * Catálogo cerrado de fallos. `tier: 'autoria'` se comprueba sin medir el audio;
 * `tier: 'compilacion'` solo después de FFprobe. La interfaz debe tomar de acá el
 * mensaje humano y la acción sugerida, no reescribirlos.
 */
export const ANIMATION_ERROR_CATALOG = Object.freeze({
  ANIM_DOCUMENT_INVALID: {
    tier: 'autoria',
    message: 'El documento de animación no tiene una estructura v1 compatible.',
    suggestedAction: 'Revisar el documento contra schema/animation-scene.schema.json.',
  },
  ANIM_ELEMENT_DUPLICATED: {
    tier: 'autoria',
    message: 'Un mismo elemento aparece dos veces en la escena.',
    suggestedAction: 'Unificar las pistas del elemento en una sola entrada.',
  },
  ANIM_PARAMETER_UNSUPPORTED: {
    tier: 'autoria',
    message: 'El elemento no admite ese parámetro animable.',
    suggestedAction: 'Elegir un parámetro que el recurso declare, o animar el elemento correcto.',
  },
  ANIM_PARAMETER_DUPLICATED: {
    tier: 'autoria',
    message: 'Hay dos pistas sobre el mismo parámetro del mismo elemento.',
    suggestedAction: 'Convertir las dos pistas en una sola antes de continuar.',
  },
  ANIM_TRACK_LIMIT_EXCEEDED: {
    tier: 'autoria',
    message: 'El elemento supera el máximo de pistas admitidas.',
    suggestedAction: `Eliminar pistas hasta dejar ${ANIMATION_LIMITS.tracksPerElement} o menos.`,
  },
  ANIM_KEYFRAME_LIMIT_EXCEEDED: {
    tier: 'autoria',
    message: 'La escena supera el máximo de keyframes admitidos.',
    suggestedAction: `Simplificar la animación hasta dejar ${ANIMATION_LIMITS.keyframesPerScene} keyframes o menos en la escena.`,
  },
  ANIM_KEYFRAME_ID_DUPLICATED: {
    tier: 'autoria',
    message: 'Dos keyframes comparten el mismo identificador.',
    suggestedAction: 'Asignar un id único a cada keyframe de la escena.',
  },
  ANIM_KEYFRAME_COLLISION: {
    tier: 'autoria',
    message: 'Dos keyframes de la misma pista caen exactamente en el mismo punto.',
    suggestedAction: 'Separar los keyframes o eliminar el duplicado; el sistema no elige uno por su cuenta.',
  },
  ANIM_KEYFRAME_ORDER_INVALID: {
    tier: 'autoria',
    message: 'Los keyframes de un mismo ancla no están en orden creciente.',
    suggestedAction: 'Ordenar los keyframes del ancla por su desplazamiento antes de guardar.',
  },
  ANIM_INTERPOLATION_INVALID: {
    tier: 'autoria',
    message: 'El último keyframe de una pista debe usar la interpolación hold.',
    suggestedAction: 'Cambiar la interpolación del último keyframe a hold: después de él el valor se congela.',
  },
  ANIM_ANCHOR_UNRESOLVED: {
    tier: 'compilacion',
    message: 'Un keyframe apunta a un turno o palabra que ya no existe.',
    suggestedAction: 'Reanclar el keyframe a una referencia vigente o eliminarlo antes de renderizar.',
  },
  ANIM_FRAME_COLLISION: {
    tier: 'compilacion',
    message: 'Dos keyframes distintos resolvieron al mismo frame.',
    suggestedAction: 'Separar los keyframes al menos un frame después de medir el audio.',
  },
  ANIM_TRACK_OUT_OF_SCENE: {
    tier: 'compilacion',
    message: 'Un keyframe resolvió fuera de los límites de su escena.',
    suggestedAction: 'Reducir el desplazamiento del keyframe o anclarlo a una referencia más cercana.',
  },
});

export class AnimationContractError extends Error {
  constructor(code, path = '/', detail = '') {
    const entry = ANIMATION_ERROR_CATALOG[code];
    super(entry ? entry.message : 'Fallo desconocido del contrato de animación.');
    this.name = 'AnimationContractError';
    this.code = code;
    this.path = path;
    this.suggestedAction = entry ? entry.suggestedAction : '';
    if (detail) this.technicalDetail = detail;
  }
}

export function failAnimation(code, path, detail) {
  throw new AnimationContractError(code, path, detail);
}

/**
 * Regla de cuantización congelada: un instante de autoría cae en el frame más
 * cercano. Deliberadamente distinta del `Math.ceil` que usa el exportador para
 * contar frames de una duración; acá se ubica un punto, no se mide un tramo.
 */
export function quantizeToFrame(seconds, fps) {
  if (!Number.isFinite(seconds) || !Number.isInteger(fps) || fps <= 0) {
    failAnimation('ANIM_DOCUMENT_INVALID', '/', 'quantizeToFrame requiere segundos finitos y fps entero positivo.');
  }
  return Math.max(0, Math.round(seconds * fps));
}

/** Clave canónica de un ancla, para detectar colisiones y agrupar. */
export function anchorKey(anchor) {
  if (anchor.kind === 'scene') return `scene:${anchor.edge}`;
  if (anchor.kind === 'turn') return `turn:${anchor.turnId}:${anchor.edge}`;
  return `word:${anchor.turnId}:${anchor.wordIndex}`;
}

/** Texto humano de un ancla, para inspector, timeline y mensajes de error. */
export function describeAnchor(anchor) {
  if (anchor.kind === 'scene') return anchor.edge === 'start' ? 'inicio de la escena' : 'fin de la escena';
  if (anchor.kind === 'turn') {
    return `${anchor.edge === 'start' ? 'inicio' : 'fin'} del turno ${anchor.turnId}`;
  }
  return `palabra ${anchor.wordIndex + 1} del turno ${anchor.turnId}`;
}

/**
 * Deriva el estado «requiere revisión». No lanza: una referencia rota es algo
 * que la interfaz tiene que mostrar y el usuario tiene que resolver, no un
 * documento corrupto. El render sí debe bloquearse mientras la lista no esté
 * vacía, con el código ANIM_ANCHOR_UNRESOLVED.
 *
 * `sceneReference` describe el diálogo vigente: { turns: [{ id, wordCount }] }.
 */
export function listAnchorsRequiringReview(document, sceneReference) {
  const turns = new Map((sceneReference?.turns ?? []).map((turn) => [turn.id, turn.wordCount]));
  const pending = [];

  for (const element of document.elements) {
    for (const track of element.tracks) {
      for (const keyframe of track.keyframes) {
        const { anchor } = keyframe;
        if (anchor.kind === 'scene') continue;
        const wordCount = turns.get(anchor.turnId);
        if (wordCount === undefined) {
          pending.push({
            elementId: element.elementId,
            parameterId: track.parameterId,
            keyframeId: keyframe.id,
            reason: 'turn-missing',
            message: `El turno ${anchor.turnId} ya no existe en la escena.`,
          });
          continue;
        }
        if (anchor.kind === 'word' && anchor.wordIndex >= wordCount) {
          pending.push({
            elementId: element.elementId,
            parameterId: track.parameterId,
            keyframeId: keyframe.id,
            reason: 'word-missing',
            message: `El turno ${anchor.turnId} ya no tiene una palabra ${anchor.wordIndex + 1}.`,
          });
        }
      }
    }
  }

  return pending;
}
