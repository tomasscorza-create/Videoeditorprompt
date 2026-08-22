export type WorkspaceMode = 'editor' | 'creator';
export type EditorSurface = 'canvas' | 'playback';

export interface MeasuredTurn {
  id: string;
  speakerType?: 'character' | 'voiceover';
  speakerId?: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  gapAfterSeconds: number;
}

export interface MeasuredScene {
  id: string;
  startSeconds: number;
  endSeconds: number;
  audioDurationSeconds?: number;
  turns?: MeasuredTurn[];
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

export interface MeasuredVisualScene {
  id: string;
  runtime: {
    audio: { durationSeconds: number };
    characters: Array<{
      id: string;
      transform: Record<string, unknown>;
      blinks: Array<{ start: number; end: number }>;
    }>;
  };
  dialogue: { turns: Array<Record<string, unknown>> };
}

export interface RenderedOutput {
  projectId: string;
  projectRevision: string | null;
  /** Revisión de lo que puede mover un tiempo, medida al renderizar. */
  timingRevision: string | null;
  downloadName: string;
  url: string;
  timeline: MeasuredProjectTimeline | null;
  stale: boolean;
}

export interface EditorWorkspaceSnapshot {
  mode: WorkspaceMode;
  surface: EditorSurface;
  activeProjectId: string | null;
  output: RenderedOutput | null;
  media: HTMLVideoElement | null;
  currentTime: number;
  duration: number;
  playing: boolean;
  muted: boolean;
}

export const EDITOR_WORKSPACE_EVENT = 'local-video:editor-workspace';
export const EDITOR_PLAYBACK_EVENT = 'local-video:editor-playback';

let mode: WorkspaceMode = 'editor';
let surface: EditorSurface = 'canvas';
let activeProjectId: string | null = null;
let activeProjectRevision: string | null = null;
let activeTimingRevision: string | null = null;
let output: RenderedOutput | null = null;
// Medición liviana vigente, independiente de que exista un MP4.
let measurement: {
  projectId: string;
  timingRevision: string;
  timeline: MeasuredProjectTimeline;
  visualScenes: MeasuredVisualScene[];
  audioUrl: string;
} | null = null;
let media: HTMLVideoElement | null = null;
let previewAudio: HTMLAudioElement | null = null;
let mediaBound = false;
let playheadSeconds = 0;
let authoringPlaying = false;
let authoringFrame = 0;

/**
 * Instante de trabajo, compartido por timeline y lienzo.
 *
 * Con un MP4 vigente lo manda el reproductor; con la medición todavía válida
 * pero el render vencido lo mueve la timeline, y el lienzo necesita leerlo para
 * previsualizar la animación en ese instante. Por eso vive acá y no dentro de la
 * timeline: es estado del espacio de trabajo, no de una de sus superficies.
 */
export function editorPlayhead(): number {
  return playheadSeconds;
}

export function setEditorPlayhead(seconds: number): void {
  const next = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (next === playheadSeconds) return;
  playheadSeconds = next;
  if (authoringPlaying) {
    const clock = authoringMedia();
    if (clock) clock.currentTime = Math.min(editorWorkspace().duration, next);
  }
  notifyPlayback();
}

export function editorWorkspace(): EditorWorkspaceSnapshot {
  const measuredDuration = currentMeasuredDuration();
  const clock = surface === 'canvas' ? authoringMedia() ?? media : media;
  return {
    mode,
    surface,
    activeProjectId,
    output,
    media,
    currentTime: surface === 'canvas' ? playheadSeconds : media?.currentTime ?? 0,
    duration: measuredDuration || media?.duration || 0,
    playing: authoringPlaying || Boolean(media && !media.paused),
    muted: Boolean(clock?.muted),
  };
}

export function bindEditorMedia(video: HTMLVideoElement): void {
  media = video;
  if (!mediaBound) {
    mediaBound = true;
    video.addEventListener('loadedmetadata', notify);
    for (const eventName of ['timeupdate', 'play', 'pause', 'ended', 'volumechange']) {
      video.addEventListener(eventName, notifyPlayback);
    }
  }
  notify();
}

export function setActiveEditorProject(
  projectId: string,
  projectRevision: string | null = null,
  timingRevision: string | null = null,
): void {
  activeProjectId = projectId;
  activeProjectRevision = projectRevision;
  activeTimingRevision = timingRevision;
  syncOutputFreshness();
  notify();
}

export function syncActiveEditorProject(
  projectId: string,
  projectRevision: string,
  timingRevision: string | null = null,
): void {
  const wasStale = output?.stale;
  const hadMeasurement = timingStillValid();
  activeProjectId = projectId;
  activeProjectRevision = projectRevision;
  activeTimingRevision = timingRevision;
  syncOutputFreshness();
  if (output?.stale && surface === 'playback') {
    showEditorCanvas();
    return;
  }
  // La medición puede perderse (o recuperarse) sin que cambie la vigencia del
  // MP4: un cambio de diálogo invalida los tiempos aunque el render ya estuviera
  // vencido, y la timeline tiene que enterarse.
  if (wasStale !== output?.stale || hadMeasurement !== timingStillValid()) notify();
}

/** La medición del último render sigue describiendo los tiempos de hoy. */
function timingStillValid(): boolean {
  return Boolean(output)
    && output!.projectId === activeProjectId
    && output!.timingRevision !== null
    && output!.timingRevision === activeTimingRevision;
}

export function editorOutputState(): 'missing' | 'current' | 'stale' {
  if (!output) return 'missing';
  return output.stale || output.projectId !== activeProjectId ? 'stale' : 'current';
}

export function currentEditorOutput(): RenderedOutput | null {
  return editorOutputState() === 'current' ? output : null;
}

/**
 * Salida que el usuario puede reproducir. Un render histórico solo entra acá
 * cuando ya fue abierto explícitamente en el visor; no vuelve vigente la
 * timeline ni se mezcla con la edición actual.
 */
export function playableEditorOutput(): RenderedOutput | null {
  return output && (editorOutputState() === 'current' || surface === 'playback') ? output : null;
}

/** Hay transporte de MP4 o preview de autoría medido disponible. */
export function editorCanPlay(): boolean {
  return Boolean(
    playableEditorOutput()
    || (surface === 'canvas' && authoringMedia() && currentMeasuredDuration() > 0),
  );
}

/**
 * Medición vigente que se corresponde con la estructura de escenas indicada, o
 * null.
 *
 * Medir y reproducir son dos cosas distintas. El MP4 queda viejo apenas se toca
 * cualquier cosa, y por eso el transporte se bloquea; pero la duración de cada
 * turno la sintetizó ElevenLabs y la midió FFprobe, y sigue siendo verdadera mientras
 * no cambie nada que la altere. Mover un personaje o animarlo no mueve un
 * milisegundo, así que la regla de tiempo se conserva y los keyframes siguen
 * ubicados. Si el diálogo, las voces, las pausas, las transiciones o la lista de
 * escenas cambian, la medición deja de describir el proyecto y se descarta.
 */
export function measuredTimelineFor(sceneIds: readonly string[]): MeasuredProjectTimeline | null {
  // Una medición liviana describe el proyecto de hoy y gana sobre el MP4: se
  // obtiene en segundos corriendo solo ElevenLabs y FFprobe, y es exactamente la
  // misma línea de tiempo que produciría un render.
  if (
    measurement
    && measurement.projectId === activeProjectId
    && measurement.timingRevision === activeTimingRevision
    && matchesScenes(measurement.timeline, sceneIds)
  ) {
    return measurement.timeline;
  }
  const timeline = output?.timeline;
  if (!output || !timeline || output.projectId !== activeProjectId) return null;
  // Sin revisión de tiempo (render de una sesión anterior) se mantiene la regla
  // estricta: solo un MP4 vigente mide.
  if (!timingStillValid() && output.stale) return null;
  return matchesScenes(timeline, sceneIds) ? timeline : null;
}

/** Un cambio de clips libres invalida el MP4, pero no los tiempos medidos de las voces. */
export function invalidateEditorOutput(): void {
  if (!output || output.stale) return;
  output = { ...output, stale: true };
  if (surface === 'playback') surface = 'canvas';
  notify();
}

/** Runtime temporal portable de una escena medida y todavía vigente. */
export function measuredVisualSceneFor(sceneId: string): MeasuredVisualScene | null {
  if (
    !measurement
    || measurement.projectId !== activeProjectId
    || measurement.timingRevision !== activeTimingRevision
  ) return null;
  return measurement.visualScenes.find((scene) => scene.id === sceneId) ?? null;
}

function matchesScenes(timeline: MeasuredProjectTimeline, sceneIds: readonly string[]): boolean {
  if (timeline.scenes.length !== sceneIds.length) return false;
  return timeline.scenes.every((scene, index) => scene.id === sceneIds[index]);
}

/**
 * Medición obtenida sin renderizar.
 *
 * Queda atada a la revisión de tiempos con la que se midió: cualquier cambio
 * que mueva un milisegundo la descarta sola, igual que descarta la del MP4. No
 * habilita reproducir —para eso hace falta el audio del MP4— pero sí ubicar el
 * cabezal, los keyframes y los cortes.
 */
export function setProjectMeasurement(value: {
  projectId: string;
  timingRevision: string;
  timeline: MeasuredProjectTimeline;
  visualScenes?: MeasuredVisualScene[];
  audioUrl: string;
}): void {
  stopAuthoringPreview(false);
  measurement = { ...value, visualScenes: value.visualScenes ?? [] };
  if (typeof Audio !== 'undefined') {
    previewAudio ??= createPreviewAudio();
    previewAudio.src = value.audioUrl;
    previewAudio.load();
  }
  notify();
}

export function projectMeasurementIsCurrent(): boolean {
  return Boolean(measurement
    && measurement.projectId === activeProjectId
    && measurement.timingRevision === activeTimingRevision);
}

// M4 — Mejora progresiva: donde el navegador soporte View Transitions, el
// cambio de superficie hace crossfade; donde no, el comportamiento es el de
// siempre. El repintado ocurre síncrono en los listeners de `notify`, así que
// basta con envolver la llamada.
function withViewTransition(apply: () => void): void {
  // Sin DOM (pruebas de módulos), sin soporte del navegador o con
  // reduced-motion, se aplica el cambio directamente.
  if (typeof document === 'undefined') {
    apply();
    return;
  }
  const start = (document as Document & {
    startViewTransition?: (callback: () => void) => unknown;
  }).startViewTransition;
  const reduced = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof start !== 'function' || reduced) {
    apply();
    return;
  }
  start.call(document, apply);
}

