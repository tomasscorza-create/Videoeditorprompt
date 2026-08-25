import { optional } from './dom.js';
import { notify } from './notifications.js';
import {
  EDITOR_WORKSPACE_EVENT,
  EDITOR_PLAYBACK_EVENT,
  currentEditorOutput,
  currentPreviewAudioUrl,
  editorCanPlay,
  editorOutputState,
  editorWorkspace,
  measuredTimelineFor,
  measuredVisualSceneFor,
  pauseEditorPlayback,
  seekEditorPlayback,
  setEditorPlayhead,
  showEditorCanvas,
  showRenderedPlayback,
  toggleEditorMute,
  toggleEditorPlayback,
  type MeasuredProjectTimeline,
  type MeasuredScene,
} from './editor-workspace.js';
import { setProjectMeasurement } from './editor-workspace.js';
import { measureProject as measureProjectTimes } from './director/api.js';
import { projectTimingFingerprint } from '../../shared/project-fingerprint.js';
import type { ProjectStore } from './project/store.js';
import type { SceneView } from './project/types.js';
import {
  PROJECT_SELECTION_EVENT,
  projectSelection,
  selectProjectItem,
} from './project/selection.js';
import {
  BACKGROUND_DRAG_TYPE,
  CHARACTER_DRAG_TYPE,
  readBackgroundDrag,
  readCharacterDrag,
} from './project/character-placement.js';
import {
  estimateDurationSeconds,
  filmstripTimes,
  pauseLabel,
  rulerTicks,
  snapSeconds,
  turnClipRect,
} from './timeline-geometry.js';
import {
  drawWaveformSlice,
  requestWaveform,
  type WaveformPeaks,
} from './timeline-waveform.js';
import { requestFrame } from './timeline-frames.js';
import {
  buildAnimationLanes,
  countAnchorsRequiringReview,
  duplicateKeyframeCommand,
  nearestAnchorFor,
  resolveWindowSeconds,
  sceneAnimationReference,
  sceneAnimationTiming,
  wordCutAtSeconds,
} from './timeline-animation.js';
import type { SceneTiming } from '../../shared/animation-evaluator.js';
import type { ElementView } from './project/types.js';
import { nextVisualZIndex } from './project/layers.js';
import {
  UNIFIED_MEDIA_TIMELINE_EVENT,
  applyUnifiedMediaToolbarState,
  renderUnifiedMediaRows,
  unifiedMediaClipCount,
  unifiedMediaDurationSeconds,
} from './timeline-v2.js';

const MIN_PIXELS_PER_SECOND = 20;
const MAX_PIXELS_PER_SECOND = 220;
const DEFAULT_PIXELS_PER_SECOND = 60;
const EDITORIAL_SCENE_WIDTH = 190;
const MIN_CLIP_WIDTH = 4;

let initialized = false;
let store: ProjectStore | null = null;
let pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND;
let snapEnabled = true;
let currentTime = 0;
let draggingPlayhead = false;
let observedTimingRevision: string | null = null;
let automaticMeasureTimer = 0;
let measurementQueued = false;

export function initTimelineShell(): void {
  if (initialized) return;
  initialized = true;

  initTimelineModeExplanation();
  optional<HTMLButtonElement>('#timeline-undo')?.addEventListener('click', narratedUndo);
  optional<HTMLButtonElement>('#timeline-redo')?.addEventListener('click', narratedRedo);
  optional<HTMLButtonElement>('#timeline-play')?.addEventListener('click', togglePlayback);
  optional<HTMLButtonElement>('#timeline-previous')?.addEventListener('click', () => jumpBoundary(-1));
  optional<HTMLButtonElement>('#timeline-next')?.addEventListener('click', () => jumpBoundary(1));
  optional<HTMLButtonElement>('#timeline-zoom-out')?.addEventListener('click', () => zoomBy(0.8));
  optional<HTMLButtonElement>('#timeline-zoom-in')?.addEventListener('click', () => zoomBy(1.25));
  optional<HTMLButtonElement>('#timeline-fit')?.addEventListener('click', fitTimeline);
  optional<HTMLButtonElement>('#timeline-snap')?.addEventListener('click', toggleSnap);
  optional<HTMLButtonElement>('#timeline-mute')?.addEventListener('click', toggleMute);
  optional<HTMLButtonElement>('#timeline-measure')?.addEventListener('click', () => void remeasureProject());
  optional<HTMLButtonElement>('#timeline-cut')?.addEventListener('click', () => setCutMode(!cutModeActive));
  // Alt mantiene la tijera mientras se aprieta, sin quedar en un modo pegajoso.
  window.addEventListener('keydown', (event) => { if (event.key === 'Alt') setCutMode(true); });
  window.addEventListener('keyup', (event) => { if (event.key === 'Alt') setCutMode(false); });
  window.addEventListener('blur', () => setCutMode(false));
  optional<HTMLButtonElement>('#timeline-duplicate')?.addEventListener('click', duplicateSelection);
  optional<HTMLButtonElement>('#timeline-split')?.addEventListener('click', splitSelectedTurn);
  optional<HTMLButtonElement>('#timeline-delete')?.addEventListener('click', deleteSelection);
  const shortcutsDialog = optional<HTMLDialogElement>('#timeline-shortcuts-dialog');
  optional<HTMLButtonElement>('#timeline-shortcuts')?.addEventListener('click', () => shortcutsDialog?.showModal());
  optional<HTMLButtonElement>('#timeline-shortcuts-close')?.addEventListener('click', () => shortcutsDialog?.close());
  window.addEventListener('keydown', handleShortcut);
  window.addEventListener(PROJECT_SELECTION_EVENT, () => {
    render();
    updateToolbar();
  });
  window.addEventListener(EDITOR_WORKSPACE_EVENT, () => {
    render();
    syncPlayheadFromMedia();
  });
  window.addEventListener(EDITOR_PLAYBACK_EVENT, () => {
    updateToolbar();
    syncPlayheadFromMedia();
  });
  window.addEventListener(UNIFIED_MEDIA_TIMELINE_EVENT, render);
  render();
}

export function attachProjectTimeline(projectStore: ProjectStore): void {
  store = projectStore;
  observedTimingRevision = projectTimingFingerprint(store.project());
  store.subscribe(() => {
    const nextTimingRevision = projectTimingFingerprint(store!.project());
    if (nextTimingRevision !== observedTimingRevision) {
      observedTimingRevision = nextTimingRevision;
      scheduleAutomaticMeasurement();
    }
    render();
  });
  // Un proyecto nuevo obtiene audio y regla real en segundo plano; la primera
  // exportación deja de ser un requisito para empezar a editar profesionalmente.
  const initialScenes = store.project().scenes;
  const missingVisualRuntime = initialScenes
    .filter((scene) => scene.elements.some((element) => element.type === 'character'))
    .some((scene) => !measuredVisualSceneFor(scene.id));
  if (!compatibleTimeline(initialScenes) || missingVisualRuntime) scheduleAutomaticMeasurement();
  render();
}

export function updateTimelineTime(timeSeconds: number): void {
  currentTime = clamp(timeSeconds, 0, activeDuration());
  // El lienzo previsualiza la animación en este instante, así que el cabezal se
  // publica en el estado del espacio de trabajo en vez de quedarse acá.
  setEditorPlayhead(currentTime);
  const authoringPlayhead = optional<HTMLElement>('#authoring-playhead');
  if (authoringPlayhead) {
    authoringPlayhead.hidden = !hasExactTimelineTime();
    authoringPlayhead.style.left = `calc(var(--timeline-label-width) + ${currentTime * pixelsPerSecond}px)`;
    authoringPlayhead.setAttribute('aria-valuenow', currentTime.toFixed(3));
    authoringPlayhead.setAttribute('aria-valuemax', activeDuration().toFixed(3));
    authoringPlayhead.setAttribute('aria-valuetext', formatTimecode(currentTime));
  }
  updateTimecode();
  if (!draggingPlayhead) followPlayhead();
}

function render(): void {
  if (!initialized) return;
  // Mientras se arrastra el cabezal no se reconstruye el árbol. Cada seek emite
  // EDITOR_WORKSPACE_EVENT, así que un repintado por pointermove reemplazaba el
  // propio <span> que el usuario tenía agarrado: el nodo quedaba huérfano y el
  // estado `is-dragging` se aplicaba sobre un elemento ya removido. Un arrastre
  // solo mueve el tiempo, no la estructura, así que basta con reposicionar el
  // cabezal; al soltar (`onUp`) se repinta todo y se recupera lo que se saltó.
  if (draggingPlayhead) {
    updateToolbar();
    syncPlayheadFromMedia();
    return;
  }
  if (editorWorkspace().mode === 'creator') renderCreatorTimeline();
  else renderProject();
  updateToolbar();
  syncPlayheadFromMedia();
}

// El cabezal sigue al reproductor solo mientras haya un MP4 vigente. Con la
// medición todavía válida pero el render vencido el cabezal es de la timeline:
// lo mueve el usuario y ningún repintado lo devuelve a cero.
function syncPlayheadFromMedia(): void {
  const state = editorWorkspace();
  updateTimelineTime(state.currentTime);
}

function renderCreatorTimeline(): void {
  const timeline = optional<HTMLElement>('.professional-timeline');
  timeline?.classList.add('is-authoring', 'is-creator');
  setTimelineMode(false, 'Creador');
  const root = optional<HTMLElement>('#timeline-layer-stack');
  if (root) {
    root.hidden = false;
    const message = document.createElement('div');
    message.className = 'creator-timeline-state';
    message.innerHTML = '<strong>Creador de recursos</strong><span>La timeline pertenece al Editor de video y se conserva sin cambios mientras diseñás.</span>';
    root.replaceChildren(message);
  }
  setSummary('Volvé al Editor para reproducir y editar la secuencia del video.');
}

function renderProject(): void {
  const project = store?.project();
  optional<HTMLElement>('.professional-timeline')?.classList.add('is-authoring');
  optional<HTMLElement>('.professional-timeline')?.classList.remove('is-creator');
  if (!project) {
    setTimelineMode(false);
    setSummary('Abrí un proyecto para ver su secuencia, capas y diálogos.');
    renderLayerStack(null, [], []);
    return;
  }
  const measured = compatibleTimeline(project.scenes);
  const outputState = editorOutputState();
  const scale = pixelsPerSecond / DEFAULT_PIXELS_PER_SECOND;
  let positions: number[] = [];
  let sceneWidths: number[] = [];
  if (measured) {
    positions = measured.scenes.map((scene) => scene.startSeconds * pixelsPerSecond);
    sceneWidths = measured.scenes.map((scene) => (scene.endSeconds - scene.startSeconds) * pixelsPerSecond);
  } else {
    sceneWidths = project.scenes.map((scene) => Math.max(EDITORIAL_SCENE_WIDTH, wordsInScene(scene) * 8) * scale);
    let cursor = 0;
    for (const width of sceneWidths) {
      positions.push(cursor);
      cursor += width;
    }
  }
  // Medir y reproducir son dos cosas distintas: los tiempos del último render
  // siguen valiendo mientras no cambie nada que altere una duración, aunque el
  // MP4 ya no corresponda a lo que se ve.
  setTimelineMode(
    Boolean(measured),
    measured
      ? (outputState === 'current' ? undefined : 'Preview listo · sin exportar')
      : (outputState === 'stale' ? 'Cambios pendientes' : undefined),
  );
  renderLayerStack(project, positions, sceneWidths, measured);
  const freeMedia = unifiedMediaClipCount();
  const freeMediaLabel = freeMedia > 0 ? ` · ${freeMedia} medio(s) libre(s)` : '';
  setSummary((measured
    ? outputState === 'current'
      ? `1 secuencia continua · ${measured.durationSeconds.toFixed(2)} s medidos · capas alineadas con la exportación actual.`
      : `1 secuencia continua · ${measured.durationSeconds.toFixed(2)} s medidos · Play usa su audio con los cambios visuales actuales.`
    : outputState === 'stale'
      ? '1 secuencia continua · cambios sin exportar · el MP4 anterior quedó fuera del transporte.'
      : '1 secuencia continua · visual arriba, audio abajo · estructura editorial sin tiempos inventados.') + freeMediaLabel);
}

