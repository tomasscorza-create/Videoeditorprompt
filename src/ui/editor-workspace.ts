export type WorkspaceMode = 'editor' | 'creator';
export type EditorSurface = 'canvas' | 'playback';

export interface MeasuredTurn {
  id: string;
  speakerId: string;
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

export interface RenderedOutput {
  projectId: string;
  projectRevision: string | null;
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
let output: RenderedOutput | null = null;
let media: HTMLVideoElement | null = null;
let mediaBound = false;

export function editorWorkspace(): EditorWorkspaceSnapshot {
  const measuredDuration = output?.timeline?.durationSeconds ?? 0;
  return {
    mode,
    surface,
    activeProjectId,
    output,
    media,
    currentTime: media?.currentTime ?? 0,
    duration: measuredDuration || media?.duration || 0,
    playing: Boolean(media && !media.paused),
    muted: Boolean(media?.muted),
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

export function setActiveEditorProject(projectId: string, projectRevision: string | null = null): void {
  activeProjectId = projectId;
  activeProjectRevision = projectRevision;
  syncOutputFreshness();
  notify();
}

export function syncActiveEditorProject(projectId: string, projectRevision: string): void {
  activeProjectId = projectId;
  activeProjectRevision = projectRevision;
  const wasStale = output?.stale;
  syncOutputFreshness();
  if (output?.stale && surface === 'playback') {
    showEditorCanvas();
    return;
  }
  if (wasStale !== output?.stale) notify();
}

export function editorOutputState(): 'missing' | 'current' | 'stale' {
  if (!output) return 'missing';
  return output.stale || output.projectId !== activeProjectId ? 'stale' : 'current';
}

export function currentEditorOutput(): RenderedOutput | null {
  return editorOutputState() === 'current' ? output : null;
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
  current: boolean;
  reveal?: boolean;
}): void {
  if (!media) throw new Error('El reproductor del Editor todavía no está disponible.');
  media.src = options.url;
  media.load();
  output = {
    projectId: options.projectId,
    projectRevision: options.projectRevision ?? null,
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
    media?.pause();
    mode = 'editor';
    surface = 'canvas';
    notify();
  });
}

export async function showRenderedPlayback(): Promise<void> {
  if (!media || !currentEditorOutput()) return;
  withViewTransition(() => {
    mode = 'editor';
    surface = 'playback';
    notify();
  });
  await media.play();
}

export async function toggleEditorPlayback(): Promise<void> {
  if (!media || !currentEditorOutput()) return;
  if (surface !== 'playback') {
    await showRenderedPlayback();
    return;
  }
  if (media.paused) await media.play();
  else media.pause();
}

export function seekEditorPlayback(timeSeconds: number): void {
  if (!media || !currentEditorOutput()) return;
  media.currentTime = Math.max(0, Math.min(editorWorkspace().duration, timeSeconds));
  notify();
}

export function toggleEditorMute(): void {
  if (!media || !currentEditorOutput()) return;
  media.muted = !media.muted;
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
}
