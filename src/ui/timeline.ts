import { optional } from './dom.js';
import {
  EDITOR_WORKSPACE_EVENT,
  EDITOR_PLAYBACK_EVENT,
  editorWorkspace,
  seekEditorPlayback,
  showEditorCanvas,
  showRenderedPlayback,
  toggleEditorMute,
  toggleEditorPlayback,
  type MeasuredProjectTimeline,
} from './editor-workspace.js';
import type { ProjectStore } from './project/store.js';
import type { SceneView } from './project/types.js';
import {
  PROJECT_SELECTION_EVENT,
  projectSelection,
  selectProjectItem,
} from './project/selection.js';
import {
  pauseLabel,
  rulerTicks,
  transitionGlyph,
  transitionLabel,
} from './timeline-geometry.js';

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

export function initTimelineShell(): void {
  if (initialized) return;
  initialized = true;

  optional<HTMLButtonElement>('#timeline-undo')?.addEventListener('click', () => store?.undo());
  optional<HTMLButtonElement>('#timeline-redo')?.addEventListener('click', () => store?.redo());
  optional<HTMLButtonElement>('#timeline-play')?.addEventListener('click', togglePlayback);
  optional<HTMLButtonElement>('#timeline-previous')?.addEventListener('click', () => jumpBoundary(-1));
  optional<HTMLButtonElement>('#timeline-next')?.addEventListener('click', () => jumpBoundary(1));
  optional<HTMLButtonElement>('#timeline-zoom-out')?.addEventListener('click', () => zoomBy(0.8));
  optional<HTMLButtonElement>('#timeline-zoom-in')?.addEventListener('click', () => zoomBy(1.25));
  optional<HTMLButtonElement>('#timeline-fit')?.addEventListener('click', fitTimeline);
  optional<HTMLButtonElement>('#timeline-snap')?.addEventListener('click', toggleSnap);
  optional<HTMLButtonElement>('#timeline-mute')?.addEventListener('click', toggleMute);
  optional<HTMLButtonElement>('#timeline-duplicate')?.addEventListener('click', duplicateSelection);
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
    updateTimelineTime(editorWorkspace().currentTime);
  });
  window.addEventListener(EDITOR_PLAYBACK_EVENT, () => {
    updateToolbar();
    updateTimelineTime(editorWorkspace().currentTime);
  });
  render();
}

export function attachProjectTimeline(projectStore: ProjectStore): void {
  store = projectStore;
  store.subscribe(() => render());
  render();
}

export function updateTimelineTime(timeSeconds: number): void {
  currentTime = clamp(timeSeconds, 0, activeDuration());
  const authoringPlayhead = optional<HTMLElement>('#authoring-playhead');
  if (authoringPlayhead) {
    authoringPlayhead.hidden = !isMeasured();
    authoringPlayhead.style.left = `calc(var(--timeline-label-width) + ${currentTime * pixelsPerSecond}px)`;
  }
  updateTimecode();
  followPlayhead();
}

function render(): void {
  if (!initialized) return;
  if (editorWorkspace().mode === 'creator') renderCreatorTimeline();
  else renderProject();
  updateToolbar();
  updateTimelineTime(editorWorkspace().currentTime);
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
  setSummary('Volvé al Editor para seleccionar escenas, reproducir y editar la timeline.');
}