function renderLayerStack(
  project: ReturnType<ProjectStore['project']> | null,
  positions: number[] = [],
  sceneWidths: number[] = [],
  measured: MeasuredProjectTimeline | null = null,
): void {
  const root = optional<HTMLElement>('#timeline-layer-stack');
  if (!root) return;
  root.hidden = !project;
  if (!project) {
    root.replaceChildren();
    optional<HTMLElement>('.professional-timeline')?.classList.remove('is-authoring');
    return;
  }
  root.style.setProperty('--timeline-grid-size', `${pixelsPerSecond}px`);
  const mediaDuration = unifiedMediaDurationSeconds();
  const totalDuration = Math.max(measured?.durationSeconds ?? 0, mediaDuration);
  const totalWidth = Math.max(
    640,
    (positions.at(-1) ?? 0) + (sceneWidths.at(-1) ?? 0),
    totalDuration * pixelsPerSecond,
  );
  const output = currentEditorOutput();
  // La onda sale del audio liviano cuando existe; el MP4 queda como fallback
  // para proyectos históricos. Medir ya no obliga a exportar para ver la voz.
  const waveformUrl = currentPreviewAudioUrl() ?? output?.url ?? null;
  const waveform = measured && waveformUrl ? requestWaveform(waveformUrl, render) : null;
  const rows: HTMLElement[] = [authoringRuler(totalWidth, measured, totalDuration)];
  rows.push(trackDivider('VISUAL', 'Capas que forman la imagen'));
  const authoredWidth = Math.max(1, (positions.at(-1) ?? 0) + (sceneWidths.at(-1) ?? 0));
  const background = project.scenes[0].background;
  const backgroundClip = authoringClip(
    background.resourceId,
    measured ? `${measured.durationSeconds.toFixed(2)} s` : 'Video completo · sin medir',
    0,
    authoredWidth,
    'background',
  );
  bindContinuousBackgroundClip(backgroundClip, project, measured);
  if (measured && output) attachFilmstripCanvas(backgroundClip, 0, measured.durationSeconds);
  rows.push(authoringTrack('BG', 'Fondo', totalWidth, [backgroundClip]));

  const characterGroups = groupElementsByResource(project, 'character');
  for (const [slot, group] of characterGroups.entries()) {
    const clip = continuousElementClip(group, authoredWidth, measured, 'character');
    const track = authoringTrack(`V${slot + 1}`, `Personaje ${slot + 1}`, totalWidth, [clip]);
    acceptCharacterDropOnLane(track, project, positions, sceneWidths);
    rows.push(track);
  }
  const maximumCharacters = Math.max(1, characterGroups.length);
  const propGroups = groupElementsByResource(project, 'prop');
  for (const [slot, group] of propGroups.entries()) {
    rows.push(authoringTrack(`P${slot + 1}`, `Prop ${slot + 1}`, totalWidth, [continuousElementClip(group, authoredWidth, measured, 'character')]));
  }
  const templateGroups = groupElementsByResource(project, 'template');
  for (const [slot, group] of templateGroups.entries()) {
    rows.push(authoringTrack(`E${slot + 1}`, `Efecto ${slot + 1}`, totalWidth, [continuousElementClip(group, authoredWidth, measured, 'character')]));
  }
  rows.push(trackDivider('AUDIO', 'Voces debajo de las capas visuales'));
  for (let slot = 0; slot < maximumCharacters; slot += 1) {
    const clips: HTMLElement[] = [];
    project.scenes.forEach((scene, sceneIndex) => {
      const speaker = scene.elements.filter((element) => element.type === 'character')[slot];
      if (!speaker) return;
      const totalWords = Math.max(1, wordsInScene(scene));
      const measuredTurns = measured?.scenes[sceneIndex]?.turns;
      const turnById = measuredTurns && measuredTurns.length > 0
        ? new Map(measuredTurns.map((measuredTurn) => [measuredTurn.id, measuredTurn]))
        : null;
      let cursor = positions[sceneIndex];
      for (const turn of scene.dialogue) {
        // D1: en medido se usan los tiempos reales por turno; si no, prorrateo por palabras.
        const measuredTurn = turnById?.get(turn.id);
        const { left, width } = measuredTurn
          ? turnClipRect(measuredTurn.startSeconds, measuredTurn.durationSeconds, pixelsPerSecond, MIN_CLIP_WIDTH)
          : { left: cursor, width: Math.max(38, sceneWidths[sceneIndex] * (wordCount(turn.text) / totalWords)) };
        const turnStartSeconds = measuredTurn ? measuredTurn.startSeconds : left / pixelsPerSecond;
        const turnEndSeconds = measuredTurn ? measuredTurn.endSeconds : (left + width) / pixelsPerSecond;
        if (turn.speakerElementId === speaker.id) {
          const selection = projectSelection();
          const detail = measuredTurn
            ? `${turn.voiceId} · ${measuredTurn.durationSeconds.toFixed(2)} s medidos`
            : measured ? `${turn.voiceId} · orden del guion medido` : `${turn.voiceId} · duración pendiente de voz`;
          const clip = authoringClip(
            turn.text,
            detail,
            left,
            width,
            'dialogue',
            selection?.kind === 'dialogue' && selection.turnId === turn.id,
          );
          clip.addEventListener('click', () => clipSingleClick(turnStartSeconds, () => selectDialogue(scene.id, turn.id), () => selectDialogueCore(scene.id, turn.id)));
          clip.addEventListener('dblclick', () => selectDialogue(scene.id, turn.id));
          clip.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            openContextMenu(clip, dialogueMenuItems(scene.id, turn.id, clip));
          });
          bindDialogueDrag(clip, scene.id, turn.id);
          if (measuredTurn) bindDialogueCutter(clip, scene.id, turn, measuredTurn);
          if (waveform) attachWaveformCanvas(clip, turnStartSeconds, turnEndSeconds);
          clips.push(clip);
          clips.push(gapHandle(scene.id, turn.id, turnEndSeconds * pixelsPerSecond, turn.gapAfterSeconds));
          const turnIndex = scene.dialogue.indexOf(turn);
          if (turnIndex > 0 && scene.dialogue.length < 20) {
            const previous = scene.dialogue[turnIndex - 1];
            clips.push(insertButton(left, 'Insertar turno aquí', false, () => insertTurn(scene.id, turn, previous.id)));
          }
        }
        cursor += width;
      }
    });
    rows.push(authoringTrack(`A${slot + 1}`, `Voz ${slot + 1}`, totalWidth, clips));
  }
  const voiceoverClips: HTMLElement[] = [];
  project.scenes.forEach((scene, sceneIndex) => {
    const totalWords = Math.max(1, wordsInScene(scene));
    const measuredTurns = measured?.scenes[sceneIndex]?.turns;
    const turnById = measuredTurns && measuredTurns.length > 0
      ? new Map(measuredTurns.map((measuredTurn) => [measuredTurn.id, measuredTurn]))
      : null;
    let cursor = positions[sceneIndex];
    for (const turn of scene.dialogue) {
      const measuredTurn = turnById?.get(turn.id);
      const { left, width } = measuredTurn
        ? turnClipRect(measuredTurn.startSeconds, measuredTurn.durationSeconds, pixelsPerSecond, MIN_CLIP_WIDTH)
        : { left: cursor, width: Math.max(38, sceneWidths[sceneIndex] * (wordCount(turn.text) / totalWords)) };
      const turnStartSeconds = measuredTurn ? measuredTurn.startSeconds : left / pixelsPerSecond;
      const turnEndSeconds = measuredTurn ? measuredTurn.endSeconds : (left + width) / pixelsPerSecond;
      if (turn.speakerType === 'voiceover') {
        const selection = projectSelection();
        const detail = measuredTurn
          ? `${turn.voiceId} · ${measuredTurn.durationSeconds.toFixed(2)} s medidos`
          : `${turn.voiceId} · voz fuera de campo`;
        const clip = authoringClip(turn.text, detail, left, width, 'dialogue', selection?.kind === 'dialogue' && selection.turnId === turn.id);
        clip.addEventListener('click', () => clipSingleClick(turnStartSeconds, () => selectDialogue(scene.id, turn.id), () => selectDialogueCore(scene.id, turn.id)));
        clip.addEventListener('dblclick', () => selectDialogue(scene.id, turn.id));
        clip.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          openContextMenu(clip, dialogueMenuItems(scene.id, turn.id, clip));
        });
        bindDialogueDrag(clip, scene.id, turn.id);
        if (measuredTurn) bindDialogueCutter(clip, scene.id, turn, measuredTurn);
        if (waveform) attachWaveformCanvas(clip, turnStartSeconds, turnEndSeconds);
        voiceoverClips.push(clip, gapHandle(scene.id, turn.id, turnEndSeconds * pixelsPerSecond, turn.gapAfterSeconds));
        const turnIndex = scene.dialogue.indexOf(turn);
        if (turnIndex > 0 && scene.dialogue.length < 20) {
          voiceoverClips.push(insertButton(left, 'Insertar turno aquí', false, () => insertTurn(scene.id, turn, scene.dialogue[turnIndex - 1].id)));
        }
      }
      cursor += width;
    }
  });
  if (voiceoverClips.length > 0) rows.push(authoringTrack('VO', 'Voz fuera de campo', totalWidth, voiceoverClips));
  rows.push(...renderUnifiedMediaRows(totalWidth, pixelsPerSecond));
  const playhead = document.createElement('span');
  playhead.id = 'authoring-playhead';
  playhead.className = 'authoring-playhead';
  playhead.hidden = !measured;
  bindPlayheadDrag(playhead, root);
  rows.push(playhead);
  root.replaceChildren(...rows);
  syncClipRoving();
  // Dibujar ondas y filmstrips después de adjuntar: recién ahí los canvas tienen tamaño.
  if (waveform) drawWaveforms(root, waveform);
  if (measured && output) drawFilmstrips(root, output.url);
}

function bindPlayheadDrag(playhead: HTMLElement, root: HTMLElement): void {
  playhead.tabIndex = 0;
  playhead.setAttribute('role', 'slider');
  playhead.setAttribute('aria-label', 'Posición del cabezal');
  playhead.setAttribute('aria-valuemin', '0');
  playhead.title = 'Arrastrá para mover el cabezal';

  const moveToPointer = (event: PointerEvent): void => {
    const ruler = root.querySelector<HTMLElement>('.authoring-track-ruler');
    if (!ruler) return;
    const bounds = ruler.getBoundingClientRect();
    const seconds = clamp((event.clientX - bounds.left) / pixelsPerSecond, 0, activeDuration());
    seekTo(snapTime(seconds));
  };
  const onMove = (event: PointerEvent): void => {
    if (!draggingPlayhead) return;
    event.preventDefault();
    moveToPointer(event);
  };
  const onUp = (): void => {
    if (!draggingPlayhead) return;
    draggingPlayhead = false;
    playhead.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    followPlayhead();
    // Repintado diferido de todo lo que el arrastre saltó (onda, filmstrip,
    // rótulos), ya con el cabezal quieto.
    render();
  };
  playhead.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !isMeasured()) return;
    event.preventDefault();
    event.stopPropagation();
    pauseEditorPlayback();
    draggingPlayhead = true;
    playhead.classList.add('is-dragging');
    moveToPointer(event);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  playhead.addEventListener('keydown', (event) => {
    if (!isMeasured()) return;
    const fps = projectFps();
    // Igual que en los clips: el cabezal se mueve por frames, así que tiene que
    // cortar el burbujeo o `handleShortcut` le sumaría además su salto de 0,5 s.
    const consume = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      consume();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      seekTo(currentTime + direction * (event.shiftKey ? 5 : 1) / fps);
    } else if (event.key === 'Home') {
      consume();
      seekTo(0);
    } else if (event.key === 'End') {
      consume();
      seekTo(activeDuration());
    }
  });
}

function attachFilmstripCanvas(clip: HTMLElement, startSeconds: number, endSeconds: number): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'clip-filmstrip';
  canvas.dataset.start = String(startSeconds);
  canvas.dataset.end = String(endSeconds);
  clip.prepend(canvas);
}

function drawFilmstrips(root: HTMLElement, url: string): void {
  root.querySelectorAll<HTMLCanvasElement>('canvas.clip-filmstrip').forEach((canvas) => {
    const start = Number(canvas.dataset.start ?? '0');
    const end = Number(canvas.dataset.end ?? '0');
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const slots = clamp(Math.round(width / 64), 1, 16);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    const slotWidth = width / slots;
    filmstripTimes(start, end, slots).forEach((time, index) => {
      const frame = requestFrame(url, time, render);
      if (frame) drawCover(context, frame, index * slotWidth, 0, slotWidth, height);
    });
  });
}

// Dibuja `image` cubriendo el rectángulo destino (recorte centrado), como background-size: cover.
function drawCover(context: CanvasRenderingContext2D, image: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number): void {
  const scale = Math.max(dw / image.width, dh / image.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (image.width - sw) / 2;
  const sy = (image.height - sh) / 2;
  context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
}

function attachWaveformCanvas(clip: HTMLElement, startSeconds: number, endSeconds: number): void {
  const canvas = document.createElement('canvas');
  canvas.className = 'clip-waveform';
  canvas.dataset.start = String(startSeconds);
  canvas.dataset.end = String(endSeconds);
  clip.prepend(canvas);
}

function drawWaveforms(root: HTMLElement, waveform: WaveformPeaks): void {
  root.querySelectorAll<HTMLCanvasElement>('canvas.clip-waveform').forEach((canvas) => {
    const color = getComputedStyle(canvas).getPropertyValue('--waveform-color').trim() || 'rgba(255,255,255,.55)';
    const start = Number(canvas.dataset.start ?? '0');
    const end = Number(canvas.dataset.end ?? '0');
    drawWaveformSlice(canvas, waveform, start, end, color);
  });
}

function isElementSelected(elementId: string): boolean {
  const selection = projectSelection();
  return (selection?.kind === 'element' || selection?.kind === 'keyframe') && selection.elementId === elementId;
}

interface ElementOccurrence {
  scene: SceneView;
  sceneIndex: number;
  element: ElementView;
}

function groupElementsByResource(
  project: ReturnType<ProjectStore['project']>,
  type: ElementView['type'],
): ElementOccurrence[][] {
  const groups = new Map<string, ElementOccurrence[]>();
  project.scenes.forEach((scene, sceneIndex) => {
    scene.elements.filter((element) => element.type === type).forEach((element) => {
      const key = element.type === 'template' ? element.templateId ?? element.id : element.resourceId ?? element.id;
      const group = groups.get(key) ?? [];
      group.push({ scene, sceneIndex, element });
      groups.set(key, group);
    });
  });
  return [...groups.values()];
}

function occurrenceAtPlayhead(group: ElementOccurrence[], measured: MeasuredProjectTimeline | null): ElementOccurrence {
  if (measured) {
    const active = group.find(({ sceneIndex }) => {
      const timing = measured.scenes[sceneIndex];
      return timing && currentTime >= timing.startSeconds && currentTime < timing.endSeconds;
    });
    if (active) return active;
  }
  return group.find(({ scene }) => scene.id === store?.selectedSceneId()) ?? group[0];
}

function continuousElementClip(
  group: ElementOccurrence[],
  width: number,
  measured: MeasuredProjectTimeline | null,
  kind: 'character',
): HTMLButtonElement {
  const first = group[0].element;
  const title = first.type === 'template' && first.values?.word
    ? `«${first.values.word}»`
    : first.resourceId ?? first.id;
  const clip = authoringClip(
    title,
    elementClipDetail(first),
    0,
    width,
    kind,
    group.some(({ element }) => isElementSelected(element.id)),
  );
  clip.dataset.resource = first.type === 'template' ? first.templateId ?? first.id : first.resourceId ?? first.id;
  let pending = 0;
  for (const occurrence of group) {
    pending += countAnchorsRequiringReview(
      occurrence.element.id,
      occurrence.element.tracks ?? [],
      sceneAnimationReference(occurrence.scene.dialogue),
    );
    appendElementKeyframes(
      clip,
      occurrence.scene,
      occurrence.element,
      measured?.scenes[occurrence.sceneIndex] ?? null,
      0,
      measured?.durationSeconds ?? width / pixelsPerSecond,
    );
  }
  if (pending > 0) clip.append(reviewBadge(pending));
  const select = (withCanvas: boolean): void => {
    const active = occurrenceAtPlayhead(group, measured);
    if (withCanvas) selectElement(active.scene.id, active.element.id);
    else selectElementCore(active.scene.id, active.element.id);
  };
  clip.addEventListener('click', () => clipSingleClick(currentTime, () => select(true), () => select(false)));
  clip.addEventListener('dblclick', () => selectElement(...(() => {
    const active = occurrenceAtPlayhead(group, measured);
    return [active.scene.id, active.element.id] as const;
  })()));
  if (first.type === 'character') {
    clip.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const active = occurrenceAtPlayhead(group, measured);
      openContextMenu(clip, characterMenuItems(active.scene.id, active.element.id, clip));
    });
    acceptResourceDrop(clip, CHARACTER_DRAG_TYPE, (dataTransfer) => {
      const active = occurrenceAtPlayhead(group, measured);
      applyCharacterDrop(active.scene.id, active.element.id, dataTransfer);
    });
  }
  return clip;
}

