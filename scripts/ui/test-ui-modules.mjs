import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot, readJson } from '../stage1/common.mjs';

// Los módulos de src/ui son TypeScript y no son importables directo desde Node. Se
// compilan a un directorio temporal preservando el árbol, de modo que store.js resuelva
// el motor real shared/project-editor.js por su ruta relativa (../../../shared/...).
// Se elige compilar (en vez de refactorizar) para no cambiar la superficie del código.
const outDir = mkdtempSync(path.join(os.tmpdir(), 'local-video-ui-modules-'));
const tsc = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const sources = ['src/ui/editor-workspace.ts', 'src/ui/project/store.ts'];
const compile = spawnSync(process.execPath, [
  tsc,
  ...sources,
  '--ignoreConfig',
  '--outDir', outDir,
  '--rootDir', projectRoot,
  '--module', 'esnext',
  '--target', 'es2022',
  '--moduleResolution', 'bundler',
  '--skipLibCheck',
  '--noEmitOnError', 'false',
], { cwd: projectRoot, shell: false, encoding: 'utf8' });
if (compile.status !== 0) {
  process.stderr.write(`${compile.stdout || ''}${compile.stderr || ''}`);
  throw new Error('No se pudieron compilar los módulos de UI para la prueba.');
}

// El dir temporal necesita ser tratado como ESM y contener el motor que store.js importa.
writeFileSync(path.join(outDir, 'package.json'), '{"type":"module"}\n');
mkdirSync(path.join(outDir, 'shared'), { recursive: true });
copyFileSync(
  path.join(projectRoot, 'shared', 'project-editor.js'),
  path.join(outDir, 'shared', 'project-editor.js'),
);

const workspacePath = path.join(outDir, 'src', 'ui', 'editor-workspace.js');
const storePath = path.join(outDir, 'src', 'ui', 'project', 'store.js');
assert.equal(existsSync(workspacePath), true, 'editor-workspace.js no se compiló');
assert.equal(existsSync(storePath), true, 'store.js no se compiló');

// Stubs mínimos de DOM para editor-workspace (solo despacha CustomEvent sobre window).
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };
}
const dispatched = [];
globalThis.window = { dispatchEvent: (event) => { dispatched.push(event.type); return true; } };

function fakeVideo() {
  return {
    paused: true,
    muted: false,
    currentTime: 0,
    duration: 0,
    src: '',
    load() {},
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
    addEventListener() {},
  };
}

const workspace = await import(pathToFileURL(workspacePath).href);
const storeModule = await import(pathToFileURL(storePath).href);
const engine = await import(pathToFileURL(path.join(outDir, 'shared', 'project-editor.js')).href);

let passed = 0;
const check = (label, condition) => {
  assert.equal(condition, true, label);
  passed += 1;
};

// ---- editor-workspace.ts: máquina de estados modo/superficie/vigencia ----
const video = fakeVideo();
workspace.bindEditorMedia(video);
let snap = workspace.editorWorkspace();
check('inicia en editor/canvas', snap.mode === 'editor' && snap.surface === 'canvas');
check('sin proyecto ni salida al inicio', snap.activeProjectId === null && snap.output === null);

workspace.setActiveEditorProject('proyecto-1');
check('registra el proyecto activo', workspace.editorWorkspace().activeProjectId === 'proyecto-1');

workspace.registerRenderedOutput({
  projectId: 'proyecto-1',
  url: 'blob:video-1',
  downloadName: 'proyecto-1.mp4',
  timeline: { durationSeconds: 12.5, scenes: [] },
  current: true,
  reveal: true,
});
snap = workspace.editorWorkspace();
check('una salida vigente y revelada muestra playback', snap.surface === 'playback' && snap.output.stale === false);
check('la duración medida tiene prioridad', snap.duration === 12.5);

workspace.markEditorProjectChanged('proyecto-1');
snap = workspace.editorWorkspace();
check('editar el proyecto activo marca la salida vencida', snap.output.stale === true);
check('una salida vencida vuelve al lienzo', snap.surface === 'canvas');

workspace.registerRenderedOutput({
  projectId: 'proyecto-1',
  url: 'blob:video-2',
  downloadName: 'proyecto-1.mp4',
  timeline: null,
  current: true,
});
workspace.setActiveEditorProject('proyecto-2');
check('cambiar de proyecto activo vence la salida', workspace.editorWorkspace().output.stale === true);

workspace.showWorkspaceMode('creator');
snap = workspace.editorWorkspace();
check('el modo creador fuerza lienzo y pausa el medio', snap.mode === 'creator' && snap.surface === 'canvas' && video.paused === true);
check('cada transición notifica por evento', dispatched.length > 0);

// ---- store.ts: comandos, undo/redo, suscripción ----
const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const store = storeModule.createStore(engine.createProjectEditor(project, catalog), 'rev-abc');

check('expone la escena seleccionada inicial', store.selectedSceneId() === 'escena-presentacion');
check('expone la revisión del catálogo', store.catalogRevision() === 'rev-abc');
check('sin historial al inicio', store.canUndo() === false && store.canRedo() === false);

let notified = 0;
store.subscribe(() => { notified += 1; });

check('seleccionar escena no crea historial', store.dispatch({ type: 'select-scene', sceneId: 'escena-cierre' }) === null);
check('la selección se aplicó', store.selectedSceneId() === 'escena-cierre' && store.canUndo() === false);
check('la selección notificó a los suscriptores', notified === 1);

check('editar el título es válido', store.dispatch({ type: 'set-project-title', title: 'Título de prueba' }) === null);
check('una edición crea historial deshacible', store.canUndo() === true && notified === 2);

const before = store.exportJson();
const rejection = store.dispatch({ type: 'comando-inexistente' });
check('un comando inválido devuelve un mensaje', typeof rejection === 'string' && rejection.length > 0);
check('un comando inválido no muta el estado', store.exportJson() === before);

store.undo();
check('deshacer revierte el historial', store.canUndo() === false && store.canRedo() === true);
store.redo();
check('rehacer reaplica el cambio', store.canRedo() === false);
check('el JSON exportado refleja el título aplicado', JSON.parse(store.exportJson()).title === 'Título de prueba');
check('los recursos provienen del catálogo del motor', store.resources('character').length === 2);

process.stdout.write(`${JSON.stringify({ version: 1, passed, failed: 0 })}\n`);
