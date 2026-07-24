export type WorkspaceMode = 'editor' | 'creator';
export type EditorSurface = 'canvas' | 'playback';

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

export interface RenderedOutput {
  projectId: string;
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

export function setActiveEditorProject(projectId: string): void {
  activeProjectId = projectId;
  if (output && output.projectId !== projectId) output = { ...output, stale: true };
  notify();
}

export function markEditorProjectChanged(projectId: string): void {
  if (projectId !== activeProjectId || !output || output.stale) return;
  output = { ...output, stale: true };
  if (surface === 'playback') showEditorCanvas();
  else notify();
}

export function showWorkspaceMode(nextMode: WorkspaceMode): void {
  mode = nextMode;
  if (nextMode === 'creator') {
    media?.pause();
    surface = 'canvas';
  }
  notify();
}

export function registerRenderedOutput(options: {
  projectId: string;
  url: string;
  downloadName: string;
  timeline: MeasuredProjectTimeline | null;
  current: boolean;
  reveal?: boolean;
}): void {
  if (!media) throw new Error('El reproductor del Editor todavía no está disponible.');
  media.src = options.url;
  media.load();
  output = {
    projectId: options.projectId,
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
  media?.pause();
  mode = 'editor';
  surface = 'canvas';
  notify();
}

export async function showRenderedPlayback(): Promise<void> {
  if (!media || !output) return;
  mode = 'editor';
  surface = 'playback';
  notify();
  await media.play();
}

export async function toggleEditorPlayback(): Promise<void> {
  if (!media || !output) return;
  if (surface !== 'playback') {
    await showRenderedPlayback();
    return;
  }
  if (media.paused) await media.play();
  else media.pause();
}

export function seekEditorPlayback(timeSeconds: number): void {
  if (!media || !output) return;
  media.currentTime = Math.max(0, Math.min(editorWorkspace().duration, timeSeconds));
  notify();
}

export function toggleEditorMute(): void {
  if (!media || !output) return;
  media.muted = !media.muted;
  notify();
}

function notify(): void {
  window.dispatchEvent(new CustomEvent(EDITOR_WORKSPACE_EVENT));
}

function notifyPlayback(): void {
  window.dispatchEvent(new CustomEvent(EDITOR_PLAYBACK_EVENT));
}
