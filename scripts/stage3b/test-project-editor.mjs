import assert from 'node:assert/strict';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { loadAndValidateVideoProject } from '../stage3a/validate-video-project.mjs';
import {
  ProjectEditorError,
  applyProjectEditorCommand,
  createProjectEditor,
  exportEditorProject,
  listEditorResources,
  redoProjectEditor,
  undoProjectEditor,
} from '../../shared/project-editor.js';

const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const commandSchema = readJson(path.join(projectRoot, 'schema', 'editor-command.schema.json'));
const validateCommand = new Ajv2020({ allErrors: true, strict: true }).compile(commandSchema);
const results = [];

function test(name, run) {
  try {
    run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

function command(state, value) {
  assert.equal(validateCommand(value), true, JSON.stringify(validateCommand.errors));
  return applyProjectEditorCommand(state, value);
}

function rejects(code, run) {
  assert.throws(run, (error) => error instanceof ProjectEditorError && error.code === code);
}

test('creates-frozen-state-with-real-resources', () => {
  const state = createProjectEditor(project, catalog);
  assert.equal(state.selectedSceneId, 'escena-presentacion');
  assert.equal(Object.isFrozen(state.project), true);
  assert.equal(listEditorResources(state, 'character').length, 2);
  assert.equal(listEditorResources(state, 'voice').length, 2);
  assert.equal(listEditorResources(state, 'background').length, 1);
});

test('selection-does-not-create-project-history', () => {
  const initial = createProjectEditor(project, catalog);
  const selected = command(initial, { type: 'select-scene', sceneId: 'escena-cierre' });
  assert.equal(selected.selectedSceneId, 'escena-cierre');
  assert.equal(selected.revision, 0);
  assert.equal(selected.past.length, 0);
  assert.strictEqual(selected.project, initial.project);
});

test('edits-project-and-scene-titles-immutably', () => {
  const initial = createProjectEditor(project, catalog);
  const titled = command(initial, { type: 'set-project-title', title: 'Video editorial' });
  const sceneTitled = command(titled, { type: 'set-scene-title', sceneId: 'escena-cierre', title: 'Nuevo cierre' });
  assert.equal(initial.project.title, project.title);
  assert.equal(sceneTitled.project.title, 'Video editorial');
  assert.equal(sceneTitled.project.scenes[1].title, 'Nuevo cierre');
  assert.equal(sceneTitled.revision, 2);
});

test('edits-background-character-and-canvas-transform', () => {
  let state = createProjectEditor(project, catalog);
  state = command(state, {
    type: 'set-scene-background', sceneId: 'escena-presentacion',
    resourceId: 'fondo-estudio-parallax-v1', cameraPreset: 'slow-zoom',
  });
  state = command(state, {
    type: 'set-character-resource', sceneId: 'escena-presentacion',
    elementId: 'presentadora', resourceId: 'mono-ciruela-v1',
  });
  state = command(state, {
    type: 'set-character-transform', sceneId: 'escena-presentacion', elementId: 'presentadora',
    x: 360, y: 1120, scale: 0.76, zIndex: 25,
  });
  const scene = state.project.scenes[0];
  assert.equal(scene.background.cameraPreset, 'slow-zoom');
  assert.equal(scene.elements[0].resourceId, 'mono-ciruela-v1');
  assert.deepEqual(
    { x: scene.elements[0].transform.x, y: scene.elements[0].transform.y, scale: scene.elements[0].transform.scale, zIndex: scene.elements[0].transform.zIndex },
    { x: 360, y: 1120, scale: 0.76, zIndex: 25 },
  );
});

test('edits-dialogue-voice-gesture-and-gap', () => {
  const state = command(createProjectEditor(project, catalog), {
    type: 'set-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-01',
    text: 'Texto corregido manualmente.', voiceId: 'voz-davefx-es-v1', gestureId: 'neutral', gapAfterSeconds: 0.6,
  });
  assert.deepEqual(
    state.project.scenes[0].dialogue[0],
    {
      id: 'turno-presentacion-01', speakerElementId: 'presentadora', text: 'Texto corregido manualmente.',
      voiceId: 'voz-davefx-es-v1', gestureId: 'neutral', gapAfterSeconds: 0.6,
    },
  );
});

test('edits-cut-and-fade-transitions', () => {
  const initial = createProjectEditor(project, catalog);
  const cut = command(initial, { type: 'set-transition', sceneId: 'escena-presentacion', preset: 'cut', durationSeconds: 0 });
  assert.deepEqual(cut.project.scenes[0].transitionToNext, { preset: 'cut', durationSeconds: 0 });
  const fade = command(cut, { type: 'set-transition', sceneId: 'escena-presentacion', preset: 'fade', durationSeconds: 0.5 });
  assert.deepEqual(fade.project.scenes[0].transitionToNext, { preset: 'fade', durationSeconds: 0.5 });
});

test('reorders-scenes-and-normalizes-transition-placement', () => {
  const state = command(createProjectEditor(project, catalog), {
    type: 'reorder-scenes', sceneIds: ['escena-cierre', 'escena-presentacion'],
  });
  assert.deepEqual(state.project.scenes.map((scene) => scene.id), ['escena-cierre', 'escena-presentacion']);
  assert.ok(state.project.scenes[0].transitionToNext);
  assert.equal('transitionToNext' in state.project.scenes[1], false);
});

test('undo-and-redo-preserve-valid-projects', () => {
  const initial = createProjectEditor(project, catalog);
  const edited = command(initial, { type: 'set-project-title', title: 'Título temporal' });
  const undone = undoProjectEditor(edited);
  assert.equal(undone.project.title, project.title);
  assert.equal(undone.future.length, 1);
  const redone = redoProjectEditor(undone);
  assert.equal(redone.project.title, 'Título temporal');
  assert.equal(redone.future.length, 0);
});

test('rejects-unknown-resources-and-unsupported-values', () => {
  const state = createProjectEditor(project, catalog);
  rejects('EDITOR_RESOURCE_INVALID', () => applyProjectEditorCommand(state, {
    type: 'set-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-01', voiceId: 'voz-inexistente',
  }));
  rejects('EDITOR_VALUE_INVALID', () => applyProjectEditorCommand(state, {
    type: 'set-character-transform', sceneId: 'escena-presentacion', elementId: 'presentadora', x: 9000,
  }));
  rejects('EDITOR_TRANSITION_INVALID', () => applyProjectEditorCommand(state, {
    type: 'set-transition', sceneId: 'escena-presentacion', preset: 'cut', durationSeconds: 0.4,
  }));
});

test('command-schema-rejects-arbitrary-fields', () => {
  assert.equal(validateCommand({ type: 'set-project-title', title: 'Válido', script: 'alert(1)' }), false);
  assert.equal(validateCommand({ type: 'set-character-transform', sceneId: 'escena-presentacion', elementId: 'presentadora' }), false);
  rejects('EDITOR_COMMAND_INVALID', () => applyProjectEditorCommand(createProjectEditor(project, catalog), {
    type: 'set-project-title', title: 'Válido', script: 'alert(1)',
  }));
});

test('export-is-portable-and-passes-authoritative-validator', () => {
  let state = createProjectEditor(project, catalog);
  state = command(state, { type: 'set-scene-title', sceneId: 'escena-presentacion', title: 'Escena editada' });
  state = command(state, {
    type: 'set-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-02', text: 'Este texto fue editado desde el núcleo local.',
  });
  const exported = exportEditorProject(state);
  assert.equal(exported.endsWith('\n'), true);
  assert.equal(/[A-Za-z]:\\/.test(exported), false);
  const testRoot = ensureDirectory(path.join(projectRoot, '.local-video', 'tests', 'project-editor'));
  const exportedPath = path.join(testRoot, 'project.exported.json');
  writeJson(exportedPath, JSON.parse(exported));
  const validated = loadAndValidateVideoProject({ projectPath: exportedPath, assetsRoot: path.join(projectRoot, 'public') });
  assert.equal(validated.project.scenes[0].title, 'Escena editada');
});

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  passed: results.filter((result) => result.passed).length,
  failed: results.filter((result) => !result.passed).length,
  results,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'project-editor-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.failed > 0) process.exitCode = 1;
