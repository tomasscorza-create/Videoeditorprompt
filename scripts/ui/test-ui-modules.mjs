import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
const sources = [
  'src/vite-env.d.ts',
  'src/ui/editor-workspace.ts',
  'src/ui/right-panel.ts',
  'src/ui/project/editing-panel.ts',
  'src/ui/project/store.ts',
  'src/ui/timeline-geometry.ts',
  'src/ui/timeline-animation.ts',
  'src/ui/director/api.ts',
  'src/ui/director/progress-copy.ts',
  'src/ui/director/flow-guidance.ts',
  'src/ui/director/navigation.ts',
  'src/ui/notifications-queue.ts',
  'src/ui/director/quality-copy.ts',
  'src/ui/director/health-copy.ts',
  'src/ui/director/candidates-copy.ts',
  'src/ui/director/edit-proposal.ts',
  'src/ui/command-labels.ts',
  'src/ui/command-registry.ts',
];
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
// El motor y todo lo que importa: `project-editor.js` lee el vocabulario
// congelado de animación desde `animation-contract.js`.
for (const name of ['project-editor.js', 'animation-contract.js', 'animation-presets.js', 'animation-evaluator.js']) {
  copyFileSync(path.join(projectRoot, 'shared', name), path.join(outDir, 'shared', name));
}

const workspacePath = path.join(outDir, 'src', 'ui', 'editor-workspace.js');
const rightPanelPath = path.join(outDir, 'src', 'ui', 'right-panel.js');
const editingPanelPath = path.join(outDir, 'src', 'ui', 'project', 'editing-panel.js');
const layersPath = path.join(outDir, 'src', 'ui', 'project', 'layers.js');
const storePath = path.join(outDir, 'src', 'ui', 'project', 'store.js');
assert.equal(existsSync(workspacePath), true, 'editor-workspace.js no se compiló');
assert.equal(existsSync(rightPanelPath), true, 'right-panel.js no se compiló');
assert.equal(existsSync(editingPanelPath), true, 'editing-panel.js no se compiló');
assert.equal(existsSync(layersPath), true, 'layers.js no se compiló');
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
const apiPath = path.join(outDir, 'src', 'ui', 'director', 'api.js');
const directorNavigationPath = path.join(outDir, 'src', 'ui', 'director', 'navigation.js');
assert.equal(existsSync(geometryPath), true, 'timeline-geometry.js no se compiló');
assert.equal(existsSync(apiPath), true, 'director/api.js no se compiló');
assert.equal(existsSync(directorNavigationPath), true, 'director/navigation.js no se compiló');

const workspace = await import(pathToFileURL(workspacePath).href);
const rightPanel = await import(pathToFileURL(rightPanelPath).href);
const editingPanel = await import(pathToFileURL(editingPanelPath).href);
const layers = await import(pathToFileURL(layersPath).href);
const storeModule = await import(pathToFileURL(storePath).href);
const geometry = await import(pathToFileURL(geometryPath).href);
const animation = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'timeline-animation.js')).href);
const directorApi = await import(pathToFileURL(apiPath).href);
const directorProgress = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'progress-copy.js')).href);
const directorFlow = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'flow-guidance.js')).href);
const directorNavigation = await import(pathToFileURL(directorNavigationPath).href);
const notificationsQueue = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'notifications-queue.js')).href);
const qualityCopy = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'quality-copy.js')).href);
const healthCopy = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'health-copy.js')).href);
const candidatesCopy = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'candidates-copy.js')).href);
const editProposal = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'edit-proposal.js')).href);
const commandLabels = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'command-labels.js')).href);
const commandRegistry = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'command-registry.js')).href);
const engine = await import(pathToFileURL(path.join(outDir, 'shared', 'project-editor.js')).href);
const fingerprint = await import(pathToFileURL(path.join(projectRoot, 'shared', 'project-fingerprint.js')).href);

let passed = 0;
const check = (label, condition) => {
  assert.equal(condition, true, label);
  passed += 1;
};

check(
  'la revisión visual es determinista y sensible al proyecto',
  fingerprint.projectFingerprint({ id: 'a', scenes: [] }) === fingerprint.projectFingerprint({ id: 'a', scenes: [] })
    && fingerprint.projectFingerprint({ id: 'a', scenes: [] }) !== fingerprint.projectFingerprint({ id: 'b', scenes: [] }),
);

// ---- project-fingerprint.js: revisión de tiempo aparte de la visual (Fase 4) ----
{
  const base = {
    id: 'p', title: 'T', video: { width: 1080, height: 1920, fps: 30 },
    scenes: [{
      id: 's1',
      title: 'Escena 1',
      background: { resourceId: 'fondo', cameraPreset: 'static' },
      elements: [{ id: 'e1', type: 'character', transform: { x: 10, y: 20, scale: 1 } }],
      dialogue: [{ id: 't1', text: 'Hola', voiceId: 'v1', gestureId: 'neutral', gapAfterSeconds: 0.2 }],
      transitionToNext: { preset: 'cut', durationSeconds: 0 },
    }],
  };
  const variant = (mutate) => { const copy = structuredClone(base); mutate(copy); return copy; };
  const moved = variant((p) => { p.scenes[0].elements[0].transform.x = 400; });
  const animated = variant((p) => { p.scenes[0].elements[0].tracks = [{ parameterId: 'opacity', keyframes: [] }]; });
  const renamed = variant((p) => { p.scenes[0].title = 'Otro nombre'; });
  const retexted = variant((p) => { p.scenes[0].dialogue[0].text = 'Hola de nuevo'; });
  const repaused = variant((p) => { p.scenes[0].dialogue[0].gapAfterSeconds = 1; });
  const revoiced = variant((p) => { p.scenes[0].dialogue[0].voiceId = 'v2'; });
  const faded = variant((p) => { p.scenes[0].transitionToNext = { preset: 'fade', durationSeconds: 0.4 }; });

  check('las dos revisiones no se confunden entre sí', fingerprint.projectTimingFingerprint(base).startsWith('timing-v1-'));
  check('la revisión de tiempo es determinista', fingerprint.projectTimingFingerprint(base) === fingerprint.projectTimingFingerprint(structuredClone(base)));
  check('mover un personaje cambia la revisión visual', fingerprint.projectFingerprint(moved) !== fingerprint.projectFingerprint(base));
  check('mover un personaje no mueve un milisegundo', fingerprint.projectTimingFingerprint(moved) === fingerprint.projectTimingFingerprint(base));
  check('animar tampoco cambia una duración', fingerprint.projectTimingFingerprint(animated) === fingerprint.projectTimingFingerprint(base));
  check('renombrar una escena tampoco', fingerprint.projectTimingFingerprint(renamed) === fingerprint.projectTimingFingerprint(base));
  check('cambiar el texto sí cambia el tiempo', fingerprint.projectTimingFingerprint(retexted) !== fingerprint.projectTimingFingerprint(base));
  check('cambiar una pausa sí', fingerprint.projectTimingFingerprint(repaused) !== fingerprint.projectTimingFingerprint(base));
  check('cambiar la voz sí', fingerprint.projectTimingFingerprint(revoiced) !== fingerprint.projectTimingFingerprint(base));
  check('cambiar la transición sí, porque corre el inicio de la escena siguiente', fingerprint.projectTimingFingerprint(faded) !== fingerprint.projectTimingFingerprint(base));
}