function bindContinuousBackgroundClip(
  clip: HTMLButtonElement,
  project: ReturnType<ProjectStore['project']>,
  measured: MeasuredProjectTimeline | null,
): void {
  const select = (): void => {
    const index = measured?.scenes.findIndex((timing) => currentTime >= timing.startSeconds && currentTime < timing.endSeconds) ?? -1;
    selectScene(project.scenes[Math.max(0, index)]?.id ?? project.scenes[0].id);
  };
  clip.addEventListener('click', select);
  clip.addEventListener('dblclick', select);
  acceptResourceDrop(clip, BACKGROUND_DRAG_TYPE, (dataTransfer) => applyContinuousBackgroundDrop(project, dataTransfer));
}

function applyContinuousBackgroundDrop(
  project: ReturnType<ProjectStore['project']>,
  dataTransfer: DataTransfer,
): void {
  const resourceId = readBackgroundDrag(dataTransfer);
  if (!resourceId || !store) return;
  const presets = store.resources('background').find((resource) => resource.id === resourceId)?.capabilities?.cameraPresets;
  const list = Array.isArray(presets) ? (presets as string[]) : ['static'];
  const cameraPreset = list.includes('static') ? 'static' : list[0];
  const error = store.dispatchBatch(project.scenes.map((scene) => ({
    type: 'set-scene-background',
    sceneId: scene.id,
    resourceId,
    cameraPreset,
  })));
  if (error) window.alert(error);
}

function appendElementKeyframes(
  clip: HTMLElement,
  scene: SceneView,
  element: ElementView,
  measured: MeasuredScene | null,
  clipStartSeconds = measured?.startSeconds ?? 0,
  clipDurationSeconds = measured ? measured.endSeconds - measured.startSeconds : 0,
): void {
  if (!measured || !element.tracks?.length) return;
  const reference = sceneAnimationReference(scene.dialogue);
  const timing = sceneAnimationTiming(measured, reference);
  if (!timing) return;
  const lanes = buildAnimationLanes(element.id, element.tracks, {
    timing,
    reference,
    fps: projectFps(),
  });
  const selected = projectSelection();
  const clipWidth = Math.max(MIN_CLIP_WIDTH, clipDurationSeconds * pixelsPerSecond);
  for (const [laneIndex, lane] of lanes.entries()) {
    for (const keyframe of lane.keyframes) {
      if (keyframe.seconds === null || keyframe.status === 'out-of-scene') continue;
      const marker = document.createElement('span');
      marker.className = 'timeline-keyframe-marker';
      marker.classList.toggle(
        'is-selected',
        selected?.kind === 'keyframe'
          && selected.sceneId === scene.id
          && selected.elementId === element.id
          && selected.parameterId === lane.parameterId
          && selected.keyframeId === keyframe.id,
      );
      marker.style.left = `${clamp(
        (keyframe.seconds - clipStartSeconds) * pixelsPerSecond,
        4,
        Math.max(4, clipWidth - 4),
      )}px`;
      marker.style.setProperty('--keyframe-offset', `${(laneIndex % 3) * 0.48}rem`);
      marker.dataset.keyframe = keyframe.id;
      marker.dataset.parameter = lane.parameterId;
      marker.title = `${lane.label}: ${keyframe.valueLabel} · ${keyframe.timeLabel}`;
      marker.addEventListener('pointerdown', (event) => event.stopPropagation());
      marker.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        pauseEditorPlayback();
        showEditorCanvas();
        setEditorPlayhead(keyframe.seconds as number);
        if (store?.selectedSceneId() !== scene.id) store?.dispatch({ type: 'select-scene', sceneId: scene.id });
        selectProjectItem({
          kind: 'keyframe',
          sceneId: scene.id,
          elementId: element.id,
          parameterId: lane.parameterId,
          keyframeId: keyframe.id,
        });
      });
      clip.append(marker);
    }
  }
  if (clip.querySelector('.timeline-keyframe-marker')) clip.classList.add('has-keyframes');
}

function projectFps(): number {
  const fps = store?.project().video?.fps;
  return Number.isInteger(fps) && (fps as number) > 0 ? fps as number : 30;
}

function elementClipDetail(element: ElementView): string {
  // Una plantilla no expone escala: cubre el cuadro y solo se edita su palabra.
  if (element.type === 'template') return `Efecto en la capa ${element.transform.zIndex}`;
  const parts = [`Escala ${element.transform.scale.toFixed(2)}`];
  if (element.type === 'character') parts.push(`movimiento base ${element.animationPreset ?? 'sin definir'}`);
  return parts.join(' · ');
}

function reviewBadge(count: number): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'animation-review-badge';
  badge.textContent = `⚠ ${count}`;
  badge.title = `${count} referencia(s) de animación para revisar en este elemento.`;
  return badge;
}

function deleteKeyframe(
  context: { sceneId: string; elementId: string },
  parameterId: string,
  keyframeId: string,
): void {
  const error = store?.dispatch({
    type: 'delete-keyframe',
    sceneId: context.sceneId,
    elementId: context.elementId,
    parameterId,
    keyframeId,
  });
  if (error) notify({ message: error, level: 'error' });
  else selectProjectItem({ kind: 'element', sceneId: context.sceneId, elementId: context.elementId });
}

// U3 — Los clips forman un único recorrido por teclado (roving tabindex):
// Tab entra a la timeline, las flechas se mueven entre clips y Enter abre el
// elemento en el inspector. Se anuncia cada movimiento por `aria-live`.
function announceTimeline(message: string): void {
  const region = optional<HTMLElement>('#timeline-live');
  if (region) region.textContent = message;
}

function timelineClips(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.timeline-layer-stack .authoring-clip')];
}

function focusClip(clip: HTMLElement): void {
  for (const other of timelineClips()) other.tabIndex = other === clip ? 0 : -1;
  clip.focus();
  clip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  announceTimeline(`${clip.querySelector('strong')?.textContent ?? 'Clip'}. ${clip.querySelector('small')?.textContent ?? ''}`);
}

function bindClipKeyboard(clip: HTMLElement): void {
  clip.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const clips = timelineClips();
    const index = clips.indexOf(clip);
    if (index < 0) return;
    event.preventDefault();
    // `handleShortcut` escucha en window: sin cortar el burbujeo, una flecha
    // movía el foco entre clips Y además desplazaba el cabezal medio segundo.
    event.stopPropagation();
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? clips.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + clips.length) % clips.length;
    const target = clips[next];
    if (target) focusClip(target);
  });
}

function syncClipRoving(): void {
  const clips = timelineClips();
  if (clips.length === 0) return;
  const selected = clips.find((clip) => clip.classList.contains('is-selected')) ?? clips[0];
  for (const clip of clips) clip.tabIndex = clip === selected ? 0 : -1;
}

function authoringTrack(code: string, label: string, width: number, clips: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'authoring-track-row';
  for (const clip of clips) bindClipKeyboard(clip);
  const heading = document.createElement('div');
  heading.className = 'authoring-track-label';
  heading.innerHTML = `<strong>${code}</strong><span>${label}</span>`;
  const lane = document.createElement('div');
  lane.className = 'authoring-track-lane';
  lane.style.width = `${Math.ceil(width)}px`;
  lane.append(...clips);
  row.append(heading, lane);
  return row;
}

function authoringRuler(width: number, measured: MeasuredProjectTimeline | null, unifiedDurationSeconds: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'authoring-track-row authoring-ruler-row';
  const label = document.createElement('div');
  label.className = 'authoring-track-label';
  label.innerHTML = `<strong>TIEMPO</strong><span>${measured ? 'medido' : 'sin medir'}</span>`;
  const ruler = document.createElement('div');
  ruler.className = 'authoring-track-ruler';
  ruler.style.width = `${Math.ceil(width)}px`;
  if (measured || unifiedDurationSeconds > 0) {
    ruler.title = 'Clic para mover el cabezal de reproducción';
    ruler.addEventListener('click', (event) => {
      const bounds = ruler.getBoundingClientRect();
      seekTo(snapTime((event.clientX - bounds.left) / pixelsPerSecond));
    });
    // Subdivisiones de segundos/medios/cuartos según el zoom (solo con medición).
    for (const tick of rulerTicks(unifiedDurationSeconds, pixelsPerSecond)) {
      const mark = document.createElement('span');
      mark.className = `ruler-tick ${tick.major ? 'is-major' : 'is-minor'}`;
      mark.style.left = `${tick.position}px`;
      if (tick.major) mark.textContent = formatRulerTime(tick.seconds);
      ruler.append(mark);
    }
  }
  row.append(label, ruler);
  return row;
}

const FADE_DEFAULT_SECONDS = 0.35;
const FADE_MIN_SECONDS = 0.05;
const FADE_MAX_SECONDS = 2;

// B1: alterna corte↔fundido conservando una transición válida siempre.
function cycleTransition(sceneId: string, current: 'cut' | 'fade'): void {
  if (!store) return;
  if (current === 'cut') {
    store.dispatch({ type: 'set-transition', sceneId, preset: 'fade', durationSeconds: FADE_DEFAULT_SECONDS });
  } else {
    store.dispatch({ type: 'set-transition', sceneId, preset: 'cut', durationSeconds: 0 });
  }
}

// B1: popover para ajustar la duración del fundido (rango del contrato). Elegir corte
// pone duración 0; mover el rango implica fundido. Cerrable con Esc o clic afuera.
function openTransitionPopover(anchor: HTMLElement, sceneId: string, preset: 'cut' | 'fade', durationSeconds: number): void {
  closeTimelinePopover();
  const popover = document.createElement('div');
  popover.className = 'timeline-popover transition-popover';
  const heading = document.createElement('strong');
  heading.textContent = 'Transición';
  const cut = document.createElement('button');
  cut.type = 'button';
  cut.className = 'timeline-popover-option';
  cut.textContent = '✂ Corte';
  cut.classList.toggle('is-active', preset === 'cut');
  cut.addEventListener('click', () => {
    store?.dispatch({ type: 'set-transition', sceneId, preset: 'cut', durationSeconds: 0 });
    closeTimelinePopover();
  });
  const row = document.createElement('label');
  row.className = 'timeline-popover-range';
  const rangeLabel = document.createElement('span');
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(FADE_MIN_SECONDS);
  range.max = String(FADE_MAX_SECONDS);
  range.step = '0.05';
  range.value = String(preset === 'fade' && durationSeconds > 0 ? durationSeconds : FADE_DEFAULT_SECONDS);
  const paint = () => { rangeLabel.textContent = `◇ Fundido ${Number(range.value).toFixed(2)} s`; };
  paint();
  range.addEventListener('input', () => {
    paint();
    store?.dispatch({ type: 'set-transition', sceneId, preset: 'fade', durationSeconds: Number(range.value) });
  });
  row.append(rangeLabel, range);
  popover.append(heading, cut, row);
  positionPopover(popover, anchor);
}

let activePopover: HTMLElement | null = null;

// Ancla un popover flotante (fixed) junto a `anchor`, dentro del viewport, y lo cierra
// con Esc o clic afuera. Compartido por B1 (unión) y B3 (menú contextual).
function positionPopover(popover: HTMLElement, anchor: HTMLElement): void {
  document.body.append(popover);
  activePopover = popover;
  const anchorRect = anchor.getBoundingClientRect();
  const rect = popover.getBoundingClientRect();
  const left = clamp(anchorRect.left, 8, window.innerWidth - rect.width - 8);
  const top = anchorRect.bottom + 6 + rect.height > window.innerHeight
    ? anchorRect.top - rect.height - 6
    : anchorRect.bottom + 6;
  popover.style.left = `${Math.max(8, left)}px`;
  popover.style.top = `${Math.max(8, top)}px`;
  window.addEventListener('keydown', popoverKeydown, true);
  window.addEventListener('pointerdown', popoverPointerdown, true);
  const first = popover.querySelector<HTMLElement>('button, input, [tabindex]');
  first?.focus();
}

