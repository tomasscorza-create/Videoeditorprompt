// Fase 2 — pruebas del evaluador paramétrico.
//
// Nivel 2 (lógica de módulo). El gate de la fase tiene dos mitades y las dos se
// prueban acá: que una escena v2 sin pistas siga produciendo exactamente el mismo
// plan temporal, y que una escena con pistas dé valores idénticos en dos corridas.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  createFfmpegMotionExpressions,
  createFfmpegTrackExpression,
  evaluateScene,
} from '../../shared/scene-evaluator.js';
import {
  buildSceneTiming,
  evaluateAnimationParams,
  evaluateTrack,
  resolveAnchorSeconds,
  resolveAnimationScene,
} from '../../shared/animation-evaluator.js';
import { validateAnimationScene } from './animation-contract.mjs';
import { applyOpacity } from '../compositor/ffmpeg-compositor.mjs';

const fixturesRoot = path.join(projectRoot, 'pilots', 'animacion-v1', 'fixtures');
const scene = readJson(path.join(fixturesRoot, 'escena-v2-medida.json'));
const { config, runtime, dialogueData } = scene;
const fps = config.video.fps;
const results = [];

function pass(name, detail = {}) {
  results.push({ name, ...detail });
}

function framePlan(animation) {
  const frameCount = Math.ceil(runtime.audio.durationSeconds * fps);
  return Array.from({ length: frameCount }, (unused, frameIndex) => ({
    frameIndex,
    timeSeconds: frameIndex / fps,
    ...evaluateScene(config, runtime, dialogueData, frameIndex / fps, animation),
  }));
}

function hashPlan(plan) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

// 1. Gate, primera mitad: una escena v2 sin pistas no cambia su plan temporal.
//    El hash se capturó ANTES de introducir la animación en el evaluador. Si esta
//    aserción falla, el soporte de pistas alteró la salida v2 y hay que revisarlo,
//    no actualizar la constante.
const BASELINE_TEMPORAL_HASH = '195bcd1b5b0e6d7fcffe8558cf2387aff0489642879d8180f2c6a498f29ff790';
const plainPlan = framePlan(null);
assert.equal(plainPlan.length, 192);
assert.equal(hashPlan(plainPlan), BASELINE_TEMPORAL_HASH, 'el plan temporal v2 cambió');
pass('temporalHash-v2-sin-cambios', { accepted: true, frames: plainPlan.length });

// Sin animación no aparece la clave `elements`: es lo que mantiene el hash.
assert.deepEqual(Object.keys(plainPlan[40]), [
  'frameIndex', 'timeSeconds', 'time', 'background',
  'activeSpeakerId', 'activeTurnId', 'subtitlePath', 'characters',
]);
pass('sin-animacion-no-hay-clave-elements', { accepted: true });

// 2. Resolución de anclas sobre el timing medido.
const timing = buildSceneTiming(dialogueData, runtime.audio.durationSeconds);
assert.equal(timing.turns.length, 2);
assert.equal(timing.turns[1].wordCount, 8);
assert.equal(resolveAnchorSeconds({ kind: 'scene', edge: 'start' }, timing), 0);
assert.equal(resolveAnchorSeconds({ kind: 'scene', edge: 'end' }, timing), 6.4);
assert.equal(resolveAnchorSeconds({ kind: 'turn', turnId: 'escena-1-t2', edge: 'start' }, timing), 2.133);
assert.equal(resolveAnchorSeconds({ kind: 'turn', turnId: 'escena-1-t2', edge: 'end' }, timing), 6.4);
pass('anclas-de-escena-y-turno', { accepted: true });

// La palabra se prorratea por conteo sobre la duración medida del turno, igual que
// el proyecto ya ubica los gestos. Es un prorrateo, no alineación forzada.
const wordSeconds = resolveAnchorSeconds({ kind: 'word', turnId: 'escena-1-t2', wordIndex: 3 }, timing);
assert.equal(wordSeconds, 2.133 + 4.267 * 3 / 8);
pass('ancla-de-palabra-prorrateada', { accepted: true, seconds: Number(wordSeconds.toFixed(6)) });

