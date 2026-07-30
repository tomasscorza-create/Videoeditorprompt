import type { ElementView, SceneView } from './types.js';

/** Elementos que participan del orden visual, de atrás hacia adelante. */
export function visualElementsByLayer(scene: SceneView): ElementView[] {
  const sourceOrder = new Map(scene.elements.map((element, index) => [element.id, index]));
  return scene.elements
    .filter((element) => ['character', 'prop', 'template'].includes(element.type))
    .sort((left, right) => (
      left.transform.zIndex - right.transform.zIndex
      || (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0)
    ));
}

/** Capa humana: el fondo es 0 y el primer elemento visual es 1. */
export function visualLayerNumber(scene: SceneView, elementId: string): number | null {
  const index = visualElementsByLayer(scene).findIndex((element) => element.id === elementId);
  return index < 0 ? null : index + 1;
}

/**
 * Reordena una capa y normaliza los zIndex a 1..N. El motor conserva zIndex
 * como dato interno, pero la UI expone una secuencia sin saltos.
 */
export function setVisualLayerCommands(
  scene: SceneView,
  elementId: string,
  requestedLayer: number,
): Array<Record<string, unknown>> {
  const ordered = visualElementsByLayer(scene);
  const currentIndex = ordered.findIndex((element) => element.id === elementId);
  if (currentIndex < 0) return [];
  const targetIndex = Math.max(0, Math.min(ordered.length - 1, Math.round(requestedLayer) - 1));
  const [selected] = ordered.splice(currentIndex, 1);
  ordered.splice(targetIndex, 0, selected);
  return ordered
    .map((element, index) => ({
      type: 'set-element-transform',
      sceneId: scene.id,
      elementId: element.id,
      zIndex: index + 1,
    }))
    .filter((command, index) => ordered[index].transform.zIndex !== command.zIndex);
}

/** Un elemento nuevo siempre queda delante de todos los existentes. */
export function nextVisualZIndex(scene: SceneView): number {
  const current = visualElementsByLayer(scene);
  return current.length === 0
    ? 1
    : Math.max(...current.map((element) => element.transform.zIndex)) + 1;
}
