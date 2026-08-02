// Fase 2 del plan de capacidades creativas editables — evaluación de pistas.
//
// Tres responsabilidades, en este orden:
//
//   1. Resolver anclas semánticas a segundos, una vez que FFprobe midió el audio.
//   2. Cuantizar a frame y rechazar lo que el contrato no admite: referencias
//      rotas, colisiones y keyframes fuera de la escena.
//   3. Evaluar el valor de cada parámetro en un instante dado.
//
// La evaluación trabaja en segundos, no en frames: así la vista previa y la
// exportación coinciden en cualquier `t`, y el frame solo se usa para detectar
// colisiones y para mostrarlo en la interfaz.
//
// Módulo puro: entra en el bundle del navegador y no importa nada de Node.

import { anchorKey, failAnimation, quantizeToFrame } from './animation-contract.js';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Palabras de un turno, con el mismo criterio que usa la preparación de audio. */
function wordCountOf(turn) {
  const text = typeof turn.ttsText === 'string' ? turn.ttsText : '';
  return text.split(/\s+/u).filter(Boolean).length;
}

/**
 * Timing medido de una escena, derivado de los datos de diálogo ya probados con
 * FFprobe. Es la única entrada temporal de la resolución de anclas.
 */
export function buildSceneTiming(dialogueData, durationSeconds) {
  return {
    startSeconds: 0,
    endSeconds: durationSeconds,
    turns: (dialogueData?.turns ?? []).map((turn) => ({
      id: turn.id,
      startSeconds: turn.startSeconds,
      endSeconds: turn.endSeconds,
      durationSeconds: turn.durationSeconds,
      wordCount: wordCountOf(turn),
    })),
  };
}

/**
 * Ancla semántica → segundos absolutos dentro de la escena.
 *
 * El ancla de palabra se prorratea por cantidad de palabras sobre la duración
 * medida del turno, exactamente igual que el proyecto ya ubica los gestos en
 * `prepare-dialogue.mjs`. No hay alineación forzada palabra por palabra: la
 * precisión es la de un prorrateo, y por eso el contrato empuja a anclar al
 * turno cuando alcanza.
 */
export function resolveAnchorSeconds(anchor, timing, path = '/') {
  if (anchor.kind === 'scene') {
    return anchor.edge === 'start' ? timing.startSeconds : timing.endSeconds;
  }
  const turn = timing.turns.find((candidate) => candidate.id === anchor.turnId);
  if (!turn) {
    failAnimation('ANIM_ANCHOR_UNRESOLVED', path, `El turno ${anchor.turnId} no existe en la escena medida.`);
  }
  if (anchor.kind === 'turn') {
    return anchor.edge === 'start' ? turn.startSeconds : turn.endSeconds;
  }
  if (anchor.wordIndex >= turn.wordCount) {
    failAnimation('ANIM_ANCHOR_UNRESOLVED', path, `El turno ${anchor.turnId} tiene ${turn.wordCount} palabras y se pidió la ${anchor.wordIndex + 1}.`);
  }
  const wordCount = Math.max(1, turn.wordCount);
  return turn.startSeconds + turn.durationSeconds * anchor.wordIndex / wordCount;
}

/**
 * Resuelve un documento de animación contra el timing medido.
 *
 * Devuelve las pistas con cada keyframe ya en segundos y en frame, ordenadas
 * canónicamente por segundo y luego por id. Lanza si una referencia quedó rota,
 * si dos keyframes caen en el mismo frame o si uno resolvió fuera de la escena:
 * los tres son errores visibles, nunca un descarte silencioso.
 */
