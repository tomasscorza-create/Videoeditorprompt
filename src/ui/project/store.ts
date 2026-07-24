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

// La UI solo consume proyectos PUBLICADOS por scripts/stage3b/publish-project.mjs.
// Nunca lee pilots/: esa es la fuente del motor, no una ubicación servible.
// El índice sigue schema/published-project-index.schema.json.
export const PROJECT_INDEX_URL = '/projects/index.json';

export interface PublishedProjectEntry {
  projectId: string;
  title: string;
  projectPath: string;
  resourceCatalog: string;
  sceneCount: number;
  editorContractVersion: number;
  projectSha256: string;
  catalogSha256: string;
  revision: string;
}

export interface PublishedProjectIndex {
  version: number;
  defaultProjectId: string;
  projects: PublishedProjectEntry[];
}

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
  replaceProject(project: unknown): string | null;
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
    replaceProject(project) {
      try {
        current = createProjectEditor(project, current.catalog);
        notify();
        return null;
      } catch (error) {
        return describeError(error);
      }
    },
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

async function fetchJson<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return await response.json() as T;
}

// Defensa en profundidad: el schema ya exige rutas portables, pero la UI no
// debe construir URLs con rutas absolutas ni con salto de directorio.
function isPortablePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.split('/').includes('..');
}

export async function loadProjectStore(requestedProjectId?: string | null): Promise<ProjectStore> {
  const index = await fetchJson<PublishedProjectIndex>(PROJECT_INDEX_URL);
  if (index?.version !== 1 || !Array.isArray(index.projects)) {
    throw new Error('El índice de proyectos publicados no tiene un formato compatible.');
  }
  if (index.projects.length === 0) {
    throw new Error('No hay proyectos publicados. Ejecutá «npm run stage3b:publish-project».');
  }

  const wantedId = requestedProjectId || index.defaultProjectId;
  const entry = index.projects.find((item) => item.projectId === wantedId);
  if (!entry) {
    const available = index.projects.map((item) => item.projectId).join(', ');
    throw new Error(`No existe el proyecto publicado «${wantedId}». Disponibles: ${available}.`);
  }
  if (!isPortablePath(entry.projectPath) || !isPortablePath(entry.resourceCatalog)) {
    throw new Error(`El proyecto «${entry.projectId}» declara una ruta no portable.`);
  }

  // `revision` es la clave de caché publicada; el índice no expone updatedAt.
  const cacheKey = encodeURIComponent(entry.revision);
  const [project, catalog] = await Promise.all([
    fetchJson(`/projects/${entry.projectPath}?v=${cacheKey}`),
    fetchJson(`/${entry.resourceCatalog}?v=${cacheKey}`),
  ]);
  return createStore(createProjectEditor(project, catalog));
}

export async function createProjectStore(project: unknown): Promise<ProjectStore> {
  const catalog = await fetchJson('/assets/catalog/authoring-resources.json');
  return createStore(createProjectEditor(project, catalog));
}
