// Fase 5 del plan de capacidades creativas editables — presets versionados.
//
// Un preset es DATO, no código: describe qué parámetro toca y qué keyframes
// produce, y nada más. No hay expresiones ni scripts, que es justamente lo que
// mantiene el render determinista y el contexto del Director chico.
//
// La expansión es pura y determinista: mismo preset, misma ancla, misma
// intensidad y mismo valor base producen exactamente los mismos keyframes.
//
// Módulo puro: entra en el bundle del navegador.

import { ANIMATION_PARAMETERS, failAnimation } from './animation-contract.js';

/** Escalas de intensidad. Multiplican amplitud y duración del preset. */
export const ANIMATION_INTENSITIES = Object.freeze({
  soft: { amplitude: 0.6, duration: 1.2 },
  medium: { amplitude: 1, duration: 1 },
  strong: { amplitude: 1.5, duration: 0.85 },
});

/** Orden y rótulos compartidos por cualquier interfaz que presente presets. */
export const ANIMATION_PRESET_GROUPS = Object.freeze({
  entrance: { label: 'Entradas' },
  exit: { label: 'Salidas' },
  visibility: { label: 'Visibilidad' },
  emphasis: { label: 'Énfasis' },
  movement: { label: 'Movimiento' },
  articulation: { label: 'Cuerpo y articulaciones' },
});

/**
 * Catálogo cerrado y versionado.
 *
 * `steps` describe los keyframes en forma relativa: `atSeconds` es el
 * desplazamiento desde el ancla y `value` se resuelve contra el valor base del
 * elemento. `offset` suma sobre la base, `absolute` la ignora, `factor` la
 * multiplica. Con eso alcanza para ampliar el catálogo sin agregar una sola
 * línea de lógica específica por preset.
 */
