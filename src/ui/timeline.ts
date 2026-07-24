import type { PreviewHandle } from '../preview/types.js';
import { optional } from './dom.js';
import type { ProjectStore } from './project/store.js';
import type { SceneView } from './project/types.js';
import type { ViewerSource } from './viewer.js';

const MIN_PIXELS_PER_SECOND = 20;
const MAX_PIXELS_PER_SECOND = 220;
const DEFAULT_PIXELS_PER_SECOND = 60;
const EDITORIAL_SCENE_WIDTH = 190;
const MIN_CLIP_WIDTH = 4;

export interface MeasuredScene {
  id: string;
  startSeconds: number;
  endSeconds: number;
  audioDurationSeconds?: number;
  transitionToNext?: {
    preset: string;
    durationSeconds: number;
    startSeconds: number;
    endSeconds: number;
  };
}

export interface MeasuredProjectTimeline {
  durationSeconds: number;
  scenes: MeasuredScene[];
}

interface FinalTimelineState {
  video: HTMLVideoElement;
  timeline: MeasuredProjectTimeline | null;
}

let initialized = false;
let source: ViewerSource = 'composition';
let store: ProjectStore | null = null;
let preview: PreviewHandle | null = null;
let finalState: FinalTimelineState | null = null;
let pixelsPerSecond = DEFAULT_PIXELS_PER_SECOND;
let snapEnabled = true;
let selectedClipId: string | null = null;
let currentTime = 0;
const boundFinalMedia = new WeakSet<HTMLVideoElement>();

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
  const shortcutsDialog = optional<HTMLDialogElement>('#timeline-shortcuts-dialog');
  optional<HTMLButtonElement>('#timeline-shortcuts')?.addEventListener('click', () => shortcutsDialog?.showModal());
  optional<HTMLButtonElement>('#timeline-shortcuts-close')?.addEventListener('click', () => shortcutsDialog?.close());
  optional<HTMLElement>('#timeline-ruler')?.addEventListener('click', seekFromPointer);
  optional<HTMLElement>('#timeline-video-track')?.addEventListener('click', seekFromPointer);
  optional<HTMLElement>('#timeline-audio-track')?.addEventListener('click', seekFromPointer);
  window.addEventListener('keydown', handleShortcut);
  render();
}

export function attachProjectTimeline(projectStore: ProjectStore): void {
  store = projectStore;
  store.subscribe(() => render());
  render();
}

export function attachPreviewTimeline(handle: PreviewHandle): void {
  preview = handle;
  handle.audio.addEventListener('play', syncPlayButton);
  handle.audio.addEventListener('pause', syncPlayButton);
  handle.audio.addEventListener('ended', syncPlayButton);
  handle.audio.addEventListener('timeupdate', () => updateTimelineTime(handle.audio.currentTime));
  render();
}

export function attachFinalTimeline(video: HTMLVideoElement, timeline: MeasuredProjectTimeline | null): void {
  finalState = { video, timeline };
  if (!boundFinalMedia.has(video)) {
    boundFinalMedia.add(video);
    video.addEventListener('play', syncPlayButton);
    video.addEventListener('pause', syncPlayButton);
    video.addEventListener('ended', syncPlayButton);
    video.addEventListener('loadedmetadata', () => render());
    video.addEventListener('timeupdate', () => updateTimelineTime(video.currentTime));
  }
  render();
}

export function setTimelineSource(nextSource: ViewerSource): void {
  source = nextSource;
  currentTime = activeMedia()?.currentTime ?? 0;
  selectedClipId = null;
  render();
}

export function updateTimelineTime(timeSeconds: number): void {
  currentTime = clamp(timeSeconds, 0, activeDuration());
  const playhead = optional<HTMLElement>('#timeline-playhead');
  if (playhead) {
    playhead.hidden = !isMeasured();
    playhead.style.transform = `translateX(${currentTime * pixelsPerSecond}px)`;
  }
  updateTimecode();
  followPlayhead();
}

function render(): void {
  if (!initialized) return;
  if (source === 'preview' && preview) renderPreview();
  else if (source === 'final' && finalState) renderFinal();
  else renderProject();
  updateToolbar();
  updateTimelineTime(activeMedia()?.currentTime ?? currentTime);
}