const appHtml = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const projectPanelSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'project', 'panel.ts'), 'utf8');
const directorPanelSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'director', 'panel.ts'), 'utf8');
const timelineSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'timeline.ts'), 'utf8');
const editingPanelSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'project', 'editing-panel.ts'), 'utf8');
const compositionSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'project', 'composition.ts'), 'utf8');
check(
  'el panel derecho ofrece Recursos y Edición como páginas hermanas',
  appHtml.includes('id="right-panel-resources-tab"')
    && appHtml.includes('id="right-panel-editing-tab"')
    && appHtml.includes('id="right-panel-resources"')
    && appHtml.includes('id="right-panel-editing"'),
);
check(
  'la cabecera elimina Catálogo local y conserva Recursos',
  !appHtml.includes('Catálogo local')
    && appHtml.includes('data-right-panel-page="resources"')
    && appHtml.includes('data-right-panel-page="editing"'),
);
check(
  'Edición expone un host único para herramientas contextuales',
  appHtml.includes('id="editing-tool-host"')
    && appHtml.includes('data-editing-host="selection-tools"'),
);
check(
  'Edición elimina el encabezado explicativo y el badge contextual',
  !appHtml.includes('Panel de mando')
    && !appHtml.includes('Edición manual')
    && !appHtml.includes('id="editing-selection-context"')
    && !appHtml.includes('id="editing-selection-title"'),
);
check(
  'un elemento reparte la edición en tres subpáginas comprensibles',
  editingPanel.editingSubpages({
    kind: 'element',
    sceneId: 'scene-1',
    elementId: 'element-1',
  }).map((page) => page.label).join('|') === 'Ajustes|Crear animación|Pistas',
);
check(
  'seleccionar un keyframe abre directamente Pistas',
  editingPanel.defaultEditingSubpage({
    kind: 'keyframe',
    sceneId: 'scene-1',
    elementId: 'element-1',
    parameterId: 'opacity',
    keyframeId: 'keyframe-1',
  }) === 'tracks',
);
check(
  'un diálogo usa una página enfocada en texto y voz',
  editingPanel.editingSubpages({
    kind: 'dialogue',
    sceneId: 'scene-1',
    turnId: 'turn-1',
  }).map((page) => page.label).join('|') === 'Texto y voz',
);
check(
  'Edición usa el cabezal compartido para crear keyframes con el helper canónico',
  editingPanelSource.includes('editorPlayhead()')
    && editingPanelSource.includes('keyframeCommandsForValue({')
    && editingPanelSource.includes('Agregar keyframe en el cabezal'),
);
check(
  'Opacidad muestra porcentaje y previsualiza mientras se desliza',
  editingPanelSource.includes("input('range'")
    && editingPanelSource.includes("range.addEventListener('input', paint)")
    && editingPanelSource.includes('output.textContent = `${percent}%`')
    && compositionSource.includes('image.style.opacity = String(view.opacity)'),
);
check(
  'una animación de opacidad no constante desactiva el ajuste simple',
  editingPanelSource.includes("track.parameterId === 'opacity'")
    && editingPanelSource.includes('opacityTrack && !constantTrack')
    && editingPanelSource.includes("output.textContent = 'Controlada por pista'"),
);
{
  const character = {
    id: 'character-opacity',
    type: 'character',
    transform: { x: 0, y: 0, scale: 1, rotationDegrees: 0, opacity: 1, zIndex: 20 },
    tracks: [],
  };
  const scene = { id: 'scene-opacity', elements: [character] };
  const commands = editingPanel.constantCharacterOpacityCommands(scene, character, 0.35);
  const createTrack = commands.find((command) => command.type === 'create-track');
  check(
    'la opacidad simple de personaje crea una pista constante compatible con render',
    commands.every((command) => command.type !== 'set-element-transform')
      && createTrack?.parameterId === 'opacity'
      && createTrack.keyframes?.length === 2
      && createTrack.keyframes.every((keyframe) => keyframe.value === 0.35)
      && createTrack.keyframes[0].anchor.edge === 'start'
      && createTrack.keyframes[1].anchor.edge === 'end',
  );
  check(
    'volver a opacidad completa sin pista no genera historial vacío',
    editingPanel.constantCharacterOpacityCommands(scene, character, 1).length === 0,
  );
}
check(
  'las capas se expresan como números simples con el fondo en cero',
  editingPanelSource.includes("field('Capa', control)")
    && editingPanelSource.includes("control.addEventListener('input'")
    && editingPanelSource.includes('Fondo: capa 0')
    && !editingPanelSource.includes('Al fondo')
    && !editingPanelSource.includes('Al frente'),
);
{
  const scene = {
    id: 'scene-layer',
    elements: [
      { id: 'back', type: 'character', transform: { zIndex: 20 } },
      { id: 'front', type: 'character', transform: { zIndex: 21 } },
    ],
  };
  const commands = layers.setVisualLayerCommands(scene, 'back', 2);
  check(
    'subir a capa 2 deja al elemento seleccionado por encima y normaliza 1..N',
    commands.length > 0
      && commands.every((command) => command.type === 'set-element-transform')
      && commands.some((command) => command.elementId === 'front' && command.zIndex === 1)
      && commands.some((command) => command.elementId === 'back' && command.zIndex === 2),
  );
  check(
    'la UI traduce zIndex históricos a capas humanas consecutivas',
    layers.visualLayerNumber(scene, 'back') === 1
      && layers.visualLayerNumber(scene, 'front') === 2,
  );
  check(
    'un elemento nuevo obtiene automáticamente la capa superior siguiente',
    layers.nextVisualZIndex(scene) === 22
      && layers.nextVisualZIndex({ id: 'empty', elements: [] }) === 1,
  );
  check(
    'todos los caminos de alta usan la misma asignación de capa',
    compositionSource.includes('zIndex: nextVisualZIndex(scene)')
      && timelineSource.includes('zIndex: nextVisualZIndex(target)')
      && compositionSource.includes("image.style.zIndex = '0'"),
  );
}
check(
  'el Director ya no conserva una segunda implementación de edición manual',
  !projectPanelSource.includes('function animationControls(')
    && !projectPanelSource.includes('function keyframeCard(')
    && projectPanelSource.includes("showRightPanelPage('editing')"),
);
check(
  'la timeline conserva acciones estructurales y comparte la duplicación de keyframes',
  appHtml.includes('id="timeline-split"')
    && timelineSource.includes('splitSelectedTurn')
    && timelineSource.includes('duplicateKeyframeCommand({'),
);
check(
  'seleccionar un elemento no inserta filas informativas en la timeline',
  !timelineSource.includes('animationRowsForSlot')
    && !timelineSource.includes("authoringTrack('ANIM'"),
);
check(
  'las pistas y keyframes seleccionables viven en Edición',
  editingPanelSource.includes("button.className = 'editing-keyframe-item'")
    && editingPanelSource.includes('keyframePicker(scene, element, lane)'),
);
check(
  'el cabezal se puede arrastrar y expone su posición como slider',
  timelineSource.includes('bindPlayheadDrag(playhead, root)')
    && timelineSource.includes("playhead.addEventListener('pointerdown'")
    && timelineSource.includes("playhead.setAttribute('role', 'slider')"),
);
check(
  'la selección enlaza la edición derecha y no el antiguo inspector del Director',
  readFileSync(path.join(projectRoot, 'src', 'ui', 'selection-mirror.ts'), 'utf8')
    .includes("showRightPanelPage('editing')")
    && !readFileSync(path.join(projectRoot, 'src', 'ui', 'selection-mirror.ts'), 'utf8')
      .includes("querySelector<HTMLElement>('#scene-inspector')"),
);
check(
  'la creación de pista selecciona el keyframe editable del cabezal',
  editingPanel.selectedKeyframeId([{
    type: 'create-track',
    keyframes: [{ id: 'base' }, { id: 'cabezal' }],
  }], null, 2, 30) === 'cabezal',
);
check(
  'el Director expone un único control contextual de cancelación',
  (appHtml.match(/id="director-cancel"/g) ?? []).length === 1 && !appHtml.includes('director-proposal-cancel'),
);
check('el estado del Director incluye un indicador de actividad', appHtml.includes('class="director-activity"'));
check(
  'Estado actual no duplica las acciones estructurales de la timeline',
  !projectPanelSource.includes("actionButton('Nueva escena'")
    && !projectPanelSource.includes("actionButton('Duplicar'")
    && !projectPanelSource.includes("actionButton('Eliminar',"),
);
check(
  'Escena edita el guion sin exponer personaje ni voz',
  !projectPanelSource.includes('set-dialogue-speaker')
    && !projectPanelSource.includes('voiceSelect')
    && projectPanelSource.includes('proposal-dialogue-meta'),
);
check(
  'la propuesta recorre todas las escenas en sus editores enfocados',
  projectPanelSource.includes('project.scenes.map((scene, index)')
    && projectPanelSource.includes('store.project().scenes.map((scene, index)'),
);
check(
  'la cabecera del Director usa y permite editar el título real del proyecto',
  directorPanelSource.includes("proposalTitle.value = store?.project().title?.trim()")
    && directorPanelSource.includes("store.dispatch({ type: 'set-project-title', title })"),
);

