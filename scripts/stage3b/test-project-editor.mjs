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
  validateRenderableProject,
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
  const catalogCount = (type) => catalog.entries.filter((entry) => entry.type === type).length;
  assert.equal(listEditorResources(state, 'character').length, catalogCount('character'));
  assert.equal(listEditorResources(state, 'voice').length, catalogCount('voice'));
  assert.equal(listEditorResources(state, 'background').length, catalogCount('background'));
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
  state = command(state, {
    type: 'set-character-animation', sceneId: 'escena-presentacion', elementId: 'presentadora',
    animationPreset: 'talk-calm',
  });
  const scene = state.project.scenes[0];
  assert.equal(scene.background.cameraPreset, 'slow-zoom');
  assert.equal(scene.elements[0].resourceId, 'mono-ciruela-v1');
  assert.deepEqual(
    { x: scene.elements[0].transform.x, y: scene.elements[0].transform.y, scale: scene.elements[0].transform.scale, zIndex: scene.elements[0].transform.zIndex },
    { x: 360, y: 1120, scale: 0.76, zIndex: 25 },
  );
  assert.equal(scene.elements[0].animationPreset, 'talk-calm');
});

test('places-character-resource-and-position-atomically', () => {
  const initial = createProjectEditor(project, catalog);
  const state = command(initial, {
    type: 'place-character-resource',
    sceneId: 'escena-presentacion',
    elementId: 'presentadora',
    resourceId: 'mono-ciruela-v1',
    x: 275,
    y: 980,
  });
  const element = state.project.scenes[0].elements.find((item) => item.id === 'presentadora');
  assert.equal(state.revision, 1);
  assert.equal(element.resourceId, 'mono-ciruela-v1');
  assert.equal(element.transform.x, 275);
  assert.equal(element.transform.y, 980);
  assert.equal(initial.project.scenes[0].elements[0].resourceId, 'mono-azul-v1');
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

test('supports-incomplete-drafts-and-structural-authoring-commands', () => {
  const draft = structuredClone(project);
  draft.scenes = [{
    id: 'escena-vacia',
    title: 'Escena vacía',
    background: structuredClone(project.scenes[0].background),
    elements: [],
    dialogue: [],
  }];
  let state = createProjectEditor(draft, catalog);
  rejects('EDITOR_SCENE_NOT_RENDERABLE', () => validateRenderableProject(state.project, catalog));
  state = command(state, {
    type: 'add-character', sceneId: 'escena-vacia', elementId: 'personaje-01',
    resourceId: 'mono-azul-v1', x: 360, y: 1180, scale: 0.75, zIndex: 20,
  });
  state = command(state, {
    type: 'add-character', sceneId: 'escena-vacia', elementId: 'personaje-02',
    resourceId: 'mono-ciruela-v1', x: 720, y: 1180, scale: 0.75, zIndex: 21,
  });
  state = command(state, {
    type: 'add-dialogue-turn', sceneId: 'escena-vacia', turnId: 'turno-01',
    speakerElementId: 'personaje-01', text: 'Primer turno.', voiceId: 'voz-daniela-ar-v1',
    gestureId: 'neutral', gapAfterSeconds: 0.2,
  });
  state = command(state, {
    type: 'add-dialogue-turn', sceneId: 'escena-vacia', turnId: 'turno-02',
    speakerElementId: 'personaje-02', text: 'Segundo turno.', voiceId: 'voz-davefx-es-v1',
    gestureId: 'neutral', gapAfterSeconds: 0,
  });
  assert.equal(validateRenderableProject(state.project, catalog), true);
  state = command(state, {
    type: 'add-scene',
    scene: {
      id: 'escena-nueva', title: 'Escena nueva',
      background: structuredClone(project.scenes[0].background), elements: [], dialogue: [],
    },
  });
  assert.equal(state.project.scenes.length, 2);
  assert.deepEqual(state.project.scenes[0].transitionToNext, { preset: 'cut', durationSeconds: 0 });
  state = command(state, { type: 'delete-scene', sceneId: 'escena-nueva' });
  assert.equal(state.project.scenes.length, 1);
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

test('splits-a-scene-at-a-turn-boundary', () => {
  let state = createProjectEditor(project, catalog);
  // La escena arranca con 2 turnos; se lleva a 4 para poder partir 2+2 (cada escena
  // renderizable necesita >= 2 turnos).
  state = command(state, {
    type: 'add-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-03',
    speakerElementId: 'presentadora', text: 'Tercer turno.', voiceId: 'voz-daniela-ar-v1', gestureId: 'neutral', gapAfterSeconds: 0,
  });
  state = command(state, {
    type: 'add-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-04',
    speakerElementId: 'analista', text: 'Cuarto turno.', voiceId: 'voz-daniela-ar-v1', gestureId: 'neutral', gapAfterSeconds: 0,
  });
  state = command(state, { type: 'split-scene', sceneId: 'escena-presentacion', atTurnId: 'turno-presentacion-03', newSceneId: 'escena-partida' });
  assert.equal(state.project.scenes.length, 3);
  const [primera, nueva, cierre] = state.project.scenes;
  assert.equal(primera.id, 'escena-presentacion');
  assert.deepEqual(primera.dialogue.map((turn) => turn.id), ['turno-presentacion-01', 'turno-presentacion-02']);
  assert.deepEqual(primera.transitionToNext, { preset: 'cut', durationSeconds: 0 });
  assert.equal(nueva.id, 'escena-partida');
  assert.equal(nueva.dialogue.length, 2);
  // la nueva hereda la transición de salida original (fade) y el hablante remapeado
  assert.deepEqual(nueva.transitionToNext, { preset: 'fade', durationSeconds: 0.35 });
  assert.equal(nueva.elements.every((element) => element.id.startsWith('escena-partida-e')), true);
  assert.equal(nueva.dialogue.every((turn) => nueva.elements.some((element) => element.id === turn.speakerElementId)), true);
  assert.equal(cierre.id, 'escena-cierre');
  assert.equal(validateRenderableProject(state.project, catalog), true);
});

test('rejects-invalid-scene-splits', () => {
  const state = createProjectEditor(project, catalog);
  rejects('EDITOR_SPLIT_INVALID', () => command(state, { type: 'split-scene', sceneId: 'escena-presentacion', atTurnId: 'turno-presentacion-01', newSceneId: 'parte-a' }));
  rejects('EDITOR_SPLIT_INVALID', () => command(state, { type: 'split-scene', sceneId: 'escena-presentacion', atTurnId: 'turno-fantasma', newSceneId: 'parte-b' }));
  rejects('EDITOR_PROJECT_INVALID', () => command(state, { type: 'split-scene', sceneId: 'escena-presentacion', atTurnId: 'turno-presentacion-02', newSceneId: 'escena-cierre' }));
});

test('reorders-dialogue-turns-within-a-scene', () => {
  let state = createProjectEditor(project, catalog);
  state = command(state, { type: 'reorder-dialogue-turns', sceneId: 'escena-presentacion', turnIds: ['turno-presentacion-02', 'turno-presentacion-01'] });
  assert.deepEqual(state.project.scenes[0].dialogue.map((turn) => turn.id), ['turno-presentacion-02', 'turno-presentacion-01']);
  assert.equal(validateRenderableProject(state.project, catalog), true);
  rejects('EDITOR_TURN_ORDER_INVALID', () => command(state, { type: 'reorder-dialogue-turns', sceneId: 'escena-presentacion', turnIds: ['turno-presentacion-02'] }));
  rejects('EDITOR_TURN_ORDER_INVALID', () => command(state, { type: 'reorder-dialogue-turns', sceneId: 'escena-presentacion', turnIds: ['turno-presentacion-02', 'turno-fantasma'] }));
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
