// Fase 4, lote 1 — comandos de keyframe en el proyecto editable.
//
// Nivel 2 (lógica de módulo). Prueba que las pistas entren al proyecto por
// comandos cerrados, que se deshagan como cualquier otra edición y que el
// contrato de la Fase 0 se aplique donde el usuario edita, no solo al validar.

import assert from 'node:assert/strict';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  applyProjectEditorCommand,
  createProjectEditor,
  exportEditorProject,
  redoProjectEditor,
  undoProjectEditor,
} from '../../shared/project-editor.js';

// `proyecto-editable-01` incluye un elemento de texto, que el editor todavía no
// admite; el proyecto compilable es el que usa el resto de las pruebas del editor.
const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const commandSchema = readJson(path.join(projectRoot, 'schema', 'editor-command.schema.json'));
const projectSchema = readJson(path.join(projectRoot, 'schema', 'video-project.schema.json'));
const validateCommand = new Ajv2020({ allErrors: true, strict: true }).compile(commandSchema);
const validateProject = new Ajv2020({ allErrors: true, strict: true }).compile(projectSchema);
const results = [];

function pass(name, detail = {}) {
  results.push({ name, ...detail });
}

const base = createProjectEditor(project, catalog);
const sceneId = base.project.scenes[0].id;
const elementId = base.project.scenes[0].elements.find((element) => element.type === 'character').id;

function apply(state, command) {
  // Todo comando pasa por el schema antes que por el motor: la interfaz no puede
  // inventar formas que el contrato no admite.
  assert.ok(validateCommand(command), `comando inválido: ${JSON.stringify(validateCommand.errors?.[0])}`);
  return applyProjectEditorCommand(state, command);
}

function keyframe(id, offsetSeconds, value, interpolation = 'linear') {
  return {
    type: 'add-keyframe',
    sceneId,
    elementId,
    parameterId: 'opacity',
    keyframeId: id,
    anchor: { kind: 'scene', edge: 'start' },
    offsetSeconds,
    value,
    interpolation,
  };
}

// 1. El proyecto vigente sigue siendo válido sin pistas: el campo es aditivo.
assert.ok(validateProject(project), 'un proyecto sin pistas debe seguir siendo válido');
pass('el-campo-tracks-es-aditivo', { accepted: true });