check(
  'explica la escena y la capacidad no soportada sin índice técnico',
  directorApi.formatApiError({
    code: 'PROJECT_SCENE_UNSUPPORTED',
    message: 'Una escena no es compatible.',
    technicalDetail: '/scenes/1 el personaje protagonista usa pose inicial point',
    suggestedAction: 'Corrija la escena.',
  }).includes('Escena 2: el personaje protagonista usa pose inicial point'),
);
check(
  'no muestra detalles técnicos arbitrarios de otros errores',
  !directorApi.formatApiError({
    code: 'UNEXPECTED_ERROR',
    message: 'Falló.',
    technicalDetail: 'C:\\ruta\\privada\\archivo.json',
  }).includes('ruta'),
);
check(
  'los códigos técnicos no contaminan el mensaje principal',
  directorApi.formatApiError({ code: 'OLLAMA_TIMEOUT', message: 'Ollama tardó demasiado.', suggestedAction: 'Reintentá.' })
    === 'Ollama tardó demasiado. Reintentá.',
);
check(
  'el detalle técnico queda disponible bajo demanda',
  directorApi.formatApiTechnicalDetails({
    code: 'OLLAMA_TIMEOUT',
    message: 'Ollama tardó demasiado.',
    technicalDetail: 'elapsed=240000',
  }).includes('Código: OLLAMA_TIMEOUT')
    && directorApi.formatApiTechnicalDetails({
      code: 'OLLAMA_TIMEOUT',
      message: 'Ollama tardó demasiado.',
      technicalDetail: 'elapsed=240000',
    }).includes('elapsed=240000'),
);
check('cancelar no se clasifica como caída del servicio', directorApi.classifyApiError({ code: 'DIRECTOR_CANCELLED', message: 'Cancelado.' }) === 'cancelled');
check('un timeout tiene una categoría propia', directorApi.classifyApiError({ code: 'OLLAMA_TIMEOUT', message: 'Tardó.' }) === 'timeout');
check('una respuesta inválida no se confunde con Ollama caído', directorApi.classifyApiError({ code: 'LOCAL_SERVICE_INVALID_RESPONSE', message: 'Inválida.' }) === 'invalid-response');
check(
  'el progreso nombra candidato y reparación sin inventar porcentaje',
  directorProgress.describeDirectorProgress({
    version: 1,
    state: 'running',
    stage: 'generating',
    updatedAt: new Date(0).toISOString(),
    candidateIndex: 2,
    candidateCount: 3,
    attempt: 2,
  }) === 'Reparando la propuesta 2 de 3…',
);
check(
  'el progreso de cancelación es explícito',
  directorProgress.describeDirectorProgress({
    version: 1,
    state: 'cancelling',
    stage: 'cancelling',
    updatedAt: new Date(0).toISOString(),
  }) === 'Cancelando el trabajo del Director…',
);

check(
  'el render expone disponibilidad y evita repetir una exportación vigente',
  appHtml.includes('id="render-readiness"')
    && directorPanelSource.includes("outputState === 'current'")
    && directorPanelSource.includes("label: 'Video actualizado'"),
);
check(
  'el Director presenta el recorrido numerado y una siguiente acción',
  appHtml.includes('id="director-next-step"')
    && directorPanelSource.includes('director-step-number')
    && directorPanelSource.includes('syncFlowGuidance'),
);
check(
  'Render enumera sus requisitos sin reemplazar la validación del motor',
  appHtml.includes('id="render-requirements"')
    && directorPanelSource.includes('describeRenderRequirements')
    && directorPanelSource.includes('store?.validate()'),
);
check(
  'la timeline solo transporta el render correspondiente a la edición actual',
  timelineSource.includes('currentEditorOutput()')
    && timelineSource.includes('el MP4 anterior quedó fuera del transporte'),
);

// ---- director/navigation.ts: recorrido inicial y modo de ajustes ----
let directorState = directorNavigation.createDirectorNavigation(false);
let directorPages = directorNavigation.describeDirectorPages(directorState);
check('un proyecto vacío inicia en Idea', directorState.mode === 'creation' && directorState.page === 'command');
check('Propuesta está deshabilitada antes de generar', directorPages.find((page) => page.page === 'project')?.enabled === false);
directorState = directorNavigation.updateDirectorNavigation(directorState, { type: 'proposal-created' });
check('generar abre la Propuesta sin salir del recorrido inicial', directorState.mode === 'creation' && directorState.page === 'project');
directorState = directorNavigation.updateDirectorNavigation(directorState, { type: 'render-opened' });
check('iniciar el render abre su subpágina', directorState.page === 'render');
directorState = directorNavigation.updateDirectorNavigation(directorState, { type: 'render-completed' });
directorPages = directorNavigation.describeDirectorPages(directorState);
check('el primer render convierte el recorrido en edición', directorState.mode === 'editing' && directorState.page === 'render');
check('la primera subpágina pasa a Ajustar con IA', directorPages.find((page) => page.page === 'command')?.label === 'Ajustar con IA');
directorState = directorNavigation.updateDirectorNavigation(directorState, { type: 'ai-change-applied' });
check('un ajuste aplicado abre Estado actual', directorState.mode === 'editing' && directorState.page === 'project');
check('un proyecto abierto inicia directamente en ajustes', directorNavigation.createDirectorNavigation(true).mode === 'editing');
const unavailableProjectState = directorNavigation.updateDirectorNavigation(
  { mode: 'creation', page: 'project', projectAvailable: true },
  { type: 'project-availability-changed', available: false },
);
check('si deja de haber contenido vuelve a Idea', unavailableProjectState.page === 'command');

