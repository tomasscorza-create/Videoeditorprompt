import { evaluateAnimationParams } from './animation-evaluator.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cuadros que ocupa una escena y la duración exacta que va a tener su video.
 *
 * El video cubre el audio medido completo, así que se redondea hacia arriba al
 * cuadro siguiente. La duración resultante es la que el ensamblaje usa para
 * ubicar cada escena en la línea de tiempo del proyecto.
 *
 * Vive acá porque es una función pura del audio medido y los fps: permite
 * conocer la duración de una escena SIN renderizarla, que es lo que habilita
 * medir un proyecto sin generar un solo cuadro. Las dos rutas de exportación y
 * el medidor la comparten para no sostener el mismo invariante por triplicado.
 */
export function sceneFrameCount(audioDurationSeconds, fps) {
  return Math.ceil(audioDurationSeconds * fps);
}

export function sceneRenderDurationSeconds(audioDurationSeconds, fps) {
  return sceneFrameCount(audioDurationSeconds, fps) / fps;
}

export function buildBlinkSchedule(durationSeconds, options) {
  const random = mulberry32(options.seed);
  const schedule = [];
  let time = options.firstSeconds;
  while (time < durationSeconds) {
    schedule.push({ start: time, end: Math.min(durationSeconds, time + options.durationSeconds) });
    time += options.minIntervalSeconds
      + random() * (options.maxIntervalSeconds - options.minIntervalSeconds);
  }
  return schedule;
}

/**
 * `animation` es opcional y viene de `resolveAnimationScene`. Cuando falta, el
 * estado devuelto es exactamente el de siempre, sin la clave `elements`: de eso
 * depende que el `temporalHash` de los pilotos v2 no cambie. Las escenas v1
 * heredadas no admiten pistas.
 */
export function evaluateScene(config, runtime, temporalData, timeSeconds, animation = null) {
  if (config.version === 2) return evaluateDialogueScene(config, runtime, temporalData, timeSeconds, animation);
  return evaluateLegacyScene(config, runtime, temporalData, timeSeconds);
}

function evaluateLegacyScene(config, runtime, mouthCues, timeSeconds) {
  const duration = runtime.audio.durationSeconds;
  const time = clamp(timeSeconds, 0, duration);
  const character = config.character;
  const entry = smoothstep(time / character.entrySeconds);
  const phase = (time / character.bobPeriodSeconds) * Math.PI * 2;
  const cue = mouthCues.find((item) => time >= item.start && time < item.end);
  const blinking = runtime.blinks.some((blink) => time >= blink.start && time < blink.end);
  const gestureCue = (config.gestures ?? []).find((item) => time >= item.startSeconds && time < item.startSeconds + item.durationSeconds);

  return {
    time,
    background: evaluateBackground(runtime.backgroundAnimation, time, duration),
    character: {
      x: character.fromX + (character.toX - character.fromX) * entry,
      y: character.baseY + Math.sin(phase) * character.bobAmplitude,
      scale: character.baseScale + Math.sin(phase * 0.5) * character.scalePulse,
      opacity: clamp(time / 0.3, 0, 1),
    },
    eyes: blinking ? 'closed' : 'open',
    mouth: cue?.state ?? 'closed',
    gesture: gestureCue?.pose ?? 'neutral',
    subtitleVisible: time >= config.subtitle.startSeconds && time < duration,
  };
}

function evaluateBackground(backgroundAnimation, time, duration) {
  if (!backgroundAnimation) return null;
  const progress = smoothstep(duration > 0 ? time / duration : 0);
  const camera = backgroundAnimation.camera;
  const x = camera.fromX + (camera.toX - camera.fromX) * progress;
  const y = camera.fromY + (camera.toY - camera.fromY) * progress;
  const zoom = camera.fromZoom + (camera.toZoom - camera.fromZoom) * progress;
  return {
    camera: { x, y, zoom },
    layers: backgroundAnimation.layers.map((layer) => ({
      id: layer.id,
      x: -x * layer.parallaxX,
      y: -y * layer.parallaxY,
      scale: layer.baseScale * zoom,
    })),
  };
}

