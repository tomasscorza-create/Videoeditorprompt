// Fase 3 — el compositor vigente, detrás del contrato.
//
// Esto no es código nuevo: es el mismo grafo de filtros que el exportador venía
// armando en línea, movido tal cual detrás de la misma firma que
// `composeFramesWithPixi`. Que los dos backends entren y salgan igual es lo que
// después permite elegir uno u otro por escena.
//
// El contrato del compositor es angosto a propósito: entra un plan de frames ya
// resuelto y salen PNG. FFmpeg sigue siendo además el encoder, el mixer y el
// muxer, pero eso pasa afuera de acá.
//
// Cómo compone, en dos capas que conviene no confundir:
//
//   - Lo DISCRETO (ojos, boca, gesto, subtítulo, opacidad animada) se enciende y
//     se apaga por rangos de frames que salen del plan: `enable='between(n,a,b)'`.
//   - Lo CONTINUO (posición y escala) es una expresión sobre `t`, que el
//     evaluador y el compositor comparten a través de `createFfmpegMotionExpressions`.
//
// La lista de PNG que devuelve se lee del directorio, no de lo que se pidió: el
// hash de contenido del render depende de ese orden, y leerlo del disco es lo que
// venía haciendo el exportador.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createFfmpegBackgroundExpressions, createFfmpegMotionExpressions } from '../../shared/scene-evaluator.js';
import { ensureDirectory, run } from '../stage1/common.mjs';
import { resolveAsset } from '../stage1/job-context.mjs';

// Pasos de alfa. Con 8 bits por canal, 1/64 deja un error máximo de 2 niveles de
// 255: invisible, y acota cuántos filtros se encadenan por personaje.
const OPACITY_LEVELS = 64;

const LAYER_KEYS = [
  'body', 'eyesOpen', 'eyesClosed',
  'mouthClosed', 'mouthMedium', 'mouthOpen', 'mouthRound', 'mouthLabiodental', 'mouthBilabial',
  'handNeutral', 'handPoint', 'handCelebrate', 'handDoubt', 'handDeny',
];

/** Tramos contiguos de frames que cumplen `predicate`, para `enable`. */
export function ranges(items, predicate) {
  const result = [];
  let start = null;
  for (let index = 0; index < items.length; index += 1) {
    if (predicate(items[index]) && start === null) start = index;
    if ((!predicate(items[index]) || index === items.length - 1) && start !== null) {
      result.push([start, predicate(items[index]) && index === items.length - 1 ? index : index - 1]);
      start = null;
    }
  }
  return result;
}

export function quantizedOpacity(frame, characterId) {
  const state = frame.characters.find((character) => character.id === characterId);
  const value = Math.max(0, Math.min(1, state?.character.opacity ?? 1));
  return Math.round(value * OPACITY_LEVELS);
}

/**
 * Opacidad del personaje sobre la cadena de filtros.
 *
 * Sin pista se conserva la entrada de siempre. Con pista, el valor sale del plan
 * de frames —que ya trae la pista evaluada— y se aplica por rangos de frames, el
 * mismo idioma con el que la escena ya enciende ojos, boca y gestos. Se hace así
 * porque `overlay` no acepta una expresión de alfa, y resolverlo por píxel con
 * `geq` costaría mil millones de evaluaciones por escena.
 */
export function applyOpacity(filters, prefix, characterId, framePlan, animatedTracks, enable) {
  const hasTrack = (animatedTracks ?? []).some((track) => track.parameterId === 'opacity');
  if (!hasTrack) {
    filters.push(`[${prefix}hands]fade=t=in:st=0:d=0.3:alpha=1[${prefix}character]`);
    return `${prefix}character`;
  }
  const levels = [...new Set(framePlan.map((frame) => quantizedOpacity(frame, characterId)))]
    .filter((level) => level < OPACITY_LEVELS)
    .sort((left, right) => left - right);
  let label = `${prefix}hands`;
  for (const [index, level] of levels.entries()) {
    const next = `${prefix}op${index}`;
    const enabled = enable((frame) => quantizedOpacity(frame, characterId) === level);
    filters.push(`[${label}]colorchannelmixer=aa=${(level / OPACITY_LEVELS).toFixed(4)}:enable='${enabled}'[${next}]`);
    label = next;
  }
  return label;
}

/**
 * Compone los frames de una escena de diálogo con FFmpeg y devuelve los PNG.
 *
 * Misma forma de entrada y de salida que `composeFramesWithPixi`, que es el punto
 * de tener el contrato.
 */
