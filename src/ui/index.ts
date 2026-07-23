import type { PreviewHandle } from '../preview/types.js';
import { optional } from './dom.js';
import { initPlaybackUi } from './playback.js';
import { initDirectorUi } from './director/panel.js';
import { initProjectEditor } from './project/panel.js';
import { loadProjectStore } from './project/store.js';
import { initShortcuts } from './shortcuts.js';
import { initSettingsModal, initTheme } from './theme.js';
import { initTimeline } from './timeline.js';
import { initToolbarPrototype } from './toolbar.js';

export { renderJobGallery } from './gallery.js';

// Interfaz que no depende de que la escena cargue.
export function initShellUi(): void {
  initTheme();
  initSettingsModal();
  initToolbarPrototype();
}

// Interfaz que consume la reproducción ya iniciada por el preview.
export function initEditorUi(handle: PreviewHandle): void {
  const timeline = initTimeline(handle);
  initPlaybackUi(handle, { onTime: (timeSeconds) => timeline.setPlayhead(timeSeconds) });
  initShortcuts(handle);
}

// Editor del proyecto de autoría. Es independiente del preview: si el proyecto no
// está disponible, el resto de la aplicación sigue funcionando.
export async function initProjectUi(): Promise<void> {
  try {
    const requestedProjectId = new URLSearchParams(window.location.search).get('project');
    const store = await loadProjectStore(requestedProjectId);
    initProjectEditor(store);
    initDirectorUi(store);
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
}
