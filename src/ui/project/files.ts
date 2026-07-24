import { optional } from '../dom.js';
import {
  deleteSavedProject,
  listSavedProjects,
  loadSavedProject,
  saveEditableProject,
} from '../director/api.js';
import { persistStore } from './persistence.js';
import { createBlankProjectStore, createProjectStore, type ProjectStore } from './store.js';

let saveTimer: number | null = null;

export function initProjectFiles(store: ProjectStore): void {
  const open = optional<HTMLButtonElement>('#projects-open');
  const create = optional<HTMLButtonElement>('#project-new');
  const dialog = optional<HTMLDialogElement>('#projects-modal');
  const close = optional<HTMLButtonElement>('#projects-close');
  const list = optional<HTMLElement>('#saved-project-list');
  if (!open || !create || !dialog || !list) return;

  const save = (): void => {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void saveEditableProject(store.project() as unknown as { id: string })
        .then((summary) => {
          const status = optional<HTMLElement>('#save-status');
          if (status) status.textContent = `Guardado ${new Date(summary.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        })
        .catch(() => {
          const status = optional<HTMLElement>('#save-status');
          if (status) status.textContent = 'Guardado en sesión; servicio durable no disponible';
        });
    }, 450);
  };
  store.subscribe(save);
  save();

  create.addEventListener('click', () => void createNewProject());
  open.addEventListener('click', () => {
    dialog.showModal();
    void renderProjects(list);
  });
  close?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function createNewProject(): Promise<void> {
  const store = await createBlankProjectStore();
  await saveEditableProject(store.project() as unknown as { id: string });
  persistStore(store);
  window.location.assign(window.location.pathname);
}

async function renderProjects(root: HTMLElement): Promise<void> {
  root.replaceChildren(message('Cargando proyectos…'));
  try {
    const projects = await listSavedProjects();
    if (projects.length === 0) {
      root.replaceChildren(message('Todavía no hay proyectos editables guardados.'));
      return;
    }
    root.replaceChildren(...projects.map((project) => {
      const card = document.createElement('article');
      card.className = 'saved-project-card';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = project.title;
      const meta = document.createElement('span');
      meta.textContent = `${project.scenes} escena${project.scenes === 1 ? '' : 's'} · ${new Date(project.updatedAt).toLocaleString()}`;
      copy.append(title, meta);
      const actions = document.createElement('div');
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Abrir';
      edit.addEventListener('click', () => void openProject(project.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger-button';
      remove.textContent = 'Eliminar';
      remove.addEventListener('click', () => void removeProject(project.id, project.title, root));
      actions.append(edit, remove);
      card.append(copy, actions);
      return card;
    }));
  } catch (error) {
    root.replaceChildren(message(error instanceof Error ? error.message : String(error)));
  }
}

async function openProject(id: string): Promise<void> {
  const project = await loadSavedProject(id);
  const store = await createProjectStore(project);
  persistStore(store);
  window.location.assign(window.location.pathname);
}

async function removeProject(id: string, title: string, root: HTMLElement): Promise<void> {
  if (!window.confirm(`¿Eliminar el proyecto «${title}» del almacenamiento local?`)) return;
  await deleteSavedProject(id);
  await renderProjects(root);
}

function message(text: string): HTMLElement {
  const node = document.createElement('p');
  node.className = 'empty-state';
  node.textContent = text;
  return node;
}