export function resolveAnimationScene(document, timing, fps) {
  const frameCount = Math.max(1, Math.ceil(timing.endSeconds * fps));
  const elements = document.elements.map((element, elementIndex) => ({
    elementId: element.elementId,
    elementType: element.elementType,
    // La ventana usa el mismo anclaje que los keyframes, así que se resuelve
    // con la misma medición y en el mismo lugar. Un borde que cae fuera de la
    // escena se sujeta al borde: recortar no puede alargar una escena.
    visibility: element.visibility
      ? {
        fromSeconds: clamp(
          resolveAnchorSeconds(element.visibility.from.anchor, timing, `/elements/${elementIndex}/visibility/from`)
            + element.visibility.from.offsetSeconds,
          timing.startSeconds,
          timing.endSeconds,
        ),
        toSeconds: clamp(
          resolveAnchorSeconds(element.visibility.to.anchor, timing, `/elements/${elementIndex}/visibility/to`)
            + element.visibility.to.offsetSeconds,
          timing.startSeconds,
          timing.endSeconds,
        ),
      }
      : null,
    tracks: (element.tracks ?? []).map((track, trackIndex) => {
      const trackPath = `/elements/${elementIndex}/tracks/${trackIndex}`;
      const keyframes = track.keyframes.map((keyframe, keyframeIndex) => {
        const keyframePath = `${trackPath}/keyframes/${keyframeIndex}`;
        const anchored = resolveAnchorSeconds(keyframe.anchor, timing, keyframePath);
        const seconds = anchored + keyframe.offsetSeconds;
        // Se comprueba en segundos y no en frames: la cuantización sujeta los
        // negativos a cero y taparía un keyframe que cayó antes de la escena.
        if (seconds < timing.startSeconds - 1e-9 || seconds > timing.endSeconds + 1e-9) {
          failAnimation('ANIM_TRACK_OUT_OF_SCENE', keyframePath, `${anchorKey(keyframe.anchor)} resolvió en ${seconds.toFixed(3)}s, fuera de 0..${timing.endSeconds.toFixed(3)}s.`);
        }
        return {
          id: keyframe.id,
          anchor: keyframe.anchor,
          seconds,
          frameIndex: Math.min(quantizeToFrame(seconds, fps), frameCount - 1),
          value: keyframe.value,
          interpolation: keyframe.interpolation,
        };
      });

      // Orden canónico: segundo resuelto y después id, para que dos anclas
      // distintas que resolvieron cerca queden en un orden estable.
      keyframes.sort((a, b) => (a.seconds - b.seconds) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      for (let index = 1; index < keyframes.length; index += 1) {
        if (keyframes[index].frameIndex === keyframes[index - 1].frameIndex) {
          failAnimation(
            'ANIM_FRAME_COLLISION',
            `${trackPath}/keyframes`,
            `${keyframes[index - 1].id} y ${keyframes[index].id} resolvieron al frame ${keyframes[index].frameIndex}.`,
          );
        }
      }

      return { parameterId: track.parameterId, source: track.source, keyframes };
    }),
  }));

  return { sceneId: document.sceneId, fps, frameCount, elements };
}

function easeRatio(ratio, interpolation) {
  if (interpolation === 'hold') return 0;
  if (interpolation === 'ease') return 0.5 - 0.5 * Math.cos(Math.PI * ratio);
  return ratio;
}

/**
 * Valor de una pista resuelta en un instante.
 *
 * Reglas congeladas en la Fase 0: la interpolación de un keyframe describe el
 * tramo que SALE de él; antes del primero se sostiene el valor del primero;
 * después del último el valor queda congelado.
 */
export function evaluateTrack(track, timeSeconds) {
  const { keyframes } = track;
  if (timeSeconds <= keyframes[0].seconds) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (timeSeconds >= last.seconds) return last.value;
  let index = 0;
  while (index < keyframes.length - 1 && keyframes[index + 1].seconds <= timeSeconds) index += 1;
  const from = keyframes[index];
  const to = keyframes[index + 1];
  const span = to.seconds - from.seconds;
  const ratio = span <= 0 ? 1 : clamp((timeSeconds - from.seconds) / span, 0, 1);
  return from.value + (to.value - from.value) * easeRatio(ratio, from.interpolation);
}

/**
 * Parámetros animados de todos los elementos en un instante.
 * Solo aparecen los parámetros que tienen pista; el resto lo aporta la base.
 */
export function evaluateAnimationParams(resolved, timeSeconds) {
  const byElement = {};
  for (const element of resolved.elements) {
    const params = {};
    for (const track of element.tracks) params[track.parameterId] = evaluateTrack(track, timeSeconds);
    // Fuera de su ventana el elemento no se ve. Se expresa como opacidad 0
    // porque es el único canal que los dos compositores ya leen por frame: el
    // recorte llega igual a FFmpeg y a PixiJS sin que ninguno lo reinterprete.
    // El intervalo incluye su inicio y excluye su final, así dos elementos
    // contiguos no se pisan en el cuadro del corte.
    if (element.visibility) {
      const visible = timeSeconds >= element.visibility.fromSeconds - 1e-9
        && timeSeconds < element.visibility.toSeconds - 1e-9;
      if (!visible) params.opacity = 0;
    }
    byElement[element.elementId] = params;
  }
  return byElement;
}