// ---- director/flow-guidance.ts: siguiente acción y requisitos de U1 ----
const baseFlow = {
  mode: 'editing',
  page: 'command',
  projectAvailable: true,
  validationError: null,
  workspaceMode: 'editor',
  healthChecked: true,
  directorReady: true,
  renderReady: true,
  outputState: 'missing',
  busyMode: null,
};
check(
  'un proyecto válido sin MP4 orienta hacia Render',
  directorFlow.describeDirectorFlow(baseFlow).action?.id === 'render',
);
check(
  'los cambios posteriores al MP4 piden actualizarlo',
  directorFlow.describeDirectorFlow({ ...baseFlow, outputState: 'stale' }).title === 'Actualizá el video',
);
check(
  'un MP4 vigente cierra el recorrido sin CTA redundante',
  directorFlow.describeDirectorFlow({ ...baseFlow, outputState: 'current' }).action === null,
);
const invalidFlow = directorFlow.describeDirectorFlow({
  ...baseFlow,
  page: 'render',
  validationError: 'La escena 1 necesita dos turnos.',
});
check(
  'un proyecto inválido lleva a la revisión y conserva el error concreto',
  invalidFlow.action?.id === 'project' && invalidFlow.detail.includes('dos turnos'),
);
check(
  'el modo Creador ofrece volver directamente al Editor',
  directorFlow.describeDirectorFlow({ ...baseFlow, workspaceMode: 'creator' }).action?.id === 'editor',
);
check(
  'sin contenido y sin Ollama el primer paso abre el diagnóstico',
  directorFlow.describeDirectorFlow({
    ...baseFlow,
    mode: 'creation',
    projectAvailable: false,
    directorReady: false,
  }).action?.id === 'health',
);
check(
  'la generación IA en curso reemplaza la orientación por un estado temporal',
  directorFlow.describeDirectorFlow({ ...baseFlow, busyMode: 'ai' }).eyebrow === 'En curso',
);
const renderRequirements = directorFlow.describeRenderRequirements(baseFlow);
check(
  'un proyecto renderizable completa los cuatro requisitos',
  renderRequirements.length === 4 && renderRequirements.every((requirement) => requirement.state === 'complete'),
);
check(
  'Piper pendiente no se presenta como fallo',
  directorFlow.describeRenderRequirements({
    ...baseFlow,
    healthChecked: false,
    renderReady: false,
  }).find((requirement) => requirement.id === 'voice')?.state === 'pending',
);
check(
  'Piper ausente bloquea solo el requisito de voces',
  directorFlow.describeRenderRequirements({
    ...baseFlow,
    renderReady: false,
  }).filter((requirement) => requirement.state === 'blocked').map((requirement) => requirement.id).join(',') === 'voice',
);

// ---- editor-workspace.ts: máquina de estados modo/superficie/vigencia ----
const video = fakeVideo();
workspace.bindEditorMedia(video);
let snap = workspace.editorWorkspace();
check('inicia en editor/canvas', snap.mode === 'editor' && snap.surface === 'canvas');
check('sin proyecto ni salida al inicio', snap.activeProjectId === null && snap.output === null);

workspace.setActiveEditorProject('proyecto-1', 'snapshot-a');
check('registra el proyecto activo', workspace.editorWorkspace().activeProjectId === 'proyecto-1');

workspace.registerRenderedOutput({
  projectId: 'proyecto-1',
  url: 'blob:video-1',
  downloadName: 'proyecto-1.mp4',
  timeline: { durationSeconds: 12.5, scenes: [] },
  projectRevision: 'snapshot-a',
  current: true,
  reveal: true,
});
snap = workspace.editorWorkspace();
check('una salida vigente y revelada muestra playback', snap.surface === 'playback' && snap.output.stale === false);
check('la duración medida tiene prioridad', snap.duration === 12.5);

workspace.syncActiveEditorProject('proyecto-1', 'snapshot-b');
snap = workspace.editorWorkspace();
check('editar el proyecto activo marca la salida vencida', snap.output.stale === true);
check('una salida vencida vuelve al lienzo', snap.surface === 'canvas');
await workspace.showRenderedPlayback();
check('el transporte no reproduce una salida vencida', workspace.editorWorkspace().surface === 'canvas' && video.paused === true);
check('una salida vencida no cuenta como render actual', workspace.currentEditorOutput() === null && workspace.editorOutputState() === 'stale');

workspace.syncActiveEditorProject('proyecto-1', 'snapshot-a');
check('deshacer hasta la revisión renderizada recupera su vigencia', workspace.editorOutputState() === 'current');

workspace.registerRenderedOutput({
  projectId: 'proyecto-1',
  url: 'blob:video-2',
  downloadName: 'proyecto-1.mp4',
  timeline: null,
  projectRevision: 'snapshot-a',
  current: true,
});
workspace.setActiveEditorProject('proyecto-2', 'snapshot-otro');
check('cambiar de proyecto activo vence la salida', workspace.editorWorkspace().output.stale === true);

workspace.showWorkspaceMode('creator');
snap = workspace.editorWorkspace();
check('el modo creador fuerza lienzo y pausa el medio', snap.mode === 'creator' && snap.surface === 'canvas' && video.paused === true);
check('cada transición notifica por evento', dispatched.length > 0);

// ---- editor-workspace.ts: medir y reproducir son cosas distintas (Fase 4) ----
{
  workspace.setActiveEditorProject('proyecto-3', 'rev-1', 'timing-1');
  workspace.registerRenderedOutput({
    projectId: 'proyecto-3',
    url: 'blob:video-3',
    downloadName: 'proyecto-3.mp4',
    timeline: { durationSeconds: 9, scenes: [{ id: 'escena-1', startSeconds: 0, endSeconds: 9 }] },
    projectRevision: 'rev-1',
    timingRevision: 'timing-1',
    current: true,
  });
  check('con el render vigente hay medición', workspace.measuredTimelineFor(['escena-1'])?.durationSeconds === 9);

  workspace.syncActiveEditorProject('proyecto-3', 'rev-2', 'timing-1');
  check('una edición visual vence el MP4', workspace.editorOutputState() === 'stale' && workspace.currentEditorOutput() === null);
  check('pero la medición del audio sigue valiendo', workspace.measuredTimelineFor(['escena-1'])?.durationSeconds === 9);

  workspace.syncActiveEditorProject('proyecto-3', 'rev-3', 'timing-2');
  check('cambiar algo que mueve un tiempo sí descarta la medición', workspace.measuredTimelineFor(['escena-1']) === null);

  workspace.syncActiveEditorProject('proyecto-3', 'rev-1', 'timing-1');
  check(
    'volver a la revisión renderizada recupera medición y transporte',
    workspace.editorOutputState() === 'current' && workspace.measuredTimelineFor(['escena-1']) !== null,
  );
  check('una lista de escenas distinta nunca se mide con esta medición', workspace.measuredTimelineFor(['otra-escena']) === null);

  // Un render sin revisión de tiempo (sesión anterior) vuelve a la regla estricta.
  workspace.registerRenderedOutput({
    projectId: 'proyecto-3',
    url: 'blob:video-4',
    downloadName: 'proyecto-3.mp4',
    timeline: { durationSeconds: 9, scenes: [{ id: 'escena-1', startSeconds: 0, endSeconds: 9 }] },
    projectRevision: 'rev-1',
    current: true,
  });
  workspace.syncActiveEditorProject('proyecto-3', 'rev-2', 'timing-1');
  check('sin revisión de tiempo no se supone una medición ajena', workspace.measuredTimelineFor(['escena-1']) === null);
}

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

