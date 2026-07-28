// Fase 0 — pruebas del contrato de animación V1.
//
// Nivel 2 (lógica de módulo): valida vocabulario, límites y estado «requiere
// revisión» sobre fixtures reales. No toca el pipeline ni el evaluador, porque
// la Fase 0 todavía no los modifica.

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  ANIMATION_ERROR_CATALOG,
  ANIMATION_LIMITS,
  ANIMATION_PARAMETERS,
  describeAnchor,
  listAnchorsRequiringReview,
  quantizeToFrame,
  validateAnimationScene,
} from './animation-contract.mjs';

const fixturesRoot = path.join(projectRoot, 'pilots', 'animacion-v1', 'fixtures');
const results = [];

function pass(name, detail = {}) {
  results.push({ name, ...detail });
}

// 1. Fixtures válidos: todos deben aceptarse sin excepción.
const validFiles = readdirSync(path.join(fixturesRoot, 'valid')).sort();
assert.ok(validFiles.length >= 4, 'se esperan al menos cuatro fixtures válidos');
for (const file of validFiles) {
  const document = readJson(path.join(fixturesRoot, 'valid', file));
  const accepted = validateAnimationScene(document);
  assert.equal(accepted, document, 'la validación no debe reemplazar el documento');
  pass(`valid/${file}`, { accepted: true });
}

// 2. Fixtures inválidos: cada uno debe fallar con su código exacto.
const invalidExpectations = {
  'parametro-desconocido.json': 'ANIM_DOCUMENT_INVALID',
  'campo-desconocido.json': 'ANIM_DOCUMENT_INVALID',
  'valor-fuera-de-rango.json': 'ANIM_DOCUMENT_INVALID',
  'offset-fuera-de-rango.json': 'ANIM_DOCUMENT_INVALID',
  'pista-de-un-keyframe.json': 'ANIM_DOCUMENT_INVALID',
  'customized-en-manual.json': 'ANIM_DOCUMENT_INVALID',
  'elemento-duplicado.json': 'ANIM_ELEMENT_DUPLICATED',
  'armraise-en-prop.json': 'ANIM_PARAMETER_UNSUPPORTED',
  'parametro-duplicado.json': 'ANIM_PARAMETER_DUPLICATED',
  'id-de-keyframe-repetido.json': 'ANIM_KEYFRAME_ID_DUPLICATED',
  'colision-de-keyframes.json': 'ANIM_KEYFRAME_COLLISION',
  'orden-invertido.json': 'ANIM_KEYFRAME_ORDER_INVALID',
  'ultimo-sin-hold.json': 'ANIM_INTERPOLATION_INVALID',
};

const invalidFiles = readdirSync(path.join(fixturesRoot, 'invalid')).sort();
assert.deepEqual(invalidFiles, Object.keys(invalidExpectations).sort(), 'cada fixture inválido necesita un código esperado');
for (const file of invalidFiles) {
  const expectedCode = invalidExpectations[file];
  const document = readJson(path.join(fixturesRoot, 'invalid', file));
  assert.throws(() => validateAnimationScene(document), (error) => {
    assert.equal(error.code, expectedCode, `${file} esperaba ${expectedCode} y devolvió ${error.code}`);
    assert.ok(error.message.length > 0, 'todo fallo lleva mensaje humano');
    assert.ok(error.suggestedAction.length > 0, 'todo fallo lleva acción sugerida');
    assert.ok(error.path.startsWith('/'), 'todo fallo apunta a una ruta del documento');
    return true;
  });
  pass(`invalid/${file}`, { accepted: false, expectedCode });
}

// 3. Límite por escena: se construye porque un fixture de 258 keyframes sería
//    ruido. Dos elementos con seis pistas llenas superan los 256 permitidos.
function fullElement(elementId) {
  const parameters = Object.keys(ANIMATION_PARAMETERS).slice(0, ANIMATION_LIMITS.tracksPerElement);
  return {
    elementId,
    elementType: 'character',
    tracks: parameters.map((parameterId) => ({
      parameterId,
      source: { kind: 'manual' },
      keyframes: Array.from({ length: ANIMATION_LIMITS.keyframesPerTrack }, (unused, index) => ({
        id: `kf-${elementId}-${parameterId.replace('.', '-')}-${index}`,
        anchor: { kind: 'scene', edge: 'start' },
        offsetSeconds: Number((index * 0.1).toFixed(2)),
        value: parameterId === 'scale' ? 1 : 0,
        interpolation: index === ANIMATION_LIMITS.keyframesPerTrack - 1 ? 'hold' : 'linear',
      })),
    })),
  };
}

const oversizedScene = {
  version: 1,
  sceneId: 'escena-1',
  elements: [fullElement('escena-1-personaje-a'), fullElement('escena-1-personaje-b')],
};
assert.throws(() => validateAnimationScene(oversizedScene), (error) => error.code === 'ANIM_KEYFRAME_LIMIT_EXCEEDED');
pass('limite-de-keyframes-por-escena', { accepted: false, expectedCode: 'ANIM_KEYFRAME_LIMIT_EXCEEDED' });

// Un solo elemento lleno (6 × 32 = 192) sigue siendo válido.
const maximumElement = { version: 1, sceneId: 'escena-1', elements: [fullElement('escena-1-personaje-a')] };
validateAnimationScene(maximumElement);
pass('elemento-lleno-dentro-del-limite', { accepted: true, keyframes: 256 });

