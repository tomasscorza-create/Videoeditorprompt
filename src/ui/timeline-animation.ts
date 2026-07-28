// Fase 4 del plan de capacidades creativas editables — modelo puro de la fila
// «Animación» de la timeline y del inspector de keyframe.
//
// No reimplementa nada del contrato: el vocabulario, los límites y los mensajes
// de error salen de `shared/animation-contract.js`, y la resolución de anclas es
// la MISMA función que usa el motor (`resolveAnchorSeconds`). Lo propio de este
// módulo es solo la traducción a lo que la interfaz necesita: rótulos, estado
// por keyframe y el desplazamiento que produce arrastrar un diamante.
//
// Regla del proyecto que manda acá: sin medición no se inventa un tiempo. Un
// keyframe sin render vigente se muestra como pendiente, nunca en una posición
// estimada por cantidad de palabras.
//
// Sin DOM: se prueba en Node desde `ui:test-modules`.

import {
  ANIMATION_ERROR_CATALOG,
  ANIMATION_LIMITS,
  ANIMATION_PARAMETERS,
  describeAnchor,
  listAnchorsRequiringReview,
  quantizeToFrame,
  type AnimationAnchor,
  type AnimationInterpolation,
} from '../../shared/animation-contract.js';
import { evaluateTrack, resolveAnchorSeconds, type SceneTiming } from '../../shared/animation-evaluator.js';
import type { KeyframeView, TrackView } from './project/types.js';

/**
 * Nombres cortos de cada parámetro, para etiquetas de pista e inspector.
 * `src/ui/command-labels.ts` tiene la forma narrativa («la posición horizontal»)
 * que necesita el relato de deshacer; las dos parten del mismo vocabulario
 * congelado y ninguna inventa parámetros nuevos.
 */
export const ANIMATION_PARAMETER_LABELS: Record<string, string> = {
  'position.x': 'Posición X',
  'position.y': 'Posición Y',
  scale: 'Escala',
  rotationDegrees: 'Rotación',
  opacity: 'Opacidad',
  armRaise: 'Brazo',
};

export function parameterLabel(parameterId: string): string {
  return ANIMATION_PARAMETER_LABELS[parameterId] ?? parameterId;
}

/** Estado de un keyframe tal como se muestra, derivado y nunca persistido. */
export type KeyframeStatus =
  /** Resuelto contra una medición vigente. */
  | 'ok'
  /** El ancla apunta a un turno o palabra que ya no existe: lo resuelve el usuario. */
  | 'review'
  /** Resolvió fuera de los límites de su escena. */
  | 'out-of-scene'
  /** Todavía no hay voz medida para ubicarlo: no es un error, es falta de render. */
  | 'unmeasured';

export interface AnimationKeyframeItem {
  id: string;
  anchor: AnimationAnchor;
  offsetSeconds: number;
  value: number;
  interpolation: AnimationInterpolation;
  status: KeyframeStatus;
  /** Segundos absolutos en la timeline del proyecto, o null si no se resolvió. */
  seconds: number | null;
  /** Frame dentro de la escena, con la cuantización del contrato. */
  sceneFrameIndex: number | null;
  /** Último de la pista en el orden guardado: el contrato lo obliga a `hold`. */
  isLast: boolean;
  message: string | null;
  anchorLabel: string;
  valueLabel: string;
  timeLabel: string;
}

export interface AnimationSegment {
  fromSeconds: number;
  toSeconds: number;
  interpolation: AnimationInterpolation;
}

export interface AnimationLane {
  parameterId: string;
  label: string;
  sourceLabel: string;
  customized: boolean;
  keyframes: AnimationKeyframeItem[];
  segments: AnimationSegment[];
  reviewCount: number;
}

export interface SceneAnimationReference {
  turns: Array<{ id: string; wordCount: number }>;
}

/**
 * Diálogo vigente en la forma que espera el contrato. El conteo de palabras usa
 * el mismo criterio que `shared/project-editor.js` aplica a `gestureAtWord`:
 * palabras del texto de autoría, no del texto normalizado para Piper.
 */