function renderProject(): void {
  const project = store?.project();
  optional<HTMLElement>('.professional-timeline')?.classList.add('is-authoring');
  optional<HTMLElement>('.professional-timeline')?.classList.remove('is-creator');
  if (!project) {
    setTimelineMode(false);
    setSummary('Abrí un proyecto para ver sus escenas y diálogos.');
    renderLayerStack(null, [], []);
    return;
  }
  const measured = compatibleTimeline(project.scenes);
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
      cursor += width + 4;
    }
  }
  setTimelineMode(Boolean(measured));
  renderLayerStack(project, positions, sceneWidths, measured);
  setSummary(measured
    ? `${project.scenes.length} escena(s) · ${measured.durationSeconds.toFixed(2)} s medidos · capas editables alineadas con la exportación actual.`
    : `${project.scenes.length} escena(s) · visual arriba, audio abajo · estructura editorial sin tiempos inventados.`);
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
  const totalWidth = Math.max(640, (positions.at(-1) ?? 0) + (sceneWidths.at(-1) ?? 0));
  const rows: HTMLElement[] = [
    authoringRuler(project, positions, totalWidth, measured),
  ];
  if (project.scenes.length >= 2) {
    rows.push(transitionsRow(project, positions, sceneWidths, totalWidth, measured));
  }
  rows.push(trackDivider('VISUAL', 'Capas que forman la imagen'));
  rows.push(authoringTrack('BG', 'Fondos', totalWidth, project.scenes.map((scene, index) => {
    const duration = measured?.scenes[index] ? measured.scenes[index].endSeconds - measured.scenes[index].startSeconds : null;
    const clip = authoringClip(
      scene.title,
      `${scene.background.resourceId} · ${duration === null ? 'escena completa · sin medir' : `${duration.toFixed(2)} s`}`,
      positions[index],
      sceneWidths[index],
      'background',
    );
    bindSceneClip(clip, scene.id);
    return clip;
  })));
  const maximumCharacters = Math.max(1, ...project.scenes.map((scene) => scene.elements.filter((element) => element.type === 'character').length));
  for (let slot = 0; slot < maximumCharacters; slot += 1) {
    const clips = project.scenes.flatMap((scene, sceneIndex) => {
      const element = scene.elements.filter((candidate) => candidate.type === 'character')[slot];
      if (!element) return [];
      const selection = projectSelection();
      const clip = authoringClip(
        element.resourceId ?? element.id,
        `Escala ${element.transform.scale.toFixed(2)} · ${element.animationPreset ?? 'movimiento base'}`,
        positions[sceneIndex],
        sceneWidths[sceneIndex],
        'character',
        selection?.kind === 'element' && selection.elementId === element.id,
      );
      clip.addEventListener('click', () => selectElement(scene.id, element.id));
      clip.addEventListener('dblclick', () => selectElement(scene.id, element.id));
      return [clip];
    });
    rows.push(authoringTrack(`V${slot + 1}`, `Personaje ${slot + 1}`, totalWidth, clips));
  }
  rows.push(trackDivider('AUDIO', 'Voces debajo de las capas visuales'));
  for (let slot = 0; slot < maximumCharacters; slot += 1) {
    const clips: HTMLElement[] = [];
    project.scenes.forEach((scene, sceneIndex) => {
      const speaker = scene.elements.filter((element) => element.type === 'character')[slot];
      if (!speaker) return;
      const totalWords = Math.max(1, wordsInScene(scene));
      let cursor = positions[sceneIndex];
      for (const turn of scene.dialogue) {
        const width = Math.max(38, sceneWidths[sceneIndex] * (wordCount(turn.text) / totalWords));
        if (turn.speakerElementId === speaker.id) {
          const selection = projectSelection();
          const clip = authoringClip(
            turn.text,
            measured ? `${turn.voiceId} · orden del guion dentro de la escena medida` : `${turn.voiceId} · duración pendiente de voz`,
            cursor,
            width,
            'dialogue',
            selection?.kind === 'dialogue' && selection.turnId === turn.id,
          );
          clip.addEventListener('click', () => selectDialogue(scene.id, turn.id));
          clip.addEventListener('dblclick', () => selectDialogue(scene.id, turn.id));
          clips.push(clip);
          if (turn.gapAfterSeconds > 0) {
            clips.push(pauseMarker(cursor + width, turn.gapAfterSeconds));
          }
        }
        cursor += width;
      }
    });
    rows.push(authoringTrack(`A${slot + 1}`, `Voz ${slot + 1}`, totalWidth, clips));
  }
  const playhead = document.createElement('span');
  playhead.id = 'authoring-playhead';
  playhead.className = 'authoring-playhead';
  playhead.hidden = !measured;
  rows.push(playhead);
  root.replaceChildren(...rows);
}