export function showWorkspaceMode(nextMode: WorkspaceMode): void {
  withViewTransition(() => {
    mode = nextMode;
    if (nextMode === 'creator') {
      stopAuthoringPreview(false);
      media?.pause();
      surface = 'canvas';
    }
    notify();
  });
}

export function registerRenderedOutput(options: {
  projectId: string;
  url: string;
  downloadName: string;
  timeline: MeasuredProjectTimeline | null;
  projectRevision?: string | null;
  timingRevision?: string | null;
  current: boolean;
  reveal?: boolean;
}): void {
  if (!media) throw new Error('El reproductor del Editor todavía no está disponible.');
  stopAuthoringPreview(false);
  media.src = options.url;
  media.load();
  output = {
    projectId: options.projectId,
    projectRevision: options.projectRevision ?? null,
    timingRevision: options.timingRevision ?? null,
    url: options.url,
    downloadName: options.downloadName,
    timeline: options.timeline,
    stale: !options.current || options.projectId !== activeProjectId,
  };
  mode = 'editor';
  surface = options.reveal ? 'playback' : 'canvas';
  notify();
}

export function showEditorCanvas(): void {
  withViewTransition(() => {
    stopAuthoringPreview(false);
    media?.pause();
    mode = 'editor';
    surface = 'canvas';
    notify();
  });
}