function evaluateDialogueScene(config, runtime, dialogueData, timeSeconds, animation = null) {
  const duration = runtime.audio.durationSeconds;
  const time = clamp(timeSeconds, 0, duration);
  const activeTurn = dialogueData.turns.find((turn) => time >= turn.startSeconds && time < turn.endSeconds);
  const animatedParams = animation ? evaluateAnimationParams(animation, time) : null;
  const elementParams = {};
  const characters = runtime.characters.map((characterRuntime) => {
    const transform = characterRuntime.transform;
    const entry = smoothstep(time / transform.entrySeconds);
    const idle = evaluateIdleMotion(transform, time);
    const layout = evaluateTurnLayout(dialogueData.turns, characterRuntime.id, transform, time);
    const blinking = characterRuntime.blinks.some((blink) => time >= blink.start && time < blink.end);
    const speaking = activeTurn?.speakerId === characterRuntime.id;
    const localTime = speaking ? time - activeTurn.startSeconds : -1;
    const cue = speaking ? activeTurn.mouthCues.find((item) => localTime >= item.start && localTime < item.end) : null;
    const gestureCue = speaking
      ? activeTurn.gestureCue ?? (activeTurn.gesture !== 'neutral' ? {
        pose: activeTurn.gesture,
        startSeconds: activeTurn.durationSeconds * 0.22,
        durationSeconds: activeTurn.durationSeconds * 0.5,
      } : null)
      : null;
    const gesture = gestureCue
      && localTime >= gestureCue.startSeconds
      && localTime < gestureCue.startSeconds + gestureCue.durationSeconds
      ? gestureCue.pose
      : 'neutral';
    // Los parámetros son la fuente: primero la base (entrada, layout de turno y
    // movimiento base), después la pista, que REEMPLAZA el valor base en vez de
    // sumarse. La vista v2 de abajo se deriva de acá, así no hay dos cálculos.
    const params = {
      'position.x': layout ? layout.x : transform.fromX + (transform.toX - transform.fromX) * entry,
      'position.y': (layout?.y ?? transform.baseY) + idle.y,
      scale: (layout?.scale ?? transform.baseScale) + idle.scale,
      opacity: clamp(time / 0.3, 0, 1),
      ...(animatedParams?.[characterRuntime.id] ?? {}),
    };
    if (animation) elementParams[characterRuntime.id] = { params };
    return {
      id: characterRuntime.id,
      character: {
        x: params['position.x'],
        y: params['position.y'],
        scale: params.scale,
        opacity: params.opacity,
      },
      eyes: blinking ? 'closed' : 'open',
      mouth: cue?.state ?? 'closed',
      gesture,
      speaking,
    };
  });
  if (animation) {
    for (const propRuntime of (runtime.props ?? [])) {
      const transform = propRuntime.transform;
      elementParams[propRuntime.id] = {
        params: {
          'position.x': transform.x,
          'position.y': transform.y,
          scale: transform.scale,
          rotationDegrees: transform.rotationDegrees,
          opacity: transform.opacity,
          ...(animatedParams?.[propRuntime.id] ?? {}),
        },
      };
    }
  }
  return {
    time,
    background: evaluateBackground(runtime.backgroundAnimation, time, duration),
    activeSpeakerId: activeTurn?.speakerId ?? null,
    activeTurnId: activeTurn?.id ?? null,
    subtitlePath: activeTurn?.subtitlePath ?? null,
    characters,
    // Solo con animación: agregar la clave siempre cambiaría el temporalHash de
    // todos los pilotos v2 sin que nada haya cambiado de verdad.
    ...(animation ? { elements: elementParams } : {}),
  };
}

function evaluateIdleMotion(transform, time) {
  if (!transform.idleProfile) {
    const phase = (time / transform.bobPeriodSeconds) * Math.PI * 2;
    return {
      y: Math.sin(phase) * transform.bobAmplitude,
      scale: Math.sin(phase * 0.5) * transform.scalePulse,
    };
  }
  const phaseOffset = ((transform.motionSeed ?? 0) % 997) / 997 * Math.PI * 2;
  const phase = (time / transform.bobPeriodSeconds) * Math.PI * 2 + phaseOffset;
  if (transform.idleProfile === 'breathing') {
    return {
      y: Math.sin(phase) * transform.bobAmplitude * 0.55 + Math.sin(phase * 0.37) * transform.bobAmplitude * 0.2,
      scale: Math.sin(phase * 0.5) * transform.scalePulse,
    };
  }
  if (transform.idleProfile === 'sway') {
    return {
      y: Math.sin(phase) * transform.bobAmplitude + Math.sin(phase * 1.73) * transform.bobAmplitude * 0.18,
      scale: Math.sin(phase * 0.41) * transform.scalePulse * 0.65,
    };
  }
  return {
    y: Math.sin(phase) * transform.bobAmplitude * 0.72
      + Math.sin(phase * 0.61 + 1.2) * transform.bobAmplitude * 0.25,
    scale: Math.sin(phase * 0.47) * transform.scalePulse
      + Math.sin(phase * 0.19 + 0.7) * transform.scalePulse * 0.3,
  };
}

