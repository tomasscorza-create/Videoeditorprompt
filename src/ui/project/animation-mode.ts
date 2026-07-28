// Fase 4 — modo animación del lienzo.
//
// El riesgo principal de esta capacidad es un modo global invisible: mover un
// personaje y no saber si se cambió la base o se creó un keyframe. Por eso el
// modo es POR ELEMENTO y se apaga solo al cambiar de selección, en vez de ser un
// interruptor que queda encendido.
//
// Esa regla no se implementa con un listener que podría desincronizarse: el modo
// se deriva de la selección vigente cada vez que se consulta. Si la selección se
// fue a otro elemento, el modo simplemente no existe.

import { PROJECT_SELECTION_EVENT, projectSelection } from './selection.js';

export interface AnimationModeTarget {
  sceneId: string;
  elementId: string;
}

export const ANIMATION_MODE_EVENT = 'local-video:animation-mode';

let requested: AnimationModeTarget | null = null;

/** Modo activo, o null si está apagado o la selección se fue a otra parte. */
export function animationMode(): AnimationModeTarget | null {
  if (!requested) return null;
  const selection = projectSelection();
  if (selection?.kind !== 'element' && selection?.kind !== 'keyframe') return null;
  if (selection.sceneId !== requested.sceneId || selection.elementId !== requested.elementId) return null;
  return requested;
}

export function setAnimationMode(target: AnimationModeTarget | null): void {
  requested = target;
  window.dispatchEvent(new CustomEvent<AnimationModeTarget | null>(ANIMATION_MODE_EVENT, { detail: target }));
}

export function isAnimationModeOn(sceneId: string, elementId: string): boolean {
  const mode = animationMode();
  return mode !== null && mode.sceneId === sceneId && mode.elementId === elementId;
}

/**
 * Avisa a las superficies cuando la selección apaga el modo. El estado ya está
 * derivado; esto solo garantiza el repintado del borde y el rótulo.
 */
export function initAnimationMode(): void {
  window.addEventListener(PROJECT_SELECTION_EVENT, () => {
    if (requested && animationMode() === null) setAnimationMode(null);
  });
}
