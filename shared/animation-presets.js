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

/**
 * Catálogo cerrado y versionado.
 *
 * `steps` describe los keyframes en forma relativa: `atSeconds` es el
 * desplazamiento desde el ancla y `value` se resuelve contra el valor base del
 * elemento. `offset` suma sobre la base, `absolute` la ignora, `factor` la
 * multiplica. Con eso alcanza para los seis presets de V1 sin una sola línea de
 * lógica por preset.
 */
export const ANIMATION_PRESETS = Object.freeze({
  'enter-left': {
    version: 1,
    parameterId: 'position.x',
    label: 'Entrar por la izquierda',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: -420, interpolation: 'ease' },
      { atSeconds: 0.6, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  'enter-right': {
    version: 1,
    parameterId: 'position.x',
    label: 'Entrar por la derecha',
    steps: [
      { atSeconds: 0, mode: 'offset', amount: 420, interpolation: 'ease' },
      { atSeconds: 0.6, mode: 'offset', amount: 0, interpolation: 'hold' },
    ],
  },
  'fade-in': {
    version: 1,
    parameterId: 'opacity',
    label: 'Aparecer',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 0, interpolation: 'linear' },
      { atSeconds: 0.4, mode: 'absolute', amount: 1, interpolation: 'hold' },
    ],
  },
  'fade-out': {
    version: 1,
    parameterId: 'opacity',
    label: 'Desaparecer',
    steps: [
      { atSeconds: 0, mode: 'absolute', amount: 1, interpolation: 'linear' },
      { atSeconds: 0.4, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
  'emphasis-pulse': {
    version: 1,
    parameterId: 'scale',
    label: 'Énfasis',
    steps: [
      { atSeconds: 0, mode: 'factor', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.18, mode: 'factor', amount: 1.14, interpolation: 'ease' },
      { atSeconds: 0.46, mode: 'factor', amount: 1, interpolation: 'hold' },
    ],
  },
  'arm-raise': {
    version: 1,
    parameterId: 'armRaise',
    label: 'Levantar el brazo',
    steps: [
      { atSeconds: -0.1, mode: 'absolute', amount: 0, interpolation: 'ease' },
      { atSeconds: 0.15, mode: 'absolute', amount: 1, interpolation: 'ease' },
      { atSeconds: 0.85, mode: 'absolute', amount: 0, interpolation: 'hold' },
    ],
  },
});

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
      offsetSeconds: round(step.atSeconds * intensity.duration),
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
    .map(([id, preset]) => ({ id, label: preset.label, parameterId: preset.parameterId, version: preset.version }));
}
