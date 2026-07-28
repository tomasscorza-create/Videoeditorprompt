import { optional } from './dom.js';
import {
  bindEditorMedia,
  EDITOR_WORKSPACE_EVENT,
  editorOutputState,
  editorWorkspace,
  registerRenderedOutput,
  showEditorCanvas,
  showWorkspaceMode,
  type MeasuredProjectTimeline,
  type WorkspaceMode,
} from './editor-workspace.js';

// A2: recuerda el estado anterior para detectar el instante en que el render
// pasa a estar vigente, que es cuando corresponde celebrarlo.
let lastOutputState: 'missing' | 'current' | 'stale' | null = null;

export function initViewerWorkspace(): void {
  const video = optional<HTMLVideoElement>('#director-result-video');
  if (video) bindEditorMedia(video);
  optional<HTMLButtonElement>('#workspace-editor')?.addEventListener('click', () => showWorkspaceMode('editor'));
  optional<HTMLButtonElement>('#workspace-creator')?.addEventListener('click', () => showWorkspaceMode('creator'));
  optional<HTMLButtonElement>('#viewer-return-edit')?.addEventListener('click', showEditorCanvas);
  window.addEventListener(EDITOR_WORKSPACE_EVENT, renderViewerWorkspace);
  renderViewerWorkspace();
}

export function showViewerWorkspace(mode: WorkspaceMode): void {
  showWorkspaceMode(mode);
}

export function showFinalVideo(options: {
  projectId: string;
  url: string;
  downloadName: string;
  timeline: MeasuredProjectTimeline | null;
  projectRevision?: string | null;
  timingRevision?: string | null;
  current: boolean;
  reveal?: boolean;
}): void {
  registerRenderedOutput(options);
}

function renderViewerWorkspace(): void {
  const state = editorWorkspace();
  const outputState = editorOutputState();
  for (const mode of ['editor', 'creator'] as WorkspaceMode[]) {
    const active = state.mode === mode;
    const button = optional<HTMLButtonElement>(`#workspace-${mode}`);
    const view = optional<HTMLElement>(`#${mode}-workspace`);
    button?.classList.toggle('is-active', active);
    button?.setAttribute('aria-selected', String(active));
    if (view) view.hidden = !active;
  }

  const composition = optional<HTMLElement>('#composition-view');
  const playback = optional<HTMLElement>('#final-view');
  if (composition) composition.hidden = state.mode !== 'editor' || state.surface !== 'canvas';
  if (playback) playback.hidden = state.mode !== 'editor' || state.surface !== 'playback';

  const title = optional<HTMLElement>('#viewer-title');
  if (title) title.textContent = state.mode === 'creator' ? 'Creador de recursos' : 'Editor de video';
  const description = optional<HTMLElement>('#viewer-context');
  if (description) {
    description.textContent = state.mode === 'creator'
      ? 'Construí un recurso animable y guardalo en la biblioteca local.'
      : state.surface === 'playback'
        ? outputState === 'stale'
          ? 'Vista histórica: este MP4 no corresponde a la edición actual.'
          : 'Reproducción medida del proyecto. La timeline y el visor comparten el mismo transporte.'
        : outputState === 'stale'
          ? 'Vista editable actualizada. Hay cambios sin renderizar; el MP4 anterior no se usará para reproducir.'
          : outputState === 'current'
            ? 'Vista editable sincronizada con el render vigente.'
            : 'Vista editable sin render. La duración real aparecerá al generar el primer MP4.';
  }

  const status = optional<HTMLElement>('#viewer-output-status');
  if (status) {
    status.hidden = state.mode !== 'editor' || !state.activeProjectId;
    status.textContent = outputState === 'current'
      ? 'Render vigente'
      : outputState === 'stale' ? 'Cambios sin renderizar' : 'Sin render';
    status.classList.toggle('is-stale', outputState === 'stale');
    status.classList.toggle('is-missing', outputState === 'missing');
    // A2: el paso a «render vigente» es el momento en que el trabajo terminó;
    // se marca con una entrada animada en vez de un cambio mudo de texto.
    if (outputState === 'current' && lastOutputState !== 'current') {
      status.classList.remove('is-fresh');
      void status.offsetWidth;
      status.classList.add('is-fresh');
      status.addEventListener('animationend', () => status.classList.remove('is-fresh'), { once: true });
    }
  }
  lastOutputState = outputState;
  const returnButton = optional<HTMLButtonElement>('#viewer-return-edit');
  if (returnButton) returnButton.hidden = state.mode !== 'editor' || state.surface !== 'playback';
  const download = optional<HTMLAnchorElement>('#director-result-download');
  if (download) {
    download.hidden = state.mode !== 'editor' || !state.output;
    if (state.output) {
      download.href = state.output.url;
      download.download = state.output.downloadName;
      download.textContent = outputState === 'stale' ? 'Descargar MP4 anterior' : 'Descargar MP4';
    }
  }
  const video = optional<HTMLVideoElement>('#director-result-video');
  if (video) video.controls = state.surface === 'playback' && outputState === 'stale';
}