// ---- timeline-geometry.ts: casillas del filmstrip (A2) ----
check('sin casillas no hay tiempos', geometry.filmstripTimes(0, 4, 0).length === 0);
check('sin rango no hay tiempos', geometry.filmstripTimes(2, 2, 3).length === 0);
const strip = geometry.filmstripTimes(0, 4, 2);
check('los tiempos caen en el centro de cada casilla', strip.length === 2 && strip[0] === 1 && strip[1] === 3);
check('los tiempos quedan dentro del rango', geometry.filmstripTimes(1, 5, 4).every((time) => time > 1 && time < 5));

// ---- timeline-geometry.ts: snap del arrastre de pausas (B2) ----
check('el snap redondea al paso', geometry.snapSeconds(0.43, 0.1, 0, 2) === 0.4);
check('el snap sube al paso más cercano', geometry.snapSeconds(0.46, 0.1, 0, 2) === 0.5);
check('el snap acota al mínimo', geometry.snapSeconds(-1, 0.1, 0, 2) === 0);
check('el snap acota al máximo', geometry.snapSeconds(9, 0.1, 0, 2) === 2);

// ---- timeline-geometry.ts: estimación aproximada de duración (C1) ----
check('la estimación suma habla y pausas', geometry.estimateDurationSeconds([5, 5], [0.5], 2.5) === 4.5);
check('sin turnos la estimación es cero', geometry.estimateDurationSeconds([], [], 2.5) === 0);
check('borrar un turno reduce la estimación', geometry.estimateDurationSeconds([5], [0], 2.5) < geometry.estimateDurationSeconds([5, 5], [0], 2.5));
check('reducir la pausa reduce la estimación', geometry.estimateDurationSeconds([4], [0.2], 2.5) < geometry.estimateDurationSeconds([4], [1], 2.5));

// ---- timeline-geometry.ts: geometría de clip por tiempos medidos (D1 consumo UI) ----
const rect = geometry.turnClipRect(2, 1.5, 60, 4);
check('el clip medido arranca en start * pps', rect.left === 120);
check('el ancho del clip medido es duración * pps', rect.width === 90);
check('un turno muy corto respeta el ancho mínimo', geometry.turnClipRect(0, 0.01, 60, 4).width === 4);

