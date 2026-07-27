// Navegación por teclado de todos los grupos de tabs (patrón roving tabindex).
// La selección sigue al foco: mover con flechas activa la pestaña enfocada
// disparando el click que cada módulo ya maneja. Los módulos siguen siendo
// dueños de is-active / aria-selected; acá vive solo el teclado.

const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function initTablists(root: ParentNode = document): void {
  for (const tablist of root.querySelectorAll<HTMLElement>('[role="tablist"]')) {
    wireTablist(tablist);
  }
}

function wireTablist(tablist: HTMLElement): void {
  const allTabs = (): HTMLButtonElement[] =>
    Array.from(tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

  const syncRoving = (): void => {
    const tabs = allTabs();
    const active = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true' && !tab.disabled)
      ?? tabs.find((tab) => !tab.disabled);
    for (const tab of tabs) tab.tabIndex = tab === active ? 0 : -1;
  };

  tablist.addEventListener('keydown', (event) => {
    if (!KEYS.has(event.key)) return;
    const enabled = allTabs().filter((tab) => !tab.disabled);
    if (enabled.length === 0) return;
    event.preventDefault();
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? enabled.length - 1
        : (Math.max(current, 0) + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
    const target = enabled[next];
    if (!target) return;
    target.focus();
    target.click();
  });

  // is-active/aria-selected cambian desde cada módulo; el observer mantiene el
  // roving tabindex coherente sin que los módulos conozcan este helper.
  const observer = new MutationObserver(syncRoving);
  observer.observe(tablist, { attributes: true, attributeFilter: ['aria-selected', 'disabled'], subtree: true });
  syncRoving();
}