export function sceneAnimationReference(
  dialogue: ReadonlyArray<{ id: string; text: string }>,
): SceneAnimationReference {
  return {
    turns: dialogue.map((turn) => ({
      id: turn.id,
      wordCount: turn.text.trim().split(/\s+/u).filter(Boolean).length,
    })),
  };
}

/**
 * Timing medido de la escena en segundos ABSOLUTOS del proyecto. Devuelve null
 * cuando no hay render vigente: sin medición no hay dónde poner un diamante.
 */
export function sceneAnimationTiming(
  measured: { startSeconds: number; endSeconds: number; turns?: ReadonlyArray<{ id: string; startSeconds: number; endSeconds: number; durationSeconds: number }> } | null | undefined,
  reference: SceneAnimationReference,
): SceneTiming | null {
  if (!measured) return null;
  const wordCounts = new Map(reference.turns.map((turn) => [turn.id, turn.wordCount]));
  return {
    startSeconds: measured.startSeconds,
    endSeconds: measured.endSeconds,
    turns: (measured.turns ?? []).map((turn) => ({
      id: turn.id,
      startSeconds: turn.startSeconds,
      endSeconds: turn.endSeconds,
      durationSeconds: turn.durationSeconds,
      wordCount: wordCounts.get(turn.id) ?? 0,
    })),
  };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Valor con la unidad de su parámetro, para inspector y tooltips. */
export function formatParameterValue(parameterId: string, value: number): string {
  if (parameterId === 'position.x' || parameterId === 'position.y') return `${round(value, 1)} px`;
  if (parameterId === 'scale') return `${value.toFixed(2)}×`;
  if (parameterId === 'rotationDegrees') return `${round(value, 1)}°`;
  return value.toFixed(2);
}

/** Rótulo del origen de la pista: qué preset la creó y si ya se editó a mano. */
export function trackSourceLabel(source: TrackView['source']): string {
  if (source.kind === 'manual') return 'manual';
  return source.customized ? `${source.presetId} · editado` : source.presetId;
}

function statusMessage(status: KeyframeStatus, reviewMessage: string | null): string | null {
  if (status === 'review') return reviewMessage;
  if (status === 'out-of-scene') return ANIMATION_ERROR_CATALOG.ANIM_TRACK_OUT_OF_SCENE.message;
  if (status === 'unmeasured') return 'Todavía no hay voz medida para ubicar este keyframe.';
  return null;
}

/**
 * Traduce las pistas de un elemento a filas dibujables.
 *
 * `timing` viene de la medición y `reference` del diálogo vigente: la diferencia
 * importa porque un turno que existe en el guion pero todavía no se midió es
 * «pendiente de voz», mientras que un turno que ya no existe es una referencia
 * rota que el usuario tiene que resolver.
 */
export function buildAnimationLanes(
  elementId: string,
  tracks: readonly TrackView[],
  options: { timing: SceneTiming | null; reference: SceneAnimationReference; fps: number },
): AnimationLane[] {
  const { timing, reference, fps } = options;
  const pending = new Map(
    listAnchorsRequiringReview({ elements: [{ elementId, tracks: tracks as never }] }, reference)
      .map((entry) => [entry.keyframeId, entry.message]),
  );

  return tracks.map((track) => {
    const keyframes = track.keyframes.map((keyframe, index) => describeKeyframe(
      keyframe,
      track.parameterId,
      index === track.keyframes.length - 1,
      { timing, fps, reviewMessage: pending.get(keyframe.id) ?? null },
    ));
    // En medido se muestran en el orden temporal real, que es el orden canónico
    // del evaluador; sin medir se respeta el orden guardado.
    const ordered = [...keyframes].sort((left, right) => {
      if (left.seconds === null || right.seconds === null) return 0;
      return (left.seconds - right.seconds) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    });
    const segments: AnimationSegment[] = [];
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const from = ordered[index];
      const to = ordered[index + 1];
      if (from.seconds === null || to.seconds === null) continue;
      segments.push({ fromSeconds: from.seconds, toSeconds: to.seconds, interpolation: from.interpolation });
    }
    return {
      parameterId: track.parameterId,
      label: parameterLabel(track.parameterId),
      sourceLabel: trackSourceLabel(track.source),
      customized: track.source.kind === 'preset' && track.source.customized,
      keyframes: ordered,
      segments,
      reviewCount: ordered.filter((keyframe) => keyframe.status === 'review').length,
    };
  });
}

