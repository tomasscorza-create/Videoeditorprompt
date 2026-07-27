// C2 — Espeja selección y hover entre timeline, lienzo e inspector.
//
// No introduce estado nuevo: se apoya en `projectSelection` y en los atributos
// que cada superficie ya publica (`data-element` en los clips, `data-element-id`
// en los personajes del lienzo). Solo agrega el vínculo visual que faltaba.

import { PROJECT_SELECTION_EVENT, type ProjectSelection } from './project/selection.js';

const HIGHLIGHT_CLASS = 'is-linked-hover';
const PULSE_CLASS = 'is-selection-pulse';

export function initSelectionMirror(): void {
  window.addEventListener(PROJECT_SELECTION_EVENT, (event) => {
    const selection = (event as CustomEvent<ProjectSelection>).detail;
    if (selection) revealInInspector(selection);
  });

  // Delegado: los clips y los personajes se recrean en cada render, así que
  // escuchar en document evita re-suscribir en cada repintado.
  document.addEventListener('pointerover', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clip = target.closest<HTMLElement>('.authoring-clip[data-element]');
    if (clip?.dataset.element) {
      linkHover(clip.dataset.element, true);
      return;
    }
    const character = target.closest<HTMLElement>('.composition-character[data-element-id]');
    if (character?.dataset.elementId) linkHover(character.dataset.elementId, true);
  });
  document.addEventListener('pointerout', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const clip = target.closest<HTMLElement>('.authoring-clip[data-element]');
    const character = target.closest<HTMLElement>('.composition-character[data-element-id]');
    const elementId = clip?.dataset.element ?? character?.dataset.elementId;
    if (elementId) linkHover(elementId, false);
  });
}

/** Resalta a la vez el clip y el personaje que representan el mismo elemento. */
function linkHover(elementId: string, on: boolean): void {
  const selector = `.authoring-clip[data-element="${CSS.escape(elementId)}"], .composition-character[data-element-id="${CSS.escape(elementId)}"]`;
  for (const node of document.querySelectorAll<HTMLElement>(selector)) {
    node.classList.toggle(HIGHLIGHT_CLASS, on);
  }
}

/**
 * Lleva el inspector hasta lo seleccionado y lo destaca un instante. El
 * inspector se repinta de forma asíncrona ante un cambio de selección, así que
 * se espera al siguiente cuadro antes de buscar el nodo.
 */
function revealInInspector(selection: ProjectSelection): void {
  requestAnimationFrame(() => {
    const inspector = document.querySelector<HTMLElement>('#scene-inspector');
    if (!inspector) return;
    const target = findTarget(inspector, selection);
    if (!target) return;
    target.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    target.classList.remove(PULSE_CLASS);
    // Reiniciar la animación cuando se selecciona dos veces seguidas lo mismo.
    void target.offsetWidth;
    target.classList.add(PULSE_CLASS);
    target.addEventListener('animationend', () => target.classList.remove(PULSE_CLASS), { once: true });
  });
}

function findTarget(inspector: HTMLElement, selection: ProjectSelection): HTMLElement | null {
  if (selection.kind === 'element') {
    return inspector.querySelector<HTMLElement>(`[data-inspector-element="${CSS.escape(selection.elementId)}"]`);
  }
  if (selection.kind === 'dialogue') {
    return inspector.querySelector<HTMLElement>(`[data-inspector-turn="${CSS.escape(selection.turnId)}"]`);
  }
  return inspector.querySelector<HTMLElement>(`[data-inspector-scene="${CSS.escape(selection.sceneId)}"]`);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
