import { optional } from './dom.js';

// Deshacer/rehacer sí están implementados en shared/project-editor.js y se cablean
// desde el panel de proyecto. El resto de las acciones todavía no existe en el
// contrato de comandos, así que se declaran prototipo y no ejecutan nada.
const WIRED_TOOL_IDS = new Set(['tool-undo', 'tool-redo']);

export function initToolbarPrototype(): void {
  const toolbar = optional<HTMLElement>('.editor-toolbar');
  if (!toolbar) return;
  for (const button of toolbar.querySelectorAll<HTMLButtonElement>('.tool-btn')) {
    if (WIRED_TOOL_IDS.has(button.id)) continue;
    button.disabled = true;
    button.dataset.prototype = 'true';
    const label = button.title || 'Herramienta';
    if (!label.includes('prototipo')) button.title = `${label} — prototipo, sin conectar`;
  }
}
