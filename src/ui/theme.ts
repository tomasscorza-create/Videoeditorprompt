import { optional } from './dom.js';

const STORAGE_KEY = 'app-theme';

function applyTheme(theme: string): void {
  const isLight = theme === 'light'
    || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
}

export function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY) ?? 'system';
  applyTheme(saved);
  const select = optional<HTMLSelectElement>('#theme-select');
  if (!select) return;
  select.value = saved;
  select.addEventListener('change', () => {
    applyTheme(select.value);
    localStorage.setItem(STORAGE_KEY, select.value);
  });
}

export function initSettingsModal(): void {
  const open = optional<HTMLButtonElement>('#settings-open');
  const modal = optional<HTMLDialogElement>('#settings-modal');
  const close = optional<HTMLButtonElement>('#settings-close');
  if (!open || !modal) return;
  open.addEventListener('click', () => modal.showModal());
  close?.addEventListener('click', () => modal.close());
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.close();
  });
}