// 3. Referencias rotas, colisiones y keyframes fuera de escena se rechazan.
function anchorTrack(keyframes, parameterId = 'opacity') {
  return {
    version: 1,
    sceneId: 'escena-1',
    elements: [{
      elementId: 'personaje-a',
      elementType: 'character',
      tracks: [{ parameterId, source: { kind: 'manual' }, keyframes }],
    }],
  };
}

const brokenTurn = anchorTrack([
  { id: 'kf-1', anchor: { kind: 'turn', turnId: 'turno-borrado', edge: 'start' }, offsetSeconds: 0, value: 0, interpolation: 'linear' },
  { id: 'kf-2', anchor: { kind: 'turn', turnId: 'turno-borrado', edge: 'start' }, offsetSeconds: 0.4, value: 1, interpolation: 'hold' },
]);
validateAnimationScene(brokenTurn);
assert.throws(() => resolveAnimationScene(brokenTurn, timing, fps), (error) => error.code === 'ANIM_ANCHOR_UNRESOLVED');
pass('turno-inexistente-rechazado', { accepted: false, expectedCode: 'ANIM_ANCHOR_UNRESOLVED' });

const brokenWord = anchorTrack([
  { id: 'kf-1', anchor: { kind: 'word', turnId: 'escena-1-t2', wordIndex: 40 }, offsetSeconds: 0, value: 0, interpolation: 'linear' },
  { id: 'kf-2', anchor: { kind: 'word', turnId: 'escena-1-t2', wordIndex: 40 }, offsetSeconds: 0.4, value: 1, interpolation: 'hold' },
]);
assert.throws(() => resolveAnimationScene(brokenWord, timing, fps), (error) => error.code === 'ANIM_ANCHOR_UNRESOLVED');
pass('palabra-inexistente-rechazada', { accepted: false, expectedCode: 'ANIM_ANCHOR_UNRESOLVED' });

// Dos anclas distintas que caen en el mismo frame: el contrato no elige una.
const collision = anchorTrack([
  { id: 'kf-a', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 1, value: 0, interpolation: 'linear' },
  { id: 'kf-b', anchor: { kind: 'turn', turnId: 'escena-1-t1', edge: 'start' }, offsetSeconds: 1.001, value: 1, interpolation: 'hold' },
]);
validateAnimationScene(collision);
assert.throws(() => resolveAnimationScene(collision, timing, fps), (error) => error.code === 'ANIM_FRAME_COLLISION');
pass('colision-de-frame-rechazada', { accepted: false, expectedCode: 'ANIM_FRAME_COLLISION' });

