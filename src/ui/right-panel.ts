import { optional } from './dom.js';
import {
  PROJECT_SELECTION_EVENT,
  projectSelection,
  type ProjectSelection,
} from './project/selection.js';

export type RightPanelPage = 'resources' | 'editing';

const RIGHT_PANEL_PAGE_EVENT = 'local-video:right-panel-page';
const REVEAL_RESOURCE_EVENT = 'local-video:reveal-resource';
const ACTIVE_PAGE_KEY = 'local-video.right-panel-page';

export function showRightPanelPage(page: RightPanelPage): void {
  window.dispatchEvent(new CustomEvent<RightPanelPage>(RIGHT_PANEL_PAGE_EVENT, { detail: page }));
}

export function initRightPanel(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-right-panel-page]'));
  const pages = new Map<RightPanelPage, HTMLElement>([
    ['resources', optional<HTMLElement>('#right-panel-resources')!],
    ['editing', optional<HTMLElement>('#right-panel-editing')!],
  ]);
  const resourceAction = optional<HTMLButtonElement>('#resource-register');
  if (tabs.length !== 2 || Array.from(pages.values()).some((page) => !page)) return;

  let activePage = readActivePage();
  const activate = (page: RightPanelPage): void => {
    activePage = page;
    for (const tab of tabs) {
      const selected = tab.dataset.rightPanelPage === page;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
    }
    for (const [id, panel] of pages) panel.hidden = id !== page;
    if (resourceAction) resourceAction.hidden = page !== 'resources';
    try {
      sessionStorage.setItem(ACTIVE_PAGE_KEY, page);
    } catch {
      // La navegación sigue funcionando aunque la sesión no pueda persistirse.
    }
  };

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const page = tab.dataset.rightPanelPage;
      if (isRightPanelPage(page)) activate(page);
    });
  }
  window.addEventListener(RIGHT_PANEL_PAGE_EVENT, (event) => {
    const page = (event as CustomEvent<RightPanelPage>).detail;
    if (isRightPanelPage(page)) activate(page);
  });
  // Mostrar un recurso desde el Director también debe revelar su página contenedora.
  window.addEventListener(REVEAL_RESOURCE_EVENT, () => activate('resources'));
  window.addEventListener(PROJECT_SELECTION_EVENT, renderEditingContext);

  activate(activePage);
  renderEditingContext();
}

export function describeEditingSelection(selection: ProjectSelection | null): {
  kind: ProjectSelection['kind'] | 'none';
  title: string;
  detail: string;
} {
  if (!selection) {
    return {
      kind: 'none',
      title: 'Sin selección',
      detail: 'Seleccioná una escena, elemento, diálogo o keyframe para comenzar.',
    };
  }
  const descriptions: Record<ProjectSelection['kind'], { title: string; detail: string }> = {
    scene: {
      title: 'Escena seleccionada',
      detail: 'Acá aparecerán sus propiedades visuales, cámara y ajustes generales.',
    },
    element: {
      title: 'Elemento seleccionado',
      detail: 'Acá aparecerán transformación, animación y apariencia compatibles.',
    },
    dialogue: {
      title: 'Diálogo seleccionado',
      detail: 'Acá aparecerán texto en pantalla, voz, subtítulos y estilo.',
    },
    keyframe: {
      title: 'Keyframe seleccionado',
      detail: 'Acá aparecerán valor, ancla, interpolación y acciones de la pista.',
    },
  };
  return { kind: selection.kind, ...descriptions[selection.kind] };
}

function renderEditingContext(): void {
  const title = optional<HTMLElement>('#editing-selection-title');
  const detail = optional<HTMLElement>('#editing-selection-detail');
  const host = optional<HTMLElement>('#editing-tool-host');
  if (!title || !detail || !host) return;
  const description = describeEditingSelection(projectSelection());
  title.textContent = description.title;
  detail.textContent = description.detail;
  host.dataset.selectionKind = description.kind;
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = description.kind === 'none'
    ? 'Este espacio alojará herramientas compatibles con la selección actual.'
    : 'La selección está lista. Las herramientas manuales se incorporarán aquí por módulos.';
  host.replaceChildren(empty);
}

function readActivePage(): RightPanelPage {
  try {
    const saved = sessionStorage.getItem(ACTIVE_PAGE_KEY);
    if (isRightPanelPage(saved)) return saved;
  } catch {
    // Sin persistencia se usa la página canónica inicial.
  }
  return 'resources';
}

function isRightPanelPage(value: string | null | undefined): value is RightPanelPage {
  return value === 'resources' || value === 'editing';
}
