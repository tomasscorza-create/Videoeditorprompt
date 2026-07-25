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
  transitionGlyph,
  transitionLabel,
  turnClipRect,
} from './timeline-geometry.js';
import {
  drawWaveformSlice,
  requestWaveform,
  type WaveformPeaks,
} from './timeline-waveform.js';
import { requestFrame } from './timeline-frames.js';

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
  const output = editorWorkspace().output;
  // Onda real solo en modo medido (hay MP4 vigente); se decodifica una vez por url.
  const waveform = measured && output ? requestWaveform(output.url, render) : null;
  const rows: HTMLElement[] = [
    authoringRuler(project, positions, totalWidth, measured),
  ];
  if (project.scenes.length >= 2) {
    rows.push(transitionsRow(project, positions, sceneWidths, totalWidth, measured));
  }
  rows.push(trackDivider('VISUAL', 'Capas que forman la imagen'));
  const backgroundClips = project.scenes.map((scene, index) => {
    const duration = measured?.scenes[index] ? measured.scenes[index].endSeconds - measured.scenes[index].startSeconds : null;
    const clip = authoringClip(
      scene.title,
      `${scene.background.resourceId} · ${duration === null ? 'escena completa · sin medir' : `${duration.toFixed(2)} s`}`,
      positions[index],
      sceneWidths[index],
      'background',
    );
    bindSceneClip(clip, scene.id, measured?.scenes[index]?.startSeconds ?? 0);
    if (measured && output) {
      attachFilmstripCanvas(clip, measured.scenes[index].startSeconds, measured.scenes[index].endSeconds);
    }
    return clip;
  });
  rows.push(authoringTrack('BG', 'Fondos', totalWidth, [...backgroundClips, ...sceneInsertButtons(project, positions, sceneWidths)]));
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
      const characterStart = measured?.scenes[sceneIndex]?.startSeconds ?? 0;
      clip.addEventListener('click', () => clipSingleClick(characterStart, () => selectElement(scene.id, element.id), () => selectElementCore(scene.id, element.id)));
      clip.addEventListener('dblclick', () => selectElement(scene.id, element.id));
      clip.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openContextMenu(clip, characterMenuItems(scene.id, element.id, clip));
      });
      acceptResourceDrop(clip, CHARACTER_DRAG_TYPE, (dataTransfer) => applyCharacterDrop(scene.id, element.id, dataTransfer));
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
            : measured ? `${turn.voiceId} · orden del guion dentro de la escena medida` : `${turn.voiceId} · duración pendiente de voz`;
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
  const playhead = document.createElement('span');
  playhead.id = 'authoring-playhead';
  playhead.className = 'authoring-playhead';
  playhead.hidden = !measured;
  rows.push(playhead);
  root.replaceChildren(...rows);
  // Dibujar ondas y filmstrips después de adjuntar: recién ahí los canvas tienen tamaño.
  if (waveform) drawWaveforms(root, waveform);
  if (measured && output) drawFilmstrips(root, output.url);
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
    // Subdivisiones de segundos/medios/cuartos según el zoom (solo con medición).
    for (const tick of rulerTicks(measured.durationSeconds, pixelsPerSecond)) {
      const mark = document.createElement('span');
      mark.className = `ruler-tick ${tick.major ? 'is-major' : 'is-minor'}`;
      mark.style.left = `${tick.position}px`;
      if (tick.major) mark.textContent = formatRulerTime(tick.seconds);
      ruler.append(mark);
    }
  }
  // Fronteras de escena, siempre presentes y por encima de las subdivisiones.
  positions.forEach((left, index) => {
    const mark = document.createElement('span');
    mark.className = 'ruler-scene';
    mark.style.left = `${left}px`;
    mark.textContent = measured
      ? `E${index + 1}`
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
    const scene = project.scenes[index];
    const transition = scene.transitionToNext ?? { preset: 'cut' as const, durationSeconds: 0 };
    const boundary = measured?.scenes[index]
      ? measured.scenes[index].endSeconds * pixelsPerSecond
      : positions[index] + sceneWidths[index];
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `transition-chip is-${transition.preset}`;
    chip.style.left = `${boundary}px`;
    chip.textContent = transitionGlyph(transition.preset, transition.durationSeconds);
    chip.title = `${transitionLabel(transition.preset, transition.durationSeconds)} · entre ${scene.title} y ${project.scenes[index + 1].title} · clic: cambiar · clic derecho: duración`;
    // B1: clic cicla corte↔fundido; clic derecho abre el popover de duración.
    chip.addEventListener('click', () => cycleTransition(scene.id, transition.preset));
    chip.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openTransitionPopover(chip, scene.id, transition.preset, transition.durationSeconds);
    });
    lane.append(chip);
  }
  row.append(label, lane);
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
  const canAdd = scenes.length < 8;
  const isLast = index === scenes.length - 1;
  return [
    { label: 'Duplicar escena', disabled: !canAdd, action: () => duplicateSceneById(sceneId) },
    { label: 'Insertar escena antes', disabled: !canAdd, action: () => insertSceneAt(sceneId, index) },
    { label: 'Insertar escena después', disabled: !canAdd, action: () => insertSceneAt(sceneId, index + 1) },
    { separator: true },
    { label: '← Mover a la izquierda', disabled: index <= 0, action: () => moveScene(index, -1) },
    { label: 'Mover a la derecha →', disabled: index < 0 || index >= scenes.length - 1, action: () => moveScene(index, 1) },
    { separator: true },
    { label: isLast ? 'Transición (no hay escena siguiente)' : 'Editar transición…', disabled: isLast, action: () => openTransitionPopoverForScene(sceneId, anchor) },
    { separator: true },
    { label: 'Acortar escena…', action: () => openShortenPanel(anchor, sceneId) },
    { label: 'Eliminar escena', disabled: scenes.length <= 1, action: () => deleteSceneById(sceneId) },
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
  const items: MenuItem[] = [
    { label: 'Insertar turno antes', disabled: !canAdd || !turn || turnIndex === 0, action: () => turn && insertTurn(sceneId, turn, previous?.id) },
    { label: 'Insertar turno después', disabled: !canAdd || !turn, action: () => turn && insertTurn(sceneId, turn, turn.id) },
    { separator: true },
    { label: canSplit ? 'Dividir escena aquí' : 'Dividir aquí (necesita 2 turnos por lado)', disabled: !canSplit, action: () => splitSceneAtTurn(sceneId, turnId) },
    { separator: true },
  ];
  if (speakers.length > 1) {
    items.push({ label: 'Cambiar hablante…', action: () => openResourcePicker(
      anchor,
      'Hablante',
      null,
      (speakerElementId) => {
        const error = store?.dispatch({ type: 'set-dialogue-speaker', sceneId, turnId, speakerElementId });
        if (error) window.alert(error);
      },
      speakers.map((element) => ({ id: element.id, label: element.resourceId ?? element.id })),
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

// Inserta una escena en blanco en `targetIndex` (add-scene appende + reorder la ubica).
function insertSceneAt(referenceSceneId: string, targetIndex: number): void {
  if (!store) return;
  const reference = store.project().scenes.find((item) => item.id === referenceSceneId);
  if (!reference) return;
  const newSceneId = nextSceneId(store.project().scenes.map((item) => item.id));
  const error = store.dispatch({
    type: 'add-scene',
    scene: {
      id: newSceneId,
      title: 'Escena nueva',
      background: { resourceId: reference.background.resourceId, cameraPreset: reference.background.cameraPreset },
      elements: [],
      dialogue: [],
    },
  });
  if (error) { window.alert(error); return; }
  const ids = store.project().scenes.map((item) => item.id).filter((id) => id !== newSceneId);
  ids.splice(clamp(targetIndex, 0, ids.length), 0, newSceneId);
  store.dispatch({ type: 'reorder-scenes', sceneIds: ids });
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

function insertTurn(sceneId: string, reference: { speakerElementId: string; voiceId: string }, afterTurnId?: string): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const turnId = nextTurnId(scene.dialogue.map((turn) => turn.id));
  const command = {
    type: 'add-dialogue-turn' as const,
    sceneId,
    turnId,
    speakerElementId: reference.speakerElementId,
    text: 'Nuevo diálogo',
    voiceId: reference.voiceId,
    gestureId: 'neutral' as const,
    gapAfterSeconds: 0,
    ...(afterTurnId ? { afterTurnId } : {}),
  };
  const error = store.dispatch(command);
  if (error) window.alert(error);
  else selectDialogue(sceneId, turnId);
}

// C2: el corte es válido solo si deja al menos dos turnos a cada lado (el motor exige
// >= 2 turnos por escena renderizable).
function canSplitAtIndex(dialogueLength: number, turnIndex: number): boolean {
  return turnIndex >= 2 && turnIndex <= dialogueLength - 2;
}

function splitSceneAtTurn(sceneId: string, turnId: string): void {
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === sceneId);
  if (!scene) return;
  const turnIndex = scene.dialogue.findIndex((turn) => turn.id === turnId);
  if (!canSplitAtIndex(scene.dialogue.length, turnIndex) || store.project().scenes.length >= 8) return;
  const newSceneId = nextSceneId(store.project().scenes.map((item) => item.id));
  const error = store.dispatch({ type: 'split-scene', sceneId, atTurnId: turnId, newSceneId });
  if (error) window.alert(error);
  else selectScene(newSceneId);
}

function splitSelectedTurn(): void {
  const selection = projectSelection();
  if (selection?.kind === 'dialogue') splitSceneAtTurn(selection.sceneId, selection.turnId);
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
    empty.textContent = 'La escena quedó sin turnos.';
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
  const title = canAdd ? 'Insertar escena aquí' : 'Máximo de 8 escenas';
  const buttons: HTMLElement[] = [
    insertButton(positions[0] ?? 0, canAdd ? 'Insertar escena al inicio' : title, !canAdd, () => insertSceneAt(scenes[0].id, 0)),
  ];
  scenes.forEach((scene, index) => {
    const boundary = (positions[index] ?? 0) + (sceneWidths[index] ?? 0);
    buttons.push(insertButton(boundary, title, !canAdd, () => insertSceneAt(scene.id, index + 1)));
  });
  return buttons;
}

// ---- B5: soltar recursos de la biblioteca sobre clips ----

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
  // B6: Ctrl/Cmd+Z deshace y Ctrl+Y / Ctrl+Shift+Z rehace. Se respeta isTyping para no
  // pisar el undo nativo de los inputs.
  if ((event.ctrlKey || event.metaKey) && !isTyping(event.target)) {
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      if (store?.canUndo()) store.undo();
      return;
    }
    if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      if (store?.canRedo()) store.redo();
      return;
    }
    if (key === 'b') {
      event.preventDefault();
      splitSelectedTurn();
      return;
    }
  }
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
  } else if (event.code === 'KeyB') {
    event.preventDefault();
    splitSelectedTurn();
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
