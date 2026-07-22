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

export function evaluateScene(config, runtime, temporalData, timeSeconds) {
  if (config.version === 2) return evaluateDialogueScene(config, runtime, temporalData, timeSeconds);
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

function evaluateDialogueScene(config, runtime, dialogueData, timeSeconds) {
  const duration = runtime.audio.durationSeconds;
  const time = clamp(timeSeconds, 0, duration);
  const activeTurn = dialogueData.turns.find((turn) => time >= turn.startSeconds && time < turn.endSeconds);
  const characters = runtime.characters.map((characterRuntime) => {
    const transform = characterRuntime.transform;
    const entry = smoothstep(time / transform.entrySeconds);
    const phase = (time / transform.bobPeriodSeconds) * Math.PI * 2;
    const blinking = characterRuntime.blinks.some((blink) => time >= blink.start && time < blink.end);
    const speaking = activeTurn?.speakerId === characterRuntime.id;
    const localTime = speaking ? time - activeTurn.startSeconds : -1;
    const cue = speaking ? activeTurn.mouthCues.find((item) => localTime >= item.start && localTime < item.end) : null;
    const turnProgress = speaking && activeTurn.durationSeconds > 0 ? localTime / activeTurn.durationSeconds : 0;
    const gesture = speaking && activeTurn.gesture === 'point' && turnProgress >= 0.22 && turnProgress < 0.72
      ? 'point'
      : 'neutral';
    return {
      id: characterRuntime.id,
      character: {
        x: transform.fromX + (transform.toX - transform.fromX) * entry,
        y: transform.baseY + Math.sin(phase) * transform.bobAmplitude,
        scale: transform.baseScale + Math.sin(phase * 0.5) * transform.scalePulse,
        opacity: clamp(time / 0.3, 0, 1),
      },
      eyes: blinking ? 'closed' : 'open',
      mouth: cue?.state ?? 'closed',
      gesture,
      speaking,
    };
  });
  return {
    time,
    background: evaluateBackground(runtime.backgroundAnimation, time, duration),
    activeSpeakerId: activeTurn?.speakerId ?? null,
    activeTurnId: activeTurn?.id ?? null,
    subtitlePath: activeTurn?.subtitlePath ?? null,
    characters,
  };
}

export function createFfmpegMotionExpressions(config, character = config.character) {
  const item = character;
  const entry = `min(max(t/${item.entrySeconds},0),1)`;
  const eased = `((${entry})*(${entry})*(3-2*(${entry})))`;
  const scale = `(${item.baseScale}+sin(PI*t/${item.bobPeriodSeconds})*${item.scalePulse})`;
  return {
    scaleWidth: `${config.video.width}*${scale}`,
    scaleHeight: `${config.video.height}*${scale}`,
    x: `${config.video.width / 2}+(${item.fromX}+(${item.toX}-${item.fromX})*${eased})-overlay_w/2`,
    y: `${config.video.height / 2}+${item.baseY}+sin(2*PI*t/${item.bobPeriodSeconds})*${item.bobAmplitude}-overlay_h/2`,
  };
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
