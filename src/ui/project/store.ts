import {
  applyProjectEditorCommand,
  createProjectEditor,
  exportEditorProject,
  listEditorResources,
  redoProjectEditor,
  undoProjectEditor,
  validateEditableProject,
  type EditorState,
} from '../../../shared/project-editor.js';
import type { ProjectView, ResourceEntry, ResourceType } from './types.js';

// El proyecto de autoría vive en pilots/ y el catálogo en public/assets/.
// Rutas relativas: nunca absolutas a datos de proyecto.
// 3B.0 solo admite elementos de tipo character, por eso se abre el piloto
// compilable y no `proyecto-editable-01`, que además contiene texto.
export const DEFAULT_PROJECT_URL = '/pilots/proyecto-compilable-01/project.json';
export const DEFAULT_CATALOG_URL = '/assets/catalog/authoring-resources.json';

export interface ProjectStore {
  getState(): EditorState;
  project(): ProjectView;
  selectedSceneId(): string;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Devuelve null si el comando se aplicó, o un mensaje si el motor lo rechazó. */
  dispatch(command: Record<string, unknown>): string | null;
  undo(): void;
  redo(): void;
  resources(type: ResourceType): ResourceEntry[];
  exportJson(): string;
  /** Devuelve null si el proyecto es válido, o el mensaje de error del motor. */
  validate(): string | null;
  subscribe(listener: () => void): void;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const detail = error as { code?: string; path?: string; message?: string };
    const where = detail.path ? ` (${detail.path})` : '';
    return `${detail.code ?? 'ERROR'}${where}: ${detail.message ?? ''}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

export function createStore(initial: EditorState): ProjectStore {
  let current = initial;
  const listeners: Array<() => void> = [];
  const notify = (): void => { for (const listener of listeners) listener(); };

  return {
    getState: () => current,
    project: () => current.project as unknown as ProjectView,
    selectedSceneId: () => current.selectedSceneId,
    canUndo: () => current.past.length > 0,
    canRedo: () => current.future.length > 0,
    dispatch(command) {
      try {
        current = applyProjectEditorCommand(current, command);
        notify();
        return null;
      } catch (error) {
        return describeError(error);
      }
    },
    undo() {
      current = undoProjectEditor(current);
      notify();
    },
    redo() {
      current = redoProjectEditor(current);
      notify();
    },
    resources: (type) => listEditorResources(current, type) as unknown as ResourceEntry[],
    exportJson: () => exportEditorProject(current),
    validate() {
      try {
        validateEditableProject(current.project, current.catalog);
        return null;
      } catch (error) {
        return describeError(error);
      }
    },
    subscribe(listener) {
      listeners.push(listener);
    },
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

export async function loadProjectStore(
  projectUrl: string = DEFAULT_PROJECT_URL,
  catalogUrl: string = DEFAULT_CATALOG_URL,
): Promise<ProjectStore> {
  const [project, catalog] = await Promise.all([fetchJson(projectUrl), fetchJson(catalogUrl)]);
  return createStore(createProjectEditor(project, catalog));
}