function describeKeyframe(
  keyframe: KeyframeView,
  parameterId: string,
  isLast: boolean,
  context: { timing: SceneTiming | null; fps: number; reviewMessage: string | null },
): AnimationKeyframeItem {
  const { timing, fps, reviewMessage } = context;
  let status: KeyframeStatus = 'ok';
  let seconds: number | null = null;
  let sceneFrameIndex: number | null = null;

  if (reviewMessage) {
    status = 'review';
  } else if (!timing) {
    status = 'unmeasured';
  } else {
    try {
      seconds = resolveAnchorSeconds(keyframe.anchor, timing) + keyframe.offsetSeconds;
    } catch {
      // El ancla existe en el guion pero el render vigente no la midió.
      status = 'unmeasured';
    }
    if (seconds !== null) {
      if (seconds < timing.startSeconds - 1e-9 || seconds > timing.endSeconds + 1e-9) {
        status = 'out-of-scene';
      } else {
        sceneFrameIndex = quantizeToFrame(seconds - timing.startSeconds, fps);
      }
    }
  }

  return {
    id: keyframe.id,
    anchor: keyframe.anchor,
    offsetSeconds: keyframe.offsetSeconds,
    value: keyframe.value,
    interpolation: keyframe.interpolation,
    status,
    seconds,
    sceneFrameIndex,
    isLast,
    message: statusMessage(status, reviewMessage),
    anchorLabel: describeAnchor(keyframe.anchor),
    valueLabel: formatParameterValue(parameterId, keyframe.value),
    timeLabel: sceneFrameIndex === null || seconds === null
      ? 'pendiente de voz'
      : `${seconds.toFixed(3)} s · frame ${sceneFrameIndex}`,
  };
}

/**
 * Valor de cada parámetro animado en un instante, para previsualizar en el
 * lienzo. Usa `evaluateTrack`, el mismo evaluador que produce el render, así que
 * la vista previa y el MP4 salen del mismo estado temporal.
 *
 * Una pista con algún keyframe sin resolver no se evalúa: se prefiere mostrar la
 * base a mostrar un valor calculado con la mitad de los puntos.
 */
export function evaluateLanesAt(lanes: readonly AnimationLane[], timeSeconds: number): Record<string, number> {
  const values: Record<string, number> = {};
  for (const lane of lanes) {
    if (lane.keyframes.length === 0) continue;
    if (lane.keyframes.some((keyframe) => keyframe.seconds === null)) continue;
    values[lane.parameterId] = evaluateTrack(
      {
        parameterId: lane.parameterId,
        source: { kind: 'manual' },
        keyframes: lane.keyframes.map((keyframe) => ({
          id: keyframe.id,
          anchor: keyframe.anchor,
          seconds: keyframe.seconds as number,
          frameIndex: keyframe.sceneFrameIndex ?? 0,
          value: keyframe.value,
          interpolation: keyframe.interpolation,
        })),
      },
      timeSeconds,
    );
  }
  return values;
}