export const ANIMATION_PRESETS = Object.freeze({
  'enter-left': {
    version: 1,
    groupId: 'entrance',
    parameterId: 'position.x',
    label: 'Entrar por la izquierda',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: -420, interpolation: 'ease' },
      { atSeconds: 0.6, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  'enter-right': {
    version: 1,
    groupId: 'entrance',
    parameterId: 'position.x',
    label: 'Entrar por la derecha',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 420, interpolation: 'ease' },
      { atSeconds: 0.6, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  'enter-bottom': {
    version: 1,
    groupId: 'entrance',
    parameterId: 'position.y',
    label: 'Entrar desde abajo',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 520, interpolation: 'ease' },
      { atSeconds: 0.68, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  'pop-in': {
    version: 1,
    groupId: 'entrance',
    parameterId: 'scale',
    label: 'Aparecer con rebote',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.28, mode: 'factor', amount: 1.12, interpolation: 'ease' },
      { atSeconds: 0.48, mode: 'factor', amount: 1, interpolation: 'hold' },
    ],
  },
  'exit-left': {
    version: 1,
    groupId: 'exit',
    parameterId: 'position.x',
    label: 'Salir por la izquierda',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.6, mode: 'offset', amount: -420, interpolation: 'hold' },
    ],
  },
  'exit-right': {
    version: 1,
    groupId: 'exit',
    parameterId: 'position.x',
    label: 'Salir por la derecha',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.6, mode: 'offset', amount: 420, interpolation: 'hold' },
    ],
  },
  'exit-top': {
    version: 1,
    groupId: 'exit',
    parameterId: 'position.y',
    label: 'Salir hacia arriba',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.68, mode: 'offset', amount: -520, interpolation: 'hold' },
    ],
  },
  'fade-in': {
    version: 1,
    groupId: 'visibility',
    parameterId: 'opacity',
    label: 'Aparecer',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 0, interpolation: 'linear' },
      { atSeconds: 0.4, mode: 'absolute', amount: 1, interpolation: 'hold' },
    ],
  },
  'fade-out': {
    version: 1,
    groupId: 'visibility',
    parameterId: 'opacity',
    label: 'Desaparecer',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 1, interpolation: 'linear' },
      { atSeconds: 0.4, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  blink: {
    version: 1,
    groupId: 'visibility',
    parameterId: 'opacity',
    label: 'Parpadeo visual',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 1, interpolation: 'linear' },
      { atSeconds: 0.1, mode: 'absolute', amount: 0, interpolation: 'linear' },
      { atSeconds: 0.2, mode: 'absolute', amount: 1, interpolation: 'hold' },
    ],
  },
  'emphasis-pulse': {
    version: 1,
    groupId: 'emphasis',
    parameterId: 'scale',
    label: 'Énfasis',
    steps: [
      { atSeconds: 0, mode: 'factor', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.18, mode: 'factor', amount: 1.14, interpolation: 'ease' },
      { atSeconds: 0.46, mode: 'factor', amount: 1, interpolation: 'hold' },
    ],
  },
  'shake-horizontal': {
    version: 1,
    groupId: 'emphasis',
    parameterId: 'position.x',
    label: 'Sacudida lateral',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 0, interpolation: 'linear' },
      { atSeconds: 0.08, mode: 'offset', amount: -34, interpolation: 'linear' },
      { atSeconds: 0.16, mode: 'offset', amount: 34, interpolation: 'linear' },
      { atSeconds: 0.24, mode: 'offset', amount: -18, interpolation: 'linear' },
      { atSeconds: 0.34, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  wobble: {
    version: 1,
    groupId: 'emphasis',
    parameterId: 'rotationDegrees',
    label: 'Balanceo',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.14, mode: 'offset', amount: -10, interpolation: 'ease' },
      { atSeconds: 0.28, mode: 'offset', amount: 10, interpolation: 'ease' },
      { atSeconds: 0.42, mode: 'offset', amount: -5, interpolation: 'ease' },
      { atSeconds: 0.58, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  'squash-stretch': {
    version: 1,
    groupId: 'emphasis',
    parameterId: 'scale',
    label: 'Aplastar y estirar',
    steps: [
      { atSeconds: 0, mode: 'factor', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.12, mode: 'factor', amount: 0.86, interpolation: 'ease' },
      { atSeconds: 0.26, mode: 'factor', amount: 1.12, interpolation: 'ease' },
      { atSeconds: 0.44, mode: 'factor', amount: 1, interpolation: 'hold' },
    ],
  },
  jump: {
    version: 1,
    groupId: 'movement',
    parameterId: 'position.y',
    label: 'Saltar',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.24, mode: 'offset', amount: -240, interpolation: 'ease' },
      { atSeconds: 0.52, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  float: {
    version: 1,
    groupId: 'movement',
    parameterId: 'position.y',
    label: 'Flotar',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.36, mode: 'offset', amount: -42, interpolation: 'ease' },
      { atSeconds: 0.72, mode: 'offset', amount: 0, interpolation: 'ease' },
      { atSeconds: 1.08, mode: 'offset', amount: 32, interpolation: 'ease' },
      { atSeconds: 1.44, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  'arm-raise': {
    version: 1,
    groupId: 'articulation',
    parameterId: 'armRaise',
    label: 'Levantar brazo derecho',
    steps: [
      { atSeconds: -0.1, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.15, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.85, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  'left-arm-raise': {
    version: 1, groupId: 'articulation', parameterId: 'leftArmRaise', label: 'Levantar brazo izquierdo',
    steps: [
      { atSeconds: -0.1, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.15, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.85, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  'right-elbow-bend': {
    version: 1, groupId: 'articulation', parameterId: 'rightElbowBend', label: 'Flexionar codo derecho',
    steps: [
      { atSeconds: -0.1, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.15, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.7, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  'left-elbow-bend': {
    version: 1, groupId: 'articulation', parameterId: 'leftElbowBend', label: 'Flexionar codo izquierdo',
    steps: [
      { atSeconds: -0.1, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.15, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.7, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  'head-tilt': {
    version: 1, groupId: 'articulation', parameterId: 'headTilt', label: 'Inclinar la cabeza',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.2, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.65, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  'head-nod': {
    version: 1, groupId: 'articulation', parameterId: 'headNod', label: 'Asentir',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.16, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.34, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.52, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.7, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  'body-lean': {
    version: 1, groupId: 'articulation', parameterId: 'bodyLean', label: 'Inclinar el cuerpo',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.24, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.72, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  'body-bounce': {
    version: 1, groupId: 'articulation', parameterId: 'bodyBounce', label: 'Rebotar',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.14, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.3, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.46, mode: 'absolute', amount: 0.75, interpolation: 'ease' },
      { atSeconds: 0.62, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
});

export function animationPresetWindow(presetId, intensityId = 'medium') {
  const preset = ANIMATION_PRESETS[presetId];
  if (!preset) failAnimation('ANIM_DOCUMENT_INVALID', '/presetId', `Preset desconocido: ${presetId}`);
  const intensity = ANIMATION_INTENSITIES[intensityId];
  if (!intensity) failAnimation('ANIM_DOCUMENT_INVALID', '/intensity', `Intensidad desconocida: ${intensityId}`);
  const offsets = preset.steps.map((step) => round(step.atSeconds * intensity.duration));
  return {
    startOffsetSeconds: Math.min(...offsets),
    endOffsetSeconds: Math.max(...offsets),
  };
}

function clamp(value, parameter) {
  const minimum = parameter.exclusiveMinimum !== undefined
    // Un valor exactamente en el mínimo excluyente no es válido; se deja apenas
    // por encima en vez de fallar, que para una escala es lo útil.
    ? parameter.exclusiveMinimum + 0.001
    : parameter.minimum;
  return Math.max(minimum, Math.min(parameter.maximum, value));
}

function round(value) {
  // Tres decimales: suficiente para píxeles y factores, y evita que la misma
  // expansión difiera en el último bit entre plataformas.
  return Math.round(value * 1000) / 1000;
}

/**
 * Expande un preset a una pista completa.
 *
 * `baseValue` es el valor vigente del parámetro en el elemento; los presets que
 * vuelven a la base lo necesitan para saber a dónde volver. Se lee UNA vez, al
 * aplicar: si después se mueve la base, la pista no se mueve sola, como fijó la
 * Fase 0.
 */
export function expandAnimationPreset(presetId, options = {}) {
  const preset = ANIMATION_PRESETS[presetId];
  if (!preset) failAnimation('ANIM_DOCUMENT_INVALID', '/presetId', `Preset desconocido: ${presetId}`);
  const intensity = ANIMATION_INTENSITIES[options.intensity ?? 'medium'];
  if (!intensity) failAnimation('ANIM_DOCUMENT_INVALID', '/intensity', `Intensidad desconocida: ${options.intensity}`);
  const anchor = options.anchor ?? { kind: 'scene', edge: 'start' };
  const parameter = ANIMATION_PARAMETERS[preset.parameterId];
  const baseValue = options.baseValue ?? (preset.parameterId === 'scale' ? 1 : 0);
  const baseOffsetSeconds = options.offsetSeconds ?? 0;
  const prefix = options.keyframeIdPrefix ?? `kf-${presetId}`;

  const keyframes = preset.steps.map((step, index) => {
    const raw = step.mode === 'offset'
      ? baseValue + step.amount * intensity.amplitude
      : step.mode === 'factor'
        ? baseValue * (1 + (step.amount - 1) * intensity.amplitude)
        : step.amount;
    return {
      id: `${prefix}-${index + 1}`,
      anchor: structuredClone(anchor),
      offsetSeconds: round(baseOffsetSeconds + step.atSeconds * intensity.duration),
      value: round(clamp(raw, parameter)),
      interpolation: step.interpolation,
    };
  });

  return {
    parameterId: preset.parameterId,
    source: { kind: 'preset', presetId, version: preset.version, customized: false },
    keyframes,
  };
}

/** Presets aplicables a un elemento, según lo que el recurso declare. */
export function listApplicablePresets(declaredParameters = []) {
  return Object.entries(ANIMATION_PRESETS)
    .filter(([, preset]) => !ANIMATION_PARAMETERS[preset.parameterId].requiresResourceSupport
      || declaredParameters.includes(preset.parameterId))
    .map(([id, preset]) => ({
      id,
      label: preset.label,
      groupId: preset.groupId,
      parameterId: preset.parameterId,
      version: preset.version,
    }));
}
