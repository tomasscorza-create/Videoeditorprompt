// Fase 5 — catálogo de presets y su aplicación desde el editor.
//
// Nivel 2 (lógica de módulo). Lo que se prueba es que la expansión sea pura y
// determinista, que conserve procedencia, y que aplicar un preset produzca un
// proyecto portable que el contrato acepta.

import assert from 'node:assert/strict';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  ANIMATION_PRESETS,
  animationPresetWindow,
  expandAnimationPreset,
  listApplicablePresets,
} from '../../shared/animation-presets.js';
import {
  applyProjectEditorCommand,
  createProjectEditor,
  exportEditorProject,
  undoProjectEditor,
} from '../../shared/project-editor.js';

const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const validateProject = new Ajv2020({ allErrors: true, strict: true })
  .compile(readJson(path.join(projectRoot, 'schema', 'video-project.schema.json')));
const validateCommand = new Ajv2020({ allErrors: true, strict: true })
  .compile(readJson(path.join(projectRoot, 'schema', 'editor-command.schema.json')));
const results = [];

function pass(name, detail = {}) {
  results.push({ name, ...detail });
}

// 1. El catálogo tiene los seis presets del plan y todos expanden a 2-4 keyframes.
assert.deepEqual(Object.keys(ANIMATION_PRESETS).sort(),
  [
    'arm-raise', 'body-bounce', 'body-lean', 'emphasis-pulse', 'enter-left',
    'enter-right', 'fade-in', 'fade-out', 'head-nod', 'head-tilt',
    'left-arm-raise', 'left-elbow-bend', 'right-elbow-bend',
  ]);
for (const [presetId, preset] of Object.entries(ANIMATION_PRESETS)) {
  const track = expandAnimationPreset(presetId, { baseValue: preset.parameterId === 'scale' ? 1 : 100 });
  assert.ok(track.keyframes.length >= 2 && track.keyframes.length <= 5, `${presetId} debe dar entre 2 y 5 keyframes`);
  assert.equal(track.keyframes.at(-1).interpolation, 'hold', `${presetId} debe cerrar en hold`);
  assert.equal(track.source.kind, 'preset');
  assert.equal(track.source.customized, false);
  assert.equal(track.source.presetId, presetId);
}
pass('los-presets-expanden-a-pistas-acotadas', { accepted: true, presets: Object.keys(ANIMATION_PRESETS).length });

// 2. La expansión es determinista.
assert.deepEqual(
  expandAnimationPreset('enter-left', { baseValue: 320, intensity: 'medium' }),
  expandAnimationPreset('enter-left', { baseValue: 320, intensity: 'medium' }),
);
pass('la-expansion-es-determinista', { accepted: true });

// 3. `enter-left` sale de la izquierda y vuelve a la base vigente.
const entrance = expandAnimationPreset('enter-left', { baseValue: 320 });
assert.equal(entrance.parameterId, 'position.x');
assert.equal(entrance.keyframes[0].value, -100);
assert.equal(entrance.keyframes.at(-1).value, 320, 'el preset vuelve a la base que había al aplicarlo');
pass('enter-left-vuelve-a-la-base', { accepted: true });

// La intensidad escala amplitud y duración, no cambia la forma.
const soft = expandAnimationPreset('enter-left', { baseValue: 320, intensity: 'soft' });
const strong = expandAnimationPreset('enter-left', { baseValue: 320, intensity: 'strong' });
assert.ok(soft.keyframes[0].value > entrance.keyframes[0].value, 'soft arranca más cerca');
assert.ok(strong.keyframes[0].value < entrance.keyframes[0].value, 'strong arranca más lejos');
assert.ok(strong.keyframes[1].offsetSeconds < soft.keyframes[1].offsetSeconds, 'strong dura menos');
assert.equal(soft.keyframes.length, strong.keyframes.length);
pass('la-intensidad-escala-amplitud-y-duracion', { accepted: true });

const shifted = expandAnimationPreset('emphasis-pulse', {
  baseValue: 0.7,
  intensity: 'medium',
  offsetSeconds: -0.267,
});
assert.deepEqual(shifted.keyframes.map((keyframe) => keyframe.offsetSeconds), [-0.267, -0.087, 0.193]);
assert.deepEqual(animationPresetWindow('emphasis-pulse', 'medium'), {
  startOffsetSeconds: 0,
  endOffsetSeconds: 0.46,
});
pass('el-desplazamiento-del-cabezal-se-conserva-en-todo-el-preset', { accepted: true });

// 4. Los valores respetan el rango del parámetro.
const clamped = expandAnimationPreset('enter-left', { baseValue: -1000, intensity: 'strong' });
assert.ok(clamped.keyframes.every((keyframe) => keyframe.value >= -1080 && keyframe.value <= 2160));
const pulse = expandAnimationPreset('emphasis-pulse', { baseValue: 9.8, intensity: 'strong' });
assert.ok(pulse.keyframes.every((keyframe) => keyframe.value > 0 && keyframe.value <= 10));
pass('los-valores-quedan-dentro-del-rango', { accepted: true });