/** Cuántas referencias de un elemento hay que revisar, para la insignia ⚠ n. */
export function countAnchorsRequiringReview(
  elementId: string,
  tracks: readonly TrackView[],
  reference: SceneAnimationReference,
): number {
  return listAnchorsRequiringReview({ elements: [{ elementId, tracks: tracks as never }] }, reference).length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Desplazamiento que hay que guardar para que un keyframe caiga en `targetSeconds`.
 *
 * Se ajusta al frame más cercano (mover con el mouse no puede producir un
 * desplazamiento más fino que un frame) y se acota al rango del contrato: un
 * desplazamiento mayor a ±5 s significa que el keyframe está colgado del ancla
 * equivocada, y por eso el contrato no lo admite.
 */
export function offsetForSeconds(anchorSeconds: number, targetSeconds: number, fps: number): number {
  const frames = Math.round((targetSeconds - anchorSeconds) * fps);
  return round(clamp(frames / fps, ANIMATION_LIMITS.offsetSecondsMinimum, ANIMATION_LIMITS.offsetSecondsMaximum), 4);
}

/** Corrimiento por teclado, en frames enteros y dentro del rango del contrato. */
export function nudgeOffsetSeconds(offsetSeconds: number, frames: number, fps: number): number {
  return round(
    clamp(offsetSeconds + frames / fps, ANIMATION_LIMITS.offsetSecondsMinimum, ANIMATION_LIMITS.offsetSecondsMaximum),
    4,
  );
}

export interface AnchorProposal {
  anchor: AnimationAnchor;
  offsetSeconds: number;
  label: string;
}

/**
 * Referencia semántica más cercana a un instante medido.
 *
 * Es la operación «convertir el tiempo resuelto en la referencia semántica más
 * cercana» de la Fase 0: se prefiere el borde de turno o de escena que quede a
 * menos distancia, de modo que editar el diálogo mueva el keyframe con su turno
 * en vez de dejarlo colgado de un segundo absoluto.
 */
export function nearestAnchorFor(targetSeconds: number, timing: SceneTiming, fps: number): AnchorProposal {
  const candidates: AnimationAnchor[] = [
    { kind: 'scene', edge: 'start' },
    { kind: 'scene', edge: 'end' },
    ...timing.turns.flatMap((turn): AnimationAnchor[] => [
      { kind: 'turn', turnId: turn.id, edge: 'start' },
      { kind: 'turn', turnId: turn.id, edge: 'end' },
    ]),
  ];
  let best: AnchorProposal | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of candidates) {
    const anchorSeconds = resolveAnchorSeconds(anchor, timing);
    const distance = Math.abs(targetSeconds - anchorSeconds);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        anchor,
        offsetSeconds: offsetForSeconds(anchorSeconds, targetSeconds, fps),
        label: describeAnchor(anchor),
      };
    }
  }
  // `timing` siempre trae los dos bordes de escena, así que `best` nunca es null.
  return best as AnchorProposal;
}

/**
 * Comandos para que un parámetro valga `value` en el cabezal, sin tocar la base.
 *
 * Es el corazón del modo animación del lienzo: con el modo encendido, mover el
 * elemento crea o actualiza el keyframe del cabezal y nunca el transform base.
 *
 * Tres casos: si ya hay un keyframe en ese frame se le cambia el valor; si la
 * pista existe se agrega uno; y si no existe la pista nace con la base al inicio
 * de la escena y el valor nuevo en el cabezal, porque una pista de un solo
 * keyframe no cumple el contrato.
 */