function closeTimelinePopover(): void {
  if (!activePopover) return;
  window.removeEventListener('keydown', popoverKeydown, true);
  window.removeEventListener('pointerdown', popoverPointerdown, true);
  activePopover.remove();
  activePopover = null;
}

function popoverKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeTimelinePopover();
  }
}

function popoverPointerdown(event: PointerEvent): void {
  if (activePopover && !activePopover.contains(event.target as Node)) closeTimelinePopover();
}

// ---- B3: menú contextual por clip ----

interface MenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

function openContextMenu(anchor: HTMLElement, items: MenuItem[]): void {
  closeTimelinePopover();
  const menu = document.createElement('div');
  menu.className = 'timeline-popover context-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item.separator) {
      const separator = document.createElement('div');
      separator.className = 'timeline-popover-separator';
      menu.append(separator);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'timeline-popover-item';
    button.setAttribute('role', 'menuitem');
    button.textContent = item.label ?? '';
    if (item.disabled) button.disabled = true;
    else button.addEventListener('click', () => { closeTimelinePopover(); item.action?.(); });
    menu.append(button);
  }
  menu.addEventListener('keydown', menuKeydown);
  positionPopover(menu, anchor);
}

// Navegación por teclado dentro del menú (flechas mueven el foco entre ítems activos).
function menuKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const menu = event.currentTarget as HTMLElement;
  const options = [...menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  if (options.length === 0) return;
  const current = options.indexOf(document.activeElement as HTMLButtonElement);
  const delta = event.key === 'ArrowDown' ? 1 : -1;
  const next = (current + delta + options.length) % options.length;
  options[next].focus();
}

function sceneMenuItems(sceneId: string, anchor: HTMLElement): MenuItem[] {
  const scenes = store?.project().scenes ?? [];
  const index = scenes.findIndex((scene) => scene.id === sceneId);
  const scene = scenes[index];
  const canAdd = scenes.length < 8;
  const isLast = index === scenes.length - 1;
  return [
    { label: 'Duplicar momento', disabled: !canAdd, action: () => duplicateSceneById(sceneId) },
    { label: 'Insertar momento antes', disabled: !canAdd, action: () => insertSceneAt(sceneId, index) },
    { label: 'Insertar momento después', disabled: !canAdd, action: () => insertSceneAt(sceneId, index + 1) },
    { label: 'Agregar voz fuera de campo', disabled: !scene || scene.dialogue.length >= 20, action: () => addVoiceoverTurn(sceneId) },
    { separator: true },
    { label: '← Mover a la izquierda', disabled: index <= 0, action: () => moveScene(index, -1) },
    { label: 'Mover a la derecha →', disabled: index < 0 || index >= scenes.length - 1, action: () => moveScene(index, 1) },
    { separator: true },
    { label: isLast ? 'Enlace (no hay momento siguiente)' : 'Editar enlace…', disabled: isLast, action: () => openTransitionPopoverForScene(sceneId, anchor) },
    { separator: true },
    { label: 'Acortar momento…', action: () => openShortenPanel(anchor, sceneId) },
    { label: 'Eliminar momento', disabled: scenes.length <= 1, action: () => deleteSceneById(sceneId) },
  ];
}

function characterMenuItems(sceneId: string, elementId: string, anchor: HTMLElement): MenuItem[] {
  return [
    { label: 'Cambiar recurso…', action: () => openResourcePicker(anchor, 'Personajes', 'character', (resourceId) => {
      const error = store?.dispatch({ type: 'set-character-resource', sceneId, elementId, resourceId });
      if (error) window.alert(error);
    }) },
    { separator: true },
    { label: 'Quitar personaje', action: () => {
      const error = store?.dispatch({ type: 'delete-element', sceneId, elementId });
      if (error) window.alert(error);
    } },
  ];
}

function dialogueMenuItems(sceneId: string, turnId: string, anchor: HTMLElement): MenuItem[] {
  const scene = store?.project().scenes.find((item) => item.id === sceneId);
  const turnIndex = scene?.dialogue.findIndex((turn) => turn.id === turnId) ?? -1;
  const turn = scene?.dialogue[turnIndex];
  const previous = turnIndex > 0 ? scene?.dialogue[turnIndex - 1] : undefined;
  const speakers = scene?.elements.filter((element) => element.type === 'character') ?? [];
  const canAdd = (scene?.dialogue.length ?? 20) < 20;
  const canSplit = canSplitAtIndex(scene?.dialogue.length ?? 0, turnIndex) && (store?.project().scenes.length ?? 8) < 8;
  const cut = dialogueCutPlan(sceneId, turnId);
  const items: MenuItem[] = [
    {
      label: cut.atWord === null ? `Cortar el diálogo · ${cut.blocked}` : `✂ Cortar el diálogo en el cabezal · palabra ${cut.atWord} (B)`,
      disabled: cut.atWord === null,
      action: () => cutDialogueTurn(sceneId, turnId),
    },
    { separator: true },
    { label: 'Insertar turno antes', disabled: !canAdd || !turn || turnIndex === 0, action: () => turn && insertTurn(sceneId, turn, previous?.id) },
    { label: 'Insertar turno después', disabled: !canAdd || !turn, action: () => turn && insertTurn(sceneId, turn, turn.id) },
    { separator: true },
    { label: canSplit ? 'Dividir momento aquí' : 'Dividir aquí (necesita 1 turno por lado)', disabled: !canSplit, action: () => splitSceneAtTurn(sceneId, turnId) },
    { separator: true },
  ];
  if (turn) {
    items.push({ label: 'Cambiar hablante…', action: () => openResourcePicker(
      anchor,
      'Hablante',
      null,
      (speakerElementId) => {
        const error = speakerElementId === '__voiceover__'
          ? store?.dispatch({ type: 'set-dialogue-voiceover', sceneId, turnId })
          : store?.dispatch({ type: 'set-dialogue-speaker', sceneId, turnId, speakerElementId });
        if (error) window.alert(error);
      },
      [
        { id: '__voiceover__', label: 'Voz fuera de campo' },
        ...speakers.map((element) => ({ id: element.id, label: element.resourceId ?? element.id })),
      ],
    ) });
    items.push({ separator: true });
  }
  items.push({ label: 'Eliminar turno', action: () => store?.dispatch({ type: 'delete-dialogue-turn', sceneId, turnId }) });
  return items;
}

// Lista de opciones (recursos del catálogo o hablantes) como un popover de selección.
function openResourcePicker(
  anchor: HTMLElement,
  title: string,
  resourceType: 'character' | null,
  onPick: (id: string) => void,
  explicit?: Array<{ id: string; label: string }>,
): void {
  const options = explicit ?? (resourceType ? store?.resources(resourceType).map((resource) => ({ id: resource.id, label: resource.label })) ?? [] : []);
  const items: MenuItem[] = options.length > 0
    ? options.map((option) => ({ label: option.label, action: () => onPick(option.id) }))
    : [{ label: 'Sin opciones disponibles', disabled: true }];
  openContextMenu(anchor, [{ label: title, disabled: true }, { separator: true }, ...items]);
}

function duplicateSceneById(sceneId: string): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const newSceneId = nextSceneId(store.project().scenes.map((item) => item.id));
  const error = store.dispatch({ type: 'duplicate-scene', sceneId, newSceneId, title: `${scene.title} copia` });
  if (!error) selectScene(newSceneId);
}

// Una escena nueva es un borrador vacío deliberado. El usuario decide si será narrada,
// tendrá uno o dos personajes o quedará solo como composición mientras la completa.
function insertSceneAt(referenceSceneId: string, targetIndex: number): void {
  if (!store) return;
  const scenes = store.project().scenes;
  const reference = scenes.find((item) => item.id === referenceSceneId);
  if (!reference || scenes.length >= 8) return;
  const newSceneId = nextSceneId(scenes.map((item) => item.id));
  const error = store.dispatch({
    type: 'add-scene',
    scene: {
      id: newSceneId,
      title: 'Nuevo momento',
      background: { ...reference.background },
      elements: [],
      dialogue: [],
    },
  });
  if (error) { window.alert(error); return; }
  const currentIndex = store.project().scenes.findIndex((item) => item.id === newSceneId);
  if (currentIndex !== targetIndex) {
    const ids = store.project().scenes.map((item) => item.id).filter((id) => id !== newSceneId);
    ids.splice(clamp(targetIndex, 0, ids.length), 0, newSceneId);
    store.dispatch({ type: 'reorder-scenes', sceneIds: ids });
  }
  selectScene(newSceneId);
}

function moveScene(index: number, direction: -1 | 1): void {
  if (!store) return;
  const ids = store.project().scenes.map((item) => item.id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  store.dispatch({ type: 'reorder-scenes', sceneIds: ids });
}

function deleteSceneById(sceneId: string): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene || store.project().scenes.length <= 1 || !window.confirm(`¿Eliminar «${scene.title}»?`)) return;
  store.dispatch({ type: 'delete-scene', sceneId });
}

function addVoiceoverTurn(sceneId: string, afterTurnId?: string, voiceId?: string): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  const voice = voiceId ?? store.resources('voice')[0]?.id;
  if (!scene || !voice) {
    notify({ message: 'No hay una voz disponible para crear la narración.', level: 'error' });
    return;
  }
  const turnId = nextTurnId(scene.dialogue.map((turn) => turn.id));
  const error = store.dispatch({
    type: 'add-voiceover-turn',
    sceneId,
    turnId,
    text: 'Nueva narración',
    voiceId: voice,
    gapAfterSeconds: 0,
    ...(afterTurnId ? { afterTurnId } : {}),
  });
  if (error) window.alert(error);
  else selectDialogue(sceneId, turnId);
}

function insertTurn(sceneId: string, reference: { speakerType?: 'character' | 'voiceover'; speakerElementId?: string; voiceId: string }, afterTurnId?: string): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const turnId = nextTurnId(scene.dialogue.map((turn) => turn.id));
  if (reference.speakerType === 'voiceover' || !reference.speakerElementId) {
    addVoiceoverTurn(sceneId, afterTurnId, reference.voiceId);
    return;
  }
  const command = {
    type: 'add-dialogue-turn' as const, sceneId, turnId,
    speakerElementId: reference.speakerElementId, text: 'Nuevo diálogo', voiceId: reference.voiceId,
    gestureId: 'neutral' as const, gapAfterSeconds: 0,
    ...(afterTurnId ? { afterTurnId } : {}),
  };
  const error = store.dispatch(command);
  if (error) window.alert(error);
  else selectDialogue(sceneId, turnId);
}

// ---- Recorte de elementos visuales: arrastrar los bordes del clip ----

// Un personaje, prop o plantilla dura toda su escena salvo que declare una
// ventana. Acá esa ventana se edita como en cualquier editor: agarrando el
// borde del clip. El rectángulo que se ve es el tramo real en el que el
// elemento va a estar en el MP4, porque se resuelve con el mismo evaluador.
interface ElementClipRect {
  left: number;
  width: number;
  windowSeconds: { fromSeconds: number; toSeconds: number } | null;
}

function elementClipRect(scene: SceneView, element: ElementView, measured: MeasuredScene | null): ElementClipRect {
  const sceneIndex = store?.project().scenes.findIndex((item) => item.id === scene.id) ?? -1;
  const fullLeft = measured ? measured.startSeconds * pixelsPerSecond : 0;
  const fullWidth = measured ? (measured.endSeconds - measured.startSeconds) * pixelsPerSecond : 0;
  if (!measured || !element.visibility) return { left: fullLeft, width: fullWidth, windowSeconds: null };
  const timing = sceneAnimationTiming(measured, sceneAnimationReference(scene.dialogue));
  const window = resolveWindowSeconds(element.visibility, timing);
  if (!window || sceneIndex < 0) return { left: fullLeft, width: fullWidth, windowSeconds: null };
  return {
    left: window.fromSeconds * pixelsPerSecond,
    width: Math.max(MIN_CLIP_WIDTH, (window.toSeconds - window.fromSeconds) * pixelsPerSecond),
    windowSeconds: window,
  };
}

function bindElementTrim(
  clip: HTMLElement,
  scene: SceneView,
  element: ElementView,
  measured: MeasuredScene,
): void {
  const timing = sceneAnimationTiming(measured, sceneAnimationReference(scene.dialogue));
  if (!timing) return;
  clip.classList.add('is-trimmable');
  const current = resolveWindowSeconds(element.visibility, timing)
    ?? { fromSeconds: measured.startSeconds, toSeconds: measured.endSeconds };

  for (const edge of ['from', 'to'] as const) {
    const handle = document.createElement('span');
    handle.className = `clip-trim-handle is-${edge}`;
    handle.title = edge === 'from' ? 'Arrastrá para que aparezca más tarde' : 'Arrastrá para que desaparezca antes';
    let dragging = false;
    let preview = current[edge === 'from' ? 'fromSeconds' : 'toSeconds'];

    const secondsAt = (event: PointerEvent): number => {
      const lane = clip.parentElement;
      if (!lane) return preview;
      const bounds = lane.getBoundingClientRect();
      return clamp((event.clientX - bounds.left) / pixelsPerSecond, measured.startSeconds, measured.endSeconds);
    };
    const paint = (): void => {
      const from = edge === 'from' ? preview : current.fromSeconds;
      const to = edge === 'from' ? current.toSeconds : preview;
      clip.style.left = `${from * pixelsPerSecond}px`;
      clip.style.width = `${Math.max(MIN_CLIP_WIDTH, (to - from) * pixelsPerSecond)}px`;
      announceTimeline(`${element.resourceId ?? element.id}: ${from.toFixed(2)} s a ${to.toFixed(2)} s`);
    };
    const onMove = (event: PointerEvent): void => {
      if (!dragging) return;
      event.preventDefault();
      const raw = secondsAt(event);
      // Nunca cruzar el otro borde: se deja al menos un cuadro de ancho.
      const minimum = 1 / projectFps();
      preview = edge === 'from'
        ? Math.min(raw, current.toSeconds - minimum)
        : Math.max(raw, current.fromSeconds + minimum);
      paint();
    };
    const onUp = (): void => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      clip.classList.remove('is-trimming');
      commitTrim(scene, element, timing, {
        fromSeconds: edge === 'from' ? preview : current.fromSeconds,
        toSeconds: edge === 'from' ? current.toSeconds : preview,
      }, measured);
    };
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      clip.classList.add('is-trimming');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    clip.append(handle);
  }
}

