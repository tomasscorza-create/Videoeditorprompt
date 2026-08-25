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
  'src/ui/project/video-template-catalog.ts',
  'src/ui/project/animation-sequence-catalog.ts',
  'src/ui/project/rig-preview.ts',
  'src/ui/project/editing-panel.ts',
  'src/ui/project/store.ts',
  'src/ui/timeline-geometry.ts',
  'src/ui/timeline-animation.ts',
  'src/ui/timeline-media-placement.ts',
  'src/ui/director/api.ts',
  'src/ui/director/preconfiguration-manager.ts',
  'src/ui/notifications.ts',
  'src/ui/director/progress-copy.ts',
  'src/ui/director/brief.ts',
  'src/ui/director/flow-state.ts',
  'src/ui/director/pending-edit.ts',
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
for (const name of [
  'project-editor.js',
  'animation-contract.js',
  'animation-presets.js',
  'animation-sequences.js',
  'animation-evaluator.js',
  'video-template-page.js',
  'video-template-definition.js',
  'project-fingerprint.js',
  'compositor-contract.js',
]) {
  copyFileSync(path.join(projectRoot, 'shared', name), path.join(outDir, 'shared', name));
}

const workspacePath = path.join(outDir, 'src', 'ui', 'editor-workspace.js');
const rightPanelPath = path.join(outDir, 'src', 'ui', 'right-panel.js');
const videoTemplateCatalogPath = path.join(outDir, 'src', 'ui', 'project', 'video-template-catalog.js');
const editingPanelPath = path.join(outDir, 'src', 'ui', 'project', 'editing-panel.js');
const rigPreviewPath = path.join(outDir, 'src', 'ui', 'project', 'rig-preview.js');
const layersPath = path.join(outDir, 'src', 'ui', 'project', 'layers.js');
const storePath = path.join(outDir, 'src', 'ui', 'project', 'store.js');
assert.equal(existsSync(workspacePath), true, 'editor-workspace.js no se compiló');
assert.equal(existsSync(rightPanelPath), true, 'right-panel.js no se compiló');
assert.equal(existsSync(videoTemplateCatalogPath), true, 'video-template-catalog.js no se compiló');
assert.equal(existsSync(editingPanelPath), true, 'editing-panel.js no se compiló');
assert.equal(existsSync(rigPreviewPath), true, 'rig-preview.js no se compiló');
assert.equal(existsSync(layersPath), true, 'layers.js no se compiló');
assert.equal(existsSync(storePath), true, 'store.js no se compiló');

// Stubs mínimos de DOM para editor-workspace (solo despacha CustomEvent sobre window).
if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  };
}
const dispatched = [];
globalThis.window = {
  dispatchEvent: (event) => { dispatched.push(event.type); return true; },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
};

function fakeVideo() {
  return {
    paused: true,
    muted: false,
    currentTime: 0,
    duration: 0,
    readyState: 4,
    ended: false,
    error: null,
    playCalls: 0,
    playFailures: 0,
    src: '',
    load() {},
    play() {
      this.playCalls += 1;
      if (this.playFailures > 0) {
        this.playFailures -= 1;
        return Promise.reject(new DOMException('Carga reemplazada', 'AbortError'));
      }
      this.paused = false;
      return Promise.resolve();
    },
    pause() { this.paused = true; },
    addEventListener() {},
  };
}

const geometryPath = path.join(outDir, 'src', 'ui', 'timeline-geometry.js');
const mediaPlacementPath = path.join(outDir, 'src', 'ui', 'timeline-media-placement.js');
const apiPath = path.join(outDir, 'src', 'ui', 'director', 'api.js');
const directorFlowPath = path.join(outDir, 'src', 'ui', 'director', 'flow-state.js');
const preconfigurationManagerPath = path.join(outDir, 'src', 'ui', 'director', 'preconfiguration-manager.js');
assert.equal(existsSync(geometryPath), true, 'timeline-geometry.js no se compiló');
assert.equal(existsSync(mediaPlacementPath), true, 'timeline-media-placement.js no se compiló');
assert.equal(existsSync(apiPath), true, 'director/api.js no se compiló');
assert.equal(existsSync(directorFlowPath), true, 'director/flow-state.js no se compiló');
assert.equal(existsSync(preconfigurationManagerPath), true, 'director/preconfiguration-manager.js no se compiló');

const workspace = await import(pathToFileURL(workspacePath).href);
const rightPanel = await import(pathToFileURL(rightPanelPath).href);
const videoTemplateCatalog = await import(pathToFileURL(videoTemplateCatalogPath).href);
const editingPanel = await import(pathToFileURL(editingPanelPath).href);
const rigPreview = await import(pathToFileURL(rigPreviewPath).href);
const layers = await import(pathToFileURL(layersPath).href);
const storeModule = await import(pathToFileURL(storePath).href);
const geometry = await import(pathToFileURL(geometryPath).href);
const mediaPlacement = await import(pathToFileURL(mediaPlacementPath).href);
const animation = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'timeline-animation.js')).href);
const directorApi = await import(pathToFileURL(apiPath).href);
const directorProgress = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'progress-copy.js')).href);
const directorBrief = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'brief.js')).href);
const directorFlow = await import(pathToFileURL(directorFlowPath).href);
const preconfigurationManager = await import(pathToFileURL(preconfigurationManagerPath).href);
const pendingDirectorEdit = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'pending-edit.js')).href);
const notificationsQueue = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'notifications-queue.js')).href);
const qualityCopy = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'quality-copy.js')).href);
const healthCopy = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'health-copy.js')).href);
const candidatesCopy = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'candidates-copy.js')).href);
const editProposal = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'director', 'edit-proposal.js')).href);
const commandLabels = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'command-labels.js')).href);
const commandRegistry = await import(pathToFileURL(path.join(outDir, 'src', 'ui', 'command-registry.js')).href);
const engine = await import(pathToFileURL(path.join(outDir, 'shared', 'project-editor.js')).href);
const fingerprint = await import(pathToFileURL(path.join(projectRoot, 'shared', 'project-fingerprint.js')).href);
const videoTemplateEvaluator = await import(pathToFileURL(path.join(projectRoot, 'shared', 'video-template-evaluator.js')).href);
const videoTemplateDefinition = await import(pathToFileURL(path.join(projectRoot, 'shared', 'video-template-definition.js')).href);

let passed = 0;
const check = (label, condition) => {
  assert.equal(condition, true, label);
  passed += 1;
};

// ---- timeline-media-placement.ts: un solo plan para picker, drop y reutilización ----
{
  const document = {
    version: 2,
    id: 'proyecto-medios-01',
    timebase: { ticksPerSecond: 48_000, fps: 30, audioSampleRate: 48_000 },
    sources: [],
    tracks: [
      { id: 'video-track-01', kind: 'visual', order: 0 },
      { id: 'video-track-02', kind: 'visual', order: 1 },
      { id: 'audio-track-01', kind: 'audio', order: 2 },
      { id: 'audio-track-02', kind: 'audio', order: 3 },
    ],
    clips: [],
  };
  const video = {
    id: 'media-aaaaaaaaaaaaaaaa', contentHash: 'a'.repeat(64), kind: 'video',
    name: 'Video prueba.mp4', durationTicks: 49_200, hasVideo: true, hasAudio: true,
  };
  const audio = {
    id: 'media-bbbbbbbbbbbbbbbb', contentHash: 'b'.repeat(64), kind: 'audio',
    name: 'Voz prueba.wav', durationTicks: 24_001, hasVideo: false, hasAudio: true,
  };
  const plan = mediaPlacement.planTimelineMediaInsertion(document, [video, audio]);
  const clips = plan.commands.filter((command) => command.type === 'add-clip').map((command) => command.clip);
  check('un video con audio crea clips A/V enlazados', clips.length === 3
    && clips[0].linkGroupId === clips[1].linkGroupId
    && clips[0].timelineStartTick === clips[1].timelineStartTick);
  check('los archivos de un mismo drop se agregan consecutivamente', clips[2].timelineStartTick === 48_000
    && plan.endTick === 72_001);
  check('el video se cuantiza a frames y el audio conserva precisión de muestra', clips[0].durationTicks === 48_000
    && clips[2].durationTicks === 24_001);
  const withSource = structuredClone(document);
  withSource.sources.push({ id: video.id, kind: 'video', durationTicks: video.durationTicks, contentHash: video.contentHash });
  const repeated = mediaPlacement.planTimelineMediaInsertion(withSource, [video]);
  check('reimportar reutiliza la fuente y crea otra instancia', repeated.commands.every((command) => command.type !== 'add-source')
    && repeated.clipIds.length === 2);
}