function renderProject(): void {
  setTimelineMode(false);
  const project = store?.project();
  const videoTrack = optional<HTMLElement>('#timeline-video-track');
  const audioTrack = optional<HTMLElement>('#timeline-audio-track');
  const ruler = optional<HTMLElement>('#timeline-ruler');
  if (!videoTrack || !audioTrack || !ruler) return;
  if (!project) {
    videoTrack.replaceChildren();
    audioTrack.replaceChildren();
    ruler.replaceChildren();
    setSurfaceWidth(600);
    setSummary('Abrí un proyecto para ver sus escenas y diálogos.');
    return;
  }

  const scale = pixelsPerSecond / DEFAULT_PIXELS_PER_SECOND;
  const sceneWidths = project.scenes.map((scene) => Math.max(EDITORIAL_SCENE_WIDTH, wordsInScene(scene) * 8) * scale);
  const positions: number[] = [];
  let cursor = 0;
  for (const width of sceneWidths) {
    positions.push(cursor);
    cursor += width + 4;
  }
  setSurfaceWidth(Math.max(600, cursor));
  const sceneNodes = project.scenes.map((scene, index) => {
    const clip = createClip({
      id: `project-scene:${scene.id}`,
      kind: 'video',
      title: scene.title,
      detail: `${scene.dialogue.length} turnos · sin medir`,
      left: positions[index],
      width: sceneWidths[index],
      unmeasured: true,
      selected: scene.id === store?.selectedSceneId(),
    });
    clip.addEventListener('click', () => {
      selectedClipId = `project-scene:${scene.id}`;
      store?.dispatch({ type: 'select-scene', sceneId: scene.id });
    });
    return clip;
  });

  const turnNodes: HTMLElement[] = [];
  project.scenes.forEach((scene, sceneIndex) => {
    const totalWords = Math.max(1, wordsInScene(scene));
    let turnCursor = positions[sceneIndex];
    for (const turn of scene.dialogue) {
      const width = Math.max(42, sceneWidths[sceneIndex] * (wordCount(turn.text) / totalWords));
      const speaker = scene.elements.find((element) => element.id === turn.speakerElementId)?.resourceId ?? turn.speakerElementId;
      const clip = createClip({
        id: `project-turn:${scene.id}:${turn.id}`,
        kind: 'audio',
        title: speaker,
        detail: turn.text,
        left: turnCursor,
        width,
        unmeasured: true,
        selected: selectedClipId === `project-turn:${scene.id}:${turn.id}`,
      });
      clip.addEventListener('click', () => {
        selectedClipId = `project-turn:${scene.id}:${turn.id}`;
        store?.dispatch({ type: 'select-scene', sceneId: scene.id });
        render();
      });
      turnNodes.push(clip);
      turnCursor += width;
    }
  });

  const rulerNodes = positions.map((left, index) => rulerMark(left, `E${index + 1}`, true));
  ruler.replaceChildren(...rulerNodes);
  videoTrack.replaceChildren(...sceneNodes);
  audioTrack.replaceChildren(...turnNodes);
  setSummary(`${project.scenes.length} escena(s) · estructura editable sin tiempos. Renderizá para obtener escala real de FFprobe.`);
}

function renderPreview(): void {
  if (!preview) return;
  const duration = preview.durationSeconds;
  const width = measuredWidth(duration);
  setSurfaceWidth(width);
  setTimelineMode(true);
  renderMeasuredRuler(duration);

  const scene = createClip({
    id: 'preview-scene',
    kind: 'video',
    title: 'Escena publicada',
    detail: `${duration.toFixed(2)} s medidos`,
    left: 0,
    width: duration * pixelsPerSecond,
    selected: selectedClipId === 'preview-scene',
  });
  scene.addEventListener('click', () => selectAndSeek('preview-scene', 0));
  optional<HTMLElement>('#timeline-video-track')?.replaceChildren(scene);

  const turns = preview.turns?.length
    ? preview.turns.map((turn) => {
      const clip = createClip({
        id: `preview-turn:${turn.id}`,
        kind: 'audio',
        title: turn.speakerId,
        detail: `${turn.startSeconds.toFixed(2)}–${turn.endSeconds.toFixed(2)} s`,
        left: turn.startSeconds * pixelsPerSecond,
        width: turn.durationSeconds * pixelsPerSecond,
        selected: selectedClipId === `preview-turn:${turn.id}`,
      });
      clip.addEventListener('click', () => selectAndSeek(`preview-turn:${turn.id}`, turn.startSeconds));
      return clip;
    })
    : [createClip({
      id: 'preview-audio',
      kind: 'audio',
      title: 'Audio generado',
      detail: `${duration.toFixed(2)} s medidos`,
      left: 0,
      width: duration * pixelsPerSecond,
    })];
  optional<HTMLElement>('#timeline-audio-track')?.replaceChildren(...turns);
  setSummary(`Preview medido · ${preview.turns?.length ?? 1} clip(s) de audio · clic en la regla o un clip para navegar.`);
}

