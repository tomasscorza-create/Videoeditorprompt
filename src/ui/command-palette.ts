// M2 — Paleta de comandos (Ctrl+K). Cada entrada ejecuta exactamente el mismo
// control visual que ya existe: la paleta es un atajo, no una vía paralela.

import { optional, required } from './dom.js';
import {
  filterActions,
  groupActions,
  isAvailable,
  type CommandAction,
  type ScoredAction,
} from './command-registry.js';

let dialog: HTMLDialogElement | null = null;
let input: HTMLInputElement | null = null;
let list: HTMLElement | null = null;
let visible: ScoredAction[] = [];
let activeIndex = 0;

/** Dispara el control real; si no existe o está deshabilitado, no hace nada. */
function clickTarget(selector: string): void {
  const target = optional<HTMLButtonElement>(selector);
  if (target && !target.disabled) target.click();
}

function disabledReason(selector: string, reason: string): string | undefined {
  const target = optional<HTMLButtonElement>(selector);
  if (!target) return 'No disponible en esta pantalla.';
  return target.disabled ? reason : undefined;
}

function actions(): CommandAction[] {
  const entries: CommandAction[] = [
    {
      id: 'project-new',
      label: 'Nuevo proyecto',
      group: 'Proyecto',
      keywords: ['crear', 'empezar', 'lienzo'],
      run: () => {
        const menu = optional<HTMLDetailsElement>('#files-menu');
        if (menu) menu.open = true;
        clickTarget('#project-new');
      },
    },
    {
      id: 'projects-open',
      label: 'Abrir proyecto',
      group: 'Proyecto',
      keywords: ['mis proyectos', 'guardados'],
      run: () => clickTarget('#projects-open'),
    },
    {
      id: 'project-rename',
      label: 'Renombrar proyecto',
      group: 'Proyecto',
      keywords: ['titulo', 'nombre'],
      run: () => {
        const title = optional<HTMLInputElement>('#project-title');
        title?.focus();
        title?.select();
      },
    },
    {
      id: 'director-generate',
      label: 'Crear propuesta con el Director',
      group: 'Director',
      keywords: ['idea', 'generar', 'ia'],
      unavailableReason: disabledReason('#director-generate', 'El Director no está listo o hay una tarea en curso.'),
      run: () => clickTarget('#director-generate'),
    },
    {
      id: 'director-render',
      label: 'Exportar MP4',
      group: 'Director',
      keywords: ['exportar', 'mp4', 'render'],
      unavailableReason: disabledReason('#director-render', 'El proyecto todavía no se puede renderizar.'),
      run: () => clickTarget('#director-render'),
    },
    { id: 'page-command', label: 'Ir a Idea', group: 'Director', run: () => clickTarget('#director-page-command-tab') },
    {
      id: 'page-project',
      label: 'Ir a Propuesta',
      group: 'Director',
      unavailableReason: disabledReason('#director-page-project-tab', 'Todavía no hay una propuesta.'),
      run: () => clickTarget('#director-page-project-tab'),
    },
    { id: 'page-render', label: 'Ir a Exportar', group: 'Director', run: () => clickTarget('#director-page-render-tab') },
    { id: 'workspace-editor', label: 'Ver el Editor de video', group: 'Espacio', run: () => clickTarget('#workspace-editor') },
    { id: 'workspace-creator', label: 'Ver el Creador de recursos', group: 'Espacio', run: () => clickTarget('#workspace-creator') },
    {
      id: 'toggle-director',
      label: 'Mostrar u ocultar el panel izquierdo',
      group: 'Espacio',
      keywords: ['director', 'colapsar'],
      run: () => (optional<HTMLButtonElement>('#director-collapse')?.offsetParent
        ? clickTarget('#director-collapse')
        : clickTarget('#director-expand')),
    },
    {
      id: 'toggle-inspector',
      label: 'Mostrar u ocultar el panel derecho',
      group: 'Espacio',
      keywords: ['recursos', 'biblioteca', 'colapsar'],
      run: () => (optional<HTMLButtonElement>('#inspector-collapse')?.offsetParent
        ? clickTarget('#inspector-collapse')
        : clickTarget('#inspector-expand')),
    },
    {
      id: 'toggle-timeline',
      label: 'Mostrar u ocultar la timeline',
      group: 'Espacio',
      run: () => (optional<HTMLButtonElement>('#timeline-collapse')?.offsetParent
        ? clickTarget('#timeline-collapse')
        : clickTarget('#timeline-expand')),
    },
    {
      id: 'timeline-play',
      label: 'Reproducir o pausar',
      group: 'Timeline',
      shortcut: 'Espacio',
      unavailableReason: disabledReason('#timeline-play', 'Todavía no hay nada medido para reproducir.'),
      run: () => clickTarget('#timeline-play'),
    },
    {
      id: 'timeline-undo',
      label: 'Deshacer',
      group: 'Timeline',
      shortcut: 'Ctrl+Z',
      unavailableReason: disabledReason('#timeline-undo', 'No hay nada que deshacer.'),
      run: () => clickTarget('#timeline-undo'),
    },
    {
      id: 'timeline-redo',
      label: 'Rehacer',
      group: 'Timeline',
      shortcut: 'Ctrl+Y',
      unavailableReason: disabledReason('#timeline-redo', 'No hay nada que rehacer.'),
      run: () => clickTarget('#timeline-redo'),
    },
    { id: 'timeline-fit', label: 'Ajustar la timeline al ancho', group: 'Timeline', shortcut: 'F', run: () => clickTarget('#timeline-fit') },
    { id: 'timeline-snap', label: 'Alternar ajuste magnético', group: 'Timeline', shortcut: 'S', run: () => clickTarget('#timeline-snap') },
    { id: 'timeline-shortcuts', label: 'Ver atajos de la timeline', group: 'Timeline', run: () => clickTarget('#timeline-shortcuts') },
    { id: 'settings', label: 'Abrir configuración', group: 'Aplicación', keywords: ['tema', 'ajustes'], run: () => clickTarget('#settings-open') },
    {
      id: 'health',
      label: 'Ver diagnóstico del servicio local',
      group: 'Aplicación',
      keywords: ['salud', 'ollama', 'piper', 'estado'],
      run: () => clickTarget('#director-health-badge'),
    },
  ];
  return entries;
}

