import { optional } from '../dom.js';
import {
  CHARACTER_DRAG_TYPE,
  CHARACTER_PLACEMENT_EVENT,
  currentCharacterPlacement,
  finishCharacterPlacement,
  readCharacterDrag,
  type CharacterPlacement,
} from './character-placement.js';
import type { ProjectStore } from './store.js';

interface AssetCatalogEntry {
  id: string;
  thumbnail?: string;
}

interface AssetCatalog {
  entries: AssetCatalogEntry[];
}

let activeStore: ProjectStore | null = null;
let renderActiveComposition: (() => void) | null = null;
let placementEventsBound = false;

export async function initCompositionPreview(store: ProjectStore): Promise<void> {
  const canvas = optional<HTMLElement>('#composition-canvas');
  if (!canvas) return;
  activeStore = store;
  const assetEntries = new Map<string, AssetCatalogEntry>();
  let renderVersion = 0;
  const catalogPaths = new Set(
    store.resources('character')
      .flatMap((resource) => resource.characterRef?.catalog ? [resource.characterRef.catalog] : []),
  );
  for (const catalogPath of catalogPaths) {
    try {
      const response = await fetch(`/${catalogPath}`, { cache: 'no-store' });
      if (!response.ok) continue;
      const catalog = await response.json() as AssetCatalog;
      for (const entry of catalog.entries ?? []) assetEntries.set(entry.id, entry);
    } catch {
      // El personaje conserva su ficha aunque una miniatura no pueda cargarse.
    }
  }

  const render = (): void => {
    const version = ++renderVersion;
    const project = store.project();
    const scene = project.scenes.find((item) => item.id === store.selectedSceneId()) ?? project.scenes[0];
    if (!scene) {
      canvas.replaceChildren(empty('No hay una escena seleccionada.'));
      return;
    }
    const nodes: HTMLElement[] = [];
    const background = store.resources('background').find((entry) => entry.id === scene.background.resourceId);
    if (background?.backgroundManifest) {
      void appendBackground(canvas, background.backgroundManifest, nodes, () => version === renderVersion);
    } else {
      nodes.push(label(scene.title));
      canvas.replaceChildren(...nodes);
    }

    for (const element of [...scene.elements].sort((a, b) => a.transform.zIndex - b.transform.zIndex)) {
      if (element.type !== 'character' || !element.resourceId) continue;
      const resource = store.resources('character').find((entry) => entry.id === element.resourceId);
      const entry = resource?.characterRef ? assetEntries.get(resource.characterRef.entryId) : null;
      if (!entry?.thumbnail) continue;
      const image = document.createElement('img');
      image.className = 'composition-character';
      image.src = `/${entry.thumbnail}`;
      image.alt = resource?.label || 'Personaje';
      image.dataset.elementId = element.id;
      image.draggable = false;
      image.style.left = `${element.transform.x / 10.8}%`;
      image.style.top = `${element.transform.y / 19.2}%`;
      image.style.zIndex = String(element.transform.zIndex);
      image.style.opacity = String((element.transform as unknown as { opacity?: number }).opacity ?? 1);
      image.style.transform = `translate(-50%, -50%) scale(${element.transform.scale})`;
      nodes.push(image);
    }
    const placement = currentCharacterPlacement();
    if (placement) nodes.push(placementHint(`Clic o soltar: colocar «${placement.label}»`));
    nodes.push(label(`${scene.title} · ${scene.background.cameraPreset}`));
    canvas.replaceChildren(...nodes);
  };

  renderActiveComposition = render;
  store.subscribe(() => {
    if (activeStore === store) render();
  });
  bindPlacementEvents(canvas);
  render();
}