// ---- timeline-animation.ts: fila «Animación» y ficha de keyframe (Fase 4) ----
{
  const dialogue = [
    { id: 't1', text: 'Hoy vemos un dato' },
    { id: 't2', text: 'Y ahora el dato' },
  ];
  const reference = animation.sceneAnimationReference(dialogue);
  check('el conteo de palabras usa el criterio del editor de autoría', reference.turns[0].wordCount === 4);

  const measuredScene = {
    startSeconds: 0,
    endSeconds: 6.4,
    turns: [
      { id: 't1', startSeconds: 0, endSeconds: 2.133, durationSeconds: 2.133 },
      { id: 't2', startSeconds: 2.133, endSeconds: 4.933, durationSeconds: 2.8 },
    ],
  };
  const timing = animation.sceneAnimationTiming(measuredScene, reference);
  check('sin render vigente no hay timing', animation.sceneAnimationTiming(null, reference) === null);
  check('el timing toma el conteo de palabras del guion', timing.turns[1].wordCount === 4);

  const tracks = [{
    parameterId: 'position.x',
    source: { kind: 'preset', presetId: 'enter-left', version: 1, customized: false },
    keyframes: [
      { id: 'kf-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: -100, interpolation: 'ease' },
      { id: 'kf-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0.6, value: 320, interpolation: 'hold' },
    ],
  }];
  const [lane] = animation.buildAnimationLanes('e1', tracks, { timing, reference, fps: 30 });
  check('la pista se rotula con su parámetro y su procedencia', lane.label === 'Posición X' && lane.sourceLabel === 'enter-left');
  check('el keyframe resuelve a segundos y a frame de escena', lane.keyframes[1].seconds === 0.6 && lane.keyframes[1].sceneFrameIndex === 18);
  check('el tramo hereda la interpolación del keyframe del que sale', lane.segments.length === 1 && lane.segments[0].interpolation === 'ease');
  check('el último keyframe queda marcado para exigirle hold', lane.keyframes[1].isLast === true && lane.keyframes[0].isLast === false);
  check('un keyframe resuelto no tiene nada que revisar', lane.keyframes.every((keyframe) => keyframe.status === 'ok') && lane.reviewCount === 0);

  const unmeasured = animation.buildAnimationLanes('e1', tracks, { timing: null, reference, fps: 30 })[0];
  check(
    'sin medición no se inventa una posición para el keyframe',
    unmeasured.keyframes.every((keyframe) => keyframe.seconds === null && keyframe.status === 'unmeasured')
      && unmeasured.segments.length === 0,
  );
  check('sin medición el tiempo resuelto lo dice, no muestra un número', unmeasured.keyframes[0].timeLabel === 'pendiente de voz');

  const broken = [{
    parameterId: 'opacity',
    source: { kind: 'manual' },
    keyframes: [
      { id: 'a', anchor: { kind: 'word', turnId: 't2', wordIndex: 9 }, offsetSeconds: 0, value: 0, interpolation: 'linear' },
      { id: 'b', anchor: { kind: 'turn', turnId: 'inexistente', edge: 'start' }, offsetSeconds: 0, value: 1, interpolation: 'hold' },
    ],
  }];
  const brokenLane = animation.buildAnimationLanes('e1', broken, { timing, reference, fps: 30 })[0];
  check('una palabra que ya no existe se marca para revisión', brokenLane.keyframes[0].status === 'review');
  check('un turno que desapareció también se marca', brokenLane.keyframes[1].status === 'review' && brokenLane.reviewCount === 2);
  check('el mensaje de revisión es el del contrato, no uno inventado', brokenLane.keyframes[1].message.includes('inexistente'));
  check('la insignia del elemento cuenta las referencias pendientes', animation.countAnchorsRequiringReview('e1', broken, reference) === 2);

  const outside = [{
    parameterId: 'opacity',
    source: { kind: 'manual' },
    keyframes: [
      { id: 'a', anchor: { kind: 'scene', edge: 'end' }, offsetSeconds: 0, value: 1, interpolation: 'linear' },
      { id: 'b', anchor: { kind: 'scene', edge: 'end' }, offsetSeconds: 2, value: 0, interpolation: 'hold' },
    ],
  }];
  const outsideLane = animation.buildAnimationLanes('e1', outside, { timing, reference, fps: 30 })[0];
  check('un keyframe que cae fuera de la escena es un error visible', outsideLane.keyframes.some((keyframe) => keyframe.status === 'out-of-scene'));

  check('el desplazamiento del arrastre se ajusta al frame', animation.offsetForSeconds(2, 2.04, 30) === 0.0333);
  check('el desplazamiento nunca supera el límite del contrato', animation.offsetForSeconds(0, 30, 30) === 5);
  check('el teclado corre el keyframe un frame exacto', animation.nudgeOffsetSeconds(0, 1, 30) === 0.0333);
  check('el teclado tampoco puede pasarse del límite', animation.nudgeOffsetSeconds(4.9, 30, 30) === 5);

  const proposal = animation.nearestAnchorFor(2.2, timing, 30);
  check('reanclar elige el borde semántico más cercano', proposal.anchor.kind === 'turn' && proposal.anchor.turnId === 't1' && proposal.anchor.edge === 'end');
  check('reanclar conserva el instante con un desplazamiento chico', proposal.offsetSeconds === 0.0667);
  check('el inicio de la escena gana cuando el instante está al principio', animation.nearestAnchorFor(0.05, timing, 30).anchor.kind === 'scene');

  check('el valor se muestra con la unidad de su parámetro', animation.formatParameterValue('scale', 1.14) === '1.14×' && animation.formatParameterValue('position.x', 320) === '320 px');
  check('una pista editada a mano lo declara en su procedencia', animation.trackSourceLabel({ kind: 'preset', presetId: 'enter-left', version: 1, customized: true }) === 'enter-left · editado');
  check('los ids de keyframe nuevos no pisan a los existentes', animation.nextKeyframeId('position.x', ['kf-position-x-01']) === 'kf-position-x-02');
  check(
    'los rigs v3 ofrecen articulación y rotación; los v2 conservan el conjunto FFmpeg',
    animation.listAnimatableParameters(['armRaise']).includes('armRaise')
      && animation.listAnimatableParameters(['armRaise']).includes('rotationDegrees')
      && !animation.listAnimatableParameters([]).includes('rotationDegrees')
      && animation.listAnimatableParameters([]).join(',') === 'position.x,position.y,scale,opacity'
      && animation.listAnimatableParameters([], 'prop').join(',') === 'position.x,position.y,scale,rotationDegrees,opacity',
  );
  check('el valor se acota al rango del parámetro antes de mandarlo al motor', animation.clampParameterValue('opacity', 2) === 1);
  check('la base de un parámetro sale del transform del elemento', animation.baseValueForParameter('scale', { x: 0, y: 0, scale: 0.75, rotationDegrees: 0, opacity: 1 }) === 0.75);

  // ---- vista previa en el cabezal ----
  check('antes del primer keyframe se sostiene su valor', animation.evaluateLanesAt([lane], 0)['position.x'] === -100);
  check('después del último el valor queda congelado', animation.evaluateLanesAt([lane], 5)['position.x'] === 320);
  check('en el medio interpola', animation.evaluateLanesAt([lane], 0.3)['position.x'] > -100 && animation.evaluateLanesAt([lane], 0.3)['position.x'] < 320);
  check('una pista sin resolver no se evalúa: se prefiere la base', Object.keys(animation.evaluateLanesAt([unmeasured], 1)).length === 0);
  const constantOpacity = animation.buildAnimationLanes('e1', [{
    parameterId: 'opacity',
    source: { kind: 'manual' },
    keyframes: [
      { id: 'opacity-start', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0.35, interpolation: 'linear' },
      { id: 'opacity-end', anchor: { kind: 'scene', edge: 'end' }, offsetSeconds: 0, value: 0.35, interpolation: 'hold' },
    ],
  }], { timing: null, reference, fps: 30 })[0];
  check(
    'una opacidad constante sí se previsualiza aunque la escena todavía no esté medida',
    animation.evaluateLanesAt([constantOpacity], 1).opacity === 0.35,
  );

  // ---- modo animación del lienzo: mover escribe keyframes, no la base ----
  const commandFor = (extra) => animation.keyframeCommandsForValue({
    sceneId: 'escena-1',
    elementId: 'e1',
    parameterId: 'position.x',
    value: 500,
    playheadSeconds: 2.2,
    lane: null,
    timing,
    fps: 30,
    baseValue: 290,
    takenKeyframeIds: [],
    ...extra,
  });

  const created = commandFor({})[0];
  check('sin pista, la pista nace con los dos keyframes que el contrato exige', created.type === 'create-track' && created.keyframes.length === 2);
  check('el primero conserva la base al inicio de la escena', created.keyframes[0].value === 290 && created.keyframes[0].anchor.kind === 'scene');
  check('el segundo lleva el valor nuevo al cabezal y cierra en hold', created.keyframes[1].value === 500 && created.keyframes[1].interpolation === 'hold');
  check('la pista nueva es manual, no de preset', created.source.kind === 'manual');

  const atSceneStart = commandFor({ playheadSeconds: 0 })[0];
  check(
    'con el cabezal sobre el ancla los dos keyframes no colisionan',
    atSceneStart.keyframes[0].offsetSeconds !== atSceneStart.keyframes[1].offsetSeconds,
  );

  const added = commandFor({ lane })[0];
  check('con la pista ya creada solo se agrega un keyframe', added.type === 'add-keyframe' && added.value === 500);

  const updated = commandFor({ lane, playheadSeconds: 0.6 })[0];
  check('sobre un keyframe existente se cambia su valor, no se duplica', updated.type === 'set-keyframe' && updated.keyframeId === 'kf-2');
  check('mover al mismo valor no genera comando', commandFor({ lane, playheadSeconds: 0.6, value: 320 }).length === 0);
  check('el valor se acota al rango antes de mandarlo', commandFor({ lane, value: 99999 })[0].value === 2160);
}

// ---- notifications-queue.ts: cola de notificaciones transitorias (M1) ----
{
  const { createNotificationQueue, pushNotification, dismissNotification, isPersistent, MAX_VISIBLE } = notificationsQueue;
  const empty = createNotificationQueue();
  check('la cola nace vacía', empty.items.length === 0);

  const first = pushNotification(empty, { message: 'Guardado' });
  check('encolar agrega la notificación', first.state.items.length === 1 && first.notification.message === 'Guardado');
  check('el nivel por omisión es informativo', first.notification.level === 'info');
  check('encolar no muta el estado anterior', empty.items.length === 0);
  check('los ids no se repiten', pushNotification(first.state, { message: 'B' }).notification.id !== first.notification.id);

  check('los errores no se autodescartan', isPersistent(pushNotification(empty, { message: 'X', level: 'error' }).notification));
  check('la información sí se autodescarta', !isPersistent(pushNotification(empty, { message: 'X' }).notification));
  check(
    'una duración explícita gana sobre la del nivel',
    pushNotification(empty, { message: 'X', level: 'error', durationMs: 1000 }).notification.durationMs === 1000,
  );

  let overflow = createNotificationQueue();
  for (let i = 0; i < MAX_VISIBLE + 3; i += 1) overflow = pushNotification(overflow, { message: `n${i}` }).state;
  check('la cola no supera el máximo visible', overflow.items.length === MAX_VISIBLE);
  check('al desbordar sobrevive la más reciente', overflow.items[overflow.items.length - 1].message === `n${MAX_VISIBLE + 2}`);
  check('al desbordar se descarta la más vieja', !overflow.items.some((item) => item.message === 'n0'));

  const keyed = pushNotification(pushNotification(empty, { message: 'Render 10%', dedupeKey: 'render' }).state, {
    message: 'Render 80%',
    dedupeKey: 'render',
  });
  check('una clave repetida reemplaza en vez de apilar', keyed.state.items.length === 1);
  check('la clave repetida conserva el mensaje nuevo', keyed.state.items[0].message === 'Render 80%');

  const dismissed = dismissNotification(first.state, first.notification.id);
  check('descartar quita la notificación', dismissed.items.length === 0);
  check('descartar un id inexistente no cambia el estado', dismissNotification(first.state, 999) === first.state);
}

// ---- quality-copy.ts: reporte de calidad legible (E1) ----
{
  const { summarizeQuality, describeRepairs, issueLabel } = qualityCopy;
  check('sin reporte no hay tarjeta de calidad', summarizeQuality(undefined) === null);

  const passing = summarizeQuality({ version: 1, score: 84, floor: 70, passed: true, issues: [], metrics: {} });
  check('el score se muestra sobre 100, como lo calcula el motor', passing.headline.includes('84 sobre 100'));
  check('el titular nombra el piso de calidad', passing.headline.includes('70'));
  check('una propuesta que pasa lo dice', passing.passed && passing.headline.includes('supera'));

  const failing = summarizeQuality({
    version: 1,
    score: 61,
    floor: 70,
    passed: false,
    issues: [
      { code: 'WEAK_HOOK', penalty: 9, instruction: 'El gancho inicial es demasiado corto.' },
      { code: 'LOW_RELEVANCE', penalty: 24, instruction: 'El guion no conserva los conceptos.' },
    ],
    metrics: {},
  });
  check('una propuesta por debajo del piso lo dice', !failing.passed && failing.headline.includes('por debajo'));
  check('los issues se ordenan por penalización', failing.issues[0].code === 'LOW_RELEVANCE');
  check('cada issue conserva la instrucción del motor', failing.issues[0].instruction === 'El guion no conserva los conceptos.');
  check('los códigos conocidos se traducen', failing.issues[1].label === 'Gancho inicial corto');
  check('un código desconocido se muestra legible, no se oculta', issueLabel('COSA_RARA') === 'cosa rara');

  check('sin reparaciones no se menciona reparación', describeRepairs(0) === null && describeRepairs(undefined) === null);
  check('una reparación se narra en singular', describeRepairs(1).includes('una vez'));
  check('varias reparaciones se narran en plural', describeRepairs(3).includes('3 veces'));
}

// ---- health-copy.ts: diagnóstico del servicio local (E3) ----
{
  const { summarizeHealth } = healthCopy;
  const healthy = summarizeHealth({
    version: 1,
    ready: true,
    ollama: { available: true, modelInstalled: true, model: 'qwen3:8b', version: '0.5.1', digest: 'sha256:abcdef1234567890' },
    tts: { available: true },
    renderBusy: false,
  });
  check('con todo disponible el sistema está listo', healthy.ready && healthy.badge === 'Listo');
  check('se listan las tres dependencias', healthy.dependencies.length === 3);
  check('nada pendiente no sugiere acciones', healthy.dependencies.every((item) => item.action === null));
  check('la identidad del modelo queda visible', healthy.modelIdentity.includes('qwen3:8b'));

  const noModel = summarizeHealth({
    version: 1,
    ready: false,
    ollama: { available: true, modelInstalled: false, model: 'qwen3:8b' },
    tts: { available: true },
    renderBusy: false,
  });
  check('falta de modelo no se reporta como listo', !noModel.ready);
  check('el badge nombra la dependencia que falta', noModel.badge === 'Falta Ollama');
  check('falta de modelo sugiere el pull concreto', noModel.dependencies[0].action.includes('ollama pull qwen3:8b'));

  const down = summarizeHealth({
    version: 1,
    ready: false,
    ollama: { available: false, modelInstalled: false, error: { message: 'No responde.', suggestedAction: 'Iniciá Ollama.' } },
    tts: { available: false },
    renderBusy: true,
  });
  check('se respeta la acción sugerida que ya trae la API', down.dependencies[0].action === 'Iniciá Ollama.');
  check('con dos dependencias caídas el badge pide revisar', down.badge === 'Revisar');
  check('un render en curso avisa sin ser error', down.dependencies[2].state === 'warn');
  check('sin modelo conocido no se inventa identidad', down.modelIdentity === null);
}

// ---- edit-proposal.ts: explicación visible antes de aplicar una edición IA ----
{
  const confirmation = editProposal.formatDirectorEditConfirmation({
    summary: 'El Director propone 2 cambios.',
    changes: [
      'Aplicar «Aparecer» al personaje en la escena 1.',
      'Cambiar el primer diálogo.',
    ],
    customizedTrackRemovalIndexes: [],
  });
  check('la propuesta explica cada cambio antes de pedir aprobación',
    confirmation.includes('• Aplicar «Aparecer»')
      && confirmation.includes('• Cambiar el primer diálogo.')
      && confirmation.includes('El proyecto todavía no fue modificado.')
      && confirmation.endsWith('¿Querés aplicar estos cambios?'));

  const protectedExplanation = {
    summary: 'El Director propone 2 cambios.',
    changes: ['Cambiar un diálogo.', 'Quitar la escala personalizada.'],
    customizedTrackRemovalIndexes: [1],
  };
  const protectedConfirmation = editProposal.formatCustomizedRemovalConfirmation(protectedExplanation);
  check('la eliminación personalizada exige una advertencia específica',
    protectedConfirmation.includes('• Quitar la escala personalizada.')
      && !protectedConfirmation.includes('• Cambiar un diálogo.')
      && protectedConfirmation.endsWith('¿Confirmás la eliminación personalizada?'));
  const authorized = editProposal.authorizeCustomizedRemovals([
    { type: 'set-dialogue-turn', sceneId: 's1', turnId: 't1', text: 'Nuevo' },
    { type: 'remove-animation', sceneId: 's1', elementId: 'e1', parameterId: 'scale' },
  ], [1]);
  check('solo la UI añade confirmación al remove-animation aprobado',
    !Object.hasOwn(authorized[0], 'confirmCustomized')
      && authorized[1].confirmCustomized === true);
}

// ---- command-labels.ts: qué cambió tras una edición IA (C3) y undo narrado (U1) ----
{
  const { describeCommand, describeCommands, summarizeCommands } = commandLabels;
  const context = { sceneIds: ['s1', 's2', 's3'] };
  check('un comando conocido se narra en lenguaje de usuario', describeCommand({ type: 'add-scene' }) === 'Agregó una escena');
  check(
    'el id de escena se traduce a su número',
    describeCommand({ type: 'set-dialogue-turn', sceneId: 's2' }, context) === 'Cambió un diálogo de la escena 2',
  );
  check(
    'sin contexto la escena no se inventa',
    describeCommand({ type: 'set-dialogue-turn', sceneId: 's2' }) === 'Cambió un diálogo de una escena',
  );
  check(
    'las ediciones de animación se narran con el parámetro en lenguaje de usuario',
    describeCommand({ type: 'set-keyframe', sceneId: 's2', parameterId: 'position.x' }, context)
      === 'Ajustó un keyframe de la posición horizontal en la escena 2'
      && describeCommand({ type: 'delete-track', sceneId: 's1', parameterId: 'armRaise' }, context)
        === 'Quitó la animación del brazo derecho en la escena 1'
      && describeCommand({ type: 'remove-animation', sceneId: 's1', parameterId: 'opacity' }, context)
        === 'Quitó la animación de la opacidad en la escena 1',
  );
  check(
    'aplicar un preset dice cuál, para que el usuario sepa qué deshace',
    describeCommand({ type: 'apply-animation-preset', sceneId: 's1', presetId: 'enter-left' }, context)
      === 'Aplicó «enter-left» a un personaje de la escena 1',
  );
  check(
    'una escena ajena al proyecto no se numera',
    describeCommand({ type: 'delete-scene', sceneId: 'otra' }, context) === 'Eliminó una escena',
  );
  check('un comando no mapeado degrada a texto legible, no a texto falso', describeCommand({ type: 'nuevo-comando' }) === 'Aplicó nuevo comando');
  check('un comando sin tipo no rompe', describeCommand({}) === 'Aplicó un cambio');

  const repeated = describeCommands(
    [
      { type: 'set-dialogue-turn', sceneId: 's1' },
      { type: 'set-dialogue-turn', sceneId: 's1' },
      { type: 'set-transition', sceneId: 's1' },
    ],
    context,
  );
  check('los cambios repetidos se agrupan con su cuenta', repeated[0] === 'Cambió un diálogo de la escena 1 (×2)');
  check('los cambios distintos se listan aparte', repeated.length === 2);

  const many = describeCommands(
    ['s1', 's2', 's3', 's1', 's2'].map((sceneId, index) => ({ type: index % 2 ? 'set-scene-title' : 'set-transition', sceneId })),
    context,
    2,
  );
  check('una lista larga se recorta con un resumen del resto', many.length === 3 && many[2].includes('más'));

  check('sin comandos se dice que no hubo cambios', summarizeCommands([]).includes('no encontró cambios'));
  check(
    'el resumen une los cambios en una línea',
    summarizeCommands([{ type: 'add-scene' }, { type: 'reorder-scenes' }], context) === 'Agregó una escena · Reordenó las escenas',
  );
}

// ---- candidates-copy.ts: comparación de candidatos (E2a) ----
{
  const { compareCandidates, strongestCriterion } = candidatesCopy;
  const scoreOf = (base) => ({
    relevance: base, hook: base, naturalness: base, progression: base,
    ending: base, tone: base, tts: base, audiovisual: base,
  });
  check('sin scores no hay comparación', compareCandidates({ bestOf: 1, winnerIndex: 0, judgeVersion: 1, scores: null }) === null);
  check(
    'con un solo candidato no hay nada que comparar',
    compareCandidates({ bestOf: 1, winnerIndex: 0, judgeVersion: 1, scores: [scoreOf(7)] }) === null,
  );

  const comparison = compareCandidates({
    bestOf: 2,
    winnerIndex: 1,
    judgeVersion: 1,
    scores: [scoreOf(6), { ...scoreOf(7), hook: 9 }],
    totals: [48, 58],
  });
  check('se comparan los ocho criterios del juez', comparison.criteria.length === 8);
  check('el ganador queda marcado', comparison.rows[1].winner && !comparison.rows[0].winner);
  check('el veredicto explica el margen', comparison.verdict.includes('10'));
  check('el criterio más fuerte del ganador se identifica', strongestCriterion(comparison) === 'Gancho');

  const tie = compareCandidates({
    bestOf: 2, winnerIndex: 0, judgeVersion: 1, scores: [scoreOf(7), scoreOf(7)], totals: [56, 56],
  });
  check('un empate se nombra como desempate', tie.verdict.includes('desempate'));
  check('sin totales no se inventa veredicto',
    compareCandidates({ bestOf: 2, winnerIndex: 0, judgeVersion: 1, scores: [scoreOf(7), scoreOf(6)], totals: null }).verdict === null);
}

// ---- command-registry.ts: búsqueda de la paleta de comandos (M2) ----
{
  const { fuzzyMatch, filterActions, groupActions, isAvailable } = commandRegistry;
  check('una subsecuencia en orden coincide', fuzzyMatch('Nuevo proyecto', 'np') !== null);
  check('un carácter ausente no coincide', fuzzyMatch('Nuevo proyecto', 'xyz') === null);
  check('el orden importa', fuzzyMatch('Nuevo proyecto', 'pn') === null);
  check('una consulta vacía coincide con todo', fuzzyMatch('lo que sea', '').score === 0);
  check(
    'el comienzo de palabra puntúa más que el medio',
    fuzzyMatch('Nuevo proyecto', 'pro').score > fuzzyMatch('Comprobar', 'pro').score,
  );

  const acciones = [
    { id: 'a', label: 'Renderizar video', group: 'Director', run: () => {} },
    { id: 'b', label: 'Reproducir o pausar', group: 'Timeline', run: () => {} },
    { id: 'c', label: 'Abrir configuración', group: 'Aplicación', keywords: ['tema'], run: () => {} },
    { id: 'd', label: 'Deshacer', group: 'Timeline', unavailableReason: 'No hay nada que deshacer.', run: () => {} },
  ];
  check('sin consulta se listan todas las acciones', filterActions(acciones, '').length === 4);
  check('la consulta filtra por etiqueta', filterActions(acciones, 'render').every((item) => item.action.id === 'a'));
  check('una palabra clave encuentra la acción sin figurar en la etiqueta',
    filterActions(acciones, 'tema').some((item) => item.action.id === 'c'));

  const conNoDisponible = filterActions(acciones, 'e');
  check('una acción no disponible sigue apareciendo', conNoDisponible.some((item) => item.action.id === 'd'));
  check(
    'las acciones disponibles se ordenan antes que las no disponibles',
    conNoDisponible.findIndex((item) => !isAvailable(item.action)) === conNoDisponible.length - 1,
  );
  check('una acción sin motivo está disponible', isAvailable(acciones[0]) && !isAvailable(acciones[3]));

  const grupos = groupActions(filterActions(acciones, ''));
  check('las acciones se agrupan', grupos.length === 3);
  check('el grupo conserva el orden de aparición', grupos[0].group === 'Director');
  check('cada grupo lleva sus acciones', grupos[1].group === 'Timeline' && grupos[1].items.length === 2);
}

// ---- store.ts: etiquetas de undo/redo (U1) ----
{
  const base = storeModule.createStore(engine.createProjectEditor(project, catalog));
  check('sin ediciones no hay nada que deshacer', base.pendingUndoLabel() === null);
  const scene = base.project().scenes[0];
  base.dispatch({ type: 'set-scene-title', sceneId: scene.id, title: 'Otro nombre' });
  check('tras editar se sabe qué se desharía', base.pendingUndoLabel() === 'Renombró la escena 1');
  check('todavía no hay nada que rehacer', base.pendingRedoLabel() === null);
  base.undo();
  check('al deshacer, la etiqueta pasa al lado de rehacer', base.pendingRedoLabel() === 'Renombró la escena 1');
  check('sin más historial no se inventa una etiqueta de deshacer', base.pendingUndoLabel() === null);
  base.redo();
  check('al rehacer, la etiqueta vuelve al lado de deshacer', base.pendingUndoLabel() === 'Renombró la escena 1');
  base.dispatch({ type: 'set-scene-title', sceneId: scene.id, title: 'Tercero' });
  check('una edición nueva descarta la pila de rehacer', base.pendingRedoLabel() === null);

  const beforeBatch = structuredClone(base.project());
  const historyBeforeBatch = base.getState().past.length;
  base.dispatchBatch([
    { type: 'set-project-title', title: 'Lote del Director' },
    { type: 'set-scene-title', sceneId: scene.id, title: 'Escena por IA' },
  ]);
  check('el lote del Director ocupa un solo paso de historial', base.getState().past.length === historyBeforeBatch + 1);
  check('el lote lleva una sola etiqueta que resume sus comandos',
    base.pendingUndoLabel()?.includes('Cambió el título del proyecto') === true
      && base.pendingUndoLabel()?.includes('Renombró la escena 1') === true);
  base.undo();
  check('un solo undo revierte el lote completo', JSON.stringify(base.project()) === JSON.stringify(beforeBatch));
}

process.stdout.write(`${JSON.stringify({ version: 1, passed, failed: 0 })}\n`);