export function initCommandPalette(): void {
  dialog = required<HTMLDialogElement>('#command-palette');
  input = required<HTMLInputElement>('#command-palette-input');
  list = required<HTMLElement>('#command-palette-list');

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      toggle();
    }
  });

  input.addEventListener('input', () => refresh());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      execute(activeIndex);
    }
  });
  dialog.addEventListener('close', () => {
    if (input) input.value = '';
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog?.close();
  });
}

function toggle(): void {
  if (!dialog) return;
  if (dialog.open) {
    dialog.close();
    return;
  }
  refresh();
  dialog.showModal();
  input?.focus();
}

function refresh(): void {
  if (!list || !input) return;
  visible = filterActions(actions(), input.value);
  activeIndex = visible.findIndex((item) => isAvailable(item.action));
  if (activeIndex < 0) activeIndex = 0;
  list.replaceChildren(...(visible.length === 0 ? [emptyState()] : renderGroups()));
  syncActive();
}

function emptyState(): HTMLElement {
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'Ninguna acción coincide con la búsqueda.';
  return empty;
}

function renderGroups(): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  let index = 0;
  for (const { group, items } of groupActions(visible)) {
    const heading = document.createElement('p');
    heading.className = 'command-group';
    heading.textContent = group;
    nodes.push(heading);
    for (const item of items) {
      nodes.push(renderItem(item, index));
      index += 1;
    }
  }
  return nodes;
}

function renderItem(item: ScoredAction, index: number): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'command-item';
  button.dataset.index = String(index);
  button.setAttribute('role', 'option');
  const label = document.createElement('span');
  label.className = 'command-label';
  label.textContent = item.action.label;
  button.append(label);
  if (item.action.shortcut) {
    const shortcut = document.createElement('kbd');
    shortcut.textContent = item.action.shortcut;
    button.append(shortcut);
  }
  if (!isAvailable(item.action)) {
    button.disabled = true;
    button.title = item.action.unavailableReason ?? '';
    const reason = document.createElement('small');
    reason.className = 'command-reason';
    reason.textContent = item.action.unavailableReason ?? '';
    button.append(reason);
  } else {
    button.addEventListener('click', () => execute(index));
  }
  return button;
}

function move(delta: number): void {
  if (visible.length === 0) return;
  let next = activeIndex;
  for (let step = 0; step < visible.length; step += 1) {
    next = (next + delta + visible.length) % visible.length;
    if (isAvailable(visible[next].action)) break;
  }
  activeIndex = next;
  syncActive();
}

function syncActive(): void {
  if (!list) return;
  for (const node of list.querySelectorAll<HTMLElement>('.command-item')) {
    const isActive = Number(node.dataset.index) === activeIndex;
    node.classList.toggle('is-active', isActive);
    node.setAttribute('aria-selected', String(isActive));
    if (isActive) node.scrollIntoView({ block: 'nearest' });
  }
}

function execute(index: number): void {
  const item = visible[index];
  if (!item || !isAvailable(item.action)) return;
  dialog?.close();
  item.action.run();
}