function authoringTrack(code: string, label: string, width: number, clips: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'authoring-track-row';
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

function authoringRuler(
  project: ReturnType<ProjectStore['project']>,
  positions: number[],
  width: number,
  measured: MeasuredProjectTimeline | null,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'authoring-track-row authoring-ruler-row';
  const label = document.createElement('div');
  label.className = 'authoring-track-label';
  label.innerHTML = `<strong>TIEMPO</strong><span>${measured ? 'medido' : 'sin medir'}</span>`;
  const ruler = document.createElement('div');
  ruler.className = 'authoring-track-ruler';
  ruler.style.width = `${Math.ceil(width)}px`;
  if (measured) {
    ruler.title = 'Clic para mover el cabezal de reproducción';
    ruler.addEventListener('click', (event) => {
      const bounds = ruler.getBoundingClientRect();
      seekTo(snapTime((event.clientX - bounds.left) / pixelsPerSecond));
    });
  }
  positions.forEach((left, index) => {
    const mark = document.createElement('span');
    mark.style.left = `${left}px`;
    mark.textContent = measured
      ? `${formatRulerTime(measured.scenes[index]?.startSeconds ?? 0)} · E${index + 1}`
      : `E${index + 1} · ${project.scenes[index].title}`;
    ruler.append(mark);
  });
  row.append(label, ruler);
  return row;
}

function transitionsRow(
  project: ReturnType<ProjectStore['project']>,
  positions: number[],
  sceneWidths: number[],
  width: number,
  measured: MeasuredProjectTimeline | null,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'authoring-track-row authoring-junction-row';
  const label = document.createElement('div');
  label.className = 'authoring-track-label';
  label.innerHTML = '<strong>UNIÓN</strong><span>Transiciones</span>';
  const lane = document.createElement('div');
  lane.className = 'authoring-junction-lane';
  lane.style.width = `${Math.ceil(width)}px`;
  for (let index = 0; index < project.scenes.length - 1; index += 1) {
    const transition = project.scenes[index].transitionToNext ?? { preset: 'cut', durationSeconds: 0 };
    const boundary = measured?.scenes[index]
      ? measured.scenes[index].endSeconds * pixelsPerSecond
      : positions[index] + sceneWidths[index];
    const chip = document.createElement('span');
    chip.className = `transition-chip is-${transition.preset}`;
    chip.style.left = `${boundary}px`;
    chip.textContent = transitionGlyph(transition.preset, transition.durationSeconds);
    chip.title = `${transitionLabel(transition.preset, transition.durationSeconds)} · entre ${project.scenes[index].title} y ${project.scenes[index + 1].title}`;
    lane.append(chip);
  }
  row.append(label, lane);
  return row;
}

function pauseMarker(left: number, seconds: number): HTMLElement {
  const marker = document.createElement('span');
  marker.className = 'dialogue-pause';
  marker.style.left = `${left}px`;
  marker.title = `Pausa ${pauseLabel(seconds)}`;
  const badge = document.createElement('small');
  badge.textContent = pauseLabel(seconds);
  marker.append(badge);
  return marker;
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

function bindSceneClip(clip: HTMLButtonElement, sceneId: string): void {
  clip.draggable = true;
  clip.classList.toggle('is-selected', store?.selectedSceneId() === sceneId);
  clip.addEventListener('click', () => selectScene(sceneId));
  clip.addEventListener('dblclick', () => selectScene(sceneId));
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

function selectScene(sceneId: string): void {
  showEditorCanvas();
  selectProjectItem({ kind: 'scene', sceneId });
  store?.dispatch({ type: 'select-scene', sceneId });
}

function selectElement(sceneId: string, elementId: string): void {
  showEditorCanvas();
  selectProjectItem({ kind: 'element', sceneId, elementId });
  store?.dispatch({ type: 'select-scene', sceneId });
}

function selectDialogue(sceneId: string, turnId: string): void {
  showEditorCanvas();
  selectProjectItem({ kind: 'dialogue', sceneId, turnId });
  store?.dispatch({ type: 'select-scene', sceneId });
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
  const button = optional<HTMLButtonElement>('#timeline-play');
  if (button) button.textContent = editorWorkspace().playing ? '❚❚' : '▶';
}

function toggleMute(): void {
  toggleEditorMute();
  syncMuteButton();
}

function duplicateSelection(): void {
  if (!store) return;
  const selection = projectSelection();
  if (selection?.kind !== 'scene') return;
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
  button.disabled = !state.output;
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
  const button = optional<HTMLButtonElement>('#timeline-snap');
  button?.classList.toggle('is-active', snapEnabled);
  button?.setAttribute('aria-pressed', String(snapEnabled));
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
  if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
  const hasOutput = Boolean(editorWorkspace().output);
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
    activeMedia()?.pause();
    seekTo(currentTime - 1);
  } else if (event.code === 'KeyK' && hasOutput) {
    event.preventDefault();
    activeMedia()?.pause();
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
  const hasOutput = !creator && Boolean(editorWorkspace().output);
  const undo = optional<HTMLButtonElement>('#timeline-undo');
  const redo = optional<HTMLButtonElement>('#timeline-redo');
  const play = optional<HTMLButtonElement>('#timeline-play');
  const previous = optional<HTMLButtonElement>('#timeline-previous');
  const next = optional<HTMLButtonElement>('#timeline-next');
  const duplicate = optional<HTMLButtonElement>('#timeline-duplicate');
  const remove = optional<HTMLButtonElement>('#timeline-delete');
  const snap = optional<HTMLButtonElement>('#timeline-snap');
  if (undo) undo.disabled = !store?.canUndo();
  if (redo) redo.disabled = !store?.canRedo();
  if (play) play.disabled = !hasOutput;
  if (previous) previous.disabled = !hasNavigation;
  if (next) next.disabled = !hasNavigation;
  if (snap) snap.disabled = creator || !measured;
  const selection = projectSelection();
  if (duplicate) duplicate.disabled = creator || selection?.kind !== 'scene' || (store?.project().scenes.length ?? 0) >= 8;
  if (remove) {
    remove.disabled = creator || !selection || (selection.kind === 'scene' && (store?.project().scenes.length ?? 0) <= 1);
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
  output.textContent = isMeasured()
    ? `${formatTimecode(currentTime)} / ${formatTimecode(activeDuration())}`
    : '--:--.--- / --:--.---';
}

function setTimelineMode(measured: boolean, customLabel?: string): void {
  const mode = optional<HTMLElement>('#timeline-mode');
  if (mode) {
    mode.textContent = customLabel ?? (measured ? 'Medido' : 'Sin medir');
    mode.classList.toggle('is-measured', measured);
  }
}

function setSummary(message: string): void {
  const summary = optional<HTMLElement>('#timeline-summary');
  if (summary) summary.textContent = message;
}

function followPlayhead(): void {
  const state = editorWorkspace();
  const scroll = optional<HTMLElement>('#timeline-layer-stack');
  if (!state.media || !state.playing || !scroll || !isMeasured()) return;
  const x = currentTime * pixelsPerSecond + 78;
  const leftEdge = scroll.scrollLeft + 20;
  const rightEdge = scroll.scrollLeft + scroll.clientWidth - 30;
  if (x < leftEdge || x > rightEdge) {
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.25);
  }
}

function activeMedia(): HTMLMediaElement | null {
  return editorWorkspace().output ? editorWorkspace().media : null;
}

function activeDuration(): number {
  return editorWorkspace().output ? editorWorkspace().duration : 0;
}

function isMeasured(): boolean {
  return Boolean(compatibleTimeline(store?.project().scenes ?? []));
}

function compatibleTimeline(projectScenes: SceneView[]): MeasuredProjectTimeline | null {
  const state = editorWorkspace();
  const output = state.output;
  const timeline = output?.timeline;
  if (!output || !timeline || output.stale || output.projectId !== state.activeProjectId) return null;
  if (timeline.scenes.length !== projectScenes.length) return null;
  const sameScenes = timeline.scenes.every((scene, index) => scene.id === projectScenes[index]?.id);
  return sameScenes ? timeline : null;
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