export function keyframeCommandsForValue(options: {
  sceneId: string;
  elementId: string;
  parameterId: string;
  value: number;
  playheadSeconds: number;
  lane: AnimationLane | null;
  timing: SceneTiming;
  fps: number;
  baseValue: number;
  takenKeyframeIds: readonly string[];
}): Array<Record<string, unknown>> {
  const { sceneId, elementId, parameterId, value, playheadSeconds, lane, timing, fps, baseValue } = options;
  const target = clampParameterValue(parameterId, value);
  const tolerance = 0.5 / fps;
  const existing = lane?.keyframes.find(
    (keyframe) => keyframe.seconds !== null && Math.abs(keyframe.seconds - playheadSeconds) <= tolerance,
  ) ?? null;
  if (existing) {
    if (existing.value === target) return [];
    return [{ type: 'set-keyframe', sceneId, elementId, parameterId, keyframeId: existing.id, value: target }];
  }

  const proposal = nearestAnchorFor(playheadSeconds, timing, fps);
  const first = nextKeyframeId(parameterId, options.takenKeyframeIds);
  if (lane) {
    return [{
      type: 'add-keyframe',
      sceneId,
      elementId,
      parameterId,
      keyframeId: first,
      anchor: proposal.anchor,
      offsetSeconds: proposal.offsetSeconds,
      value: target,
      interpolation: 'ease',
    }];
  }

  const sceneStart: AnimationAnchor = { kind: 'scene', edge: 'start' };
  // Si el cabezal cae justo sobre el inicio de la escena, los dos keyframes
  // caerían en el mismo punto, que el contrato rechaza; se separan medio segundo.
  const collides = proposal.anchor.kind === 'scene' && proposal.anchor.edge === 'start' && proposal.offsetSeconds === 0;
  const second = nextKeyframeId(parameterId, [...options.takenKeyframeIds, first]);
  return [{
    type: 'create-track',
    sceneId,
    elementId,
    parameterId,
    source: { kind: 'manual' },
    keyframes: [
      { id: first, anchor: sceneStart, offsetSeconds: 0, value: clampParameterValue(parameterId, baseValue), interpolation: 'ease' },
      {
        id: second,
        anchor: collides ? sceneStart : proposal.anchor,
        offsetSeconds: collides ? 0.5 : proposal.offsetSeconds,
        value: target,
        interpolation: 'hold',
      },
    ],
  }];
}

/** Id libre para un keyframe nuevo, único dentro del elemento. */
export function nextKeyframeId(parameterId: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `kf-${parameterId.replace(/[^a-zA-Z0-9]+/gu, '-')}`;
  for (let index = 1; index <= 99; index += 1) {
    const candidate = `${base}-${String(index).padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Valor base del elemento para un parámetro. Es la misma correspondencia que usa
 * `shared/project-editor.js` al expandir un preset; acá sirve para proponer el
 * valor de un keyframe nuevo, que arranca en la base y no en cero.
 */
export function baseValueForParameter(
  parameterId: string,
  transform: { x: number; y: number; scale: number; rotationDegrees: number; opacity: number },
): number {
  if (parameterId === 'position.x') return transform.x;
  if (parameterId === 'position.y') return transform.y;
  if (parameterId === 'scale') return transform.scale;
  if (parameterId === 'rotationDegrees') return transform.rotationDegrees;
  if (parameterId === 'opacity') return transform.opacity;
  return 0;
}

/**
 * Parámetros que el compositor vigente sabe llevar al MP4.
 *
 * `rotationDegrees` y `armRaise` pertenecen al vocabulario congelado pero el
 * runtime v2 todavía no los renderiza: el compilador los rechaza con
 * PROJECT_SCENE_UNSUPPORTED (`RENDERABLE_PARAMETERS` en
 * `scripts/stage3a/compile-video-project.mjs`). Ofrecerlos acá dejaría animar
 * algo que después no aparece en el video, el mismo motivo por el que los
 * recursos v3 siguen fuera de la biblioteca.
 */
const RENDERABLE_PARAMETERS: readonly string[] = ['position.x', 'position.y', 'scale', 'opacity'];

/** Parámetros animables de un elemento, según lo que el recurso declare. */
export function listAnimatableParameters(declaredParameters: readonly string[] = []): string[] {
  return Object.entries(ANIMATION_PARAMETERS)
    .filter(([id, parameter]) => !parameter.requiresResourceSupport || declaredParameters.includes(id))
    .map(([id]) => id)
    .filter((id) => RENDERABLE_PARAMETERS.includes(id));
}

/** Acota un valor al rango del parámetro antes de mandarlo al motor. */
export function clampParameterValue(parameterId: string, value: number): number {
  const parameter = ANIMATION_PARAMETERS[parameterId];
  if (!parameter) return value;
  const minimum = parameter.exclusiveMinimum !== undefined
    ? parameter.exclusiveMinimum + 0.001
    : parameter.minimum ?? 0;
  return round(clamp(value, minimum, parameter.maximum), 3);
}