// ---- preconfiguration-manager.ts: autocompletado rápido y determinista ----
{
  const resources = [
    { id: 'character-a', type: 'character', label: 'Analista', capabilities: { animationPresets: ['idle-calm', 'talk-calm'] } },
    { id: 'character-b', type: 'character', label: 'Presentadora', capabilities: { animationPresets: ['idle-calm'] } },
    { id: 'character-c', type: 'character', label: 'Robot', capabilities: { animationPresets: ['talk-calm'] } },
    { id: 'voice-a', type: 'voice', label: 'Voz A' },
    { id: 'voice-b', type: 'voice', label: 'Voz B' },
    { id: 'voice-c', type: 'voice', label: 'Voz C' },
    { id: 'background-a', type: 'background', label: 'Estudio' },
    { id: 'background-b', type: 'background', label: 'Interior' },
    { id: 'background-c', type: 'background', label: 'Noche' },
  ];
  const first = preconfigurationManager.buildDirectorPreconfigurationAutofill(resources, 0);
  const repeated = preconfigurationManager.buildDirectorPreconfigurationAutofill(resources, 0);
  const second = preconfigurationManager.buildDirectorPreconfigurationAutofill(resources, 1);
  check('el autocompletado repite la misma propuesta con el mismo intento', JSON.stringify(first) === JSON.stringify(repeated));
  check('rehacer produce otra combinación determinista', JSON.stringify(first) !== JSON.stringify(second));
  check('la propuesta completa un diálogo con dos personajes', first.structurePreference === 'dialogue' && first.characterBindings.length === 2);
  check('cada personaje automático recibe una voz distinta', new Set(first.characterBindings.map((binding) => binding.voiceResourceId)).size === 2);
  check('el autocompletado conserva un fondo global', typeof first.backgroundResourceId === 'string' && first.backgroundResourceId.length > 0);
  check('el preset conversacional se prefiere cuando está disponible', first.characterBindings[0].animationPresetId === 'talk-calm');

  const scarce = preconfigurationManager.buildDirectorPreconfigurationAutofill([
    { id: 'character-only', type: 'character', label: 'Único', capabilities: { animationPresets: ['idle-calm'] } },
    { id: 'voice-only', type: 'voice', label: 'Voz única' },
    { id: 'background-only', type: 'background', label: 'Fondo único' },
  ], 3);
  check('un catálogo pequeño degrada a una configuración válida de un personaje', scarce.structurePreference === 'one-character' && scarce.characterBindings.length === 1);
  check('un solo fondo queda fijado como fondo global', scarce.backgroundResourceId === 'background-only');
}

// ---- rig-preview.ts: el lienzo usa las piezas reales, no una miniatura ----
{
  const manifestPath = 'assets/resources/presentadora-coral-v1/resource.manifest.json';
  const manifest = readJson(path.join(projectRoot, 'public', manifestPath));
  const neutral = rigPreview.rigSpritePlan(manifest, manifestPath, {
    poseId: 'neutral', eyes: 'open', mouth: 'closed', params: {},
  });
  const speaking = rigPreview.rigSpritePlan(manifest, manifestPath, {
    poseId: 'point', eyes: 'closed', mouth: 'open', params: { headNod: 1 },
  });
  check('el preview cambia la capa de boca y ojos del rig',
    neutral.some((sprite) => sprite.id === 'mouth:closed')
      && speaking.some((sprite) => sprite.id === 'mouth:open')
      && speaking.some((sprite) => sprite.id === 'eyes:closed'));
  check('el preview aplica gesto y parametros articulados',
    speaking.find((sprite) => sprite.id === 'arm_right').transforms.some((item) => item.kind === 'rotate')
      && speaking.find((sprite) => sprite.id === 'head').transforms.some((item) => item.kind === 'translate'));

  const legacyPath = 'assets/characters/mono-parametrico-azul-v1/character.manifest.json';
  const legacy = rigPreview.rigSpritePlan(readJson(path.join(projectRoot, 'public', legacyPath)), legacyPath, {
    poseId: 'point', mouth: 'medium', eyes: 'open',
  });
  check('los rigs v2 conservan boca y manos mediante el adaptador de preview',
    legacy.some((sprite) => sprite.id === 'mouth:medium')
      && legacy.some((sprite) => sprite.id === 'hands:point'));
}