// Tijera sobre un elemento visual: parte el clip en dos donde se hace clic.
// Cada mitad queda con su propia ventana y se puede recortar por separado.
function bindElementRazor(
  clip: HTMLElement,
  scene: SceneView,
  element: ElementView,
  measured: MeasuredScene,
): void {
  const timing = sceneAnimationTiming(measured, sceneAnimationReference(scene.dialogue));
  if (!timing) return;
  const guide = document.createElement('span');
  guide.className = 'dialogue-cut-guide';
  guide.hidden = true;
  clip.append(guide);

  const secondsAt = (event: PointerEvent | MouseEvent): number | null => {
    const bounds = clip.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const window = resolveWindowSeconds(element.visibility, timing)
      ?? { fromSeconds: measured.startSeconds, toSeconds: measured.endSeconds };
    const progress = (event.clientX - bounds.left) / bounds.width;
    const seconds = window.fromSeconds + progress * (window.toSeconds - window.fromSeconds);
    // El corte tiene que dejar al menos un cuadro de cada lado.
    const minimum = 1 / projectFps();
    if (seconds <= window.fromSeconds + minimum || seconds >= window.toSeconds - minimum) return null;
    return seconds;
  };

  clip.addEventListener('pointermove', (event) => {
    if (!cutModeActive) { guide.hidden = true; return; }
    const seconds = secondsAt(event);
    if (seconds === null) { guide.hidden = true; return; }
    const bounds = clip.getBoundingClientRect();
    guide.hidden = false;
    guide.style.left = `${event.clientX - bounds.left}px`;
    clip.title = `Partir acá: ${seconds.toFixed(2)} s`;
  });
  clip.addEventListener('pointerleave', () => { guide.hidden = true; });
  clip.addEventListener('pointerdown', (event) => {
    if (!cutModeActive || event.button !== 0) return;
    const seconds = secondsAt(event);
    if (seconds === null) return;
    event.preventDefault();
    event.stopPropagation();
    splitElementAt(scene, element, timing, seconds);
  });
}

function splitElementAt(scene: SceneView, element: ElementView, timing: SceneTiming, seconds: number): void {
  if (!store) return;
  const newElementId = nextElementId(`${element.id}-b`, scene.elements.map((item) => item.id));
  const error = store.dispatch({
    type: 'split-element',
    sceneId: scene.id,
    elementId: element.id,
    at: anchorFor(seconds, timing, projectFps()),
    newElementId,
  });
  if (error) {
    notify({ message: error, level: 'error' });
    return;
  }
  selectElementCore(scene.id, newElementId);
  notify({ message: `Partido en ${seconds.toFixed(2)} s. Cada mitad se recorta por separado.` });
}

// Traduce el tramo arrastrado a la referencia semántica más cercana, que es lo
// que hace que el recorte sobreviva a editar el diálogo.
function commitTrim(
  scene: SceneView,
  element: ElementView,
  timing: SceneTiming,
  window: { fromSeconds: number; toSeconds: number },
  measured: MeasuredScene,
): void {
  const fps = projectFps();
  const cubreTodo = window.fromSeconds <= measured.startSeconds + 1e-6
    && window.toSeconds >= measured.endSeconds - 1e-6;
  const error = cubreTodo
    // Volver a cubrir la escena entera es quitar la ventana, no guardar una que
    // abarque todo: así el proyecto no acumula datos que no dicen nada.
    ? store?.dispatch({ type: 'clear-element-window', sceneId: scene.id, elementId: element.id })
    : store?.dispatch({
      type: 'set-element-window',
      sceneId: scene.id,
      elementId: element.id,
      from: anchorFor(window.fromSeconds, timing, fps),
      to: anchorFor(window.toSeconds, timing, fps),
    });
  if (error) {
    notify({ message: error, level: 'error' });
    render();
    return;
  }
  notify({
    message: cubreTodo
      ? 'El elemento vuelve a verse durante todo el tramo disponible.'
      : `Se ve de ${window.fromSeconds.toFixed(2)} s a ${window.toSeconds.toFixed(2)} s.`,
  });
}

function anchorFor(seconds: number, timing: SceneTiming, fps: number): { anchor: unknown; offsetSeconds: number } {
  const proposal = nearestAnchorFor(seconds, timing, fps);
  return { anchor: proposal.anchor, offsetSeconds: proposal.offsetSeconds };
}

// ---- Corte con el mouse sobre el clip de diálogo ----

// Un corte a ciegas no es una herramienta. Con la medición vigente el clip
// dibuja sus fronteras de palabra y sigue al mouse con la línea de corte pegada
// a la más cercana, así se ve exactamente dónde va a caer antes de confirmar.
// Un clic corta ahí, sin depender de dónde quedó el cabezal.
function bindDialogueCutter(
  clip: HTMLElement,
  sceneId: string,
  turn: { id: string; text: string },
  measured: { startSeconds: number; durationSeconds: number },
): void {
  const words = wordCount(turn.text);
  if (words < 2) return;
  clip.classList.add('is-cuttable');

  // Fronteras internas: entre la palabra 1 y la 2, la 2 y la 3, etc.
  for (let boundary = 1; boundary < words; boundary += 1) {
    const mark = document.createElement('span');
    mark.className = 'dialogue-word-boundary';
    mark.style.left = `${(boundary / words) * 100}%`;
    clip.append(mark);
  }

  const guide = document.createElement('span');
  guide.className = 'dialogue-cut-guide';
  guide.hidden = true;
  clip.append(guide);

  // Palabra bajo el puntero, con el mismo prorrateo que ubica un ancla.
  const boundaryAt = (event: PointerEvent | MouseEvent): number | null => {
    const bounds = clip.getBoundingClientRect();
    if (bounds.width <= 0) return null;
    const progress = (event.clientX - bounds.left) / bounds.width;
    return wordCutAtSeconds(
      { startSeconds: measured.startSeconds, durationSeconds: measured.durationSeconds, wordCount: words },
      measured.startSeconds + progress * measured.durationSeconds,
    );
  };

  clip.addEventListener('pointermove', (event) => {
    if (!cutModeActive) { guide.hidden = true; return; }
    const boundary = boundaryAt(event);
    if (boundary === null) { guide.hidden = true; return; }
    guide.hidden = false;
    guide.style.left = `${(boundary / words) * 100}%`;
    clip.title = `Cortar acá: después de la palabra ${boundary} de ${words}`;
  });
  clip.addEventListener('pointerleave', () => { guide.hidden = true; });
  clip.addEventListener('pointerdown', (event) => {
    if (!cutModeActive || event.button !== 0) return;
    const boundary = boundaryAt(event);
    if (boundary === null) return;
    event.preventDefault();
    event.stopPropagation();
    cutDialogueTurnAtWord(sceneId, turn.id, boundary);
  });
}

// Modo tijera: mientras está encendido, el clic sobre un diálogo corta en vez
// de seleccionar. Se enciende con el botón de la barra o manteniendo Alt.
let cutModeActive = false;

function setCutMode(active: boolean): void {
  if (cutModeActive === active) return;
  cutModeActive = active;
  document.body.classList.toggle('is-cut-mode', active);
  const button = optional<HTMLButtonElement>('#timeline-cut');
  button?.classList.toggle('is-active', active);
  button?.setAttribute('aria-pressed', String(active));
  render();
}

// ---- Corte de diálogo: partir un turno en dos por una palabra ----

// Un turno es una síntesis de ElevenLabs entera, así que «cortar el audio» significa
// producir dos enunciados que se vuelven a medir, nunca recortar un WAV. El punto
// de corte sale del cabezal por el mismo prorrateo que ubica las anclas de
// palabra, y por eso exige medición vigente: sin ella no hay dónde cae el cabezal
// dentro del turno y no se inventa una posición.
interface DialogueCutPlan {
  atWord: number | null;
  /** Por qué no se puede cortar, en lenguaje de usuario. */
  blocked: string | null;
}

function dialogueCutPlan(sceneId: string, turnId: string): DialogueCutPlan {
  const project = store?.project();
  const sceneIndex = project?.scenes.findIndex((item) => item.id === sceneId) ?? -1;
  const scene = sceneIndex >= 0 ? project!.scenes[sceneIndex] : undefined;
  const turn = scene?.dialogue.find((item) => item.id === turnId);
  if (!scene || !turn) return { atWord: null, blocked: 'El diálogo ya no existe.' };
  if (scene.dialogue.length >= 20) return { atWord: null, blocked: 'Este tramo llegó al máximo de diálogos.' };
  if (wordCount(turn.text) < 2) return { atWord: null, blocked: 'Necesita al menos dos palabras para cortarse.' };
  const measured = compatibleTimeline(project!.scenes);
  const measuredTurn = measured?.scenes[sceneIndex]?.turns?.find((item) => item.id === turnId);
  if (!measuredTurn) return { atWord: null, blocked: 'Hace falta medir las voces para saber dónde cae el cabezal.' };
  const atWord = wordCutAtSeconds(
    { startSeconds: measuredTurn.startSeconds, durationSeconds: measuredTurn.durationSeconds, wordCount: wordCount(turn.text) },
    currentTime,
  );
  if (atWord === null) return { atWord: null, blocked: 'Poné el cabezal sobre este diálogo para cortarlo.' };
  return { atWord, blocked: null };
}

// Turno que ocupa el cabezal, mirando todas las escenas medidas. Es lo que hace
// que la tijera se sienta una tijera: corta lo que está debajo del cabezal, sin
// pedir que además esté seleccionado.
function turnAtPlayhead(): { sceneId: string; turnId: string } | null {
  const project = store?.project();
  const measured = compatibleTimeline(project?.scenes ?? []);
  if (!project || !measured) return null;
  for (const [index, scene] of measured.scenes.entries()) {
    for (const turn of scene.turns ?? []) {
      if (currentTime >= turn.startSeconds && currentTime <= turn.endSeconds) {
        return { sceneId: project.scenes[index].id, turnId: turn.id };
      }
    }
  }
  return null;
}

// Tecla B. Prefiere el turno bajo el cabezal; si el cabezal cayó en una pausa
// usa el diálogo seleccionado, para poder explicar qué falta en vez de no hacer
// nada.
function cutAtPlayhead(): void {
  const selection = projectSelection();
  const target = turnAtPlayhead()
    ?? (selection?.kind === 'dialogue' ? { sceneId: selection.sceneId, turnId: selection.turnId } : null);
  if (!target) {
    notify({
      message: isMeasured()
        ? 'Poné el cabezal sobre un diálogo para cortarlo.'
        : 'Hace falta medir las voces antes de poder cortar los diálogos.',
      level: 'error',
    });
    return;
  }
  cutDialogueTurn(target.sceneId, target.turnId);
}

function cutDialogueTurn(sceneId: string, turnId: string): void {
  const plan = dialogueCutPlan(sceneId, turnId);
  if (plan.atWord === null) {
    if (plan.blocked) notify({ message: plan.blocked, level: 'error' });
    return;
  }
  cutDialogueTurnAtWord(sceneId, turnId, plan.atWord);
}

function cutDialogueTurnAtWord(sceneId: string, turnId: string, atWord: number): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const plan = { atWord };
  const newTurnId = nextTurnId(scene.dialogue.map((turn) => turn.id));
  const error = store.dispatch({ type: 'split-dialogue-turn', sceneId, turnId, atWord: plan.atWord, newTurnId });
  if (error) {
    notify({ message: error, level: 'error' });
    return;
  }
  selectDialogueCore(sceneId, newTurnId);
  notify({ message: `Cortaste el diálogo después de la palabra ${plan.atWord}. Volviendo a medir…` });
  // El corte cambia el diálogo, así que la medición anterior deja de describir
  // el proyecto. Recuperarla no necesita un render: solo las dos mitades nuevas
  // pasan por ElevenLabs y el resto sale de caché.
  void remeasureProject();
}

let measuring = false;

function scheduleAutomaticMeasurement(delayMs = 900): void {
  if (automaticMeasureTimer) window.clearTimeout(automaticMeasureTimer);
  automaticMeasureTimer = window.setTimeout(() => {
    automaticMeasureTimer = 0;
    if (measuring) {
      measurementQueued = true;
      return;
    }
    void remeasureProject({ automatic: true });
  }, delayMs);
}

/**
 * Vuelve a medir los tiempos sin renderizar.
 *
 * Es lo que permite cortar de nuevo enseguida: sin esto, cada corte dejaba la
 * timeline «sin medir» y obligaba a un render completo para volver a saber
 * dónde cae el cabezal.
 */