// Un keyframe que resuelve antes del inicio: se comprueba en segundos, porque la
// cuantización sujeta los negativos a cero y taparía el error.
const beforeScene = anchorTrack([
  { id: 'kf-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: -2, value: 0, interpolation: 'linear' },
  { id: 'kf-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0.4, value: 1, interpolation: 'hold' },
]);
assert.throws(() => resolveAnimationScene(beforeScene, timing, fps), (error) => error.code === 'ANIM_TRACK_OUT_OF_SCENE');
pass('keyframe-antes-de-la-escena-rechazado', { accepted: false, expectedCode: 'ANIM_TRACK_OUT_OF_SCENE' });

const afterScene = anchorTrack([
  { id: 'kf-1', anchor: { kind: 'scene', edge: 'end' }, offsetSeconds: -0.4, value: 1, interpolation: 'linear' },
  { id: 'kf-2', anchor: { kind: 'scene', edge: 'end' }, offsetSeconds: 0.5, value: 0, interpolation: 'hold' },
]);
assert.throws(() => resolveAnimationScene(afterScene, timing, fps), (error) => error.code === 'ANIM_TRACK_OUT_OF_SCENE');
pass('keyframe-despues-de-la-escena-rechazado', { accepted: false, expectedCode: 'ANIM_TRACK_OUT_OF_SCENE' });

// 4. Interpolaciones y las tres reglas congeladas en la Fase 0.
const fade = anchorTrack([
  { id: 'kf-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 1, value: 0, interpolation: 'linear' },
  { id: 'kf-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 2, value: 1, interpolation: 'hold' },
]);
const resolvedFade = resolveAnimationScene(fade, timing, fps);
const fadeTrack = resolvedFade.elements[0].tracks[0];

// Antes del primer keyframe se sostiene el valor del primero; no se extrapola.
assert.equal(evaluateTrack(fadeTrack, 0), 0);
assert.equal(evaluateTrack(fadeTrack, 0.5), 0);
// Tramo lineal.
assert.equal(evaluateTrack(fadeTrack, 1.5), 0.5);
assert.equal(evaluateTrack(fadeTrack, 1.25), 0.25);
// Después del último el valor queda congelado.
assert.equal(evaluateTrack(fadeTrack, 2), 1);
assert.equal(evaluateTrack(fadeTrack, 6.4), 1);
pass('interpolacion-lineal-y-bordes', { accepted: true });

const eased = anchorTrack([
  { id: 'kf-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 1, value: 0, interpolation: 'ease' },
  { id: 'kf-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 2, value: 1, interpolation: 'hold' },
]);
const easedTrack = resolveAnimationScene(eased, timing, fps).elements[0].tracks[0];
// `ease` es inOutSine, la curva que congeló la Fase 0. En el punto medio da
// 0.49999999999999994 y no 0.5, porque `Math.cos(Math.PI/2)` no es exactamente
// cero. Es determinista, que es lo que el gate pide; exigir igualdad exacta sería
// exigirle a la curva algo que el punto flotante no da.
assert.ok(Math.abs(evaluateTrack(easedTrack, 1.5) - 0.5) < 1e-12);
assert.ok(Math.abs(evaluateTrack(easedTrack, 1.25) - (0.5 - 0.5 * Math.cos(Math.PI * 0.25))) < 1e-12);
assert.ok(evaluateTrack(easedTrack, 1.25) < 0.25, 'inOutSine arranca más lento que lineal');
pass('interpolacion-ease-es-inoutsine', { accepted: true });

const held = anchorTrack([
  { id: 'kf-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 1, value: 0.2, interpolation: 'hold' },
  { id: 'kf-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 2, value: 0.9, interpolation: 'hold' },
]);
const heldTrack = resolveAnimationScene(held, timing, fps).elements[0].tracks[0];
// `hold` no mezcla: el valor salta en el keyframe siguiente.
assert.equal(evaluateTrack(heldTrack, 1.5), 0.2);
assert.equal(evaluateTrack(heldTrack, 1.99), 0.2);
assert.equal(evaluateTrack(heldTrack, 2), 0.9);
pass('interpolacion-hold-no-mezcla', { accepted: true });

// 5. Trazado completo del gesto anclado a palabra, con el fixture de la Fase 0.
const gesture = readJson(path.join(fixturesRoot, 'valid', 'gesto-en-palabra.json'));
const gestureForRuntime = structuredClone(gesture);
gestureForRuntime.elements[0].elementId = 'personaje-a';
validateAnimationScene(gestureForRuntime);
const resolvedGesture = resolveAnimationScene(gestureForRuntime, timing, fps);
const armTrack = resolvedGesture.elements[0].tracks[0];
assert.equal(armTrack.parameterId, 'armRaise');
assert.deepEqual(armTrack.keyframes.map((keyframe) => keyframe.frameIndex), [109, 116, 137]);
assert.equal(armTrack.keyframes[0].value, 0);
assert.equal(armTrack.keyframes[1].value, 1);
pass('gesto-en-palabra-resuelto-a-frames', {
  accepted: true,
  frames: armTrack.keyframes.map((keyframe) => keyframe.frameIndex),
});

// El brazo sube y vuelve: el valor en el pico es 1 y al final del tramo, 0.
assert.equal(evaluateAnimationParams(resolvedGesture, armTrack.keyframes[1].seconds)['personaje-a'].armRaise, 1);
assert.equal(evaluateAnimationParams(resolvedGesture, armTrack.keyframes[2].seconds)['personaje-a'].armRaise, 0);
pass('armraise-sube-y-vuelve', { accepted: true });

// 6. `elements[id].params` aparece con animación y la pista reemplaza la base.
const override = anchorTrack([
  { id: 'kf-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0.25, interpolation: 'hold' },
  { id: 'kf-2', anchor: { kind: 'scene', edge: 'end' }, offsetSeconds: 0, value: 0.25, interpolation: 'hold' },
], 'opacity');
const resolvedOverride = resolveAnimationScene(override, timing, fps);
const animatedPlan = framePlan(resolvedOverride);
const sample = animatedPlan[120];
assert.ok(sample.elements, 'con animación tiene que aparecer elements');
assert.equal(sample.elements['personaje-a'].params.opacity, 0.25);
// La vista v2 se deriva de los mismos parámetros, no de un cálculo aparte.
assert.equal(sample.characters[0].character.opacity, 0.25);
// El personaje sin pistas conserva su base: la opacidad ya saturó en 1.
assert.equal(sample.elements['personaje-b'].params.opacity, 1);
assert.equal(sample.characters[1].character.opacity, 1);
pass('la-pista-reemplaza-la-base-y-la-vista-v2-se-deriva', { accepted: true });

// Los parámetros sin pista siguen viniendo de la base.
assert.equal(sample.elements['personaje-a'].params['position.y'], sample.characters[0].character.y);
assert.equal(sample.elements['personaje-a'].params.scale, sample.characters[0].character.scale);
pass('parametros-sin-pista-vienen-de-la-base', { accepted: true });

// 7. Gate, segunda mitad: dos corridas con pistas dan valores idénticos.
assert.equal(hashPlan(animatedPlan), hashPlan(framePlan(resolveAnimationScene(override, timing, fps))));
assert.notEqual(hashPlan(animatedPlan), BASELINE_TEMPORAL_HASH, 'con pistas el plan tiene que cambiar');
pass('plan-con-pistas-determinista', { accepted: true });

// Y resolver dos veces el mismo documento da la misma resolución.
assert.deepEqual(resolveAnimationScene(gestureForRuntime, timing, fps), resolvedGesture);
pass('resolucion-determinista', { accepted: true });

// 8. Fase 4 — la expresión que se le pasa a FFmpeg tiene que dar exactamente lo
// mismo que el evaluador. Si divergen, la vista previa y el MP4 dejan de ser el
// mismo video, que es el punto entero de compartir el estado temporal.
function evaluateFfmpegExpression(expression, timeSeconds) {
  // Traducción mínima del dialecto de FFmpeg a JavaScript. `if` y `gte` se
  // vuelven funciones; ambas ramas se evalúan, que numéricamente da igual porque
  // los tramos no dividen por cero.
  const translated = expression
    .replace(/\bif\(/gu, 'IF(')
    .replace(/\bgte\(/gu, 'GTE(')
    .replace(/\bmin\(/gu, 'Math.min(')
    .replace(/\bmax\(/gu, 'Math.max(')
    .replace(/\bcos\(/gu, 'Math.cos(')
    .replace(/\bPI\b/gu, 'Math.PI');
  const IF = (condition, whenTrue, whenFalse) => (condition ? whenTrue : whenFalse);
  const GTE = (left, right) => left >= right;
  // eslint-disable-next-line no-new-func
  return Function('t', 'IF', 'GTE', `return ${translated};`)(timeSeconds, IF, GTE);
}

const parityTracks = [
  {
    parameterId: 'position.x',
    keyframes: [
      { id: 'p1', seconds: 0, frameIndex: 0, value: -670, interpolation: 'ease' },
      { id: 'p2', seconds: 0.6, frameIndex: 18, value: -250, interpolation: 'hold' },
    ],
  },
  {
    parameterId: 'scale',
    keyframes: [
      { id: 's1', seconds: 0.4, frameIndex: 12, value: 0.7, interpolation: 'linear' },
      { id: 's2', seconds: 1.2, frameIndex: 36, value: 0.86, interpolation: 'ease' },
      { id: 's3', seconds: 2.1, frameIndex: 63, value: 0.7, interpolation: 'hold' },
    ],
  },
];
let maximumDivergence = 0;
for (const track of parityTracks) {
  const expression = createFfmpegTrackExpression(track.keyframes);
  for (let sample = 0; sample <= 120; sample += 1) {
    const time = sample / 40;
    const divergence = Math.abs(evaluateTrack(track, time) - evaluateFfmpegExpression(expression, time));
    maximumDivergence = Math.max(maximumDivergence, divergence);
  }
}
assert.ok(maximumDivergence < 1e-9, `la expresión de FFmpeg divergió ${maximumDivergence}`);
pass('la-expresion-de-ffmpeg-coincide-con-el-evaluador', { accepted: true, maximumDivergence });

// La pista reemplaza la expresión base del parámetro que anima, y deja las otras
// intactas: no se suma al movimiento base ni al layout.
const [firstCharacter] = runtime.characters;
const baseMotion = createFfmpegMotionExpressions(config, firstCharacter.transform, dialogueData, firstCharacter.id);
const animatedMotion = createFfmpegMotionExpressions(config, firstCharacter.transform, dialogueData, firstCharacter.id, [parityTracks[0]]);
assert.notEqual(animatedMotion.x, baseMotion.x);
assert.equal(animatedMotion.y, baseMotion.y);
assert.equal(animatedMotion.scaleWidth, baseMotion.scaleWidth);
assert.equal(createFfmpegMotionExpressions(config, firstCharacter.transform, dialogueData, firstCharacter.id, null).x, baseMotion.x);
pass('la-pista-reemplaza-solo-la-expresion-de-su-parametro', { accepted: true });

// 9. La opacidad no puede ser una expresión: `overlay` no acepta alfa variable.
// Se aplica por rangos de frames con el valor del plan, y sin pista se conserva
// la entrada de siempre.
const opacityPlan = [0, 0.25, 0.5, 0.5, 1, 1].map((opacity, frameIndex) => ({
  frameIndex,
  characters: [{ id: 'personaje-a', character: { opacity } }],
}));
const withoutTrack = [];
assert.equal(applyOpacity(withoutTrack, 'd0', 'personaje-a', opacityPlan, null, () => '0'), 'd0character');
assert.equal(withoutTrack.length, 1);
assert.ok(withoutTrack[0].includes('fade=t=in:st=0:d=0.3:alpha=1'));
pass('sin-pista-de-opacidad-la-entrada-no-cambia', { accepted: true });

const withTrack = [];
const opacityLabel = applyOpacity(
  withTrack,
  'd0',
  'personaje-a',
  opacityPlan,
  [{ parameterId: 'opacity', keyframes: [] }],
  (predicate) => opacityPlan.filter((frame) => predicate(frame)).map((frame) => `n=${frame.frameIndex}`).join('+'),
);
assert.equal(withTrack.some((filter) => filter.includes('fade=t=in')), false, 'la pista reemplaza la entrada base');
// Tres niveles por debajo de 1: 0, 0.25 y 0.5. La opacidad 1 no necesita filtro.
assert.equal(withTrack.length, 3);
assert.ok(withTrack[0].includes('colorchannelmixer=aa=0.0000'));
assert.ok(withTrack[1].includes('colorchannelmixer=aa=0.2500'));
assert.ok(withTrack[2].includes('colorchannelmixer=aa=0.5000') && withTrack[2].includes('n=2+n=3'));
assert.equal(opacityLabel, 'd0op2');
pass('la-opacidad-animada-se-aplica-por-rangos-de-frames', { accepted: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'animation-evaluator-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
