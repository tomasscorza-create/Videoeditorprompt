import { optional } from '../dom.js';
import {
  CHARACTER_DRAG_TYPE,
  PROP_DRAG_TYPE,
  CHARACTER_PLACEMENT_EVENT,
  currentCharacterPlacement,
  finishCharacterPlacement,
  readCharacterDrag,
  readPropDrag,
  type CharacterPlacement,
} from './character-placement.js';
import type { ProjectStore } from './store.js';
import type { ElementView, SceneView } from './types.js';
import { nextVisualZIndex } from './layers.js';
import { PROJECT_SELECTION_EVENT, projectSelection, selectProjectItem } from './selection.js';
import {
  ANIMATION_MODE_EVENT,
  isAnimationModeOn,
  setAnimationMode,
} from './animation-mode.js';
import {
  EDITOR_PLAYBACK_EVENT,
  EDITOR_WORKSPACE_EVENT,
  editorPlayhead,
  measuredTimelineFor,
} from '../editor-workspace.js';
import {
  baseValueForParameter,
  buildAnimationLanes,
  evaluateLanesAt,
  keyframeCommandsForValue,
  parameterLabel,
  sceneAnimationReference,
  sceneAnimationTiming,
  type AnimationLane,
} from '../timeline-animation.js';
import { quantizeToFrame } from '../../../shared/animation-contract.js';
import type { SceneTiming } from '../../../shared/animation-evaluator.js';

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
    [...store.resources('character'), ...store.resources('prop')]
      .flatMap((resource) => resource.characterRef?.catalog
        ? [resource.characterRef.catalog]
        : resource.resourceRef?.catalog ? [resource.resourceRef.catalog] : []),
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

    const scope = animationScope(store, scene);
    let animatingElement: ElementView | null = null;
    for (const element of [...scene.elements].sort((a, b) => a.transform.zIndex - b.transform.zIndex)) {
      if (!['character', 'prop'].includes(element.type) || !element.resourceId) continue;
      const resource = store.resources(element.type as 'character' | 'prop').find((entry) => entry.id === element.resourceId);
      const entry = resource?.characterRef
        ? assetEntries.get(resource.characterRef.entryId)
        : resource?.resourceRef ? assetEntries.get(resource.resourceRef.entryId) : null;
      const thumbnail = resource?.thumbnail ?? entry?.thumbnail;
      if (!thumbnail) continue;
      const image = document.createElement('img');
      image.className = element.type === 'prop' ? 'composition-character composition-prop' : 'composition-character';
      image.src = `/${thumbnail}`;
      image.alt = resource?.label || (element.type === 'prop' ? 'Prop' : 'Personaje');
      image.dataset.elementId = element.id;
      const selection = projectSelection();
      image.classList.toggle(
        'is-selected',
        (selection?.kind === 'element' || selection?.kind === 'keyframe') && selection.elementId === element.id,
      );
      const animating = isAnimationModeOn(scene.id, element.id);
      image.classList.toggle('is-animating', animating);
      if (animating) animatingElement = element;
      image.draggable = false;
      image.tabIndex = 0;
      // Una pista REEMPLAZA el valor base de su parámetro: la vista previa en el
      // cabezal sale del mismo evaluador que produce el render.
      const animated = elementParamsAt(element, scope);
      const view = viewTransform(element, animated);
      image.style.left = `${view.x / 10.8}%`;
      image.style.top = `${view.y / 19.2}%`;
      image.style.zIndex = String(element.transform.zIndex);
      image.style.opacity = String(view.opacity);
      image.style.transform = `translate(-50%, -50%) rotate(${view.rotationDegrees}deg) scale(${view.scale})`;
      bindElementInteraction(image, canvas, store, scene, element);
      nodes.push(image);
    }
    const placement = currentCharacterPlacement();
    if (placement) nodes.push(placementHint(`Clic o soltar: colocar «${placement.label}»`));
    canvas.classList.toggle('is-animation-mode', animatingElement !== null);
    if (animatingElement) nodes.push(animationBanner(scope));
    nodes.push(label(`${scene.title} · ${scene.background.cameraPreset}`));
    canvas.replaceChildren(...nodes);
  };

  renderActiveComposition = render;
  store.subscribe(() => {
    if (activeStore === store) render();
  });
  bindPlacementEvents(canvas);
  window.addEventListener(PROJECT_SELECTION_EVENT, render);
  window.addEventListener(ANIMATION_MODE_EVENT, render);
  // El cabezal decide qué valor tiene cada parámetro animado, así que moverlo
  // repinta el lienzo.
  window.addEventListener(EDITOR_PLAYBACK_EVENT, render);
  window.addEventListener(EDITOR_WORKSPACE_EVENT, render);
  render();
}