// 5. `arm-raise` solo se ofrece si el recurso declara el parámetro.
assert.ok(!listApplicablePresets([]).some((preset) => preset.id === 'arm-raise'));
assert.ok(listApplicablePresets(['armRaise']).some((preset) => preset.id === 'arm-raise'));
assert.ok(listApplicablePresets(['headNod']).some((preset) => preset.id === 'head-nod'));
assert.ok(!listApplicablePresets(['armRaise']).some((preset) => preset.id === 'head-nod'));
assert.equal(listApplicablePresets([]).length, 5);
pass('presets-articulados-solo-si-el-recurso-los-declara', { accepted: true });

// 6. Aplicar un preset desde el editor produce un proyecto portable.
const base = createProjectEditor(project, catalog);
const sceneId = base.project.scenes[0].id;
const element = base.project.scenes[0].elements.find((candidate) => candidate.type === 'character');
const command = {
  type: 'apply-animation-preset',
  sceneId,
  elementId: element.id,
  presetId: 'enter-left',
  anchor: { kind: 'scene', edge: 'start' },
  offsetSeconds: 0.25,
};
assert.ok(validateCommand(command), JSON.stringify(validateCommand.errors?.[0]));
const applied = applyProjectEditorCommand(base, command);
const track = applied.project.scenes[0].elements.find((candidate) => candidate.id === element.id).tracks[0];
assert.equal(track.source.presetId, 'enter-left');
assert.equal(track.keyframes[0].offsetSeconds, 0.25);
assert.equal(track.keyframes[1].offsetSeconds, 0.85);
assert.equal(track.keyframes.at(-1).value, element.transform.x, 'vuelve a la posición base del elemento');
const exported = JSON.parse(exportEditorProject(applied));
assert.ok(validateProject(exported), JSON.stringify(validateProject.errors?.[0]));
pass('aplicar-un-preset-da-un-proyecto-portable', { accepted: true });

// Y se deshace como una sola operación.
assert.equal(undoProjectEditor(applied).project.scenes[0].elements
  .find((candidate) => candidate.id === element.id).tracks, undefined);
pass('el-preset-se-deshace-en-una-sola-operacion', { accepted: true });

// 7. Editar un punto marca la pista y la protege de un reemplazo silencioso.
const edited = applyProjectEditorCommand(applied, {
  type: 'set-keyframe', sceneId, elementId: element.id, parameterId: 'position.x',
  keyframeId: track.keyframes[0].id, value: -80,
});
const editedTrack = edited.project.scenes[0].elements.find((candidate) => candidate.id === element.id).tracks[0];
assert.equal(editedTrack.source.customized, true);
assert.equal(editedTrack.source.presetId, 'enter-left', 'la procedencia se conserva después de editar');
assert.ok(validateProject(JSON.parse(exportEditorProject(edited))));
pass('editar-un-punto-marca-customized-y-conserva-procedencia', { accepted: true });

assert.throws(() => applyProjectEditorCommand(edited, command), (error) => error.code === 'EDITOR_TRACK_CUSTOMIZED');
pass('un-preset-no-pisa-una-pista-personalizada', { accepted: false, expectedCode: 'EDITOR_TRACK_CUSTOMIZED' });

// Reaplicar sobre una pista intacta sí reemplaza.
const reapplied = applyProjectEditorCommand(applied, { ...command, intensity: 'strong' });
assert.equal(reapplied.project.scenes[0].elements.find((candidate) => candidate.id === element.id).tracks.length, 1);
pass('reaplicar-sobre-una-pista-intacta-la-reemplaza', { accepted: true });

// 8. Un preset sobre un parámetro que el recurso no declara se rechaza.
assert.throws(() => applyProjectEditorCommand(base, {
  type: 'apply-animation-preset', sceneId, elementId: element.id, presetId: 'arm-raise',
}), (error) => error.code === 'EDITOR_TRACK_INVALID');
pass('arm-raise-rechazado-en-un-personaje-v2', { accepted: false, expectedCode: 'EDITOR_TRACK_INVALID' });

const modernBase = applyProjectEditorCommand(base, {
  type: 'set-character-resource', sceneId, elementId: element.id, resourceId: 'el-peque-v1',
});
const nodded = applyProjectEditorCommand(modernBase, {
  type: 'apply-animation-preset', sceneId, elementId: element.id, presetId: 'head-nod',
});
const nodTrack = nodded.project.scenes[0].elements.find((candidate) => candidate.id === element.id)
  .tracks.find((candidate) => candidate.parameterId === 'headNod');
assert.equal(nodTrack.source.presetId, 'head-nod');
assert.ok(validateProject(JSON.parse(exportEditorProject(nodded))));
pass('personaje-v3-acepta-preset-articulado-ampliado', { accepted: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'animation-presets-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
