import { optional } from './dom.js';

export type RightPanelPage = 'resources' | 'editing' | 'files';

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
    ['files', optional<HTMLElement>('#right-panel-files')!],
  ]);
  const resourceAction = optional<HTMLButtonElement>('#resource-register');
  if (tabs.length !== pages.size || Array.from(pages.values()).some((page) => !page)) return;

  let activePage = readActivePage();
  const activate = (page: RightPanelPage): void => {
    activePage = page;
    for (const tab of tabs) {
      const selected = tab.dataset.rightPanelPage === page;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
    }
    for (const [id, panel] of pages) panel.hidden = id !== page;
    if (resourceAction) {
      resourceAction.hidden = page !== 'resources' || resourceAction.dataset.contextHidden === 'true';
    }
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
  return value === 'resources' || value === 'editing' || value === 'files';
}