check(
  'la revisión visual es determinista y sensible al proyecto',
  fingerprint.projectFingerprint({ id: 'a', scenes: [] }) === fingerprint.projectFingerprint({ id: 'a', scenes: [] })
    && fingerprint.projectFingerprint({ id: 'a', scenes: [] }) !== fingerprint.projectFingerprint({ id: 'b', scenes: [] }),
);
check(
  'la revisión visual sobrevive al reordenamiento de claves de PostgreSQL',
  fingerprint.projectFingerprint({ id: 'a', video: { width: 1080, fps: 30 }, scenes: [] })
    === fingerprint.projectFingerprint({ scenes: [], video: { fps: 30, width: 1080 }, id: 'a' }),
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
const storyboardSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'director', 'storyboard.ts'), 'utf8');
const directorPanelSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'director', 'panel.ts'), 'utf8');
const timelineSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'timeline.ts'), 'utf8');
const unifiedTimelineSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'timeline-v2.ts'), 'utf8');
const editorWorkspaceSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'editor-workspace.ts'), 'utf8');
const editingPanelSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'project', 'editing-panel.ts'), 'utf8');
const compositionSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'project', 'composition.ts'), 'utf8');
const mediaFilesPanelSource = readFileSync(path.join(projectRoot, 'src', 'ui', 'project', 'media-files-panel.ts'), 'utf8');
check(
  'el panel derecho ofrece Recursos, Edición y Archivos como páginas hermanas',
  appHtml.includes('id="right-panel-resources-tab"')
    && appHtml.includes('id="right-panel-editing-tab"')
    && appHtml.includes('id="right-panel-files-tab"')
    && appHtml.includes('id="right-panel-resources"')
    && appHtml.includes('id="right-panel-editing"')
    && appHtml.includes('id="right-panel-files"'),
);
check(
  'la cabecera elimina Catálogo local y conserva Recursos',
  !appHtml.includes('Catálogo local')
    && appHtml.includes('data-right-panel-page="resources"')
    && appHtml.includes('data-right-panel-page="editing"')
    && appHtml.includes('data-right-panel-page="files"'),
);
check(
  'Archivos ofrece picker múltiple, dropzone y biblioteca reutilizable',
  appHtml.includes('id="timeline-v2-file"')
    && appHtml.includes('accept=".mp4,.mov,.webm,.wav,.mp3,.ogg,.m4a,video/mp4,video/webm,video/quicktime,audio/wav,audio/mpeg,audio/ogg,audio/mp4"')
    && appHtml.includes('multiple hidden')
    && appHtml.includes('id="media-files-dropzone"')
    && mediaFilesPanelSource.includes("addEventListener('drop'")
    && mediaFilesPanelSource.includes('event.dataTransfer?.files')
    && mediaFilesPanelSource.includes('importMediaFiles(files)')
    && mediaFilesPanelSource.includes('addExistingTimelineMedia(entry.id)'),
);
check(
  'la timeline se adjunta al proyecto durable antes de renderizar',
  unifiedTimelineSource.includes('attachTimelineProject(projectId')
    && unifiedTimelineSource.includes('getTimelineProject(projectId)')
    && directorPanelSource.includes('await timelineProjectReady()'),
);
check(
  'los medios libres habilitan un reloj de reproducción sin exigir MP4 vigente',
  editorWorkspaceSource.includes('setExternalEditorMediaDuration')
    && editorWorkspaceSource.includes('externalMediaDurationSeconds')
    && editorWorkspaceSource.includes('canvasPreviewDuration() > 0')
    && unifiedTimelineSource.includes('setExternalEditorMediaDuration(unifiedMediaDurationSeconds())')
    && timelineSource.includes('hasExactTimelineTime()'),
);
check(
  'el preview libre no fuerza un seek ni repite play en cada frame',
  unifiedTimelineSource.includes('if (changed) syncPreview(true)')
    && unifiedTimelineSource.includes('const driftLimit = playing ? 0.35 : 0.04')
    && unifiedTimelineSource.includes('previewPlayRequests.has(clipId)')
    && unifiedTimelineSource.includes('becameActive'),
);
check(
  'Recursos incorpora Plantillas sin reemplazar las categorías existentes',
  appHtml.includes('data-resource-type="template"')
    && appHtml.includes('id="template-category-tabs"')
    && appHtml.includes('data-resource-type="character"')
    && appHtml.includes('data-resource-type="background"'),
);
{
  const catalog = videoTemplateCatalog.parseVideoTemplateCatalog({
    version: 1,
    categories: [{ id: 'animation', label: 'Animación', description: 'Efectos editables.' }],
    templates: [{
      id: 'word-pages',
      label: 'Palabra entre páginas',
      description: 'Páginas que avanzan alrededor de una palabra.',
      categoryId: 'animation',
      tags: ['texto'],
      definitionPath: 'assets/templates/word-pages.json',
    }],
  });
  check(
    'el catálogo de plantillas enlaza resúmenes portables con una categoría',
    catalog.templates[0]?.categoryId === 'animation'
      && catalog.templates[0]?.definitionPath === 'assets/templates/word-pages.json',
  );
  assert.throws(
    () => videoTemplateCatalog.parseVideoTemplateCatalog({
      version: 1,
      categories: [{ id: 'animation', label: 'Animación', description: 'Efectos editables.' }],
      templates: [{
        id: 'unsafe',
        label: 'Inválida',
        description: 'Ruta no portable.',
        categoryId: 'animation',
        tags: [],
        definitionPath: '../../fuera.json',
      }],
    }),
    /plantilla/u,
  );
  passed += 1;
}
{
  const catalog = videoTemplateCatalog.parseVideoTemplateCatalog(
    readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'video-templates.json')),
  );
  check(
    'el catálogo publicado solo ofrece plantillas generativas sin assets externos',
    catalog.templates.length === 5
      && new Set(catalog.templates.map((template) => template.id)).size === 5
      && catalog.templates.every((template) => existsSync(
        path.join(projectRoot, 'public', template.definitionPath),
      )),
  );
}
{
  const definition = videoTemplateDefinition.parseVideoTemplateDefinition(
    readJson(path.join(projectRoot, 'public', 'assets', 'templates', 'procedural-word-match-cut-v1.json')),
    'procedural-word-match-cut-v1',
  );
  const first = videoTemplateEvaluator.evaluateWordMatchCut(definition, 0);
  const next = videoTemplateEvaluator.evaluateWordMatchCut(definition, definition.cutFrames / definition.fps);
  const repeated = videoTemplateEvaluator.evaluateWordMatchCut(definition, definition.durationSeconds);
  const advanced = videoTemplateEvaluator.evaluateWordMatchCut(definition, 1);
  check(
    'la plantilla generativa dura cuatro segundos con doce páginas distintas',
    definition.kind === 'procedural-word-match-cut'
      && definition.durationSeconds === 4
      && definition.sequence.length === 24
      && definition.pageStyles.length === 12
      && new Set(definition.pageStyles.map((style) => style.layout)).size === 12
      && new Set(definition.pageStyles.map((style) => style.seed)).size === 12,
  );
  check(
    'la plantilla generativa declara una palabra editable y acotada',
    definition.defaultValues.word === 'IDEA'
      && definition.fields[0].id === 'word'
      && definition.fields[0].maxLength === 12
      && definition.pageStyles.every((style) => style.seed > 0
        && style.age >= 0
        && style.bleed >= 0
        && style.leftPhrase.length > 0
        && style.rightPhrase.length > 0),
  );
  check(
    'ninguna página se repite en dos cortes seguidos, ni al cerrar el bucle',
    definition.sequence.every((index, position) => (
      index !== definition.sequence[(position + 1) % definition.sequence.length]
    )),
  );
  check(
    'el efecto es determinista y cierra su bucle en el mismo frame',
    first.sourceIndex === repeated.sourceIndex
      && first.rotationDegrees === repeated.rotationDegrees
      && first.offsetX === repeated.offsetX,
  );
  check(
    'el tiempo hace avanzar las páginas sin mover la palabra fuera del evaluador visual',
    next.sourceIndex === definition.sequence[1]
      && advanced.sourceIndex !== first.sourceIndex
      && videoTemplateEvaluator.normalizeTemplateWord('  IMPACTO  ', 'IDEA', 24) === 'IMPACTO'
      && videoTemplateEvaluator.normalizeTemplateWord('Elegí tu próximo paso', 'ACTUÁ', 20) === 'Elegí tu próximo',
  );
}
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
  'el video ofrece ajustes generales y un fondo global sin exponer enlaces internos',
  editingPanel.editingSubpages({
    kind: 'scene',
    sceneId: 'scene-1',
  }).map((page) => page.label).join('|') === 'General|Fondo',
);
check(
  'un diálogo separa el texto de su interpretación',
  editingPanel.editingSubpages({
    kind: 'dialogue',
    sceneId: 'scene-1',
    turnId: 'turn-1',
  }).map((page) => page.label).join('|') === 'Texto|Voz y gesto',
);
check(
  'Edición usa el cabezal compartido para crear keyframes con el helper canónico',
  editingPanelSource.includes('editorPlayhead()')
    && editingPanelSource.includes('keyframeCommandsForValue({')
    && editingPanelSource.includes('offsetSeconds: placement.proposal.offsetSeconds')
    && editingPanelSource.includes('Ir a Ajustes')
    && editingPanelSource.includes("if (event.key !== 'Enter') return;"),
);
check(
  'Crear animación separa presets, mouse y edición manual sin duplicar el formulario de keyframes',
  editingPanelSource.includes("'Animaciones prediseñadas'")
    && editingPanelSource.includes("'Animar con el mouse'")
    && editingPanelSource.includes("'Edición manual'")
    && editingPanelSource.includes("'Abrir Pistas'")
    && !editingPanelSource.includes("'Agregar keyframe en el cabezal'"),
);
check(
  'los ajustes usan filas compactas, dos decimales y opacidad porcentual en vivo',
  editingPanelSource.includes("wrapper.className = 'keyframed-field'")
    && editingPanelSource.includes('formatCompactNumber')
    && editingPanelSource.includes("control.addEventListener('input', paint)")
    && editingPanelSource.includes("initialOpacity * 100")
    && compositionSource.includes('image.style.opacity = String(view.opacity)'),
);
check(
  'el visor ofrece controles directos separados para mover, escalar y rotar',
  compositionSource.includes("transformHandle('rotate', 'Rotar elemento'")
    && compositionSource.includes("transformHandle('scale', 'Escalar elemento'")
    && compositionSource.includes("move.setAttribute('aria-label', 'Mover elemento')")
    && compositionSource.includes('paintTransform(image, controls, next, visualBounds)')
    && compositionSource.includes("window.addEventListener('pointermove', move)")
    && compositionSource.includes("context.getImageData(0, 0, width, height)")
    && compositionSource.includes("'rotationDegrees',")
    && compositionSource.includes("'scale',"),
);
check(
  'el preview vivo recorre escenas y subtítulos medidos sin mostrar controles de edición',
  compositionSource.includes('measuredSceneAt(measured, editorPlayhead())')
    && compositionSource.includes('liveSubtitle(scene, previewTiming, editorPlayhead())')
    && compositionSource.includes('animatingElement !== null && !previewing'),
);
check(
  'el preview vivo consume cues medidos y dibuja el rig en vez de una miniatura',
  compositionSource.includes('measuredVisualSceneFor(scene.id)')
    && compositionSource.includes('evaluateScene({ version: 2 }')
    && compositionSource.includes('rigSpritePlan(manifest')
    && compositionSource.includes('drawRigPreview(image, sprites, render)'),
);
check(
  'el preview precarga fondos por capas o MP4 y sincroniza el video con el cabezal',
  compositionSource.includes('await loadBackgroundLayers(resource.backgroundManifest)')
    && compositionSource.includes('backgroundLayers.get(background.backgroundManifest)')
    && compositionSource.includes('backgroundVideoNodes.get(background.src)')
    && compositionSource.includes('video.currentTime = sourceSeconds')
    && !compositionSource.includes('async function appendBackground('),
);
check(
  'la biblioteca permite seleccionar PNG, JPG, GIF y MP4 como fondo',
  appHtml.includes('.gif,.mp4')
    && appHtml.includes('image/gif,video/mp4'),
);
check(
  'cada keyframe resuelto se dibuja como rombo en el clip de su elemento',
  timelineSource.includes('function appendElementKeyframes(')
    && timelineSource.includes('(keyframe.seconds - clipStartSeconds) * pixelsPerSecond')
    && timelineSource.includes("marker.className = 'timeline-keyframe-marker'")
    && timelineSource.includes("kind: 'keyframe',"),
);
check(
  'cada ajuste animable muestra rombo y navegación sin salir de Ajustes',
  editingPanelSource.includes("diamond.className = `keyframe-diamond-button")
    && editingPanelSource.includes("jump('anterior', previous)")
    && editingPanelSource.includes("jump('siguiente', next)")
    && editingPanelSource.includes('setEditorPlayhead(target.seconds)'),
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
  editingPanelSource.includes("compactFieldRow('Capa', control, 'number')")
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
  !existsSync(path.join(projectRoot, 'src', 'ui', 'project', 'panel.ts'))
    && storyboardSource.includes("showRightPanelPage('editing')")
    && storyboardSource.includes("selectProjectItem({ kind: 'scene'"),
);
check(
  'la timeline conserva acciones estructurales y comparte la duplicación de keyframes',
  appHtml.includes('id="timeline-split"')
    && timelineSource.includes('splitSelectedTurn')
    && timelineSource.includes('duplicateKeyframeCommand({'),
);
check(
  'autoría y medios libres se muestran en una sola timeline sin selector de motores',
  appHtml.includes('Secuencia continua')
    && !appHtml.includes('id="timeline-v2-toggle"')
    && timelineSource.includes('renderUnifiedMediaRows(totalWidth, pixelsPerSecond)')
    && unifiedTimelineSource.includes("document.body.dataset.timelineEngine = 'unified'")
    && !unifiedTimelineSource.includes('function setActive('),
);
check(
  'los medios libres comparten el cabezal y pueden desvincular audio y video',
  unifiedTimelineSource.includes('setEditorPlayhead(seconds)')
    && unifiedTimelineSource.includes("type: 'unlink-group'")
    && appHtml.includes('id="timeline-v2-unlink"'),
);
check(
  'un video libre de la pista base reemplaza solo el fondo en el visor semántico',
  compositionSource.includes('unifiedMediaPreviewNodes(')
    && compositionSource.includes('freeMedia.background.length === 0')
    && compositionSource.includes('nodes.push(...freeMedia.overlays, ...freeMedia.audio)'),
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
  'los atajos de la timeline no operan sobre el proyecto desde el Creador',
  timelineSource.includes("const creator = editorWorkspace().mode === 'creator';")
    && timelineSource.includes("if (key === 'b' && !creator)")
    && timelineSource.includes('if (creator || isTyping(event.target)'),
);
check(
  'las flechas de clips y cabezal no se suman al atajo global de seek',
  // El roving de clips corta el burbujeo y el cabezal consume sus propias teclas.
  timelineSource.includes('// movía el foco entre clips Y además desplazaba el cabezal medio segundo.\n    event.stopPropagation();')
    && timelineSource.includes('const consume = (): void => {\n      event.preventDefault();\n      event.stopPropagation();\n    };'),
);
check(
  'el corte de diálogo exige medición y no inventa dónde cae el cabezal',
  timelineSource.includes("type: 'split-dialogue-turn'")
    && timelineSource.includes('wordCutAtSeconds(')
    && timelineSource.includes('Hace falta medir las voces para saber dónde cae el cabezal.'),
);
check(
  'cortar vuelve a medir solo, sin exigir un render completo',
  timelineSource.includes('void remeasureProject();')
    && timelineSource.includes('measureProjectTimes(project)')
    && timelineSource.includes('setProjectMeasurement({')
    && timelineSource.includes('missingVisualRuntime')
    // Una medición que llega tarde no puede adoptarse sobre un proyecto que ya cambió.
    && timelineSource.includes('El proyecto cambió mientras se medía'),
);
check(
  'la medición liviana gana sobre el MP4 y habilita el preview con su propio audio',
  editorWorkspaceSource.includes('export function setProjectMeasurement(')
    && editorWorkspaceSource.includes('measurement.timingRevision === activeTimingRevision')
    && editorWorkspaceSource.includes('export function measuredVisualSceneFor(')
    && editorWorkspaceSource.includes('previewAudio.src = value.audioUrl')
    && editorWorkspaceSource.includes('function authoringMedia()'),
);
check(
  'la medición se agenda solo cuando cambia la revisión temporal',
  timelineSource.includes('nextTimingRevision !== observedTimingRevision')
    && timelineSource.includes('scheduleAutomaticMeasurement()')
    && timelineSource.includes("remeasureProject({ automatic: true })"),
);
check(
  'los elementos visuales se recortan arrastrando los bordes del clip',
  timelineSource.includes('function bindElementTrim(')
    && timelineSource.includes("clip.classList.add('is-trimmable')")
    // El tramo dibujado sale del MISMO evaluador que el render, no de una cuenta aparte.
    && timelineSource.includes('resolveWindowSeconds(element.visibility, timing)')
    // Al soltar se guarda una referencia semantica, no un segundo absoluto.
    && timelineSource.includes('nearestAnchorFor(seconds, timing, fps)')
    // Volver a cubrir toda la escena borra la ventana en vez de guardar una inutil.
    && timelineSource.includes("type: 'clear-element-window'")
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('.clip-trim-handle'),
);
check(
  'la tijera dibuja las fronteras de palabra y corta con un clic',
  timelineSource.includes('function bindDialogueCutter(')
    && timelineSource.includes("mark.className = 'dialogue-word-boundary'")
    && timelineSource.includes('cutDialogueTurnAtWord(sceneId, turn.id, boundary)')
    && appHtml.includes('id="timeline-cut"')
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('.dialogue-cut-guide'),
);
check(
  'un control deshabilitado de la barra no se viste de acción disponible',
  readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('.timeline-play:disabled')
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('.timeline-tool.is-active:disabled')
    && timelineSource.includes("snap.classList.toggle('is-active', snapEnabled && !snap.disabled)"),
);
check(
  'anterior y siguiente navegan puntos internos sin nombrar particiones',
  appHtml.includes('aria-label="Punto anterior"')
    && appHtml.includes('aria-label="Punto siguiente"')
    && !appHtml.includes('aria-label="Clip anterior"')
    && timelineSource.includes('previous.disabled = !hasNavigation || !canGoBack')
    && timelineSource.includes('next.disabled = !hasNavigation || !canGoForward'),
);
check(
  'el rótulo accesible de Duplicar sigue al texto visible',
  timelineSource.includes("duplicate.setAttribute('aria-label', duplicate.textContent)"),
);
check(
  'silenciar usa el mismo criterio de disponibilidad que reproducir',
  timelineSource.includes("button.disabled = state.mode === 'creator' || !editorCanPlay()"),
);
check(
  'B corta el diálogo bajo el cabezal y dividir el momento queda en Ctrl+B',
  timelineSource.includes("event.code === 'KeyB'")
    && timelineSource.includes('cutAtPlayhead();')
    && timelineSource.includes("if (key === 'b' && !creator)")
    && appHtml.includes('<dt>B</dt>')
    && appHtml.includes('<dt>Ctrl+B</dt>'),
);
check(
  'ningún corte falla en silencio: siempre explica qué falta',
  timelineSource.includes("message: 'Seleccioná un diálogo para dividir antes de él.'")
    && timelineSource.includes('tiene que quedar al menos un turno hablado de cada lado')
    && timelineSource.includes('Poné el cabezal sobre un diálogo para cortarlo.'),
);
check(
  'el vocabulario de corte de diálogo está en el esquema y en el relato de undo',
  JSON.stringify(readJson(path.join(projectRoot, 'schema', 'editor-command.schema.json'))).includes('split-dialogue-turn')
    && readFileSync(path.join(projectRoot, 'src', 'ui', 'command-labels.ts'), 'utf8').includes("'split-dialogue-turn'"),
);
check(
  'Edición crea y reasigna voz fuera de campo sin exigir personajes',
  editingPanelSource.includes("actionButton('Agregar voz fuera de campo'")
    && editingPanelSource.includes("value: '__voiceover__'")
    && editingPanelSource.includes("type: 'set-dialogue-voiceover'")
    && editingPanelSource.includes("type: 'add-voiceover-turn'"),
);
check(
  'la timeline representa narración y crea momentos como borradores vacíos',
  timelineSource.includes("authoringTrack('VO', 'Voz fuera de campo'")
    && timelineSource.includes("type: 'add-voiceover-turn'")
    && timelineSource.includes("type: 'add-scene'")
    && timelineSource.includes('elements: [],')
    && timelineSource.includes('dialogue: [],'),
);
check(
  'la timeline presenta capas continuas sin exponer particiones internas',
  appHtml.includes('<h2 id="timeline-title">Secuencia continua</h2>')
    && appHtml.includes('aria-label="Capas de la secuencia continua"')
    && timelineSource.includes("groupElementsByResource(project, 'character')")
    && timelineSource.includes('continuousElementClip(group, authoredWidth, measured')
    && timelineSource.includes("authoringTrack('BG', 'Fondo', totalWidth, [backgroundClip])")
    && !timelineSource.includes('continuousSequenceRow(project')
    && !timelineSource.includes("mark.className = 'ruler-moment'")
    && !appHtml.includes('id="director-scenes"'),
);
check(
  'los comandos cerrados incluyen alta y conversión de voz fuera de campo',
  JSON.stringify(readJson(path.join(projectRoot, 'schema', 'editor-command.schema.json'))).includes('add-voiceover-turn')
    && JSON.stringify(readJson(path.join(projectRoot, 'schema', 'editor-command.schema.json'))).includes('set-dialogue-voiceover'),
);
check(
  'arrastrar el cabezal no reconstruye el árbol que se está agarrando',
  timelineSource.includes('if (draggingPlayhead) {')
    && timelineSource.includes('    syncPlayheadFromMedia();\n    return;\n  }'),
);
check(
  'la selección enlaza la edición derecha y no el antiguo inspector del Director',
  readFileSync(path.join(projectRoot, 'src', 'ui', 'selection-mirror.ts'), 'utf8')
    .includes("showRightPanelPage('editing')")
    && !readFileSync(path.join(projectRoot, 'src', 'ui', 'selection-mirror.ts'), 'utf8')
      .includes("querySelector<HTMLElement>('#scene-inspector')"),
);
check(
  'el visor no conserva el rectángulo punteado anterior al marco de transformación',
  !readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8')
    .includes('.composition-character.is-linked-hover')
    && !readFileSync(path.join(projectRoot, 'src', 'ui', 'selection-mirror.ts'), 'utf8')
      .includes('.composition-character[data-element-id="${CSS.escape(elementId)}"]'),
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
  'Base es una segunda capa de tres preguntas y no un resumen editable',
  appHtml.includes('id="director-questions-form"')
    && appHtml.includes('id="director-questions"')
    && appHtml.includes('id="director-create-video"')
    && directorPanelSource.includes("otherLabel.textContent = 'Otra respuesta'")
    && directorPanelSource.includes("otherRadio.value = '__other__'")
    && !appHtml.includes('id="director-storyboard"')
    && !appHtml.includes('id="director-summary"'),
);
check(
  'el Director no expone campos de edición manual duplicados',
  !appHtml.includes('id="proposal-title"')
    && !appHtml.includes('id="scene-inspector"')
    && !directorPanelSource.includes("type: 'set-dialogue-turn'"),
);
check(
  'el storyboard recorre todas las escenas como navegación compacta',
  storyboardSource.includes('project.scenes.map((scene, index)')
    && storyboardSource.includes("summary.textContent = scene.dialogue[0]?.text"),
);
check(
  'el título no se duplica dentro del Director',
  !appHtml.includes('class="proposal-project-title"')
    && !directorPanelSource.includes("type: 'set-project-title'"),
);