export async function showRenderedPlayback(): Promise<void> {
  if (!media || !currentEditorOutput()) return;
  stopAuthoringPreview(false);
  withViewTransition(() => {
    mode = 'editor';
    surface = 'playback';
    notify();
  });
  await playMediaReliably(media, media.currentTime);
}

export async function toggleEditorPlayback(): Promise<void> {
  if (!media) return;
  if (surface === 'canvas' && authoringMedia() && currentMeasuredDuration() > 0) {
    await toggleAuthoringPreview();
    return;
  }
  if (!playableEditorOutput()) return;
  if (surface !== 'playback') {
    await showRenderedPlayback();
    return;
  }
  if (media.paused) await playMediaReliably(media, media.currentTime);
  else media.pause();
}

export function seekEditorPlayback(timeSeconds: number): void {
  const target = Math.max(0, Math.min(editorWorkspace().duration, timeSeconds));
  if (surface === 'canvas') {
    const clock = authoringMedia();
    if (!clock) return;
    clock.currentTime = target;
    playheadSeconds = target;
  } else {
    if (!media || !currentEditorOutput()) return;
    media.currentTime = target;
  }
  notify();
}

export function currentPreviewAudioUrl(): string | null {
  return projectMeasurementIsCurrent() ? measurement!.audioUrl : null;
}

export function pauseEditorPlayback(): void {
  if (authoringPlaying) stopAuthoringPreview();
  else media?.pause();
}

