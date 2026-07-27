// C1 — El nombre del proyecto activo, siempre visible y renombrable desde la
// topbar. Sin proyecto, el campo queda deshabilitado y explica cómo crear uno.
// El título de la pestaña sigue al proyecto (parte de M5).

import { optional } from './dom.js';
import { notify } from './notifications.js';
import type { ProjectStore } from './project/store.js';

const BASE_TITLE = 'Estudio de video local';

export function initProjectIdentity(store: ProjectStore): void {
  const input = optional<HTMLInputElement>('#project-title');
  const hint = optional<HTMLElement>('#project-title-hint');
  if (!input) return;
  input.disabled = false;
  if (hint) hint.hidden = true;

  const sync = (): void => {
    // No pisar lo que el usuario está tecleando.
    if (document.activeElement === input) return;
    input.value = store.project().title?.trim() || 'Proyecto sin título';
    document.title = `${input.value} · ${BASE_TITLE}`;
  };

  const commit = (): void => {
    const title = input.value.trim();
    if (!title) {
      sync();
      return;
    }
    if (title === store.project().title?.trim()) return;
    const error = store.dispatch({ type: 'set-project-title', title });
    if (error) {
      notify({ message: error, level: 'error' });
      sync();
      return;
    }
    document.title = `${title} · ${BASE_TITLE}`;
  };

  input.addEventListener('change', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.value = store.project().title?.trim() || 'Proyecto sin título';
      input.blur();
    }
  });
  store.subscribe(sync);
  sync();
}