// 2. La pista se crea atómicamente con sus dos keyframes. Una pista de un solo
//    keyframe no cumple el contrato, así que no existe ni como paso intermedio.
const createTrack = {
  type: 'create-track',
  sceneId,
  elementId,
  parameterId: 'opacity',
  keyframes: [
    { id: 'kf-op-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0, interpolation: 'linear' },
    { id: 'kf-op-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0.4, value: 1, interpolation: 'hold' },
  ],
};
let state = apply(base, createTrack);
let element = state.project.scenes[0].elements.find((candidate) => candidate.id === elementId);
assert.equal(element.tracks.length, 1);
assert.equal(element.tracks[0].parameterId, 'opacity');
assert.deepEqual(element.tracks[0].source, { kind: 'manual' });
assert.equal(element.tracks[0].keyframes.length, 2);

// Agregar un keyframe a una pista que no existe manda a crear la pista.
assert.throws(() => apply(base, keyframe('kf-suelto', 0, 0.5)), (error) => error.code === 'EDITOR_TRACK_NOT_FOUND');
pass('no-se-puede-empezar-una-pista-con-un-solo-keyframe', { accepted: false, expectedCode: 'EDITOR_TRACK_NOT_FOUND' });
const exported = JSON.parse(exportEditorProject(state));
assert.ok(validateProject(exported), `el proyecto con pistas debe validar: ${JSON.stringify(validateProject.errors?.[0])}`);
pass('dos-keyframes-crean-una-pista-valida', { accepted: true });

// 3. El último keyframe siempre queda en hold, aunque se agregue en el medio.
state = apply(state, keyframe('kf-op-3', 0.2, 0.5, 'linear'));
element = state.project.scenes[0].elements.find((candidate) => candidate.id === elementId);
assert.deepEqual(element.tracks[0].keyframes.map((item) => item.id), ['kf-op-1', 'kf-op-3', 'kf-op-2']);
assert.equal(element.tracks[0].keyframes.at(-1).interpolation, 'hold');
assert.equal(element.tracks[0].keyframes[1].interpolation, 'linear');
pass('los-keyframes-se-guardan-ordenados-y-el-ultimo-en-hold', { accepted: true });

// 4. Modificar un keyframe.
state = apply(state, {
  type: 'set-keyframe', sceneId, elementId, parameterId: 'opacity', keyframeId: 'kf-op-3', value: 0.75,
});
element = state.project.scenes[0].elements.find((candidate) => candidate.id === elementId);
assert.equal(element.tracks[0].keyframes.find((item) => item.id === 'kf-op-3').value, 0.75);
pass('set-keyframe-modifica-el-valor', { accepted: true });

// 5. Deshacer y rehacer funcionan como con cualquier otra edición.
const undone = undoProjectEditor(state);
assert.equal(undone.project.scenes[0].elements.find((candidate) => candidate.id === elementId)
  .tracks[0].keyframes.find((item) => item.id === 'kf-op-3').value, 0.5);
const redone = redoProjectEditor(undone);
assert.equal(redone.project.scenes[0].elements.find((candidate) => candidate.id === elementId)
  .tracks[0].keyframes.find((item) => item.id === 'kf-op-3').value, 0.75);
pass('las-pistas-se-deshacen-y-rehacen', { accepted: true });

// 6. Borrar keyframes hasta dejar menos de dos elimina la pista entera.
let pruned = apply(state, { type: 'delete-keyframe', sceneId, elementId, parameterId: 'opacity', keyframeId: 'kf-op-3' });
assert.equal(pruned.project.scenes[0].elements.find((candidate) => candidate.id === elementId).tracks[0].keyframes.length, 2);
pruned = apply(pruned, { type: 'delete-keyframe', sceneId, elementId, parameterId: 'opacity', keyframeId: 'kf-op-2' });
assert.equal(pruned.project.scenes[0].elements.find((candidate) => candidate.id === elementId).tracks, undefined,
  'una pista que queda con un keyframe se elimina en vez de quedar inválida');
pass('borrar-hasta-menos-de-dos-elimina-la-pista', { accepted: true });

// 7. Eliminar la pista completa.
const withoutTrack = apply(state, { type: 'delete-track', sceneId, elementId, parameterId: 'opacity' });
assert.equal(withoutTrack.project.scenes[0].elements.find((candidate) => candidate.id === elementId).tracks, undefined);
pass('delete-track-elimina-la-pista', { accepted: true });

// 8. `remove-animation` es la operación segura para automatizaciones: quita
//    presets intactos, participa de undo/redo y protege trabajo personalizado.
const presetState = apply(base, {
  type: 'apply-animation-preset',
  sceneId,
  elementId,
  presetId: 'fade-in',
});
const removedPreset = apply(presetState, {
  type: 'remove-animation',
  sceneId,
  elementId,
  parameterId: 'opacity',
});
assert.equal(removedPreset.project.scenes[0].elements.find((candidate) => candidate.id === elementId).tracks, undefined);
const restoredPreset = undoProjectEditor(removedPreset);
assert.equal(
  restoredPreset.project.scenes[0].elements.find((candidate) => candidate.id === elementId).tracks[0].source.presetId,
  'fade-in',
);
pass('remove-animation-quita-un-preset-intacto-y-undo-lo-restaura', { accepted: true });

const presetTrack = presetState.project.scenes[0].elements.find((candidate) => candidate.id === elementId).tracks[0];
const customizedPreset = apply(presetState, {
  type: 'set-keyframe',
  sceneId,
  elementId,
  parameterId: 'opacity',
  keyframeId: presetTrack.keyframes[0].id,
  value: 0.1,
});
assert.throws(() => apply(customizedPreset, {
  type: 'remove-animation', sceneId, elementId, parameterId: 'opacity',
}), (error) => error.code === 'EDITOR_TRACK_CUSTOMIZED');
pass('remove-animation-protege-un-preset-personalizado', { accepted: false, expectedCode: 'EDITOR_TRACK_CUSTOMIZED' });

assert.throws(() => apply(state, {
  type: 'remove-animation', sceneId, elementId, parameterId: 'opacity',
}), (error) => error.code === 'EDITOR_TRACK_CUSTOMIZED');
const confirmedRemoval = apply(state, {
  type: 'remove-animation', sceneId, elementId, parameterId: 'opacity', confirmCustomized: true,
});
assert.equal(confirmedRemoval.project.scenes[0].elements.find((candidate) => candidate.id === elementId).tracks, undefined);
pass('remove-animation-protege-pistas-manuales-y-admite-confirmacion-explicita', { accepted: true });

assert.throws(() => apply(base, {
  type: 'remove-animation', sceneId, elementId, parameterId: 'scale',
}), (error) => error.code === 'EDITOR_TRACK_NOT_FOUND');
pass('remove-animation-rechaza-una-pista-inexistente', { accepted: false, expectedCode: 'EDITOR_TRACK_NOT_FOUND' });

assert.equal(validateCommand({
  type: 'remove-animation', sceneId, elementId, parameterId: 'opacity', confirmCustomized: 'sí',
}), false);
pass('remove-animation-rechaza-confirmacion-no-booleana', { accepted: false });

// 9. Reglas del contrato aplicadas donde el usuario edita.
assert.throws(() => apply(state, keyframe('kf-op-4', 0.2, 0.9)), (error) => error.code === 'EDITOR_TRACK_INVALID');
pass('dos-keyframes-en-el-mismo-punto-rechazados', { accepted: false, expectedCode: 'EDITOR_TRACK_INVALID' });

assert.throws(() => apply(state, { ...keyframe('kf-op-5', 1, 4), parameterId: 'opacity' }),
  (error) => error.code === 'EDITOR_TRACK_INVALID');
pass('valor-fuera-del-rango-del-parametro-rechazado', { accepted: false, expectedCode: 'EDITOR_TRACK_INVALID' });

// `armRaise` necesita que el recurso lo declare, y ningún personaje v2 lo hace.
assert.throws(() => apply(base, {
  type: 'create-track', sceneId, elementId, parameterId: 'armRaise',
  keyframes: [
    { id: 'kf-arm-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0, interpolation: 'ease' },
    { id: 'kf-arm-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0.5, value: 1, interpolation: 'hold' },
  ],
}), (error) => error.code === 'EDITOR_TRACK_INVALID');
pass('armraise-rechazado-en-un-recurso-que-no-lo-declara', { accepted: false, expectedCode: 'EDITOR_TRACK_INVALID' });

// 10. El motor no acepta comandos de keyframe con campos inventados.
assert.throws(() => applyProjectEditorCommand(base, {
  type: 'add-keyframe', sceneId, elementId, parameterId: 'opacity', keyframeId: 'kf-x',
  anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0, interpolation: 'hold', curva: 'bezier',
}), (error) => error.code === 'EDITOR_COMMAND_INVALID');
pass('campo-no-permitido-rechazado', { accepted: false, expectedCode: 'EDITOR_COMMAND_INVALID' });

assert.throws(() => apply(base, {
  type: 'add-keyframe', sceneId, elementId: 'elemento-inexistente', parameterId: 'opacity', keyframeId: 'kf-y',
  anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0, interpolation: 'hold',
}), (error) => error.code === 'EDITOR_ELEMENT_NOT_FOUND');
pass('elemento-inexistente-rechazado', { accepted: false, expectedCode: 'EDITOR_ELEMENT_NOT_FOUND' });

assert.throws(() => apply(base, { type: 'delete-track', sceneId, elementId, parameterId: 'scale' }),
  (error) => error.code === 'EDITOR_TRACK_NOT_FOUND');
pass('pista-inexistente-rechazada', { accepted: false, expectedCode: 'EDITOR_TRACK_NOT_FOUND' });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'keyframe-commands-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