export function toggleEditorMute(): void {
  const clock = surface === 'canvas' ? authoringMedia() : media;
  if (!clock || !editorCanPlay()) return;
  clock.muted = !clock.muted;
  notify();
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(EDITOR_WORKSPACE_EVENT));
}

function notifyPlayback(): void {
  window.dispatchEvent(new CustomEvent(EDITOR_PLAYBACK_EVENT));
}

function syncOutputFreshness(): void {
  if (!output) return;
  const matchesProject = output.projectId === activeProjectId;
  const matchesRevision = output.projectRevision !== null
    && activeProjectRevision !== null
    && output.projectRevision === activeProjectRevision;
  output = {
    ...output,
    stale: !matchesProject || (output.projectRevision !== null && !matchesRevision) || output.stale && output.projectRevision === null,
  };
  if (!timingStillValid()) stopAuthoringPreview(false);
}

async function toggleAuthoringPreview(): Promise<void> {
  if (authoringPlaying) {
    stopAuthoringPreview();
    return;
  }
  const duration = currentMeasuredDuration();
  const clock = authoringMedia();
  if (!clock || duration <= 0) return;
  if (playheadSeconds >= duration - 1e-6) playheadSeconds = 0;
  authoringPlaying = true;
  notifyPlayback();
  try {
    await playMediaReliably(clock, playheadSeconds);
  } catch (error) {
    stopAuthoringPreview();
    console.warn('No se pudo iniciar la reproducción de referencia.', error);
    return;
  }
  if (!authoringPlaying) {
    clock.pause();
    return;
  }
  authoringFrame = window.requestAnimationFrame(advanceAuthoringPreview);
}

function advanceAuthoringPreview(): void {
  if (!authoringPlaying) return;
  const clock = authoringMedia();
  if (!clock || clock.paused || clock.ended) {
    stopAuthoringPreview();
    return;
  }
  const duration = currentMeasuredDuration();
  playheadSeconds = Math.min(duration, clock.currentTime);
  notifyPlayback();
  if (playheadSeconds >= duration) {
    stopAuthoringPreview();
    return;
  }
  authoringFrame = window.requestAnimationFrame(advanceAuthoringPreview);
}

function stopAuthoringPreview(emit = true): void {
  if (!authoringPlaying && authoringFrame === 0) return;
  authoringPlaying = false;
  authoringMedia()?.pause();
  if (authoringFrame !== 0) window.cancelAnimationFrame(authoringFrame);
  authoringFrame = 0;
  if (emit) notifyPlayback();
}

async function playMediaReliably(targetMedia: HTMLMediaElement, timeSeconds: number): Promise<void> {
  const target = Math.max(0, Math.min(editorWorkspace().duration, timeSeconds));
  if (Number.isFinite(target)) targetMedia.currentTime = target;
  try {
    await targetMedia.play();
  } catch (firstError) {
    // Después de reemplazar el src, Chromium puede rechazar el primer play con
    // AbortError mientras termina load(). Reesperar el medio evita obligar a
    // recargar toda la aplicación.
    await waitForMediaReady(targetMedia);
    targetMedia.currentTime = target;
    try {
      await targetMedia.play();
    } catch {
      throw firstError;
    }
  }
}

function waitForMediaReady(video: HTMLMediaElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('El video no quedó listo para reproducirse.')), 5_000);
    const ready = (): void => finish();
    const failed = (): void => finish(video.error ?? new Error('El video no pudo cargarse.'));
    const finish = (error?: unknown): void => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      video.removeEventListener('error', failed);
      if (error) reject(error);
      else resolve();
    };
    video.addEventListener('loadeddata', ready, { once: true });
    video.addEventListener('canplay', ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    video.load();
  });
}

function currentMeasuredDuration(): number {
  if (
    measurement
    && measurement.projectId === activeProjectId
    && measurement.timingRevision === activeTimingRevision
  ) return measurement.timeline.durationSeconds;
  return output?.timeline?.durationSeconds ?? 0;
}

function authoringMedia(): HTMLMediaElement | null {
  if (
    previewAudio
    && measurement
    && measurement.projectId === activeProjectId
    && measurement.timingRevision === activeTimingRevision
  ) return previewAudio;
  if (timingStillValid() && output?.timeline) return media;
  return null;
}

function createPreviewAudio(): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('loadedmetadata', notify);
  for (const eventName of ['timeupdate', 'play', 'pause', 'ended', 'volumechange']) {
    audio.addEventListener(eventName, notifyPlayback);
  }
  return audio;
}