function renderFinal(): void {
  if (!finalState) return;
  const duration = finalState.timeline?.durationSeconds || finalState.video.duration || 0;
  if (!duration) {
    renderEmptyMeasured('El MP4 todavía está leyendo su duración.');
    return;
  }
  setSurfaceWidth(measuredWidth(duration));
  setTimelineMode(true);
  renderMeasuredRuler(duration);
  const scenes = finalState.timeline?.scenes?.length
    ? finalState.timeline.scenes
    : [{ id: 'video-final', startSeconds: 0, endSeconds: duration }];
  const projectScenes = store?.project().scenes ?? [];
  const videoNodes: HTMLElement[] = [];
  const audioNodes: HTMLElement[] = [];
  const transitionNodes: HTMLElement[] = [];

  scenes.forEach((scene, index) => {
    const title = sceneTitle(scene, projectScenes, index);
    const width = (scene.endSeconds - scene.startSeconds) * pixelsPerSecond;
    const video = createClip({
      id: `final-scene:${scene.id}`,
      kind: 'video',
      title,
      detail: `${scene.startSeconds.toFixed(2)}–${scene.endSeconds.toFixed(2)} s`,
      left: scene.startSeconds * pixelsPerSecond,
      width,
      selected: selectedClipId === `final-scene:${scene.id}`,
    });
    video.addEventListener('click', () => selectAndSeek(`final-scene:${scene.id}`, scene.startSeconds));
    videoNodes.push(video);

    const audio = createClip({
      id: `final-audio:${scene.id}`,
      kind: 'audio',
      title: `Audio · ${title}`,
      detail: `${(scene.audioDurationSeconds ?? scene.endSeconds - scene.startSeconds).toFixed(2)} s`,
      left: scene.startSeconds * pixelsPerSecond,
      width,
      selected: selectedClipId === `final-audio:${scene.id}`,
    });
    audio.addEventListener('click', () => selectAndSeek(`final-audio:${scene.id}`, scene.startSeconds));
    audioNodes.push(audio);

    if (scene.transitionToNext) {
      const transition = document.createElement('span');
      transition.className = 'timeline-transition';
      transition.style.left = `${scene.transitionToNext.startSeconds * pixelsPerSecond}px`;
      transition.style.width = `${Math.max(MIN_CLIP_WIDTH, scene.transitionToNext.durationSeconds * pixelsPerSecond)}px`;
      transition.title = `${scene.transitionToNext.preset} · ${scene.transitionToNext.durationSeconds.toFixed(2)} s`;
      transitionNodes.push(transition);
    }
  });
  optional<HTMLElement>('#timeline-video-track')?.replaceChildren(...videoNodes, ...transitionNodes);
  optional<HTMLElement>('#timeline-audio-track')?.replaceChildren(...audioNodes);
  setSummary(`MP4 final medido · ${scenes.length} escena(s) · ${duration.toFixed(2)} s · transiciones superpuestas sobre V1.`);
}

function renderEmptyMeasured(message: string): void {
  optional<HTMLElement>('#timeline-video-track')?.replaceChildren();
  optional<HTMLElement>('#timeline-audio-track')?.replaceChildren();
  optional<HTMLElement>('#timeline-ruler')?.replaceChildren();
  setSurfaceWidth(600);
  setTimelineMode(true);
  setSummary(message);
}

function renderMeasuredRuler(duration: number): void {
  const ruler = optional<HTMLElement>('#timeline-ruler');
  if (!ruler) return;
  const minorStep = pixelsPerSecond >= 120 ? 0.5 : pixelsPerSecond >= 50 ? 1 : pixelsPerSecond >= 28 ? 2 : 5;
  const majorEvery = minorStep < 1 ? 2 : minorStep <= 2 ? 5 : 10;
  const nodes: HTMLElement[] = [];
  for (let second = 0; second <= duration + minorStep / 2; second += minorStep) {
    const rounded = Math.round(second * 1000) / 1000;
    const major = nearlyMultiple(rounded, majorEvery);
    nodes.push(rulerMark(rounded * pixelsPerSecond, major ? formatRulerTime(rounded) : '', major));
  }
  ruler.replaceChildren(...nodes);
}