// 4. El límite de pistas lo corta el schema antes que el validador: en V1 solo
//    existen seis parámetros, así que ocho pistas es techo, no muro.
const tooManyTracks = {
  version: 1,
  sceneId: 'escena-1',
  elements: [{
    ...fullElement('escena-1-personaje-a'),
    tracks: [...fullElement('escena-1-personaje-a').tracks, ...fullElement('escena-1-personaje-b').tracks].slice(0, 9),
  }],
};
assert.throws(() => validateAnimationScene(tooManyTracks), (error) => error.code === 'ANIM_DOCUMENT_INVALID');
pass('limite-de-pistas-por-elemento', { accepted: false, expectedCode: 'ANIM_DOCUMENT_INVALID' });

// 5. Estado «requiere revisión»: no lanza, se enumera para que la UI lo muestre.
const gesture = readJson(path.join(fixturesRoot, 'valid', 'gesto-en-palabra.json'));

assert.deepEqual(
  listAnchorsRequiringReview(gesture, { turns: [{ id: 'escena-1-t2', wordCount: 9 }] }),
  [],
  'con el turno y la palabra vigentes no hay nada que revisar',
);
pass('referencia-vigente-no-requiere-revision', { accepted: true });

const shortened = listAnchorsRequiringReview(gesture, { turns: [{ id: 'escena-1-t2', wordCount: 3 }] });
assert.equal(shortened.length, 3);
assert.ok(shortened.every((entry) => entry.reason === 'word-missing'));
assert.ok(shortened.every((entry) => entry.keyframeId.startsWith('kf-brazo-')));
pass('palabra-eliminada-marca-revision', { accepted: false, pending: shortened.length });

const removedTurn = listAnchorsRequiringReview(gesture, { turns: [{ id: 'escena-1-t1', wordCount: 9 }] });
assert.equal(removedTurn.length, 3);
assert.ok(removedTurn.every((entry) => entry.reason === 'turn-missing'));
pass('turno-eliminado-marca-revision', { accepted: false, pending: removedTurn.length });

// Un ancla de escena nunca se rompe al editar el diálogo.
const entrance = readJson(path.join(fixturesRoot, 'valid', 'entrada-personaje.json'));
assert.deepEqual(listAnchorsRequiringReview(entrance, { turns: [] }), []);
pass('ancla-de-escena-sobrevive-a-la-edicion', { accepted: true });

// 6. Trazado del gate: intención → keyframes → frame resuelto.
//    Medición de referencia: escena-1 empieza en 0.000 s, el turno t2 empieza
//    en 2.133 s y su palabra 4 (índice 3) empieza en 2.867 s, a 30 fps.
const fps = 30;
const wordStartSeconds = 2.867;
const trace = gesture.elements[0].tracks[0].keyframes.map((keyframe) => ({
  keyframeId: keyframe.id,
  anchor: describeAnchor(keyframe.anchor),
  resolvedSeconds: Number((wordStartSeconds + keyframe.offsetSeconds).toFixed(3)),
  frameIndex: quantizeToFrame(wordStartSeconds + keyframe.offsetSeconds, fps),
}));
assert.deepEqual(trace.map((entry) => entry.frameIndex), [83, 91, 112]);
assert.deepEqual(trace.map((entry) => entry.anchor), [
  'palabra 4 del turno escena-1-t2',
  'palabra 4 del turno escena-1-t2',
  'palabra 4 del turno escena-1-t2',
]);
pass('trazado-de-la-fase-0', { accepted: true, trace });

// La cuantización ubica un punto en el frame más cercano, no lo trunca.
assert.equal(quantizeToFrame(0, 30), 0);
assert.equal(quantizeToFrame(0.0166, 30), 0);
assert.equal(quantizeToFrame(0.0167, 30), 1);
assert.equal(quantizeToFrame(-1, 30), 0, 'un instante previo a la escena se sujeta al frame cero');
pass('cuantizacion-al-frame-mas-cercano', { accepted: true });

// 7. El catálogo de errores es la única fuente de mensajes y no tiene huérfanos.
const authoringCodes = Object.entries(ANIMATION_ERROR_CATALOG)
  .filter(([, entry]) => entry.tier === 'autoria')
  .map(([code]) => code);
const exercisedCodes = new Set([
  ...Object.values(invalidExpectations),
  'ANIM_KEYFRAME_LIMIT_EXCEEDED',
]);
const unexercised = authoringCodes.filter((code) => !exercisedCodes.has(code));
assert.deepEqual(unexercised, ['ANIM_TRACK_LIMIT_EXCEEDED'], 'solo el límite de pistas queda cubierto por el schema');
pass('catalogo-de-errores-cubierto', { accepted: true, authoringCodes: authoringCodes.length });

for (const [code, entry] of Object.entries(ANIMATION_ERROR_CATALOG)) {
  assert.ok(['autoria', 'compilacion'].includes(entry.tier), `${code} necesita un tier conocido`);
  assert.ok(entry.message.length > 0 && entry.suggestedAction.length > 0, `${code} necesita mensaje y acción`);
}
pass('catalogo-de-errores-completo', { accepted: true, codes: Object.keys(ANIMATION_ERROR_CATALOG).length });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'animation-contract-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