check(
  'explica la capacidad no soportada sin exponer el índice técnico',
  directorApi.formatApiError({
    code: 'PROJECT_SCENE_UNSUPPORTED',
    message: 'Una escena no es compatible.',
    technicalDetail: '/scenes/1 el personaje protagonista usa pose inicial point',
    suggestedAction: 'Corrija la escena.',
  }).includes('Contenido: el personaje protagonista usa pose inicial point'),
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
  'el progreso segmentado informa el bloque actual',
  directorProgress.describeDirectorProgress({
    version: 1,
    state: 'running',
    stage: 'generating',
    updatedAt: new Date(0).toISOString(),
    candidateIndex: 1,
    candidateCount: 1,
    attempt: 1,
    segmentIndex: 2,
    segmentCount: 4,
  }) === 'Generando la propuesta 1 de 1 · bloque 2 de 4…',
);

check(
  'Exportar expone disponibilidad y evita repetir una exportación vigente',
  appHtml.includes('id="render-readiness"')
    && directorPanelSource.includes("output === 'current'")
    && directorPanelSource.includes("label: 'MP4 actualizado'"),
);
check(
  'el Director presenta Idea, Base y Video como fases, no pestañas',
  appHtml.includes('data-director-phase="idea"')
    && appHtml.includes('data-director-phase="base"')
    && appHtml.includes('data-director-phase="video"')
    && !appHtml.includes('director-page-tabs'),
);
check(
  'al enviar, el prompt sale del campo y aparece como mensaje no editable',
  appHtml.includes('id="director-submitted-message"')
    && appHtml.includes('id="director-submitted-text"')
    && directorPanelSource.includes('submittedInstruction = instruction')
    && directorPanelSource.includes("composer.hidden = phase !== 'idea' || busyMode === 'ai'")
    && directorPanelSource.includes("submittedText.textContent = submittedInstruction ?? ''"),
);
check(
  'las preguntas terminadas avanzan a Base sin crear todavía el proyecto',
  directorPanelSource.includes("phase = 'base';")
    && directorPanelSource.includes('questionSet = await createClarifyingQuestions')
    && !appHtml.includes('id="director-last-request"'),
);
check(
  'Video muestra solo bloqueos y conserva la validación del motor',
  appHtml.includes('id="render-requirements"')
    && directorPanelSource.includes("state.kind === 'blocked'")
    && directorPanelSource.includes('store.validate()'),
);
check(
  'la timeline distingue el render vigente del histórico abierto explícitamente',
  timelineSource.includes('currentEditorOutput()')
    && timelineSource.includes('editorCanPlay()')
    && timelineSource.includes('el MP4 anterior quedó fuera del transporte'),
);

