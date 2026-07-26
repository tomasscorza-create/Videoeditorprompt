import {
  applyProjectEditorCommand,
  createProjectEditor,
  exportEditorProject,
  listEditorResources,
  repairMissingVoiceReferences,
  redoProjectEditor,
  undoProjectEditor,
  validateRenderableProject,
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

interface LibraryCatalogResponse {
  version: number;
  catalogPath: string;
  catalog: unknown;
}

export interface ProjectStore {
  getState(): EditorState;
  project(): ProjectView;
  selectedSceneId(): string;
  catalogRevision(): string;
  recoveryWarnings(): readonly string[];
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

export function createStore(initial: EditorState, revision = 'unknown', warnings: readonly string[] = []): ProjectStore {
  let current = initial;
  const listeners: Array<() => void> = [];
  const notify = (): void => { for (const listener of listeners) listener(); };

  return {
    getState: () => current,
    project: () => current.project as unknown as ProjectView,
    selectedSceneId: () => current.selectedSceneId,
    catalogRevision: () => revision,
    recoveryWarnings: () => warnings,
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
        validateRenderableProject(current.project, current.catalog);
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

export async function createBlankProjectStore(): Promise<ProjectStore> {
  const activeCatalog = await loadActiveCatalog('assets/catalog/authoring-resources.json');
  const catalog = activeCatalog.catalog as { entries?: Array<{ id: string; type: string; capabilities?: { cameraPresets?: string[] } }> };
  const background = catalog.entries?.find((entry) => entry.type === 'background');
  if (!background) throw new Error('La biblioteca necesita al menos un fondo para crear un proyecto.');
  const projectId = `proyecto-${Date.now().toString(36)}`;
  const project = {
    version: 1,
    id: projectId,
    title: 'Proyecto sin título',
    video: { width: 1080, height: 1920, fps: 30 },
    seed: Math.floor(Date.now() % 4_294_967_295),
    resourceCatalog: activeCatalog.path,
    scenes: [{
      id: 'escena-01',
      title: 'Escena 1',
      background: {
        resourceId: background.id,
        cameraPreset: background.capabilities?.cameraPresets?.[0] ?? 'static',
      },
      elements: [],
      dialogue: [],
    }],
  };
  return createStore(createProjectEditor(project, activeCatalog.catalog), await hashJson(activeCatalog.catalog));
}

async function loadActiveCatalog(fallbackPath: string, cacheKey?: string): Promise<{ catalog: unknown; path: string }> {
  try {
    const response = await fetchJson<LibraryCatalogResponse>('/api/library/catalog');
    if (response.version !== 1 || !isPortablePath(response.catalogPath) || !response.catalog) {
      throw new Error('La biblioteca local devolvió un catálogo incompatible.');
    }
    return { catalog: response.catalog, path: response.catalogPath };
  } catch {
    const suffix = cacheKey ? `?v=${cacheKey}` : '';
    return { catalog: await fetchJson(`/${fallbackPath}${suffix}`), path: fallbackPath };
  }
}

function selectResourceCatalog(project: unknown, catalogPath: string): unknown {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return project;
  return { ...project, resourceCatalog: catalogPath };
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
  const [project, activeCatalog] = await Promise.all([
    fetchJson(`/projects/${entry.projectPath}?v=${cacheKey}`),
    loadActiveCatalog(entry.resourceCatalog, cacheKey),
  ]);
  const selectedProject = selectResourceCatalog(project, activeCatalog.path);
  return createRecoveredStore(selectedProject, activeCatalog.catalog, await hashJson(activeCatalog.catalog));
}

export async function createProjectStore(project: unknown): Promise<ProjectStore> {
  const activeCatalog = await loadActiveCatalog('assets/catalog/authoring-resources.json');
  const selectedProject = selectResourceCatalog(project, activeCatalog.path);
  return createRecoveredStore(selectedProject, activeCatalog.catalog, await hashJson(activeCatalog.catalog));
}

export async function restoreProjectStore(project: unknown, expectedCatalogRevision: string): Promise<ProjectStore> {
  const activeCatalog = await loadActiveCatalog('assets/catalog/authoring-resources.json');
  const actualRevision = await hashJson(activeCatalog.catalog);
  // La biblioteca solo agrega recursos. Si cambió su revisión, la restauración
  // vuelve a validar el proyecto contra el catálogo actual sin descartar la sesión.
  void expectedCatalogRevision;
  const selectedProject = selectResourceCatalog(project, activeCatalog.path);
  return createRecoveredStore(selectedProject, activeCatalog.catalog, actualRevision);
}

function createRecoveredStore(project: unknown, catalog: unknown, revision: string): ProjectStore {
  const repaired = repairMissingVoiceReferences(project, catalog);
  const warnings = repaired.replacements.length === 0
    ? []
    : [`Se reemplazaron ${repaired.replacements.length} referencias a voces que ya no están disponibles.`];
  return createStore(createProjectEditor(repaired.project, catalog), revision, warnings);
}

async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