interface AnimationScope {
  timing: SceneTiming | null;
  reference: ReturnType<typeof sceneAnimationReference>;
  fps: number;
}

function animationScope(store: ProjectStore, scene: SceneView): AnimationScope {
  const project = store.project();
  const measured = measuredTimelineFor(project.scenes.map((item) => item.id));
  const reference = sceneAnimationReference(scene.dialogue);
  return {
    timing: sceneAnimationTiming(measured?.scenes.find((item) => item.id === scene.id) ?? null, reference),
    reference,
    fps: project.video?.fps ?? 30,
  };
}

function elementLanes(element: ElementView, scope: AnimationScope): AnimationLane[] {
  if (!element.tracks?.length) return [];
  return buildAnimationLanes(element.id, element.tracks, scope);
}

function elementParamsAt(element: ElementView, scope: AnimationScope): Record<string, number> {
  const lanes = elementLanes(element, scope);
  return lanes.length === 0 ? {} : evaluateLanesAt(lanes, editorPlayhead());
}

function viewTransform(
  element: ElementView,
  animated: Record<string, number>,
): { x: number; y: number; scale: number; rotationDegrees: number; opacity: number } {
  return {
    x: animated['position.x'] ?? element.transform.x,
    y: animated['position.y'] ?? element.transform.y,
    scale: animated.scale ?? element.transform.scale,
    rotationDegrees: animated.rotationDegrees ?? element.transform.rotationDegrees ?? 0,
    opacity: animated.opacity ?? element.transform.opacity ?? 1,
  };
}

/**
 * Rótulo persistente del modo animación.
 *
 * No puede ser un icono discreto en una barra: el riesgo de esta capacidad es
 * mover un personaje sin saber si se cambió la base o se creó un keyframe, así
 * que el lienzo entero se tiñe y el rótulo nombra el frame en el que se está
 * escribiendo.
 */
function animationBanner(scope: AnimationScope): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'composition-animation-banner';
  banner.style.zIndex = '2200';
  const title = document.createElement('strong');
  const frame = scope.timing
    ? quantizeToFrame(Math.max(0, editorPlayhead() - scope.timing.startSeconds), scope.fps)
    : null;
  title.textContent = frame === null
    ? '◆ Animando'
    : `◆ Animando · posición · frame ${frame}`;
  const body = document.createElement('span');
  body.textContent = 'Mover el elemento crea o actualiza un keyframe acá. La posición base no se toca.';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'composition-animation-exit';
  back.textContent = 'Volver a base';
  back.addEventListener('click', (event) => {
    event.stopPropagation();
    setAnimationMode(null);
  });
  banner.append(title, body, back);
  return banner;
}