async function remeasureProject(options: { automatic?: boolean } = {}): Promise<void> {
  if (!store) return;
  if (measuring) {
    measurementQueued = true;
    return;
  }
  const validationError = store.validate();
  if (validationError) {
    if (!options.automatic) notify({ message: validationError, level: 'error' });
    return;
  }
  measuring = true;
  updateToolbar();
  const project = store.project();
  try {
    const result = await measureProjectTimes(project);
    // El proyecto pudo cambiar mientras se medía: una medición vieja no se
    // adopta, se descarta y el usuario vuelve a pedirla.
    const current = store.project();
    if (current.id !== result.projectId || projectTimingFingerprint(current) !== projectTimingFingerprint(project)) {
      notify({ message: 'El proyecto cambió mientras se medía. Volvé a medir cuando termines de editar.', level: 'info' });
      return;
    }
    setProjectMeasurement({
      projectId: result.projectId,
      timingRevision: projectTimingFingerprint(current),
      timeline: result.timeline as MeasuredProjectTimeline,
      visualScenes: result.visualScenes as Parameters<typeof setProjectMeasurement>[0]['visualScenes'],
      audioUrl: result.audioUrl,
    });
    if (!options.automatic) {
      notify({ message: `Preview listo: ${result.timeline.durationSeconds.toFixed(2)} s medidos con audio real.`, level: 'success' });
    }
  } catch (error) {
    notify({
      message: error instanceof Error ? error.message : 'No se pudieron medir los tiempos.',
      level: 'error',
    });
  } finally {
    measuring = false;
    render();
    if (measurementQueued) {
      measurementQueued = false;
      scheduleAutomaticMeasurement(150);
    }
  }
}

// El corte es válido si deja al menos un turno hablado en cada escena.
function canSplitAtIndex(dialogueLength: number, turnIndex: number): boolean {
  return turnIndex >= 1 && turnIndex <= dialogueLength - 1;
}

function splitSceneAtTurn(sceneId: string, turnId: string): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const turnIndex = scene.dialogue.findIndex((turn) => turn.id === turnId);
  // Antes esto se rendía en silencio y parecía que la tecla estaba rota. El
  // límite es del motor: una escena renderizable necesita al menos una voz.
  if (!canSplitAtIndex(scene.dialogue.length, turnIndex)) {
    notify({
      message: 'Para dividir acá tiene que quedar al menos un turno hablado de cada lado. Cortá un diálogo con B para tener más.',
      level: 'error',
    });
    return;
  }
  if (store.project().scenes.length >= 8) {
    notify({ message: 'La secuencia llegó al límite técnico de divisiones internas.', level: 'error' });
    return;
  }
  const newSceneId = nextSceneId(store.project().scenes.map((item) => item.id));
  const error = store.dispatch({ type: 'split-scene', sceneId, atTurnId: turnId, newSceneId });
  if (error) window.alert(error);
  else selectScene(newSceneId);
}

function splitSelectedTurn(): void {
  const selection = projectSelection();
  if (selection?.kind !== 'dialogue') {
    notify({ message: 'Seleccioná un diálogo para dividir antes de él.', level: 'error' });
    return;
  }
  splitSceneAtTurn(selection.sceneId, selection.turnId);
}