function createClip(options: {
  id: string;
  kind: 'video' | 'audio';
  title: string;
  detail: string;
  left: number;
  width: number;
  selected?: boolean;
  unmeasured?: boolean;
}): HTMLButtonElement {
  const clip = document.createElement('button');
  clip.type = 'button';
  clip.className = `timeline-clip ${options.kind}`;
  clip.classList.toggle('is-selected', Boolean(options.selected));
  clip.classList.toggle('is-unmeasured', Boolean(options.unmeasured));
  clip.dataset.clipId = options.id;
  clip.style.left = `${options.left}px`;
  clip.style.width = `${Math.max(MIN_CLIP_WIDTH, options.width)}px`;
  clip.title = `${options.title} · ${options.detail}`;
  const title = document.createElement('strong');
  title.textContent = options.title;
  const detail = document.createElement('span');
  detail.textContent = options.detail;
  clip.append(title, detail);
  return clip;
}

function rulerMark(left: number, text: string, major: boolean): HTMLElement {
  const mark = document.createElement('span');
  mark.className = 'timeline-ruler-mark';
  mark.classList.toggle('is-major', major);
  mark.style.left = `${left}px`;
  mark.textContent = text;
  return mark;
}

function seekFromPointer(event: MouseEvent): void {
  if (!isMeasured() || (event.target as HTMLElement).closest('.timeline-clip')) return;
  const surface = optional<HTMLElement>('#timeline-surface');
  if (!surface) return;
  const x = event.clientX - surface.getBoundingClientRect().left;
  seekTo(snapTime(x / pixelsPerSecond));
}

function selectAndSeek(id: string, time: number): void {
  selectedClipId = id;
  seekTo(time);
  render();
}

function seekTo(time: number): void {
  const duration = activeDuration();
  const target = clamp(time, 0, duration);
  const media = activeMedia();
  if (media) media.currentTime = target;
  if (source === 'preview' && preview) preview.render(target);
  updateTimelineTime(target);
}

function togglePlayback(): void {
  const media = activeMedia();
  if (!media) return;
  if (media.paused) void media.play();
  else media.pause();
}

function syncPlayButton(): void {
  const button = optional<HTMLButtonElement>('#timeline-play');
  const media = activeMedia();
  if (button) button.textContent = media && !media.paused ? '❚❚' : '▶';
}

function toggleMute(): void {
  const media = activeMedia();
  if (!media) return;
  media.muted = !media.muted;
  syncMuteButton();
}

function syncMuteButton(): void {
  const button = optional<HTMLButtonElement>('#timeline-mute');
  const media = activeMedia();
  if (!button) return;
  button.disabled = !media;
  button.classList.toggle('is-active', Boolean(media?.muted));
  button.setAttribute('aria-pressed', String(Boolean(media?.muted)));
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
  const project = store.project();
  const index = project.scenes.findIndex((scene) => scene.id === store?.selectedSceneId());
  const target = project.scenes[clamp(index + direction, 0, project.scenes.length - 1)];
  if (target) store.dispatch({ type: 'select-scene', sceneId: target.id });
}

function measuredBoundaries(): number[] {
  const values = new Set<number>([0, activeDuration()]);
  if (source === 'preview') {
    for (const turn of preview?.turns ?? []) values.add(turn.startSeconds);
  } else if (source === 'final') {
    for (const scene of finalState?.timeline?.scenes ?? []) values.add(scene.startSeconds);
  }
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
  const scroll = optional<HTMLElement>('#timeline-scroll');
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
  if (event.code === 'Space' && isMeasured()) {
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
  } else if (event.code === 'KeyS') {
    event.preventDefault();
    toggleSnap();
  } else if (event.code === 'KeyM' && isMeasured()) {
    event.preventDefault();
    toggleMute();
  } else if (event.code === 'KeyJ' && isMeasured()) {
    event.preventDefault();
    activeMedia()?.pause();
    seekTo(currentTime - 1);
  } else if (event.code === 'KeyK' && isMeasured()) {
    event.preventDefault();
    activeMedia()?.pause();
  } else if (event.code === 'KeyL' && isMeasured()) {
    event.preventDefault();
    void activeMedia()?.play();
  } else if (event.code === 'KeyF') {
    event.preventDefault();
    fitTimeline();
  } else if (event.code === 'Equal' || event.code === 'NumpadAdd') {
    event.preventDefault();
    zoomBy(1.25);
  } else if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
    event.preventDefault();
    zoomBy(0.8);
  }
}

