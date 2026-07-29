import { optional } from './dom.js';
import type { ProjectSelection } from './project/selection.js';

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
  activate(activePage);
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
      detail: 'Ajustá sus propiedades; las operaciones de estructura siguen en la timeline.',
    },
    element: {
      title: 'Elemento seleccionado',
      detail: 'Ajustá transformación, animación y apariencia compatibles.',
    },
    dialogue: {
      title: 'Diálogo seleccionado',
      detail: 'Ajustá texto en pantalla, voz, subtítulos y pausa.',
    },
    keyframe: {
      title: 'Keyframe seleccionado',
      detail: 'Ajustá valor, ancla, interpolación y acciones de la pista.',
    },
  };
  return { kind: selection.kind, ...descriptions[selection.kind] };
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