// ---- Director guiado: estados y brief automático ----
check('un proyecto vacío inicia en Idea', directorFlow.initialDirectorPhase(false) === 'idea');
check('un proyecto existente inicia directamente en Video', directorFlow.initialDirectorPhase(true) === 'video');
check(
  'sin preguntas solo Idea está disponible',
  directorFlow.canOpenDirectorPhase({ phase: 'idea', projectAvailable: false, questionsAvailable: false, busy: null }, 'idea')
    && !directorFlow.canOpenDirectorPhase({ phase: 'idea', projectAvailable: false, questionsAvailable: false, busy: null }, 'base'),
);
check(
  'una tarea en curso inmoviliza la fase visible',
  !directorFlow.canOpenDirectorPhase({ phase: 'base', projectAvailable: true, questionsAvailable: true, busy: 'ai' }, 'video'),
);
check(
  'Idea integra duración y modelo IA sin exponer particiones técnicas',
  appHtml.includes('id="director-duration"')
    && !appHtml.includes('id="director-scenes"')
    && appHtml.includes('id="director-model"')
    && appHtml.includes('value="ollama:qwen3:8b"')
    && appHtml.includes('value="openai:gpt-5.6-luna"')
    && !appHtml.includes('id="director-provider-select"')
    && !appHtml.includes('id="director-openai-model"')
    && !appHtml.includes('id="director-provider-help"')
    && !appHtml.includes('id="director-advanced"')
    && !appHtml.includes('id="director-tone"')
    && !appHtml.includes('id="director-richness"')
    && !appHtml.includes('id="director-structure"')
    && !appHtml.includes('id="director-think"')
    && !appHtml.includes('id="director-best-of"')
    && directorPanelSource.includes('{ think: false, bestOf: 1 }'),
);
check(
  'Idea conserva sus controles reales dentro del nuevo sistema visual',
  appHtml.includes('class="director-setting-row" for="director-duration"')
    && appHtml.includes('class="director-setting-row director-model-control"')
    && appHtml.includes('id="ui-icon-clock"')
    && appHtml.includes('id="ui-icon-sparkles"')
    && directorPanelSource.includes("preconfigurationLabel.className = 'director-setting-row'")
    && directorPanelSource.includes("preconfigurationIcon.innerHTML = '<svg class=\"icon\"><use href=\"#ui-icon-sliders\"/></svg>'"),
);
check(
  'el rediseño del Director usa los tokens y medidas principales de la especificación',
  readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('--director-primary: #295db5;')
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('height: 180px;')
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('min-height: 120px;')
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('max-height: 420px;')
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('min-height: 48px;')
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('min-height: 44px;')
    && readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8').includes('@container (max-width: 380px)'),
);
check(
  'las flechas visuales alternan las listas sin duplicar sus opciones',
  directorPanelSource.includes('bindSelectChevron(duration)')
    && directorPanelSource.includes('bindSelectChevron(model)')
    && directorPanelSource.includes('bindSelectChevron(preconfigurationSelect)')
    && directorPanelSource.includes("select.classList.contains('is-arrow-open')")
    && directorPanelSource.includes("select.removeAttribute('size')"),
);
check(
  'el prompt usa un tirador propio con arrastre acotado y teclado',
  appHtml.includes('id="director-prompt-resize"')
    && directorPanelSource.includes('bindPromptResize(prompt, promptResize)')
    && directorPanelSource.includes("handle.setPointerCapture(event.pointerId)")
    && directorPanelSource.includes("event.key !== 'ArrowUp' && event.key !== 'ArrowDown'"),
);
check(
  'los valores automáticos no fijan decisiones editoriales',
  JSON.stringify(directorBrief.buildDirectorConstraints({
    duration: '', scenes: '',
  })) === JSON.stringify({ planVersion: 2 }),
);
check(
  'el brief conserva únicamente elecciones explícitas',
  JSON.stringify(directorBrief.buildDirectorConstraints({
    duration: '45', scenes: '3',
  })) === JSON.stringify({
    planVersion: 2, targetDurationSeconds: 45, sceneCount: 3,
  }),
);
{
  const project = { id: 'p', title: 'Base', video: { width: 1080, height: 1920, fps: 30 }, scenes: [] };
  const pending = pendingDirectorEdit.createPendingDirectorEdit(project, [{ type: 'set-project-title', title: 'Nueva' }], {
    summary: 'Cambia el título.', changes: ['Cambiar el título.'], customizedTrackRemovalIndexes: [],
  });
  check('una propuesta pendiente reconoce su revisión base', pendingDirectorEdit.pendingEditIsCurrent(pending, structuredClone(project)));
  check('una propuesta pendiente caduca al cambiar el proyecto', !pendingDirectorEdit.pendingEditIsCurrent(pending, { ...project, title: 'Otra' }));
}

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

