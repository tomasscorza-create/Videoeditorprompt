// Fase 0 del plan de capacidades creativas editables — validación de autoría.
//
// El vocabulario, el catálogo de errores y las funciones puras viven en
// `shared/animation-contract.js`, porque los necesitan también el evaluador
// temporal y la interfaz, que no pueden importar ajv ni Node. Acá queda lo que
// sí es exclusivo del lado servidor: la validación contra el schema JSON.
//
// Este módulo reexporta todo lo de `shared/` para que los consumidores no
// tengan que saber de la separación.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  ANIMATION_LIMITS,
  ANIMATION_PARAMETERS,
  anchorKey,
  failAnimation,
} from '../../shared/animation-contract.js';

export {
  ANIMATION_ERROR_CATALOG,
  ANIMATION_INTERPOLATIONS,
  ANIMATION_LIMITS,
  ANIMATION_PARAMETERS,
  ANIMATION_PRESET_IDS,
  AnimationContractError,
  RESOURCE_DECLARED_PARAMETERS,
  describeAnchor,
  listAnchorsRequiringReview,
  quantizeToFrame,
} from '../../shared/animation-contract.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(moduleDirectory, '..', '..', 'schema', 'animation-scene.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

/**
 * Valida estructura, vocabulario, límites y colisiones de autoría.
 * Devuelve el documento tal cual llegó; no lo reordena ni lo completa.
 */
export function validateAnimationScene(document) {
  if (!validateSchema(document)) {
    const first = validateSchema.errors?.[0];
    failAnimation('ANIM_DOCUMENT_INVALID', first?.instancePath || '/', `${first?.instancePath ?? ''} ${first?.message ?? ''}`.trim());
  }

  const seenElements = new Set();
  const seenKeyframeIds = new Set();
  let sceneKeyframes = 0;

  for (const [elementIndex, element] of document.elements.entries()) {
    const elementPath = `/elements/${elementIndex}`;
    if (seenElements.has(element.elementId)) {
      failAnimation('ANIM_ELEMENT_DUPLICATED', elementPath, element.elementId);
    }
    seenElements.add(element.elementId);

    if (element.tracks.length > ANIMATION_LIMITS.tracksPerElement) {
      failAnimation('ANIM_TRACK_LIMIT_EXCEEDED', `${elementPath}/tracks`, `${element.tracks.length} pistas`);
    }

    const seenParameters = new Set();
    for (const [trackIndex, track] of element.tracks.entries()) {
      const trackPath = `${elementPath}/tracks/${trackIndex}`;
      if (seenParameters.has(track.parameterId)) {
        failAnimation('ANIM_PARAMETER_DUPLICATED', trackPath, track.parameterId);
      }
      seenParameters.add(track.parameterId);

      const parameter = ANIMATION_PARAMETERS[track.parameterId];
      if (!parameter.elementTypes.includes(element.elementType)) {
        failAnimation('ANIM_PARAMETER_UNSUPPORTED', `${trackPath}/parameterId`, `${track.parameterId} sobre ${element.elementType}`);
      }

      sceneKeyframes += track.keyframes.length;
      if (sceneKeyframes > ANIMATION_LIMITS.keyframesPerScene) {
        failAnimation('ANIM_KEYFRAME_LIMIT_EXCEEDED', `${trackPath}/keyframes`, `${sceneKeyframes} keyframes`);
      }

      const last = track.keyframes.at(-1);
      if (last.interpolation !== 'hold') {
        failAnimation('ANIM_INTERPOLATION_INVALID', `${trackPath}/keyframes/${track.keyframes.length - 1}/interpolation`, last.interpolation);
      }

      const offsetsByAnchor = new Map();
      for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
        const keyframePath = `${trackPath}/keyframes/${keyframeIndex}`;
        if (seenKeyframeIds.has(keyframe.id)) {
          failAnimation('ANIM_KEYFRAME_ID_DUPLICATED', keyframePath, keyframe.id);
        }
        seenKeyframeIds.add(keyframe.id);

        const key = anchorKey(keyframe.anchor);
        const previous = offsetsByAnchor.get(key);
        if (previous !== undefined) {
          if (previous === keyframe.offsetSeconds) {
            failAnimation('ANIM_KEYFRAME_COLLISION', keyframePath, `${key} +${keyframe.offsetSeconds}s`);
          }
          if (previous > keyframe.offsetSeconds) {
            failAnimation('ANIM_KEYFRAME_ORDER_INVALID', keyframePath, `${key} ${previous}s → ${keyframe.offsetSeconds}s`);
          }
        }
        offsetsByAnchor.set(key, keyframe.offsetSeconds);
      }
    }
  }

  return document;
}