function bindElementInteraction(
  image: HTMLElement,
  canvas: HTMLElement,
  store: ProjectStore,
  scene: SceneView,
  element: ElementView,
): void {
  const sceneId = scene.id;
  const elementId = element.id;
  const live = (): ElementView | null => store.project().scenes.find((item) => item.id === sceneId)
    ?.elements.find((candidate) => candidate.id === elementId) ?? null;
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
      const current = live();
      if (!current) return;
      const step = event.shiftKey ? 1 : 10;
      const from = viewTransform(current, elementParamsAt(current, animationScope(store, scene)));
      const x = from.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0);
      const y = from.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
      applyPosition(store, scene, current, x, y);
    }
  });
  image.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const current = live();
    if (!current) return;
    const from = viewTransform(current, elementParamsAt(current, animationScope(store, scene)));
    const scale = Math.max(0.05, Math.min(10, Math.round((from.scale + (event.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
    if (isAnimationModeOn(sceneId, elementId)) {
      applyAnimated(store, scene, current, [{ parameterId: 'scale', value: scale }]);
      return;
    }
    store.dispatch({ type: 'set-element-transform', sceneId, elementId, scale });
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
      const current = live();
      if (Number.isFinite(x) && Number.isFinite(y) && current) applyPosition(store, scene, current, x, y);
    };
    image.addEventListener('pointermove', move);
    image.addEventListener('pointerup', finish);
  });
}

/**
 * Mover el elemento: con el modo animación apagado cambia la base y NUNCA toca
 * un keyframe; con el modo encendido crea o actualiza el keyframe del cabezal y
 * NUNCA toca la base. Las dos direcciones importan igual.
 */
function applyPosition(store: ProjectStore, scene: SceneView, element: ElementView, x: number, y: number): void {
  if (!isAnimationModeOn(scene.id, element.id)) {
    store.dispatch({ type: 'set-element-transform', sceneId: scene.id, elementId: element.id, x, y });
    return;
  }
  applyAnimated(store, scene, element, [
    { parameterId: 'position.x', value: x },
    { parameterId: 'position.y', value: y },
  ]);
}

function applyAnimated(
  store: ProjectStore,
  scene: SceneView,
  element: ElementView,
  changes: Array<{ parameterId: string; value: number }>,
): void {
  const scope = animationScope(store, scene);
  // El modo no puede activarse sin tiempo medido; si la medición se perdió
  // mientras tanto, no se escribe nada en vez de anclar a un tiempo inventado.
  if (!scope.timing) {
    setAnimationMode(null);
    reportPlacement('Sin voz medida no se puede ubicar un keyframe: renderizá para volver a animar en el lienzo.', true);
    return;
  }
  const lanes = elementLanes(element, scope);
  const taken = (element.tracks ?? []).flatMap((track) => track.keyframes.map((keyframe) => keyframe.id));
  const commands = changes.flatMap((change) => keyframeCommandsForValue({
    sceneId: scene.id,
    elementId: element.id,
    parameterId: change.parameterId,
    value: change.value,
    playheadSeconds: editorPlayhead(),
    lane: lanes.find((lane) => lane.parameterId === change.parameterId) ?? null,
    timing: scope.timing as SceneTiming,
    fps: scope.fps,
    baseValue: baseValueForParameter(change.parameterId, element.transform),
    takenKeyframeIds: taken,
  }));
  if (commands.length === 0) return;
  const error = store.dispatchBatch(commands);
  reportPlacement(
    error || `Keyframe de ${changes.map((change) => parameterLabel(change.parameterId)).join(' y ')} escrito en el cabezal.`,
    Boolean(error),
  );
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
    if (placement) placeResource(event, canvas, placement);
  });
  canvas.addEventListener('dragover', (event) => {
    const transfer = event.dataTransfer;
    if (!transfer || !Array.from(transfer.types)
      .some((type) => [CHARACTER_DRAG_TYPE, PROP_DRAG_TYPE].includes(type))) return;
    event.preventDefault();
    transfer.dropEffect = 'copy';
    canvas.classList.add('is-character-drag-over');
  });
  canvas.addEventListener('dragleave', () => canvas.classList.remove('is-character-drag-over'));
  canvas.addEventListener('drop', (event) => {
    canvas.classList.remove('is-character-drag-over');
    const placement = readPropDrag(event.dataTransfer)
      || readCharacterDrag(event.dataTransfer)
      || currentCharacterPlacement();
    if (!placement) return;
    event.preventDefault();
    placeResource(event, canvas, placement);
  });
}

function placeResource(
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
  if (placement.type === 'prop') {
    const elementId = nextElementId(scene.id, scene.elements.map((element) => element.id), 'prop');
    const error = store.dispatch({
      type: 'add-prop',
      sceneId: scene.id,
      elementId,
      resourceId: placement.resourceId,
      x,
      y,
      scale: 0.65,
      zIndex: nextVisualZIndex(scene),
    });
    reportPlacement(error || `«${placement.label}» se agregó a la escena.`, Boolean(error));
    if (!error) finishCharacterPlacement();
    return;
  }
  if (characters.length < 2) {
    const elementId = nextElementId(scene.id, scene.elements.map((element) => element.id), 'personaje');
    const error = store.dispatch({
      type: 'add-character',
      sceneId: scene.id,
      elementId,
      resourceId: placement.resourceId,
      x,
      y,
      scale: 0.75,
      zIndex: nextVisualZIndex(scene),
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

function nextElementId(sceneId: string, existing: string[], kind: 'personaje' | 'prop'): string {
  const used = new Set(existing);
  for (let index = 1; index <= 99; index += 1) {
    const id = `${sceneId}-${kind}-${String(index).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
  return `${sceneId}-${kind}-${Date.now().toString(36)}`;
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
    const backgroundNodes = layers.map((layerPath) => {
      const image = document.createElement('img');
      image.className = 'composition-layer';
      image.src = `/${base}${layerPath}`;
      image.alt = '';
      image.style.zIndex = '0';
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
