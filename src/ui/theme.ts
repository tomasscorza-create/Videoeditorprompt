import { optional } from './dom.js';

const STORAGE_KEY = 'app-theme';
const ACCENT_KEY = 'app-accent';

/** A3 — Presets de acento. `green` es el histórico y sigue siendo el defecto. */
export const ACCENTS = ['green', 'blue', 'amber', 'violet'] as const;
export type Accent = typeof ACCENTS[number];

function isAccent(value: string): value is Accent {
  return (ACCENTS as readonly string[]).includes(value);
}

function applyTheme(theme: string): void {
  const isLight = theme === 'light'
    || (theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = isLight ? 'light' : 'dark';
}

// El acento se aplica como atributo del root; los tokens derivados
// (--accent, --accent-ink) los resuelve el CSS para cada tema.
function applyAccent(accent: string): void {
  document.documentElement.dataset.accent = isAccent(accent) ? accent : 'green';
}

export function initTheme(): void {
  const saved = localStorage.getItem(STORAGE_KEY) ?? 'system';
  applyTheme(saved);
  const savedAccent = localStorage.getItem(ACCENT_KEY) ?? 'green';
  applyAccent(savedAccent);

  const select = optional<HTMLSelectElement>('#theme-select');
  if (select) {
    select.value = saved;
    select.addEventListener('change', () => {
      applyTheme(select.value);
      localStorage.setItem(STORAGE_KEY, select.value);
    });
  }

  const accentSelect = optional<HTMLSelectElement>('#accent-select');
  if (accentSelect) {
    accentSelect.value = isAccent(savedAccent) ? savedAccent : 'green';
    accentSelect.addEventListener('change', () => {
      applyAccent(accentSelect.value);
      localStorage.setItem(ACCENT_KEY, accentSelect.value);
    });
  }
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
