import { optional } from './dom.js';
import { initDirectorUi } from './director/panel.js';
import { initWorkspaceResize } from './layout-resize.js';
import { initCompositionPreview } from './project/composition.js';
import { initResourceLibrary } from './project/library.js';
import { initProjectEditor } from './project/panel.js';
import { persistStore, restoreSession } from './project/persistence.js';
import { initProjectTimeline } from './project/project-timeline.js';
import { initProjectIdentity } from './project-identity.js';
import { loadProjectStore, type ProjectStore } from './project/store.js';
import { initSettingsModal, initTheme } from './theme.js';
import { initTablists } from './tabs.js';
import { initTimelineShell } from './timeline.js';
import { initViewerWorkspace } from './viewer.js';
import { initCharacterCreator } from './character-creator.js';
import { initProjectFiles } from './project/files.js';
import { setActiveEditorProject, syncActiveEditorProject } from './editor-workspace.js';
import { projectFingerprint } from '../../shared/project-fingerprint.js';

export { renderJobGallery } from './gallery.js';

// Interfaz que no depende de que la escena cargue.
export function initShellUi(): void {
  initTheme();
  initTablists();
  initSettingsModal();
  initWorkspaceResize();
  initViewerWorkspace();
  initCharacterCreator();
  initTimelineShell();
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
    showRecoveryWarnings([
      ...(restored?.warning ? [restored.warning] : []),
      ...store.recoveryWarnings(),
    ]);
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

function showRecoveryWarnings(warnings: readonly string[]): void {
  if (warnings.length === 0) return;
  const status = optional<HTMLElement>('#project-status');
  if (status) {
    status.textContent = warnings.join(' ');
    status.classList.remove('error');
  }
  console.warn('Recuperación del proyecto', ...warnings);
}

function attachProjectUi(store: ProjectStore): void {
  let projectRevision = projectFingerprint(store.project());
  setActiveEditorProject(store.project().id, projectRevision);
  initProjectIdentity(store);
  initProjectFiles(store);
  initProjectEditor(store);
  initProjectTimeline(store);
  void initCompositionPreview(store);
  void initResourceLibrary(store);
  persistStore(store);
  store.subscribe(() => {
    persistStore(store);
    const nextRevision = projectFingerprint(store.project());
    if (nextRevision !== projectRevision) {
      projectRevision = nextRevision;
      syncActiveEditorProject(store.project().id, nextRevision);
    }
    const status = optional<HTMLElement>('#save-status');
    if (status) status.textContent = `Guardado ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  });
}