function bindPlacementEvents(canvas: HTMLElement): void {
  if (placementEventsBound) return;
  placementEventsBound = true;
  window.addEventListener(CHARACTER_PLACEMENT_EVENT, () => {
    canvas.classList.toggle('is-character-placement-active', Boolean(currentCharacterPlacement()));
    renderActiveComposition?.();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && currentCharacterPlacement()) finishCharacterPlacement();
  });
  canvas.addEventListener('click', (event) => {
    const placement = currentCharacterPlacement();
    if (placement) placeCharacter(event, canvas, placement);
  });
  canvas.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes(CHARACTER_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    canvas.classList.add('is-character-drag-over');
  });
  canvas.addEventListener('dragleave', () => canvas.classList.remove('is-character-drag-over'));
  canvas.addEventListener('drop', (event) => {
    canvas.classList.remove('is-character-drag-over');
    const placement = readCharacterDrag(event.dataTransfer) || currentCharacterPlacement();
    if (!placement) return;
    event.preventDefault();
    placeCharacter(event, canvas, placement);
  });
}

function placeCharacter(
  event: MouseEvent | DragEvent,
  canvas: HTMLElement,
  placement: CharacterPlacement,
): void {
  const store = activeStore;
  if (!store) return;
  const scene = store.project().scenes.find((item) => item.id === store.selectedSceneId());
  if (!scene) return;
  const characters = scene.elements.filter((element) => element.type === 'character');
  if (characters.length === 0) return;
  const bounds = canvas.getBoundingClientRect();
  const x = Math.round(Math.max(0, Math.min(1080, (event.clientX - bounds.left) / bounds.width * 1080)));
  const y = Math.round(Math.max(0, Math.min(1920, (event.clientY - bounds.top) / bounds.height * 1920)));
  const target = characters.reduce((closest, element) => {
    const distance = Math.hypot(element.transform.x - x, element.transform.y - y);
    const closestDistance = Math.hypot(closest.transform.x - x, closest.transform.y - y);
    return distance < closestDistance ? element : closest;
  });
  const previous = store.resources('character').find((resource) => resource.id === target.resourceId);
  const error = store.dispatch({
    type: 'place-character-resource',
    sceneId: scene.id,
    elementId: target.id,
    resourceId: placement.resourceId,
    x,
    y,
  });
  reportPlacement(
    error || `«${placement.label}» reemplazó a «${previous?.label || target.id}» y quedó colocado en la escena.`,
    Boolean(error),
  );
  if (!error) finishCharacterPlacement();
}

function reportPlacement(message: string, isError: boolean): void {
  for (const status of [
    optional<HTMLElement>('#project-status'),
    optional<HTMLElement>('#resource-library-status'),
  ]) {
    if (!status) continue;
    status.textContent = message;
    status.classList.toggle('error', isError);
    status.classList.toggle('ok', !isError);
  }
}

async function appendBackground(
  canvas: HTMLElement,
  manifestPath: string,
  foregroundNodes: HTMLElement[],
  isCurrent: () => boolean,
): Promise<void> {
  try {
    const response = await fetch(`/${manifestPath}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(String(response.status));
    const manifest = await response.json() as { layers?: Record<string, string> };
    const base = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
    const layers = ['far', 'mid', 'front'].flatMap((key) => manifest.layers?.[key] ? [manifest.layers[key]] : []);
    const backgroundNodes = layers.map((layerPath, index) => {
      const image = document.createElement('img');
      image.className = 'composition-layer';
      image.src = `/${base}${layerPath}`;
      image.alt = '';
      image.style.zIndex = String(index);
      return image;
    });
    if (isCurrent()) canvas.replaceChildren(...backgroundNodes, ...foregroundNodes);
  } catch {
    if (isCurrent()) canvas.replaceChildren(...foregroundNodes);
  }
}

function label(text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = 'composition-label';
  node.textContent = text;
  node.style.zIndex = '2000';
  return node;
}

function placementHint(text: string): HTMLElement {
  const node = document.createElement('span');
  node.className = 'composition-placement-hint';
  node.textContent = text;
  node.style.zIndex = '2100';
  return node;
}

function empty(text: string): HTMLElement {
  const node = document.createElement('p');
  node.className = 'viewer-empty';
  node.textContent = text;
  return node;
}