function updateToolbar(): void {
  const hasProject = Boolean(store);
  const measured = isMeasured();
  const hasNavigation = measured || Boolean(store?.project().scenes.length);
  const undo = optional<HTMLButtonElement>('#timeline-undo');
  const redo = optional<HTMLButtonElement>('#timeline-redo');
  const play = optional<HTMLButtonElement>('#timeline-play');
  const previous = optional<HTMLButtonElement>('#timeline-previous');
  const next = optional<HTMLButtonElement>('#timeline-next');
  if (undo) undo.disabled = !store?.canUndo();
  if (redo) redo.disabled = !store?.canRedo();
  if (play) play.disabled = !measured;
  if (previous) previous.disabled = !hasNavigation;
  if (next) next.disabled = !hasNavigation;
  optional<HTMLButtonElement>('#timeline-fit')?.toggleAttribute('disabled', !hasProject && !measured);
  syncPlayButton();
  syncMuteButton();
}

function updateTimecode(): void {
  const output = optional<HTMLOutputElement>('#timeline-timecode');
  if (!output) return;
  output.textContent = isMeasured()
    ? `${formatTimecode(currentTime)} / ${formatTimecode(activeDuration())}`
    : '--:--.--- / --:--.---';
}

function setTimelineMode(measured: boolean): void {
  const mode = optional<HTMLElement>('#timeline-mode');
  const playhead = optional<HTMLElement>('#timeline-playhead');
  if (mode) {
    mode.textContent = measured ? 'Medido' : 'Sin medir';
    mode.classList.toggle('is-measured', measured);
  }
  if (playhead) playhead.hidden = !measured;
}

function setSurfaceWidth(width: number): void {
  const surface = optional<HTMLElement>('#timeline-surface');
  if (surface) surface.style.width = `${Math.ceil(width)}px`;
  for (const track of document.querySelectorAll<HTMLElement>('.timeline-track')) {
    track.style.setProperty('--timeline-grid-size', `${pixelsPerSecond}px`);
  }
}

function setSummary(message: string): void {
  const summary = optional<HTMLElement>('#timeline-summary');
  if (summary) summary.textContent = message;
}

function followPlayhead(): void {
  const media = activeMedia();
  const scroll = optional<HTMLElement>('#timeline-scroll');
  if (!media || media.paused || !scroll) return;
  const x = currentTime * pixelsPerSecond;
  const leftEdge = scroll.scrollLeft + 20;
  const rightEdge = scroll.scrollLeft + scroll.clientWidth - 30;
  if (x < leftEdge || x > rightEdge) {
    scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.25);
  }
}

function activeMedia(): HTMLMediaElement | null {
  if (source === 'preview') return preview?.audio ?? null;
  if (source === 'final') return finalState?.video ?? null;
  return null;
}

function activeDuration(): number {
  if (source === 'preview') return preview?.durationSeconds ?? 0;
  if (source === 'final') return finalState?.timeline?.durationSeconds || finalState?.video.duration || 0;
  return 0;
}

function isMeasured(): boolean {
  return activeDuration() > 0 && Boolean(activeMedia());
}

function measuredWidth(duration: number): number {
  const scrollWidth = optional<HTMLElement>('#timeline-scroll')?.clientWidth ?? 600;
  return Math.max(scrollWidth, duration * pixelsPerSecond + 2);
}

function sceneTitle(scene: MeasuredScene, projectScenes: SceneView[], index: number): string {
  return projectScenes.find((item) => item.id === scene.id)?.title ?? projectScenes[index]?.title ?? `Escena ${index + 1}`;
}

function wordsInScene(scene: SceneView): number {
  return scene.dialogue.reduce((total, turn) => total + wordCount(turn.text), 0);
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function nearlyMultiple(value: number, divisor: number): boolean {
  return Math.abs(value / divisor - Math.round(value / divisor)) < 0.0001;
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
