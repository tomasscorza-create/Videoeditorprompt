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
const sources = ['src/ui/editor-workspace.ts', 'src/ui/project/store.ts', 'src/ui/timeline-geometry.ts'];
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

const geometryPath = path.join(outDir, 'src', 'ui', 'timeline-geometry.js');
assert.equal(existsSync(geometryPath), true, 'timeline-geometry.js no se compiló');

const workspace = await import(pathToFileURL(workspacePath).href);
const storeModule = await import(pathToFileURL(storePath).href);
const geometry = await import(pathToFileURL(geometryPath).href);
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
const catalogCharacters = catalog.entries.filter((entry) => entry.type === 'character').length;
check('los recursos provienen del catálogo del motor', store.resources('character').length === catalogCharacters);

// ---- timeline-geometry.ts: glifos de transición y rótulo de pausa (A3) ----
check('el corte se muestra con tijera', geometry.transitionGlyph('cut', 0) === '✂');
check('el fundido muestra rombo con duración', geometry.transitionGlyph('fade', 0.35) === '◇ 0.35 s');
check('el fundido sin duración muestra solo el rombo', geometry.transitionGlyph('fade', 0) === '◇');
check('el rótulo del corte es descriptivo', geometry.transitionLabel('cut', 0) === 'Corte directo');
check('el rótulo del fundido incluye la duración', geometry.transitionLabel('fade', 0.5) === 'Fundido 0.5 s');
check('el rótulo de pausa formatea segundos', geometry.pauseLabel(0.4) === '0.4 s');

// ---- timeline-geometry.ts: subdivisiones de la regla (A4) ----
check('sin duración no hay marcas de tiempo', geometry.rulerTicks(0, 60).length === 0);
check('sin escala no hay marcas de tiempo', geometry.rulerTicks(10, 0).length === 0);
const ticks = geometry.rulerTicks(10, 60);
check('la regla arranca en cero', ticks[0].seconds === 0 && ticks[0].major === true);
check('cada marca mayor cae sobre una marca real', ticks.filter((tick) => tick.major).every((tick) => ticks.includes(tick)));
check('la posición es segundos por pixelsPerSecond', ticks.every((tick) => Math.abs(tick.position - tick.seconds * 60) < 1e-6));
check('a más zoom, más marcas', geometry.rulerTicks(10, 200).length > geometry.rulerTicks(10, 30).length);
check('el paso mayor crece cuando el zoom baja', geometry.chooseTickStep(20, 64) > geometry.chooseTickStep(120, 64));
check('las marcas no superan la duración', geometry.rulerTicks(10, 60).every((tick) => tick.seconds <= 10 + 1e-6));

// ---- timeline-geometry.ts: reducción a picos de la onda (A1) ----
check('sin buckets no hay picos', geometry.computePeaks(Float32Array.from([0.5, -0.5]), 0).length === 0);
check('sin muestras los picos son cero', Array.from(geometry.computePeaks(new Float32Array(0), 3)).every((value) => value === 0));
const peaks = geometry.computePeaks(Float32Array.from([0, 0.5, -1, 0.2]), 2);
check('el pico es el máximo absoluto por ventana', peaks.length === 2 && peaks[0] === 0.5 && peaks[1] === 1);
const flat = geometry.computePeaks(Float32Array.from([0.3, 0.3, 0.3, 0.3]), 4);
check('un tono plano da picos constantes', Array.from(flat).every((value) => Math.abs(value - 0.3) < 1e-6));

process.stdout.write(`${JSON.stringify({ version: 1, passed, failed: 0 })}\n`);
