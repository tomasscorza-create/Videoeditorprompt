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
import { PROJECT_SELECTION_EVENT, projectSelection, selectProjectItem } from './selection.js';

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
      const selection = projectSelection();
      image.classList.toggle('is-selected', selection?.kind === 'element' && selection.elementId === element.id);
      image.draggable = false;
      image.tabIndex = 0;
      image.style.left = `${element.transform.x / 10.8}%`;
      image.style.top = `${element.transform.y / 19.2}%`;
      image.style.zIndex = String(element.transform.zIndex);
      image.style.opacity = String((element.transform as unknown as { opacity?: number }).opacity ?? 1);
      image.style.transform = `translate(-50%, -50%) scale(${element.transform.scale})`;
      bindElementInteraction(image, canvas, store, scene.id, element.id);
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
  window.addEventListener(PROJECT_SELECTION_EVENT, render);
  render();
}

function bindElementInteraction(
  image: HTMLElement,
  canvas: HTMLElement,
  store: ProjectStore,
  sceneId: string,
  elementId: string,
): void {
  image.addEventListener('click', (event) => {
    if (currentCharacterPlacement()) return;
    event.stopPropagation();
    selectProjectItem({ kind: 'element', sceneId, elementId });
  });
  image.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectProjectItem({ kind: 'element', sceneId, elementId });
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const element = store.project().scenes.find((scene) => scene.id === sceneId)?.elements.find((candidate) => candidate.id === elementId);
      if (!element) return;
      const step = event.shiftKey ? 1 : 10;
      const x = element.transform.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0);
      const y = element.transform.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
      store.dispatch({ type: 'set-character-transform', sceneId, elementId, x, y });
    }
  });
  image.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const element = store.project().scenes.find((scene) => scene.id === sceneId)?.elements.find((candidate) => candidate.id === elementId);
    if (!element) return;
    const scale = Math.max(0.05, Math.min(10, Math.round((element.transform.scale + (event.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
    store.dispatch({ type: 'set-character-transform', sceneId, elementId, scale });
  }, { passive: false });
  image.addEventListener('pointerdown', (event) => {
    if (currentCharacterPlacement() || event.button !== 0) return;
    event.preventDefault();
    image.setPointerCapture(event.pointerId);
    selectProjectItem({ kind: 'element', sceneId, elementId });
    const bounds = canvas.getBoundingClientRect();
    const move = (moveEvent: PointerEvent): void => {
      const x = Math.round(Math.max(-1080, Math.min(2160, (moveEvent.clientX - bounds.left) / bounds.width * 1080)));
      const y = Math.round(Math.max(-1920, Math.min(3840, (moveEvent.clientY - bounds.top) / bounds.height * 1920)));
      image.style.left = `${x / 10.8}%`;
      image.style.top = `${y / 19.2}%`;
      image.dataset.pendingX = String(x);
      image.dataset.pendingY = String(y);
    };
    const finish = (): void => {
      image.removeEventListener('pointermove', move);
      image.removeEventListener('pointerup', finish);
      const x = Number(image.dataset.pendingX);
      const y = Number(image.dataset.pendingY);
      delete image.dataset.pendingX;
      delete image.dataset.pendingY;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        store.dispatch({ type: 'set-character-transform', sceneId, elementId, x, y });
      }
    };
    image.addEventListener('pointermove', move);
    image.addEventListener('pointerup', finish);
  });
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
  const bounds = canvas.getBoundingClientRect();
  const x = Math.round(Math.max(0, Math.min(1080, (event.clientX - bounds.left) / bounds.width * 1080)));
  const y = Math.round(Math.max(0, Math.min(1920, (event.clientY - bounds.top) / bounds.height * 1920)));
  if (characters.length < 2) {
    const elementId = nextElementId(scene.id, scene.elements.map((element) => element.id));
    const error = store.dispatch({
      type: 'add-character',
      sceneId: scene.id,
      elementId,
      resourceId: placement.resourceId,
      x,
      y,
      scale: 0.75,
      zIndex: 20 + characters.length,
    });
    reportPlacement(error || `«${placement.label}» se agregó a la escena.`, Boolean(error));
    if (!error) finishCharacterPlacement();
    return;
  }
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

function nextElementId(sceneId: string, existing: string[]): string {
  const used = new Set(existing);
  for (let index = 1; index <= 99; index += 1) {
    const id = `${sceneId}-personaje-${String(index).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
  return `${sceneId}-personaje-${Date.now().toString(36)}`;
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