function evaluateTurnLayout(turns, characterId, transform, time) {
  let previous = { x: transform.toX, y: transform.baseY, scale: transform.baseScale };
  for (const turn of turns) {
    const target = turn.layout?.find((item) => item.characterId === characterId);
    if (!target || time < turn.startSeconds) continue;
    const progress = smoothstep((time - turn.startSeconds) / 0.35);
    const current = {
      x: previous.x + (target.x - previous.x) * progress,
      y: previous.y + (target.y - previous.y) * progress,
      scale: previous.scale + (target.scale - previous.scale) * progress,
    };
    if (progress < 1) return current;
    previous = target;
  }
  return previous.x === transform.toX && previous.y === transform.baseY && previous.scale === transform.baseScale
    ? null
    : previous;
}

/**
 * Expresión de FFmpeg equivalente a `evaluateTrack` para una pista resuelta.
 *
 * Reproduce exactamente las tres reglas congeladas en la Fase 0: la
 * interpolación de un keyframe describe el tramo que SALE de él, antes del
 * primero se sostiene su valor y después del último el valor queda congelado.
 * `ease` es `inOutSine`, la misma curva del evaluador.
 *
 * Los keyframes llegan resueltos y ordenados por segundo (`resolveAnimationScene`),
 * y con los valores ya en el espacio de coordenadas del runtime.
 */
export function createFfmpegTrackExpression(keyframes) {
  // Antes del primer keyframe se sostiene su valor; no se extrapola hacia atrás.
  let expression = String(keyframes[0].value);
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    const span = to.seconds - from.seconds;
    const ratio = span > 0 ? `min(max((t-${from.seconds})/${span},0),1)` : '1';
    const eased = from.interpolation === 'hold'
      ? '0'
      : from.interpolation === 'ease'
        ? `(0.5-0.5*cos(PI*(${ratio})))`
        : `(${ratio})`;
    // La diferencia se calcula acá y no en la expresión: `evaluateTrack` hace la
    // misma resta sobre los mismos dobles, así que los dos caminos coinciden bit
    // a bit, y de paso se evita emitir un `--` cuando el valor de salida es
    // negativo.
    const segment = `(${from.value}+(${to.value - from.value})*${eased})`;
    // El último tramo sujeta la razón a 1, así que después del último keyframe
    // el valor queda congelado sin necesitar una rama aparte.
    expression = `if(gte(t,${from.seconds}),${segment},${expression})`;
  }
  return expression;
}

/**
 * Una pista REEMPLAZA el valor base de su parámetro, no se suma: por eso las
 * expresiones animadas pisan las de entrada, layout y movimiento base en vez de
 * combinarse con ellas. `opacity` no aparece acá porque el compositor de FFmpeg
 * no acepta una expresión de alfa; el exportador la resuelve por rangos de
 * frames a partir del plan, que sale del mismo evaluador.
 */
function applyAnimatedTracks(config, motion, animatedTracks) {
  if (!animatedTracks || animatedTracks.length === 0) return motion;
  const result = { ...motion };
  for (const track of animatedTracks) {
    if (track.keyframes.length === 0) continue;
    const expression = createFfmpegTrackExpression(track.keyframes);
    if (track.parameterId === 'position.x') {
      result.x = `${config.video.width / 2}+(${expression})-overlay_w/2`;
    } else if (track.parameterId === 'position.y') {
      result.y = `${config.video.height / 2}+(${expression})-overlay_h/2`;
    } else if (track.parameterId === 'scale') {
      result.scaleWidth = `${config.video.width}*(${expression})`;
      result.scaleHeight = `${config.video.height}*(${expression})`;
    }
  }
  return result;
}