workspace.registerRenderedOutput({
  projectId: 'proyecto-historico',
  url: 'blob:video-historico',
  downloadName: 'historico.mp4',
  timeline: null,
  projectRevision: 'snapshot-historico',
  current: false,
  reveal: true,
});
await workspace.toggleEditorPlayback();
check(
  'un render histórico abierto explícitamente responde al botón Play',
  workspace.editorWorkspace().surface === 'playback' && video.paused === false,
);
video.pause();

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
  check('con esa medición el lienzo puede previsualizar sin otro render', workspace.editorCanPlay() === true);
  video.playFailures = 1;
  const playCallsBeforeRetry = video.playCalls;
  await workspace.toggleEditorPlayback();
  check('Play inicia el preview de autoría sobre el lienzo', workspace.editorWorkspace().playing === true);
  check('el preview reproduce el audio del MP4 medido', video.paused === false);
  check('un play abortado durante load se reintenta sin recargar', video.playCalls === playCallsBeforeRetry + 2);
  await workspace.toggleEditorPlayback();
  check('Play vuelve a pausar el preview de autoría', workspace.editorWorkspace().playing === false);
  check('pausar el preview también pausa su audio', video.paused === true);

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

{
  workspace.setActiveEditorProject('proyecto-visual', 'visual-1', 'timing-visual-1');
  workspace.setProjectMeasurement({
    projectId: 'proyecto-visual',
    timingRevision: 'timing-visual-1',
    timeline: { durationSeconds: 2, scenes: [{ id: 'escena-visual', startSeconds: 0, endSeconds: 2 }] },
    visualScenes: [{
      id: 'escena-visual',
      runtime: { audio: { durationSeconds: 2 }, characters: [] },
      dialogue: { turns: [] },
    }],
    audioUrl: 'blob:preview-visual',
  });
  check('la medición vigente expone su runtime visual', workspace.measuredVisualSceneFor('escena-visual')?.runtime.audio.durationSeconds === 2);
  workspace.syncActiveEditorProject('proyecto-visual', 'visual-2', 'timing-visual-2');
  check('el runtime visual caduca junto con los tiempos', workspace.measuredVisualSceneFor('escena-visual') === null);
}

