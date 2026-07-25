import { optional } from './dom.js';
import {
  bindEditorMedia,
  EDITOR_WORKSPACE_EVENT,
  editorWorkspace,
  registerRenderedOutput,
  showEditorCanvas,
  showWorkspaceMode,
  type MeasuredProjectTimeline,
  type WorkspaceMode,
} from './editor-workspace.js';

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
  current: boolean;
  reveal?: boolean;
}): void {
  registerRenderedOutput(options);
}

function renderViewerWorkspace(): void {
  const state = editorWorkspace();
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
        ? state.output?.stale
          ? 'Reproduciendo la última exportación. El proyecto tiene cambios posteriores sin renderizar.'
          : 'Reproducción medida del proyecto. La timeline y el visor comparten el mismo transporte.'
        : 'Seleccioná y arrastrá personajes. La duración real aparece cuando el proyecto se renderiza.';
  }

  const status = optional<HTMLElement>('#viewer-output-status');
  if (status) {
    status.hidden = state.mode !== 'editor' || !state.output || state.output.stale;
    status.textContent = 'Exportación actual';
    status.classList.toggle('is-stale', Boolean(state.output?.stale));
  }
  const returnButton = optional<HTMLButtonElement>('#viewer-return-edit');
  if (returnButton) returnButton.hidden = state.mode !== 'editor' || state.surface !== 'playback';
  const download = optional<HTMLAnchorElement>('#director-result-download');
  if (download) {
    download.hidden = state.mode !== 'editor' || !state.output;
    if (state.output) {
      download.href = state.output.url;
      download.download = state.output.downloadName;
      download.textContent = 'Descargar MP4';
    }
  }
}