function nextTurnId(existing: string[]): string {
  const used = new Set(existing);
  for (let index = 1; index <= 99; index += 1) {
    const id = `turno-${String(index).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
  return `turno-${Date.now().toString(36)}`;
}

function openTransitionPopoverForScene(sceneId: string, anchor: HTMLElement): void {
  const transition = store?.project().scenes.find((item) => item.id === sceneId)?.transitionToNext ?? { preset: 'cut' as const, durationSeconds: 0 };
  openTransitionPopover(anchor, sceneId, transition.preset, transition.durationSeconds);
}

// ---- C1: recorte por contenido guiado (panel "Acortar escena") ----

const WORDS_PER_SECOND = 2.6; // ritmo nominal solo para la estimación aproximada

function openShortenPanel(anchor: HTMLElement, sceneId: string): void {
  closeTimelinePopover();
  const panel = document.createElement('div');
  panel.className = 'timeline-popover shorten-panel';
  fillShortenPanel(panel, sceneId);
  positionPopover(panel, anchor);
}

// Reconstruye el panel desde el estado actual del store. Borrar turnos y reducir pausas
// se hace acá con los comandos existentes; el total SIEMPRE se rotula aproximado (o
// medido si hay render vigente), nunca como una duración exacta inventada.
function fillShortenPanel(panel: HTMLElement, sceneId: string): void {
  const scene = store?.project().scenes.find((item) => item.id === sceneId);
  if (!scene) { closeTimelinePopover(); return; }
  const measuredScene = compatibleTimeline(store!.project().scenes)?.scenes.find((item) => item.id === sceneId);
  panel.replaceChildren();

  const heading = document.createElement('strong');
  heading.textContent = `Acortar «${scene.title}»`;
  const hint = document.createElement('span');
  hint.className = 'shorten-hint';
  hint.textContent = 'Borrá turnos o reducí pausas para acortar. La duración nace del TTS medido.';
  panel.append(heading, hint);

  const list = document.createElement('div');
  list.className = 'shorten-list';
  scene.dialogue.forEach((turn) => {
    const row = document.createElement('div');
    row.className = 'shorten-row';
    const words = document.createElement('span');
    words.className = 'shorten-words';
    words.textContent = `${wordCount(turn.text)} pal.`;
    const text = document.createElement('span');
    text.className = 'shorten-text';
    text.textContent = turn.text;
    text.title = turn.text;
    const gap = document.createElement('label');
    gap.className = 'shorten-gap';
    const gapValue = document.createElement('span');
    const paintGap = (value: number) => { gapValue.textContent = value > 0 ? `pausa ${pauseLabel(value)}` : 'sin pausa'; };
    paintGap(turn.gapAfterSeconds);
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = String(GAP_MAX_SECONDS);
    range.step = '0.1';
    range.value = String(turn.gapAfterSeconds);
    range.title = 'Ajustar la pausa después de este turno';
    range.addEventListener('input', () => paintGap(Number(range.value)));
    range.addEventListener('change', () => {
      store?.dispatch({ type: 'set-dialogue-turn', sceneId, turnId: turn.id, gapAfterSeconds: clampGap(Number(range.value)) });
      fillShortenPanel(panel, sceneId);
    });
    gap.append(gapValue, range);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'shorten-delete';
    remove.textContent = '🗑';
    remove.title = 'Eliminar este turno';
    remove.setAttribute('aria-label', 'Eliminar este turno');
    remove.addEventListener('click', () => {
      store?.dispatch({ type: 'delete-dialogue-turn', sceneId, turnId: turn.id });
      fillShortenPanel(panel, sceneId);
    });
    row.append(words, text, gap, remove);
    list.append(row);
  });
  if (scene.dialogue.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'shorten-empty';
    empty.textContent = 'Este tramo quedó sin turnos.';
    list.append(empty);
  }
  panel.append(list);

  const total = document.createElement('div');
  total.className = 'shorten-total';
  if (measuredScene) {
    total.textContent = `${(measuredScene.endSeconds - measuredScene.startSeconds).toFixed(2)} s medidos`;
  } else {
    const estimate = estimateDurationSeconds(
      scene.dialogue.map((turn) => wordCount(turn.text)),
      scene.dialogue.map((turn) => turn.gapAfterSeconds),
      WORDS_PER_SECOND,
    );
    total.textContent = `≈ ${estimate.toFixed(1)} s · estimado por palabras (no medido)`;
  }
  panel.append(total);
}

// ---- B4: insertar desde la timeline (botón + entre clips, visible al hover/foco) ----

function insertButton(left: number, title: string, disabled: boolean, onClick: () => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'timeline-insert';
  button.textContent = '+';
  button.style.left = `${left}px`;
  button.title = title;
  button.setAttribute('aria-label', title);
  if (disabled) button.disabled = true;
  else button.addEventListener('click', (event) => { event.stopPropagation(); onClick(); });
  return button;
}

function sceneInsertButtons(
  project: ReturnType<ProjectStore['project']>,
  positions: number[],
  sceneWidths: number[],
): HTMLElement[] {
  const scenes = project.scenes;
  const canAdd = scenes.length < 8;
  const title = canAdd ? 'Insertar momento aquí' : 'Máximo de 8 momentos';
  const buttons: HTMLElement[] = [
    insertButton(positions[0] ?? 0, canAdd ? 'Insertar momento al inicio' : title, !canAdd, () => insertSceneAt(scenes[0].id, 0)),
  ];
  scenes.forEach((scene, index) => {
    const boundary = (positions[index] ?? 0) + (sceneWidths[index] ?? 0);
    buttons.push(insertButton(boundary, title, !canAdd, () => insertSceneAt(scene.id, index + 1)));
  });
  return buttons;
}

// ---- B5: soltar recursos de la biblioteca sobre clips ----

// C6 — La pista de personajes acepta recursos soltados desde la biblioteca.
// El clip existente ya acepta drop para *reemplazar*; la pista vacía *agrega*.
function acceptCharacterDropOnLane(
  row: HTMLElement,
  project: ReturnType<ProjectStore['project']>,
  positions: number[],
  widths: number[],
): void {
  const lane = row.querySelector<HTMLElement>('.authoring-track-lane');
  if (!lane) return;
  const sceneAt = (event: DragEvent): { id: string; index: number } | null => {
    const bounds = lane.getBoundingClientRect();
    const x = event.clientX - bounds.left + lane.scrollLeft;
    const index = positions.findIndex((left, position) => x >= left && x < left + widths[position]);
    const scene = index >= 0 ? project.scenes[index] : null;
    return scene ? { id: scene.id, index } : null;
  };
  lane.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(CHARACTER_DRAG_TYPE)) return;
    if (event.target !== lane) return; // sobre un clip manda el clip.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    lane.classList.add('is-drop-target');
  });
  lane.addEventListener('dragleave', () => lane.classList.remove('is-drop-target'));
  lane.addEventListener('drop', (event) => {
    lane.classList.remove('is-drop-target');
    if (!event.dataTransfer?.types.includes(CHARACTER_DRAG_TYPE)) return;
    if (event.target !== lane) return;
    event.preventDefault();
    const placement = readCharacterDrag(event.dataTransfer);
    const scene = sceneAt(event);
    if (!placement || !scene || !store) return;
    const target = project.scenes[scene.index];
    const existing = target.elements.filter((element) => element.type === 'character').length;
    const elementId = nextElementId(`${target.id}-personaje`, target.elements.map((element) => element.id));
    const error = store.dispatch({
      type: 'add-character',
      sceneId: target.id,
      elementId,
      resourceId: placement.resourceId,
      x: existing % 2 === 0 ? 360 : 720,
      y: 1180,
      scale: 0.75,
      zIndex: nextVisualZIndex(target),
    });
    if (error) notify({ message: error, level: 'error' });
    else selectElementCore(target.id, elementId);
  });
}

function nextElementId(base: string, taken: readonly string[]): string {
  let candidate = base;
  let counter = 2;
  while (taken.includes(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function acceptResourceDrop(clip: HTMLElement, dragType: string, onDrop: (dataTransfer: DataTransfer) => void): void {
  clip.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(dragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    clip.classList.add('is-drop-target');
  });
  clip.addEventListener('dragleave', () => clip.classList.remove('is-drop-target'));
  clip.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.types.includes(dragType)) return;
    event.preventDefault();
    clip.classList.remove('is-drop-target');
    onDrop(event.dataTransfer);
  });
}

function applyBackgroundDrop(sceneId: string, dataTransfer: DataTransfer): void {
  const resourceId = readBackgroundDrag(dataTransfer);
  if (!resourceId || !store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const presets = store.resources('background').find((resource) => resource.id === resourceId)?.capabilities?.cameraPresets;
  const list = Array.isArray(presets) ? (presets as string[]) : null;
  const cameraPreset = list
    ? (list.includes(scene.background.cameraPreset) ? scene.background.cameraPreset : list[0])
    : scene.background.cameraPreset;
  const error = store.dispatch({ type: 'set-scene-background', sceneId, resourceId, cameraPreset });
  if (error) window.alert(error);
}

function applyCharacterDrop(sceneId: string, elementId: string, dataTransfer: DataTransfer): void {
  const placement = readCharacterDrag(dataTransfer);
  if (!placement || !store) return;
  const error = store.dispatch({ type: 'set-character-resource', sceneId, elementId, resourceId: placement.resourceId });
  if (error) window.alert(error);
}

const GAP_MAX_SECONDS = 2;
const GAP_SNAP_SECONDS = 0.1;

function clampGap(seconds: number): number {
  return snapSeconds(seconds, GAP_SNAP_SECONDS, 0, GAP_MAX_SECONDS);
}

// B2: handle en el borde derecho del clip (zona del gap). Arrastrar horizontal ajusta
// gapAfterSeconds (0–2 s, snap 0.1 s) y despacha set-dialogue-turn al soltar. Es la única
// manija temporal permitida: edita un dato del contrato, no la duración de la voz. El
// mapeo px→s usa pixelsPerSecond (escala nominal en editorial, real en medido). El
// arrastre se sigue a nivel window para no depender de la captura de puntero.
function gapHandle(sceneId: string, turnId: string, left: number, gapSeconds: number): HTMLElement {
  const handle = document.createElement('span');
  handle.className = 'dialogue-gap';
  handle.classList.toggle('has-pause', gapSeconds > 0);
  handle.style.left = `${left}px`;
  handle.style.setProperty('--gap-width', `${gapSeconds * pixelsPerSecond}px`);
  const badge = document.createElement('small');
  const paint = (value: number) => {
    handle.style.setProperty('--gap-width', `${value * pixelsPerSecond}px`);
    handle.classList.toggle('has-pause', value > 0);
    handle.title = value > 0 ? `Pausa ${pauseLabel(value)} · arrastrá para ajustar` : 'Arrastrá para agregar una pausa';
    badge.textContent = value > 0 ? pauseLabel(value) : '';
  };
  paint(gapSeconds);
  handle.append(badge);
  let dragging = false;
  let startX = 0;
  let current = gapSeconds;
  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    current = clampGap(gapSeconds + (event.clientX - startX) / pixelsPerSecond);
    paint(current);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    handle.classList.remove('is-dragging');
    if (current !== gapSeconds) store?.dispatch({ type: 'set-dialogue-turn', sceneId, turnId, gapAfterSeconds: current });
  };
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    startX = event.clientX;
    current = gapSeconds;
    handle.classList.add('is-dragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  return handle;
}

function trackDivider(title: string, detail: string): HTMLElement {
  const divider = document.createElement('div');
  divider.className = `authoring-track-divider ${title === 'AUDIO' ? 'is-audio' : 'is-visual'}`;
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = detail;
  divider.append(strong, span);
  return divider;
}

function authoringClip(
  title: string,
  detail: string,
  left: number,
  width: number,
  kind: 'background' | 'character' | 'dialogue',
  selected = false,
): HTMLButtonElement {
  const clip = document.createElement('button');
  clip.type = 'button';
  clip.className = `authoring-clip ${kind}`;
  clip.classList.toggle('is-selected', selected);
  clip.style.left = `${left}px`;
  clip.style.width = `${Math.max(MIN_CLIP_WIDTH, width)}px`;
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = detail;
  clip.append(strong, small);
  return clip;
}

function markContinuousSegments(clips: HTMLElement[]): void {
  clips.forEach((clip, index) => {
    clip.classList.add('is-continuous-segment');
    if (index === 0) clip.classList.add('is-sequence-start');
    if (index === clips.length - 1) clip.classList.add('is-sequence-end');
  });
}

function bindSceneClip(clip: HTMLButtonElement, sceneId: string, startSeconds: number): void {
  clip.draggable = true;
  clip.classList.toggle('is-selected', store?.selectedSceneId() === sceneId);
  clip.addEventListener('click', () => clipSingleClick(startSeconds, () => selectScene(sceneId), () => selectSceneCore(sceneId)));
  clip.addEventListener('dblclick', () => selectScene(sceneId));
  clip.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openContextMenu(clip, sceneMenuItems(sceneId, clip));
  });
  acceptResourceDrop(clip, BACKGROUND_DRAG_TYPE, (dataTransfer) => applyBackgroundDrop(sceneId, dataTransfer));
  clip.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData('application/x-local-video-scene', sceneId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    clip.classList.add('is-dragging');
  });
  clip.addEventListener('dragend', () => clip.classList.remove('is-dragging'));
  clip.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('application/x-local-video-scene')) return;
    event.preventDefault();
    clip.classList.add('is-drop-target');
  });
  clip.addEventListener('dragleave', () => clip.classList.remove('is-drop-target'));
  clip.addEventListener('drop', (event) => {
    event.preventDefault();
    clip.classList.remove('is-drop-target');
    const sourceId = event.dataTransfer?.getData('application/x-local-video-scene');
    if (!sourceId || sourceId === sceneId || !store) return;
    const ids = store.project().scenes.map((scene) => scene.id);
    const sourceIndex = ids.indexOf(sourceId);
    const targetIndex = ids.indexOf(sceneId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    ids.splice(sourceIndex, 1);
    ids.splice(targetIndex, 0, sourceId);
    store.dispatch({ type: 'reorder-scenes', sceneIds: ids });
    selectScene(sourceId);
  });
}

// El "core" aplica la selección (inspector + escena activa) SIN cambiar de superficie.
// selectX = core + volver al lienzo (comportamiento de doble clic / edición).
function selectSceneCore(sceneId: string): void {
  selectProjectItem({ kind: 'scene', sceneId });
  store?.dispatch({ type: 'select-scene', sceneId });
}

function selectElementCore(sceneId: string, elementId: string): void {
  selectProjectItem({ kind: 'element', sceneId, elementId });
  store?.dispatch({ type: 'select-scene', sceneId });
}

function selectDialogueCore(sceneId: string, turnId: string): void {
  selectProjectItem({ kind: 'dialogue', sceneId, turnId });
  store?.dispatch({ type: 'select-scene', sceneId });
}

const DIALOGUE_DRAG_TYPE = 'application/x-local-video-dialogue-turn';

// C3: arrastrar un clip de diálogo sobre otro de la MISMA escena reordena los turnos.
function bindDialogueDrag(clip: HTMLElement, sceneId: string, turnId: string): void {
  clip.draggable = true;
  clip.dataset.scene = sceneId;
  clip.dataset.turn = turnId;
  clip.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(DIALOGUE_DRAG_TYPE, JSON.stringify({ sceneId, turnId }));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    clip.classList.add('is-dragging');
  });
  clip.addEventListener('dragend', () => clip.classList.remove('is-dragging'));
  clip.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(DIALOGUE_DRAG_TYPE)) return;
    event.preventDefault();
    clip.classList.add('is-drop-target');
  });
  clip.addEventListener('dragleave', () => clip.classList.remove('is-drop-target'));
  clip.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.types.includes(DIALOGUE_DRAG_TYPE)) return;
    event.preventDefault();
    clip.classList.remove('is-drop-target');
    try {
      const data = JSON.parse(event.dataTransfer.getData(DIALOGUE_DRAG_TYPE)) as { sceneId: string; turnId: string };
      if (data.sceneId === sceneId && data.turnId !== turnId) reorderTurns(sceneId, data.turnId, turnId);
    } catch { /* payload inválido: ignorar */ }
  });
}

function reorderTurns(sceneId: string, sourceTurnId: string, targetTurnId: string): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const ids = scene.dialogue.map((turn) => turn.id);
  const from = ids.indexOf(sourceTurnId);
  const to = ids.indexOf(targetTurnId);
  if (from < 0 || to < 0 || from === to) return;
  ids.splice(from, 1);
  ids.splice(to, 0, sourceTurnId);
  store.dispatch({ type: 'reorder-dialogue-turns', sceneId, turnIds: ids });
  selectDialogue(sceneId, sourceTurnId);
}

function selectScene(sceneId: string): void {
  showEditorCanvas();
  selectSceneCore(sceneId);
}

function selectElement(sceneId: string, elementId: string): void {
  showEditorCanvas();
  selectElementCore(sceneId, elementId);
}

function selectDialogue(sceneId: string, turnId: string): void {
  showEditorCanvas();
  selectDialogueCore(sceneId, turnId);
}

// B7: un clic simple mientras se reproduce (modo medido) navega a un tiempo y selecciona
// sin salir de playback; en cualquier otro caso (pausado o editorial) mantiene el
// comportamiento actual (vuelve al lienzo). El doble clic siempre vuelve al lienzo.
function clipSingleClick(startSeconds: number, selectWithCanvas: () => void, selectCore: () => void): void {
  if (isMeasured() && editorWorkspace().playing) {
    const target = clamp(startSeconds, 0, activeDuration());
    seekEditorPlayback(target);
    updateTimelineTime(target);
    selectCore();
  } else {
    selectWithCanvas();
  }
}

function seekTo(time: number): void {
  const duration = activeDuration();
  const target = clamp(time, 0, duration);
  seekEditorPlayback(target);
  updateTimelineTime(target);
}

function togglePlayback(): void {
  void toggleEditorPlayback();
}

function syncPlayButton(): void {
  const icon = optional<SVGUseElement>('#timeline-play use');
  icon?.setAttribute('href', editorWorkspace().playing ? '#ui-icon-pause' : '#ui-icon-play');
}

function toggleMute(): void {
  toggleEditorMute();
  syncMuteButton();
}

function duplicateSelection(): void {
  if (!store) return;
  const selection = projectSelection();
  if (selection?.kind === 'scene') {
    const scene = store.project().scenes.find((item) => item.id === selection.sceneId);
    if (!scene) return;
    const newSceneId = nextSceneId(store.project().scenes.map((item) => item.id));
    const error = store.dispatch({
      type: 'duplicate-scene',
      sceneId: scene.id,
      newSceneId,
      title: `${scene.title} copia`,
    });
    if (!error) selectScene(newSceneId);
    return;
  }
  if (selection?.kind === 'keyframe') {
    const scene = store.project().scenes.find((item) => item.id === selection.sceneId);
    const element = scene?.elements.find((item) => item.id === selection.elementId);
    const track = element?.tracks?.find((item) => item.parameterId === selection.parameterId);
    const keyframe = track?.keyframes.find((item) => item.id === selection.keyframeId);
    if (!element || !keyframe) return;
    const command = duplicateKeyframeCommand({
      sceneId: selection.sceneId,
      elementId: selection.elementId,
      parameterId: selection.parameterId,
      keyframe,
      takenKeyframeIds: (element.tracks ?? []).flatMap((item) => item.keyframes.map((entry) => entry.id)),
      fps: projectFps(),
    });
    const error = store.dispatch(command);
    if (!error) selectProjectItem({ ...selection, keyframeId: String(command.keyframeId) });
  }
}

function deleteSelection(): void {
  if (!store) return;
  const selection = projectSelection();
  if (!selection) return;
  const project = store.project();
  if (selection.kind === 'scene') {
    const scene = project.scenes.find((item) => item.id === selection.sceneId);
    if (!scene || project.scenes.length === 1 || !window.confirm(`¿Eliminar «${scene.title}»?`)) return;
    store.dispatch({ type: 'delete-scene', sceneId: scene.id });
  } else if (selection.kind === 'keyframe') {
    deleteKeyframe(
      { sceneId: selection.sceneId, elementId: selection.elementId },
      selection.parameterId,
      selection.keyframeId,
    );
  } else if (selection.kind === 'element') {
    const error = store.dispatch({ type: 'delete-element', sceneId: selection.sceneId, elementId: selection.elementId });
    if (error) window.alert(error);
  } else {
    store.dispatch({ type: 'delete-dialogue-turn', sceneId: selection.sceneId, turnId: selection.turnId });
  }
}

function syncMuteButton(): void {
  const button = optional<HTMLButtonElement>('#timeline-mute');
  const state = editorWorkspace();
  if (!button) return;
  // Mismo criterio que Play: silenciar algo que no se puede reproducir no es
  // una acción disponible.
  button.disabled = state.mode === 'creator' || !editorCanPlay();
  button.classList.toggle('is-active', state.muted);
  button.setAttribute('aria-pressed', String(state.muted));
}

function jumpBoundary(direction: -1 | 1): void {
  if (!isMeasured()) {
    jumpProjectScene(direction);
    return;
  }
  const boundaries = measuredBoundaries();
  if (boundaries.length === 0) return;
  const epsilon = 0.02;
  const target = direction > 0
    ? boundaries.find((time) => time > currentTime + epsilon) ?? boundaries.at(-1)
    : [...boundaries].reverse().find((time) => time < currentTime - epsilon) ?? boundaries[0];
  seekTo(target ?? 0);
}

function jumpProjectScene(direction: -1 | 1): void {
  if (!store) return;
  showEditorCanvas();
  const project = store.project();
  const index = project.scenes.findIndex((scene) => scene.id === store?.selectedSceneId());
  const target = project.scenes[clamp(index + direction, 0, project.scenes.length - 1)];
  if (target) store.dispatch({ type: 'select-scene', sceneId: target.id });
}

function measuredBoundaries(): number[] {
  const values = new Set<number>([0, activeDuration()]);
  for (const scene of compatibleTimeline(store?.project().scenes ?? [])?.scenes ?? []) values.add(scene.startSeconds);
  return [...values].sort((left, right) => left - right);
}

function snapTime(time: number): number {
  if (!snapEnabled) return time;
  const threshold = 8 / pixelsPerSecond;
  const nearest = measuredBoundaries().reduce(
    (best, boundary) => Math.abs(boundary - time) < Math.abs(best - time) ? boundary : best,
    time,
  );
  return Math.abs(nearest - time) <= threshold ? nearest : time;
}

function toggleSnap(): void {
  snapEnabled = !snapEnabled;
  optional<HTMLButtonElement>('#timeline-snap')?.setAttribute('aria-pressed', String(snapEnabled));
  // La clase visual la decide `updateToolbar`, que también sabe si el control
  // está disponible; acá se decidía sin esa mitad de la información.
  updateToolbar();
}

function zoomBy(factor: number): void {
  pixelsPerSecond = clamp(pixelsPerSecond * factor, MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND);
  render();
}

function fitTimeline(): void {
  const scroll = optional<HTMLElement>('#timeline-layer-stack');
  if (!scroll) return;
  if (isMeasured()) {
    const duration = activeDuration();
    if (duration > 0) pixelsPerSecond = clamp((scroll.clientWidth - 8) / duration, MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND);
  } else if (store) {
    const baseWidth = store.project().scenes.reduce((total, scene) => total + Math.max(EDITORIAL_SCENE_WIDTH, wordsInScene(scene) * 8) + 4, 0);
    if (baseWidth > 0) pixelsPerSecond = clamp(DEFAULT_PIXELS_PER_SECOND * ((scroll.clientWidth - 8) / baseWidth), MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND);
  }
  render();
}

function handleShortcut(event: KeyboardEvent): void {
  // El Creador de recursos no comparte las acciones del Editor: la barra ya
  // deshabilita ahí transporte, duplicar, dividir y eliminar, y el teclado tiene
  // que decir lo mismo. Sin esta guardia, `Supr` borraba una escena del proyecto
  // mientras el usuario diseñaba un personaje. Deshacer y rehacer siguen
  // disponibles, igual que sus botones.
  const creator = editorWorkspace().mode === 'creator';
  // B6: Ctrl/Cmd+Z deshace y Ctrl+Y / Ctrl+Shift+Z rehace. Se respeta isTyping para no
  // pisar el undo nativo de los inputs.
  if ((event.ctrlKey || event.metaKey) && !isTyping(event.target)) {
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      narratedUndo();
      return;
    }
    if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      narratedRedo();
      return;
    }
    if (key === 'b' && !creator) {
      event.preventDefault();
      splitSelectedTurn();
      return;
    }
  }
  if (creator || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
  const hasOutput = editorCanPlay();
  if (event.code === 'Space' && hasOutput) {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === 'ArrowLeft' && isMeasured()) {
    event.preventDefault();
    seekTo(currentTime - (event.shiftKey ? 5 : 0.5));
  } else if (event.code === 'ArrowRight' && isMeasured()) {
    event.preventDefault();
    seekTo(currentTime + (event.shiftKey ? 5 : 0.5));
  } else if (event.code === 'ArrowUp') {
    event.preventDefault();
    jumpBoundary(-1);
  } else if (event.code === 'ArrowDown') {
    event.preventDefault();
    jumpBoundary(1);
  } else if (event.code === 'Home' && isMeasured()) {
    event.preventDefault();
    seekTo(0);
  } else if (event.code === 'End' && isMeasured()) {
    event.preventDefault();
    seekTo(activeDuration());
  } else if (event.code === 'KeyS' && isMeasured()) {
    event.preventDefault();
    toggleSnap();
  } else if (event.code === 'KeyM' && hasOutput) {
    event.preventDefault();
    toggleMute();
  } else if (event.code === 'KeyJ' && hasOutput) {
    event.preventDefault();
    pauseEditorPlayback();
    seekTo(currentTime - 1);
  } else if (event.code === 'KeyK' && hasOutput) {
    event.preventDefault();
    pauseEditorPlayback();
  } else if (event.code === 'KeyL' && hasOutput) {
    event.preventDefault();
    void showRenderedPlayback();
  } else if (event.code === 'KeyF') {
    event.preventDefault();
    fitTimeline();
  } else if (event.code === 'Equal' || event.code === 'NumpadAdd') {
    event.preventDefault();
    zoomBy(1.25);
  } else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
    event.preventDefault();
    zoomBy(0.8);
  } else if (event.code === 'KeyB') {
    // B es la tijera: corta el diálogo que hay bajo el cabezal. Dividir la
    // escena, que es estructural y mucho menos frecuente, queda en Ctrl+B.
    event.preventDefault();
    cutAtPlayhead();
  } else if (event.code === 'Delete') {
    event.preventDefault();
    deleteSelection();
  }
}

function updateToolbar(): void {
  const hasProject = Boolean(store);
  const measured = isMeasured();
  const creator = editorWorkspace().mode === 'creator';
  const hasNavigation = !creator && Boolean(store?.project().scenes.length);
  const hasOutput = !creator && editorCanPlay();
  const undo = optional<HTMLButtonElement>('#timeline-undo');
  const redo = optional<HTMLButtonElement>('#timeline-redo');
  const play = optional<HTMLButtonElement>('#timeline-play');
  const previous = optional<HTMLButtonElement>('#timeline-previous');
  const next = optional<HTMLButtonElement>('#timeline-next');
  const duplicate = optional<HTMLButtonElement>('#timeline-duplicate');
  const split = optional<HTMLButtonElement>('#timeline-split');
  const remove = optional<HTMLButtonElement>('#timeline-delete');
  const snap = optional<HTMLButtonElement>('#timeline-snap');
  // U1: el botón anticipa qué se va a revertir cuando el store lo sabe.
  if (undo) {
    undo.disabled = !store?.canUndo();
    const pending = store?.pendingUndoLabel();
    undo.title = pending ? `Deshacer: ${pending.toLowerCase()} (Ctrl+Z)` : 'Deshacer (Ctrl+Z)';
  }
  if (redo) {
    redo.disabled = !store?.canRedo();
    const pending = store?.pendingRedoLabel();
    redo.title = pending ? `Rehacer: ${pending.toLowerCase()} (Ctrl+Y)` : 'Rehacer (Ctrl+Y)';
  }
  if (play) play.disabled = !hasOutput;
  // Estos dos navegan escenas, no clips, y antes quedaban encendidos siempre:
  // en un proyecto de una sola escena no hacían nada y no lo decían. Ahora se
  // apagan cuando no queda a dónde ir.
  const boundaries = measured ? measuredBoundaries() : [];
  const sceneIds = store?.project().scenes.map((scene) => scene.id) ?? [];
  const selectedIndex = sceneIds.indexOf(store?.selectedSceneId() ?? '');
  const canGoBack = measured
    ? boundaries.some((time) => time < currentTime - 0.02)
    : selectedIndex > 0;
  const canGoForward = measured
    ? boundaries.some((time) => time > currentTime + 0.02)
    : selectedIndex >= 0 && selectedIndex < sceneIds.length - 1;
  if (previous) previous.disabled = !hasNavigation || !canGoBack;
  if (next) next.disabled = !hasNavigation || !canGoForward;
  if (snap) {
    snap.disabled = creator || !measured;
    // El estado sigue siendo «activo» y `aria-pressed` lo dice, pero un control
    // que no se puede tocar no debe vestirse de encendido.
    snap.classList.toggle('is-active', snapEnabled && !snap.disabled);
  }
  const selection = projectSelection();
  const sceneCount = store?.project().scenes.length ?? 0;
  const canDuplicateScene = selection?.kind === 'scene' && sceneCount < 8;
  const canDuplicateKeyframe = selection?.kind === 'keyframe';
  if (duplicate) {
    duplicate.disabled = creator || (!canDuplicateScene && !canDuplicateKeyframe);
    duplicate.textContent = canDuplicateKeyframe ? 'Duplicar keyframe' : 'Duplicar';
    duplicate.title = canDuplicateKeyframe ? 'Duplicar keyframe seleccionado' : 'Duplicar selección';
    // El aria-label le gana al texto visible: si queda fijo, un lector de
    // pantalla anuncia una acción distinta de la que muestra el botón.
    duplicate.setAttribute('aria-label', duplicate.textContent);
  }
  let canSplitSelection = false;
  if (selection?.kind === 'dialogue') {
    const scene = store?.project().scenes.find((item) => item.id === selection.sceneId);
    const index = scene?.dialogue.findIndex((item) => item.id === selection.turnId) ?? -1;
    canSplitSelection = Boolean(scene) && canSplitAtIndex(scene!.dialogue.length, index) && sceneCount < 8;
  }
  if (split) {
    split.disabled = creator || !canSplitSelection;
    split.title = canSplitSelection
      ? 'Dividir antes del diálogo seleccionado (Ctrl+B)'
      : 'Seleccioná un diálogo que deje al menos un turno a cada lado';
  }
  // Medir es la acción que destraba todo lo temporal, así que se ofrece en la
  // barra y no escondida dentro del popover del badge. Con los tiempos ya
  // medidos deja de ocupar lugar.
  const measure = optional<HTMLButtonElement>('#timeline-measure');
  if (measure) {
    measure.hidden = creator || !hasProject || measured;
    measure.disabled = measuring;
    measure.textContent = measuring ? 'Midiendo…' : 'Medir tiempos';
    measure.classList.toggle('is-busy', measuring);
  }
  // La tijera solo sirve con medición: sin ella no hay dónde caen las palabras.
  const cut = optional<HTMLButtonElement>('#timeline-cut');
  if (cut) {
    cut.disabled = creator || !measured;
    cut.classList.toggle('is-active', cutModeActive && !cut.disabled);
    cut.title = measured
      ? 'Modo tijera: hacé clic sobre un diálogo para cortarlo (B, o mantené Alt)'
      : 'Medí los tiempos para poder cortar un diálogo';
  }
  if (remove) {
    remove.disabled = creator || !selection || (selection.kind === 'scene' && (store?.project().scenes.length ?? 0) <= 1);
    const kind = selection?.kind === 'dialogue' ? 'diálogo'
      : selection?.kind === 'keyframe' ? 'keyframe'
        : selection?.kind === 'element' ? 'elemento' : 'contenido';
    remove.title = selection ? `Eliminar ${kind} (Supr)` : 'Seleccioná algo para eliminar';
  }
  optional<HTMLButtonElement>('#timeline-fit')?.toggleAttribute('disabled', creator || (!hasProject && !measured));
  syncPlayButton();
  syncMuteButton();
}

function nextSceneId(existing: string[]): string {
  const used = new Set(existing);
  for (let index = 1; index <= 99; index += 1) {
    const id = `escena-${String(index).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
  return `escena-${Date.now().toString(36)}`;
}

function updateTimecode(): void {
  const output = optional<HTMLOutputElement>('#timeline-timecode');
  if (!output) return;
  output.textContent = hasExactTimelineTime()
    ? `${formatTimecode(currentTime)} / ${formatTimecode(activeDuration())}`
    : '--:--.--- / --:--.---';
}

// U1 — Nunca un undo a ciegas: se dice qué se deshizo. Si el store no tiene la
// etiqueta (historial recuperado de otra sesión), el mensaje es genérico pero
// verdadero en lugar de inventar un cambio.
function narratedUndo(): void {
  if (!store?.canUndo()) return;
  const label = store.pendingUndoLabel();
  store.undo();
  notify({ message: label ? `Deshecho: ${label.toLowerCase()}.` : 'Se deshizo el último cambio.' });
}

function narratedRedo(): void {
  if (!store?.canRedo()) return;
  const label = store.pendingRedoLabel();
  store.redo();
  notify({ message: label ? `Rehecho: ${label.toLowerCase()}.` : 'Se rehízo el último cambio.' });
}

function setTimelineMode(measured: boolean, customLabel?: string): void {
  const mode = optional<HTMLElement>('#timeline-mode');
  if (mode) {
    mode.textContent = customLabel ?? (measured ? 'Medido' : 'Sin medir');
    mode.classList.toggle('is-measured', measured);
    mode.classList.toggle('is-outdated', measured && customLabel !== undefined);
  }
  renderTimelineModeExplanation(measured);
}

// E4: el badge deja de ser jerga. Explica de dónde sale la duración y qué
// hacer para verla real, con acción directa cuando el render está disponible.
function renderTimelineModeExplanation(measured: boolean): void {
  const popover = optional<HTMLElement>('#timeline-mode-popover');
  if (!popover) return;
  const outdated = measured && editorOutputState() !== 'current';
  const title = document.createElement('strong');
  title.textContent = outdated ? 'Preview listo · MP4 anterior' : measured ? 'Preview medido' : 'Preparando preview';
  const body = document.createElement('p');
  body.textContent = outdated
    ? 'Hay cambios sin exportar. Play usa el audio medido y dibuja la secuencia y los keyframes actuales sobre el lienzo.'
    : measured
      ? 'Estos tiempos y la reproducción salen del audio real preparado para el preview; coincidirán con el MP4 final.'
      : 'Todavía no hay audio generado, así que la duración de cada diálogo es una estimación por cantidad de palabras. La duración real nace de las voces sintetizadas: medir las genera sin producir un video.';
  popover.replaceChildren(title, body);
  if (!measured) {
    // Medir corre solo ElevenLabs y FFprobe: segundos, contra los minutos de un
    // render. No hace falta un MP4 para saber cuánto dura cada diálogo.
    const medir = document.createElement('button');
    medir.type = 'button';
    medir.className = 'text-button';
    medir.textContent = measuring ? 'Midiendo…' : 'Medir ahora (unos segundos)';
    medir.disabled = measuring || !store;
    medir.addEventListener('click', () => {
      toggleTimelineModePopover(false);
      void remeasureProject();
    });
    const cta = document.createElement('button');
    cta.type = 'button';
    cta.className = 'text-button';
    cta.textContent = 'Exportar MP4 final';
    cta.addEventListener('click', () => {
      toggleTimelineModePopover(false);
      optional<HTMLButtonElement>('#director-render')?.click();
    });
    popover.append(medir, cta);
  }
}

function toggleTimelineModePopover(open: boolean): void {
  const popover = optional<HTMLElement>('#timeline-mode-popover');
  const badge = optional<HTMLElement>('#timeline-mode');
  if (!popover || !badge) return;
  popover.hidden = !open;
  badge.setAttribute('aria-expanded', String(open));
}

export function initTimelineModeExplanation(): void {
  const badge = optional<HTMLButtonElement>('#timeline-mode');
  const popover = optional<HTMLElement>('#timeline-mode-popover');
  if (!badge || !popover) return;
  badge.addEventListener('click', () => toggleTimelineModePopover(popover.hidden !== false));
  document.addEventListener('pointerdown', (event) => {
    if (popover.hidden || !(event.target instanceof Node)) return;
    if (!popover.contains(event.target) && !badge.contains(event.target)) toggleTimelineModePopover(false);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popover.hidden === false) {
      toggleTimelineModePopover(false);
      badge.focus();
    }
  });
  renderTimelineModeExplanation(isMeasured());
  applyUnifiedMediaToolbarState();
}

function setSummary(message: string): void {
  const summary = optional<HTMLElement>('#timeline-summary');
  if (summary) summary.textContent = message;
}

function followPlayhead(): void {
  const state = editorWorkspace();
  const scroll = optional<HTMLElement>('#timeline-layer-stack');
  if (!state.playing || !scroll || !hasExactTimelineTime()) return;
  const x = currentTime * pixelsPerSecond + 78;
  const leftEdge = scroll.scrollLeft + 20;
  const rightEdge = scroll.scrollLeft + scroll.clientWidth - 30;
  if (x < leftEdge || x > rightEdge) {
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.25);
  }
}

// La duración de trabajo es la medida cuando existe, aunque el MP4 esté vencido:
// el cabezal y la regla siguen siendo verdaderos mientras el audio no cambie.
function activeDuration(): number {
  const measured = compatibleTimeline(store?.project().scenes ?? []);
  const authoringDuration = measured?.durationSeconds ?? (currentEditorOutput() ? editorWorkspace().duration : 0);
  return Math.max(authoringDuration, unifiedMediaDurationSeconds());
}

function isMeasured(): boolean {
  return Boolean(compatibleTimeline(store?.project().scenes ?? []));
}

function hasExactTimelineTime(): boolean {
  return isMeasured() || unifiedMediaDurationSeconds() > 0;
}

function compatibleTimeline(projectScenes: SceneView[]): MeasuredProjectTimeline | null {
  return measuredTimelineFor(projectScenes.map((scene) => scene.id));
}

function wordsInScene(scene: SceneView): number {
  return scene.dialogue.reduce((total, turn) => total + wordCount(turn.text), 0);
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function formatRulerTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const milliseconds = Math.floor((safe % 1) * 1000);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