export function composeFramesWithFfmpeg({
  context,
  config,
  runtime,
  dialogueData,
  framePlan,
  animation,
  framesDirectory,
  fps,
  renderDuration,
  frameCount,
  generatedPath,
  report,
  renderId,
}) {
  ensureDirectory(framesDirectory);
  const started = performance.now();
  const inputs = [];
  const addAsset = (relativePath, name) => {
    const index = inputs.length;
    inputs.push(resolveAsset(context, relativePath, name));
    return index;
  };
  const backgroundIndex = runtime.backgroundAnimation ? null : addAsset(runtime.assets.background, 'background');
  const backgroundInputs = runtime.backgroundAnimation?.layers.map((layer) => ({
    layer,
    index: addAsset(layer.asset, `background/${layer.id}`),
  })) || [];
  const characterInputs = runtime.characters.map((character) => ({
    id: character.id,
    indices: Object.fromEntries(LAYER_KEYS.map((key) => [key, addAsset(character.assets[key], `${character.id}/${key}`)])),
    transform: character.transform,
  }));
  const subtitlePaths = [...new Set(dialogueData.turns.flatMap((turn) => (
    turn.subtitleCues?.map((cue) => cue.subtitlePath) ?? (turn.subtitlePath ? [turn.subtitlePath] : [])
  )))];
  const subtitleInputs = subtitlePaths.map((subtitlePath) => ({
    subtitlePath,
    index: inputs.push(generatedPath(subtitlePath)) - 1,
  }));
  const enable = (predicate) => ranges(framePlan, predicate)
    .map(([start, end]) => `between(n\\,${start}\\,${end})`).join('+') || '0';
  const filters = [];
  const scaledLabels = [];

  for (const [index, item] of characterInputs.entries()) {
    const stateFor = (frame) => frame.characters.find((character) => character.id === item.id);
    const prefix = `d${index}`;
    filters.push(`[${item.indices.body}:v][${item.indices.eyesOpen}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).eyes === 'open')}'[${prefix}e1]`);
    filters.push(`[${prefix}e1][${item.indices.eyesClosed}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).eyes === 'closed')}'[${prefix}e2]`);
    filters.push(`[${prefix}e2][${item.indices.mouthClosed}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'closed')}'[${prefix}m1]`);
    filters.push(`[${prefix}m1][${item.indices.mouthMedium}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'medium')}'[${prefix}m2]`);
    filters.push(`[${prefix}m2][${item.indices.mouthOpen}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'open')}'[${prefix}m3]`);
    filters.push(`[${prefix}m3][${item.indices.mouthRound}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'round')}'[${prefix}m4]`);
    filters.push(`[${prefix}m4][${item.indices.mouthLabiodental}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'labiodental')}'[${prefix}m5]`);
    filters.push(`[${prefix}m5][${item.indices.mouthBilabial}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).mouth === 'bilabial')}'[${prefix}m6]`);
    filters.push(`[${prefix}m6][${item.indices.handNeutral}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).gesture === 'neutral')}'[${prefix}h1]`);
    filters.push(`[${prefix}h1][${item.indices.handPoint}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).gesture === 'point')}'[${prefix}h2]`);
    filters.push(`[${prefix}h2][${item.indices.handCelebrate}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).gesture === 'celebrate')}'[${prefix}h3]`);
    filters.push(`[${prefix}h3][${item.indices.handDoubt}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).gesture === 'doubt')}'[${prefix}h4]`);
    filters.push(`[${prefix}h4][${item.indices.handDeny}:v]overlay=0:0:format=auto:enable='${enable((frame) => stateFor(frame).gesture === 'deny')}'[${prefix}hands]`);
    const animatedTracks = animation?.elements.find((element) => element.elementId === item.id)?.tracks ?? null;
    const characterLabel = applyOpacity(filters, prefix, item.id, framePlan, animatedTracks, enable);
    const motion = createFfmpegMotionExpressions(config, item.transform, dialogueData, item.id, animatedTracks);
    filters.push(`[${characterLabel}]scale=w='${motion.scaleWidth}':h='${motion.scaleHeight}':eval=frame[${prefix}scaled]`);
    scaledLabels.push({ label: `${prefix}scaled`, motion });
  }

  let sceneLabel;
  if (runtime.backgroundAnimation) {
    filters.push(`color=c=#071022:s=${config.video.width}x${config.video.height}:r=${fps}:d=${renderDuration}[bgbase]`);
    sceneLabel = 'bgbase';
    for (const [index, background] of backgroundInputs.entries()) {
      const motion = createFfmpegBackgroundExpressions({ ...runtime, videoWidth: config.video.width, videoHeight: config.video.height }, background.layer);
      filters.push(`[${background.index}:v]scale=w='${motion.scaleWidth}':h='${motion.scaleHeight}':eval=frame[bglayer${index}]`);
      filters.push(`[${sceneLabel}][bglayer${index}]overlay=x='${motion.x}':y='${motion.y}':eval=frame:format=auto[bgscene${index}]`);
      sceneLabel = `bgscene${index}`;
    }
  } else {
    sceneLabel = `${backgroundIndex}:v`;
  }
  for (const [index, scaled] of scaledLabels.entries()) {
    const output = `scene${index}`;
    filters.push(`[${sceneLabel}][${scaled.label}]overlay=x='${scaled.motion.x}':y='${scaled.motion.y}':eval=frame:format=auto[${output}]`);
    sceneLabel = output;
  }
  for (const [index, subtitle] of subtitleInputs.entries()) {
    const output = `sub${index}`;
    filters.push(`[${sceneLabel}][${subtitle.index}:v]overlay=0:0:format=auto:enable='${enable((frame) => frame.subtitlePath === subtitle.subtitlePath)}'[${output}]`);
    sceneLabel = output;
  }
  filters.push(`[${sceneLabel}]format=rgba[out]`);

  const framePattern = path.join(framesDirectory, 'frame_%04d.png');
  report('rendering_frames', { stage: 'rendering_frames', renderId, frameCount, fps, contractVersion: 2 });
  const inputArgs = inputs.flatMap((file) => ['-loop', '1', '-framerate', String(fps), '-t', String(renderDuration), '-i', file]);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-y', ...inputArgs,
    '-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', String(frameCount),
    '-start_number', '0', framePattern,
  ], { stage: 'rendering_frames', errorCode: 'FFMPEG_RENDER_EXIT_NONZERO' });

  const files = readdirSync(framesDirectory)
    .filter((name) => /^frame_\d{4}\.png$/u.test(name))
    .sort()
    .map((name) => path.join(framesDirectory, name));
  return {
    backend: 'ffmpeg-overlay',
    renderer: 'ffmpeg',
    frameCount: files.length,
    files,
    framePattern,
    seconds: (performance.now() - started) / 1000,
  };
}