export function createFfmpegMotionExpressions(config, character = config.character, dialogueData = null, characterId = null, animatedTracks = null) {
  const item = character;
  const entry = `min(max(t/${item.entrySeconds},0),1)`;
  const eased = `((${entry})*(${entry})*(3-2*(${entry})))`;
  if (!item.idleProfile) {
    const scale = `(${item.baseScale}+sin(PI*t/${item.bobPeriodSeconds})*${item.scalePulse})`;
    return applyAnimatedTracks(config, {
      scaleWidth: `${config.video.width}*${scale}`,
      scaleHeight: `${config.video.height}*${scale}`,
      x: `${config.video.width / 2}+(${item.fromX}+(${item.toX}-${item.fromX})*${eased})-overlay_w/2`,
      y: `${config.video.height / 2}+${item.baseY}+sin(2*PI*t/${item.bobPeriodSeconds})*${item.bobAmplitude}-overlay_h/2`,
    }, animatedTracks);
  }
  const phaseOffset = (((item.motionSeed ?? 0) % 997) / 997 * Math.PI * 2).toFixed(9);
  const phase = `(2*PI*t/${item.bobPeriodSeconds}+${phaseOffset})`;
  const idle = idleExpressions(item, phase);
  const baseX = `(${item.fromX}+(${item.toX}-${item.fromX})*${eased})`;
  const layoutTurns = dialogueData?.turns?.filter((turn) => turn.layout?.some((layout) => layout.characterId === characterId)) ?? [];
  const layoutX = layoutExpression(layoutTurns, characterId, 'x', baseX, item.toX);
  const layoutY = layoutExpression(layoutTurns, characterId, 'y', String(item.baseY), item.baseY);
  const layoutScale = layoutExpression(layoutTurns, characterId, 'scale', String(item.baseScale), item.baseScale);
  const scale = `((${layoutScale})+(${idle.scale}))`;
  return applyAnimatedTracks(config, {
    scaleWidth: `${config.video.width}*${scale}`,
    scaleHeight: `${config.video.height}*${scale}`,
    x: `${config.video.width / 2}+(${layoutX})-overlay_w/2`,
    y: `${config.video.height / 2}+(${layoutY})+(${idle.y})-overlay_h/2`,
  }, animatedTracks);
}

function idleExpressions(item, phase) {
  if (item.idleProfile === 'breathing') {
    return {
      y: `sin(${phase})*${item.bobAmplitude}*0.55+sin((${phase})*0.37)*${item.bobAmplitude}*0.2`,
      scale: `sin((${phase})*0.5)*${item.scalePulse}`,
    };
  }
  if (item.idleProfile === 'sway') {
    return {
      y: `sin(${phase})*${item.bobAmplitude}+sin((${phase})*1.73)*${item.bobAmplitude}*0.18`,
      scale: `sin((${phase})*0.41)*${item.scalePulse}*0.65`,
    };
  }
  return {
    y: `sin(${phase})*${item.bobAmplitude}*0.72+sin((${phase})*0.61+1.2)*${item.bobAmplitude}*0.25`,
    scale: `sin((${phase})*0.47)*${item.scalePulse}+sin((${phase})*0.19+0.7)*${item.scalePulse}*0.3`,
  };
}

function layoutExpression(turns, characterId, property, initialExpression, initialValue) {
  let expression = initialExpression;
  let previous = initialValue;
  for (const turn of turns) {
    const target = turn.layout.find((item) => item.characterId === characterId)?.[property];
    if (target === undefined) continue;
    const progress = `min(max((t-${turn.startSeconds})/0.35,0),1)`;
    const eased = `((${progress})*(${progress})*(3-2*(${progress})))`;
    const transition = `(${previous}+(${target}-${previous})*${eased})`;
    expression = `if(gte(t,${turn.startSeconds}),${transition},${expression})`;
    previous = target;
  }
  return expression;
}

export function createFfmpegBackgroundExpressions(runtime, layer) {
  const camera = runtime.backgroundAnimation.camera;
  const duration = runtime.audio.durationSeconds;
  const progress = `min(max(t/${duration},0),1)`;
  const eased = `((${progress})*(${progress})*(3-2*(${progress})))`;
  const x = `(${camera.fromX}+(${camera.toX}-${camera.fromX})*${eased})`;
  const y = `(${camera.fromY}+(${camera.toY}-${camera.fromY})*${eased})`;
  const zoom = `(${camera.fromZoom}+(${camera.toZoom}-${camera.fromZoom})*${eased})`;
  const scale = `(${layer.baseScale}*${zoom})`;
  return {
    scaleWidth: `${runtime.videoWidth || 1080}*${scale}`,
    scaleHeight: `${runtime.videoHeight || 1920}*${scale}`,
    x: `(main_w-overlay_w)/2-${x}*${layer.parallaxX}`,
    y: `(main_h-overlay_h)/2-${y}*${layer.parallaxY}`,
  };
}