// ---- store.ts: comandos, undo/redo, suscripción ----
const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const store = storeModule.createStore(engine.createProjectEditor(project, catalog), 'rev-abc');

{
  // Dos catálogos describen la misma plantilla: el de autoría manda para el
  // motor y el de presentación para la biblioteca. Si divergen, la tarjeta
  // arrastraría un ID que el proyecto no puede resolver.
  const presentation = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'video-templates.json'));
  const authored = new Map(catalog.entries
    .filter((entry) => entry.type === 'template')
    .map((entry) => [entry.id, entry]));
  check(
    'los catálogos de plantillas coinciden en IDs y definiciones',
    presentation.templates.length === authored.size
      && presentation.templates.every((template) => (
        authored.get(template.id)?.templateRef.definition === template.definitionPath
      )),
  );
}
{
  const scene = 'escena-presentacion';
  const added = engine.applyProjectEditorCommand(engine.createProjectEditor(project, catalog), {
    type: 'add-template',
    sceneId: scene,
    elementId: 'efecto-paginas',
    templateId: 'procedural-word-match-cut-v1',
    word: 'IDEA',
    zIndex: 30,
  });
  const element = added.project.scenes[0].elements.at(-1);
  check(
    'agregar una plantilla la centra en el cuadro y guarda su palabra',
    element.type === 'template'
      && element.values.word === 'IDEA'
      && element.transform.x === 540
      && element.transform.y === 960
      && element.transform.scale === 1,
  );
  const renamed = engine.applyProjectEditorCommand(added, {
    type: 'set-template-word',
    sceneId: scene,
    elementId: 'efecto-paginas',
    word: 'IMPACTO',
  });
  check(
    'cambiar la palabra de la plantilla entra en el historial',
    renamed.project.scenes[0].elements.at(-1).values.word === 'IMPACTO'
      && engine.undoProjectEditor(renamed).project.scenes[0].elements.at(-1).values.word === 'IDEA',
  );
  let rejected = null;
  try {
    engine.applyProjectEditorCommand(added, {
      type: 'set-template-word',
      sceneId: scene,
      elementId: 'efecto-paginas',
      word: '   ',
    });
  } catch (error) {
    rejected = error;
  }
  check('una palabra vacía no llega al proyecto', rejected?.code === 'EDITOR_VALUE_INVALID');
}

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
  check('el último keyframe queda marcado según su orden temporal', lane.keyframes[1].isLast === true && lane.keyframes[0].isLast === false);
  check('un keyframe resuelto no tiene nada que revisar', lane.keyframes.every((keyframe) => keyframe.status === 'ok') && lane.reviewCount === 0);

  const unmeasured = animation.buildAnimationLanes('e1', tracks, { timing: null, reference, fps: 30 })[0];
  check(
    'sin medición no se inventa una posición para el keyframe',
    unmeasured.keyframes.every((keyframe) => keyframe.seconds === null && keyframe.status === 'unmeasured')
      && unmeasured.segments.length === 0,
  );
  check('sin medición el tiempo resuelto lo dice, no muestra un número', unmeasured.keyframes[0].timeLabel === 'pendiente de medición');

  // ---- timeline-animation.ts: punto de corte de un turno por palabra ----
  // El turno dura 2 s y tiene 4 palabras: cada palabra ocupa 0,5 s. El corte es
  // el inverso exacto del prorrateo con el que resolveAnchorSeconds ubica un
  // ancla de palabra, así que las dos vistas coinciden.
  const cortable = { startSeconds: 1, durationSeconds: 2, wordCount: 4 };
  check('el corte cae en la palabra que marca el cabezal', animation.wordCutAtSeconds(cortable, 2) === 2);
  check('el corte redondea a la frontera de palabra más cercana', animation.wordCutAtSeconds(cortable, 2.4) === 3);
  check(
    'el corte nunca deja un lado sin palabras',
    animation.wordCutAtSeconds(cortable, 1) === 1 && animation.wordCutAtSeconds(cortable, 3) === 3,
  );
  check(
    'no hay corte fuera del turno ni en un turno de una palabra',
    animation.wordCutAtSeconds(cortable, 0.5) === null
      && animation.wordCutAtSeconds(cortable, 3.5) === null
      && animation.wordCutAtSeconds({ startSeconds: 0, durationSeconds: 2, wordCount: 1 }, 1) === null,
  );
  check(
    'sin duración medida no se propone un corte',
    animation.wordCutAtSeconds({ startSeconds: 0, durationSeconds: 0, wordCount: 4 }, 0) === null,
  );

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
  check(
    'una pista fuera de escena cuenta el aviso y lo explica sin confundirlo con la voz',
    outsideLane.reviewCount === 1
      && outsideLane.keyframes.find((keyframe) => keyframe.status === 'out-of-scene')?.timeLabel === 'fuera del tramo disponible',
  );

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
  const scaleLane = animation.buildAnimationLanes('e1', [{
    parameterId: 'scale',
    source: { kind: 'manual' },
    keyframes: [
      { id: 'scale-a', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0.7, interpolation: 'linear' },
      { id: 'scale-b', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 5, value: 1.2, interpolation: 'hold' },
    ],
  }], { timing, reference, fps: 30 })[0];
  check('la escala interpola entre dos rombos', animation.evaluateLanesAt([scaleLane], 2.5).scale === 0.95);
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
    takenKeyframeIds: [],
    ...extra,
  });

  const created = commandFor({})[0];
  check('sin pista, el primer rombo arma una pista con un único punto', created.type === 'create-track' && created.keyframes.length === 1);
  check('el primer punto usa el valor y la posición exacta del cabezal', created.keyframes[0].value === 500 && created.keyframes[0].interpolation === 'hold');
  check('la pista nueva es manual, no de preset', created.source.kind === 'manual');

  const atSceneStart = commandFor({ playheadSeconds: 0 })[0];
  check('el primer rombo también puede caer exactamente al inicio', atSceneStart.keyframes.length === 1 && atSceneStart.keyframes[0].offsetSeconds === 0);

  const added = commandFor({ lane });
  check('un punto nuevo se agrega a la pista existente', added.at(-1).type === 'add-keyframe' && added.at(-1).value === 500);

  const armedLane = animation.buildAnimationLanes('e1', [{
    parameterId: 'position.x',
    source: { kind: 'manual' },
    keyframes: [
      { id: 'kf-armed', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 100, interpolation: 'hold' },
    ],
  }], { timing, reference, fps: 30 })[0];
  const secondPoint = commandFor({ lane: armedLane, playheadSeconds: 1 });
  check(
    'el segundo rombo abre un tramo lineal desde el primero',
    secondPoint[0].type === 'set-keyframe'
      && secondPoint[0].keyframeId === 'kf-armed'
      && secondPoint[0].interpolation === 'linear'
      && secondPoint[1].type === 'add-keyframe'
      && secondPoint[1].interpolation === 'hold',
  );

  const updated = commandFor({ lane, playheadSeconds: 0.6 })[0];
  check('sobre un keyframe existente se cambia su valor, no se duplica', updated.type === 'set-keyframe' && updated.keyframeId === 'kf-2');
  check('mover al mismo valor no genera comando', commandFor({ lane, playheadSeconds: 0.6, value: 320 }).length === 0);
  check('el valor se acota al rango antes de mandarlo', commandFor({ lane, value: 99999 }).at(-1).value === 2160);
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

