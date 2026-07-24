import type { PreviewHandle } from '../preview/types.js';
import { optional } from './dom.js';
import { initPlaybackUi } from './playback.js';
import { initDirectorUi } from './director/panel.js';
import { initCompositionPreview } from './project/composition.js';
import { initResourceLibrary } from './project/library.js';
import { initProjectEditor } from './project/panel.js';
import { persistStore, restoreSession } from './project/persistence.js';
import { initProjectTimeline } from './project/project-timeline.js';
import { loadProjectStore, type ProjectStore } from './project/store.js';
import { initSettingsModal, initTheme } from './theme.js';
import { attachPreviewTimeline, initTimelineShell } from './timeline.js';
import { initViewerSources } from './viewer.js';

export { renderJobGallery } from './gallery.js';

// Interfaz que no depende de que la escena cargue.
export function initShellUi(): void {
  initTheme();
  initSettingsModal();
  initViewerSources();
  initTimelineShell();
}

// Interfaz que consume la reproducción ya iniciada por el preview.
export function initEditorUi(handle: PreviewHandle): void {
  attachPreviewTimeline(handle);
  initPlaybackUi(handle);
}

// Editor del proyecto de autoría. Es independiente del preview: si el proyecto no
// está disponible, el resto de la aplicación sigue funcionando.
export async function initProjectUi(): Promise<void> {
  let store: ProjectStore | null = null;
  try {
    const requestedProjectId = new URLSearchParams(window.location.search).get('project');
    const restored = requestedProjectId ? null : await restoreSession();
    store = restored?.store ?? await loadProjectStore(requestedProjectId);
    attachProjectUi(store);
  } catch (error) {
    const root = optional<HTMLElement>('#project-editor');
    const status = optional<HTMLElement>('#project-status');
    if (root) root.hidden = false;
    if (status) {
      status.textContent = `No se pudo abrir el proyecto de autoría: ${error instanceof Error ? error.message : String(error)}`;
      status.classList.add('error');
    }
    console.warn('Editor de proyecto no disponible', error);
  }
  initDirectorUi(store, (createdStore) => {
    store = createdStore;
    attachProjectUi(createdStore);
  });
}

function attachProjectUi(store: ProjectStore): void {
  initProjectEditor(store);
  initProjectTimeline(store);
  void initCompositionPreview(store);
  void initResourceLibrary(store);
  persistStore(store);
  store.subscribe(() => {
    persistStore(store);
    const status = optional<HTMLElement>('#save-status');
    if (status) status.textContent = `Guardado ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });
}