// ---- edit-proposal.ts: autorización humana y revisión inline ----
{
  const authorized = editProposal.authorizeCustomizedRemovals([
    { type: 'set-dialogue-turn', sceneId: 's1', turnId: 't1', text: 'Nuevo' },
    { type: 'remove-animation', sceneId: 's1', elementId: 'e1', parameterId: 'scale' },
  ], [1]);
  check('solo la UI añade confirmación al remove-animation aprobado',
    !Object.hasOwn(authorized[0], 'confirmCustomized')
      && authorized[1].confirmCustomized === true);
}
check(
  'el proyecto se crea después de las tres respuestas sin iniciar un render obligatorio',
  appHtml.includes('id="director-replacement"')
    && directorPanelSource.includes('const personalization = collectAnswers(questionSet.questions)')
    && directorPanelSource.includes('Proyecto creado. Preparando el preview con voces y tiempos reales')
    && !directorPanelSource.slice(
      directorPanelSource.indexOf('async function createPersonalizedVideo'),
      directorPanelSource.indexOf('function renderQuestions'),
    ).includes('startCurrentRender')
    && directorPanelSource.includes("render.addEventListener('click', () => void startCurrentRender())")
    && directorPanelSource.includes('editProjectWithAi')
    && directorPanelSource.includes('createPendingDirectorEdit')
    && directorPanelSource.includes('authorizeCustomizedRemovals')
    && directorPanelSource.includes('pendingEditIsCurrent')
    && directorPanelSource.includes('window.confirm'),
);
check(
  'cada regeneración reserva una variante nueva aunque la anterior falle',
  directorPanelSource.includes('const proposalVariant = variant;')
    && directorPanelSource.includes('variant += 1;')
    && directorPanelSource.includes('        proposalVariant,'),
);
check(
  'los fallos del Director conservan el detalle técnico bajo demanda',
  directorPanelSource.includes("summary.textContent = 'Detalles técnicos'")
    && directorPanelSource.includes('formatApiTechnicalDetails(detail)'),
);
check(
  'Base eliminó el segundo prompt y los detalles de la antigua propuesta',
  !appHtml.includes('director-quality-details')
    && !appHtml.includes('director-decision-details')
    && !appHtml.includes('director-variants-details')
    && !appHtml.includes('director-resources-details')
    && directorPanelSource.includes("composer.hidden = phase !== 'idea'"),
);
check(
  'Video separa el preview de la exportación y conserva la descarga sin otro reproductor',
  appHtml.includes('id="director-view-video"')
    && appHtml.includes('id="director-download-video"')
    && appHtml.includes('Podés revisar y editar el preview sin esperar un render')
    && appHtml.includes('id="director-render" class="primary-button" type="button" disabled>Exportar MP4</button>')
    && !appHtml.includes('video id="director-video-result"'),
);

// ---- command-labels.ts: qué cambió tras una edición IA (C3) y undo narrado (U1) ----
{
  const { describeCommand, describeCommands, summarizeCommands } = commandLabels;
  const context = { sceneIds: ['s1', 's2', 's3'] };
  check('un comando conocido se narra en lenguaje de usuario', describeCommand({ type: 'add-scene' }) === 'Agregó contenido');
  check(
    'el id interno no se expone al usuario',
    describeCommand({ type: 'set-dialogue-turn', sceneId: 's2' }, context) === 'Cambió un diálogo del contenido',
  );
  check(
    'sin contexto la partición interna no se inventa',
    describeCommand({ type: 'set-dialogue-turn', sceneId: 's2' }) === 'Cambió un diálogo del contenido',
  );
  check(
    'las ediciones de animación se narran con el parámetro en lenguaje de usuario',
    describeCommand({ type: 'set-keyframe', sceneId: 's2', parameterId: 'position.x' }, context)
      === 'Ajustó un keyframe de la posición horizontal en el contenido'
      && describeCommand({ type: 'delete-track', sceneId: 's1', parameterId: 'armRaise' }, context)
        === 'Quitó la animación del brazo derecho en el contenido'
      && describeCommand({ type: 'remove-animation', sceneId: 's1', parameterId: 'opacity' }, context)
        === 'Quitó la animación de la opacidad en el contenido',
  );
  check(
    'aplicar un preset dice cuál, para que el usuario sepa qué deshace',
    describeCommand({ type: 'apply-animation-preset', sceneId: 's1', presetId: 'enter-left' }, context)
      === 'Aplicó «enter-left» a un personaje del contenido',
  );
  check(
    'una partición ajena al proyecto no se expone',
    describeCommand({ type: 'delete-scene', sceneId: 'otra' }, context) === 'Eliminó el contenido',
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
  check('los cambios repetidos se agrupan con su cuenta', repeated[0] === 'Cambió un diálogo del contenido (×2)');
  check('los cambios distintos se listan aparte', repeated.length === 2);

  const many = describeCommands(
    ['s1', 's2', 's3', 's1', 's2'].map((sceneId, index) => ({ type: index % 2 ? 'set-scene-title' : 'set-transition', sceneId })),
    context,
    2,
  );
  check('los cambios internos equivalentes se agrupan sin exponer sus particiones', many.length === 2);

  check('sin comandos se dice que no hubo cambios', summarizeCommands([]).includes('no encontró cambios'));
  check(
    'el resumen une los cambios en una línea',
    summarizeCommands([{ type: 'add-scene' }, { type: 'reorder-scenes' }], context) === 'Agregó contenido · Reordenó el contenido',
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
  check('tras editar se sabe qué se desharía', base.pendingUndoLabel() === 'Renombró el contenido');
  check('todavía no hay nada que rehacer', base.pendingRedoLabel() === null);
  base.undo();
  check('al deshacer, la etiqueta pasa al lado de rehacer', base.pendingRedoLabel() === 'Renombró el contenido');
  check('sin más historial no se inventa una etiqueta de deshacer', base.pendingUndoLabel() === null);
  base.redo();
  check('al rehacer, la etiqueta vuelve al lado de deshacer', base.pendingUndoLabel() === 'Renombró el contenido');
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
      && base.pendingUndoLabel()?.includes('Renombró el contenido') === true);
  base.undo();
  check('un solo undo revierte el lote completo', JSON.stringify(base.project()) === JSON.stringify(beforeBatch));
}

process.stdout.write(`${JSON.stringify({ version: 1, passed, failed: 0 })}\n`);
