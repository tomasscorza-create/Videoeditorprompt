import { optional } from '../dom.js';
import {
  CHARACTER_DRAG_TYPE,
  PROP_DRAG_TYPE,
  TEMPLATE_DRAG_TYPE,
  CHARACTER_PLACEMENT_EVENT,
  currentCharacterPlacement,
  finishCharacterPlacement,
  readCharacterDrag,
  readPropDrag,
  readTemplateDrag,
  type CharacterPlacement,
} from './character-placement.js';
import type { ProjectStore } from './store.js';
import type { ElementView, SceneView } from './types.js';
import { nextVisualZIndex } from './layers.js';
import {
  drawVideoTemplateFrame,
  prepareVideoTemplate,
  type PreparedVideoTemplate,
} from '../../../shared/video-template-renderer.js';
import {
  parseVideoTemplateDefinition,
  type VideoTemplateDefinition,
} from '../../../shared/video-template-definition.js';
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
  editorWorkspace,
  measuredTimelineFor,
  measuredVisualSceneFor,
  type MeasuredProjectTimeline,
  type MeasuredScene,
} from '../editor-workspace.js';
import {
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
import { evaluateScene } from '../../../shared/scene-evaluator.js';
import { drawRigPreview, rigSpritePlan } from './rig-preview.js';

interface AssetCatalogEntry {
  id: string;
  manifest?: string;
  thumbnail?: string;
}

interface AssetCatalog {
  entries: AssetCatalogEntry[];
}

let activeStore: ProjectStore | null = null;
let renderActiveComposition: (() => void) | null = null;
let placementEventsBound = false;
const visualBoundsCache = new Map<string, Promise<VisualBounds>>();
const rigManifestCache = new Map<string, unknown>();
const loadingRigManifests = new Set<string>();

interface VisualBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EvaluatedDialogueFrame {
  characters: EvaluatedCharacterFrame[];
}

interface EvaluatedCharacterFrame {
  id: string;
  eyes: string;
  mouth: string;
  gesture: string;
  character: { x: number; y: number; scale: number; opacity: number };
}

interface PreviewRuntimeCharacter {
  id: string;
  transform: Record<string, unknown>;
}

const DEFAULT_VISUAL_BOUNDS: VisualBounds = { x: 0.18, y: 0.2, width: 0.64, height: 0.6 };

export async function initCompositionPreview(store: ProjectStore): Promise<void> {
  const canvas = optional<HTMLElement>('#composition-canvas');
  if (!canvas) return;
  activeStore = store;
  const assetEntries = new Map<string, AssetCatalogEntry>();
  const backgroundLayers = new Map<string, string[]>();
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
  await Promise.all(store.resources('background').map(async (resource) => {
    if (!resource.backgroundManifest) return;
    backgroundLayers.set(
      resource.backgroundManifest,
      await loadBackgroundLayers(resource.backgroundManifest),
    );
  }));

  const render = (): void => {
    const project = store.project();
    const workspace = editorWorkspace();
    const measured = measuredTimelineFor(project.scenes.map((item) => item.id));
    const previewTiming = workspace.surface === 'canvas' && workspace.playing
      ? measuredSceneAt(measured, editorPlayhead())
      : null;
    const previewing = previewTiming !== null;
    const scene = project.scenes.find((item) => item.id === (previewTiming?.id ?? store.selectedSceneId()))
      ?? project.scenes[0];
    if (!scene) {
      canvas.replaceChildren(empty('No hay una escena seleccionada.'));
      return;
    }
    const sceneTiming = measured?.scenes.find((item) => item.id === scene.id) ?? null;
    const measuredVisual = measuredVisualSceneFor(scene.id);
    const localSeconds = sceneTiming
      ? clamp(editorPlayhead() - sceneTiming.startSeconds, 0, sceneTiming.endSeconds - sceneTiming.startSeconds)
      : 0;
    const evaluatedFrame = measuredVisual
      ? evaluateScene({ version: 2 }, measuredVisual.runtime, measuredVisual.dialogue, localSeconds) as EvaluatedDialogueFrame
      : null;
    const nodes: HTMLElement[] = [];
    const background = store.resources('background').find((entry) => entry.id === scene.background.resourceId);
    if (background?.backgroundManifest) {
      nodes.push(...backgroundNodes(backgroundLayers.get(background.backgroundManifest) ?? []));
    } else {
      nodes.push(label(scene.title));
    }

    const scope = animationScope(store, scene);
    let animatingElement: ElementView | null = null;
    for (const element of [...scene.elements].sort((a, b) => a.transform.zIndex - b.transform.zIndex)) {
      if (element.type === 'template') {
        // El efecto repite su ciclo dentro de la escena: el tiempo que le importa
        // es el transcurrido desde que la escena empezó, no el del proyecto.
        const elapsed = previewTiming ? Math.max(0, editorPlayhead() - previewTiming.startSeconds) : 0;
        const node = templateNode(element, store, elapsed, render);
        if (node) nodes.push(node);
        continue;
      }
      if (!['character', 'prop'].includes(element.type) || !element.resourceId) continue;
      const resource = store.resources(element.type as 'character' | 'prop').find((entry) => entry.id === element.resourceId);
      const entry = resource?.characterRef
        ? assetEntries.get(resource.characterRef.entryId)
        : resource?.resourceRef ? assetEntries.get(resource.resourceRef.entryId) : null;
      const thumbnail = resource?.thumbnail ?? entry?.thumbnail;
      if (!thumbnail && !entry?.manifest) continue;
      // Una pista REEMPLAZA el valor base de su parámetro: la vista previa en el
      // cabezal sale del mismo evaluador que produce el render.
      const animated = elementParamsAt(element, scope);
      const runtimeCharacter = measuredVisual?.runtime.characters.find((item) => item.id === element.id) ?? null;
      const evaluatedCharacter = evaluatedFrame?.characters.find((item) => item.id === element.id) ?? null;
      const view = characterPreviewTransform(element, animated, runtimeCharacter, evaluatedCharacter);
      const manifest = entry?.manifest ? requestRigManifest(entry.manifest, render) : null;
      let image: HTMLImageElement | HTMLCanvasElement;
      if (manifest) {
        image = document.createElement('canvas');
        image.width = 540;
        image.height = 960;
        image.setAttribute('role', 'img');
        image.setAttribute('aria-label', resource?.label || (element.type === 'prop' ? 'Prop' : 'Personaje'));
        const sprites = rigSpritePlan(manifest, entry!.manifest!, {
          params: animated,
          poseId: evaluatedCharacter?.gesture ?? element.poseId ?? 'neutral',
          eyes: evaluatedCharacter?.eyes ?? 'open',
          mouth: evaluatedCharacter?.mouth ?? 'closed',
        });
        drawRigPreview(image, sprites, render);
      } else {
        image = document.createElement('img');
        image.src = `/${thumbnail}`;
        image.alt = resource?.label || (element.type === 'prop' ? 'Prop' : 'Personaje');
      }
      image.className = element.type === 'prop' ? 'composition-character composition-prop' : 'composition-character';
      image.dataset.elementId = element.id;
      const selection = projectSelection();
      image.classList.toggle(
        'is-selected',
        !previewing
          && (selection?.kind === 'element' || selection?.kind === 'keyframe')
          && selection.elementId === element.id,
      );
      const animating = isAnimationModeOn(scene.id, element.id);
      image.classList.toggle('is-animating', animating);
      if (animating) animatingElement = element;
      image.draggable = false;
      image.tabIndex = 0;
      image.style.left = `${view.x / 10.8}%`;
      image.style.top = `${view.y / 19.2}%`;
      image.style.zIndex = String(element.transform.zIndex);
      image.style.opacity = String(view.opacity);
      image.style.transform = `translate(-50%, -50%) rotate(${view.rotationDegrees}deg) scale(${view.scale})`;
      bindElementInteraction(image, canvas, store, scene, element);
      nodes.push(image);
      if (
        !previewing
        && (selection?.kind === 'element' || selection?.kind === 'keyframe')
        && selection.elementId === element.id
      ) {
        nodes.push(transformControls(image, canvas, store, scene, element, view));
      }
    }
    const placement = previewing ? null : currentCharacterPlacement();
    if (placement) nodes.push(placementHint(`Clic o soltar: colocar «${placement.label}»`));
    canvas.classList.toggle('is-animation-mode', animatingElement !== null && !previewing);
    if (animatingElement && !previewing) nodes.push(animationBanner(scope));
    const subtitle = previewTiming ? liveSubtitle(scene, previewTiming, editorPlayhead()) : null;
    if (subtitle) nodes.push(subtitle);
    if (!previewing) nodes.push(label(`${scene.title} · ${scene.background.cameraPreset}`));
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

// La preparación de una plantilla no depende del tiempo: se guarda por
// definición y texto; cada frame solo evalúa y dibuja su estado temporal.
const templateDefinitions = new Map<string, VideoTemplateDefinition>();
const preparedTemplates = new Map<string, PreparedVideoTemplate>();
const loadingTemplates = new Set<string>();
const TEMPLATE_PAGE_CACHE_LIMIT = 6;

function templateNode(
  element: ElementView,
  store: ProjectStore,
  seconds: number,
  rerender: () => void,
): HTMLElement | null {
  const resource = store.resources('template').find((entry) => entry.id === element.templateId);
  const definitionPath = resource?.templateRef?.definition;
  if (!definitionPath || !element.values?.word) return null;

  const node = document.createElement('canvas');
  node.className = 'composition-template';
  node.dataset.elementId = element.id;
  node.width = 540;
  node.height = 960;
  node.style.zIndex = String(element.transform.zIndex);
  node.style.opacity = String(element.transform.opacity);
  const selection = projectSelection();
  node.classList.toggle('is-selected', selection?.kind === 'element' && selection.elementId === element.id);
  node.addEventListener('pointerdown', () => {
    selectProjectItem({ kind: 'element', sceneId: store.selectedSceneId(), elementId: element.id });
  });

  const definition = templateDefinitions.get(definitionPath);
  if (!definition) {
    if (!loadingTemplates.has(definitionPath)) {
      loadingTemplates.add(definitionPath);
      void fetch(`/${definitionPath}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((value) => {
          templateDefinitions.set(definitionPath, parseVideoTemplateDefinition(value));
          rerender();
        })
        .catch(() => {
          // Sin definición el lienzo deja el hueco: el render lo rechazaría igual.
        })
        .finally(() => loadingTemplates.delete(definitionPath));
    }
    return node;
  }

  const key = `${definitionPath}::${element.values.word}`;
  let prepared = preparedTemplates.get(key);
  if (!prepared) {
    prepared = prepareVideoTemplate(definition, element.values.word);
    preparedTemplates.set(key, prepared);
    for (const stale of [...preparedTemplates.keys()].slice(0, -TEMPLATE_PAGE_CACHE_LIMIT)) preparedTemplates.delete(stale);
  }
  drawVideoTemplateFrame(node, prepared, seconds);
  return node;
}

function measuredSceneAt(timeline: MeasuredProjectTimeline | null, seconds: number): MeasuredScene | null {
  if (!timeline?.scenes.length) return null;
  return timeline.scenes.find((scene) => seconds >= scene.startSeconds && seconds < scene.endSeconds)
    ?? (seconds >= timeline.durationSeconds ? timeline.scenes.at(-1) ?? null : null);
}

function liveSubtitle(scene: SceneView, timing: MeasuredScene, seconds: number): HTMLElement | null {
  const measuredTurn = timing.turns?.find((turn) => seconds >= turn.startSeconds && seconds < turn.endSeconds);
  if (!measuredTurn) return null;
  const turn = scene.dialogue.find((item) => item.id === measuredTurn.id);
  if (!turn) return null;
  const subtitle = document.createElement('div');
  subtitle.className = 'composition-live-subtitle';
  subtitle.textContent = turn.text;
  subtitle.setAttribute('aria-hidden', 'true');
  return subtitle;
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
 * Combina la autoría actual con la dinámica medida.
 *
 * La medición conserva la entrada, el idle y los layouts del render que midió;
 * la posición base sigue saliendo del proyecto actual. Si una pista anima un
 * canal, ese valor manda y no se le suma movimiento implícito, igual que en el
 * evaluador final.
 */
export function characterPreviewTransform(
  element: ElementView,
  animated: Record<string, number>,
  runtime: PreviewRuntimeCharacter | null,
  evaluated: EvaluatedCharacterFrame | null,
): ReturnType<typeof viewTransform> {
  const base = viewTransform(element, animated);
  if (!runtime || !evaluated) return base;
  const runtimeX = finiteNumber(runtime.transform.toX, evaluated.character.x);
  const runtimeY = finiteNumber(runtime.transform.baseY, evaluated.character.y);
  const runtimeScale = finiteNumber(runtime.transform.baseScale, evaluated.character.scale);
  return {
    x: Object.hasOwn(animated, 'position.x') ? base.x : base.x + evaluated.character.x - runtimeX,
    y: Object.hasOwn(animated, 'position.y') ? base.y : base.y + evaluated.character.y - runtimeY,
    scale: Object.hasOwn(animated, 'scale') ? base.scale : base.scale + evaluated.character.scale - runtimeScale,
    rotationDegrees: base.rotationDegrees,
    opacity: Object.hasOwn(animated, 'opacity') ? base.opacity : base.opacity * evaluated.character.opacity,
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Rótulo persistente del modo animación.
 *
 * El borde del lienzo mantiene visible el modo y este rótulo compacto aclara
 * qué se escribe, sin cubrir al personaje ni sus tiradores.
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
    ? '◆ Animación temporal'
    : `◆ Animación temporal · frame ${frame}`;
  const body = document.createElement('span');
  body.textContent = 'Mover, escalar o rotar escribe keyframes acá. La base no cambia.';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'composition-animation-exit';
  back.textContent = 'Terminar';
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

function transformControls(
  image: HTMLElement,
  canvas: HTMLElement,
  store: ProjectStore,
  scene: SceneView,
  element: ElementView,
  view: ReturnType<typeof viewTransform>,
): HTMLElement {
  const controls = document.createElement('div');
  controls.className = 'composition-transform-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', `Transformar ${element.resourceId || element.id}`);
  let visualBounds = DEFAULT_VISUAL_BOUNDS;
  positionTransformControls(controls, view, visualBounds);
  void visualBoundsFor(image).then((bounds) => {
    visualBounds = bounds;
    if (controls.isConnected) positionTransformControls(controls, view, visualBounds);
  });

  const move = document.createElement('div');
  move.className = 'composition-transform-move';
  move.setAttribute('role', 'button');
  move.tabIndex = 0;
  move.setAttribute('aria-label', 'Mover elemento');
  move.title = 'Arrastrar para mover';
  const rotate = transformHandle('rotate', 'Rotar elemento', '↻');
  const scale = transformHandle('scale', 'Escalar elemento', '↘');
  controls.append(move, rotate, scale);
  move.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 10;
    applyPosition(
      store,
      scene,
      liveElement(store, scene.id, element.id) ?? element,
      view.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      view.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
    );
  });
  rotate.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    applyTransformValue(
      store,
      scene,
      liveElement(store, scene.id, element.id) ?? element,
      'rotationDegrees',
      normalizeDegrees(view.rotationDegrees + (event.key === 'ArrowLeft' ? -5 : 5)),
    );
  });
  scale.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    applyTransformValue(
      store,
      scene,
      liveElement(store, scene.id, element.id) ?? element,
      'scale',
      clamp(Math.round((view.scale + (event.key === 'ArrowUp' ? 0.05 : -0.05)) * 100) / 100, 0.05, 10),
    );
  });

  bindTransformPointer(move, canvas, (event, start) => {
    const x = clamp(Math.round(start.view.x + (event.clientX - start.clientX) / start.bounds.width * 1080), -1080, 2160);
    const y = clamp(Math.round(start.view.y + (event.clientY - start.clientY) / start.bounds.height * 1920), -1920, 3840);
    const next = { ...start.view, x, y };
    paintTransform(image, controls, next, visualBounds);
    return next;
  }, (next) => applyPosition(store, scene, liveElement(store, scene.id, element.id) ?? element, next.x, next.y), view);

  bindTransformPointer(scale, canvas, (event, start) => {
    const center = canvasPoint(start.bounds, start.view.x, start.view.y);
    const initialDistance = Math.max(1, Math.hypot(start.clientX - center.x, start.clientY - center.y));
    const distance = Math.hypot(event.clientX - center.x, event.clientY - center.y);
    const next = { ...start.view, scale: clamp(Math.round(start.view.scale * distance / initialDistance * 100) / 100, 0.05, 10) };
    paintTransform(image, controls, next, visualBounds);
    return next;
  }, (next) => applyTransformValue(store, scene, liveElement(store, scene.id, element.id) ?? element, 'scale', next.scale), view);

  bindTransformPointer(rotate, canvas, (event, start) => {
    const center = canvasPoint(start.bounds, start.view.x, start.view.y);
    const initialAngle = Math.atan2(start.clientY - center.y, start.clientX - center.x);
    const angle = Math.atan2(event.clientY - center.y, event.clientX - center.x);
    const delta = (angle - initialAngle) * 180 / Math.PI;
    const next = { ...start.view, rotationDegrees: normalizeDegrees(Math.round(start.view.rotationDegrees + delta)) };
    paintTransform(image, controls, next, visualBounds);
    return next;
  }, (next) => applyTransformValue(
    store,
    scene,
    liveElement(store, scene.id, element.id) ?? element,
    'rotationDegrees',
    next.rotationDegrees,
  ), view);
  return controls;
}

type ViewTransform = ReturnType<typeof viewTransform>;

interface TransformPointerStart {
  clientX: number;
  clientY: number;
  bounds: DOMRect;
  view: ViewTransform;
}

function bindTransformPointer(
  handle: HTMLElement,
  canvas: HTMLElement,
  update: (event: PointerEvent, start: TransformPointerStart) => ViewTransform,
  commit: (view: ViewTransform) => void,
  initialView: ViewTransform,
): void {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = {
      clientX: event.clientX,
      clientY: event.clientY,
      bounds: canvas.getBoundingClientRect(),
      view: initialView,
    };
    let pending = initialView;
    const move = (moveEvent: PointerEvent): void => {
      pending = update(moveEvent, start);
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (
        pending.x === start.view.x
        && pending.y === start.view.y
        && pending.scale === start.view.scale
        && pending.rotationDegrees === start.view.rotationDegrees
      ) return;
      commit(pending);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  });
}

function transformHandle(kind: string, label: string, text: string): HTMLButtonElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = `composition-transform-handle is-${kind}`;
  handle.setAttribute('aria-label', label);
  handle.title = label;
  handle.textContent = text;
  return handle;
}

function liveElement(store: ProjectStore, sceneId: string, elementId: string): ElementView | null {
  return store.project().scenes.find((scene) => scene.id === sceneId)
    ?.elements.find((element) => element.id === elementId) ?? null;
}

function canvasPoint(bounds: DOMRect, x: number, y: number): { x: number; y: number } {
  return {
    x: bounds.left + x / 1080 * bounds.width,
    y: bounds.top + y / 1920 * bounds.height,
  };
}

function positionTransformControls(
  controls: HTMLElement,
  view: ViewTransform,
  bounds: VisualBounds,
): void {
  const localX = (bounds.x + bounds.width / 2 - 0.5) * 1080 * view.scale;
  const localY = (bounds.y + bounds.height / 2 - 0.5) * 1920 * view.scale;
  const radians = view.rotationDegrees * Math.PI / 180;
  const rotatedX = localX * Math.cos(radians) - localY * Math.sin(radians);
  const rotatedY = localX * Math.sin(radians) + localY * Math.cos(radians);
  controls.style.left = `${(view.x + rotatedX) / 10.8}%`;
  controls.style.top = `${(view.y + rotatedY) / 19.2}%`;
  controls.style.width = `${Math.max(8, bounds.width * 100 * view.scale)}%`;
  controls.style.height = `${Math.max(7, bounds.height * 100 * view.scale)}%`;
  controls.style.transform = `translate(-50%, -50%) rotate(${view.rotationDegrees}deg)`;
}

function paintTransform(
  image: HTMLElement,
  controls: HTMLElement,
  view: ViewTransform,
  bounds: VisualBounds,
): void {
  image.style.left = `${view.x / 10.8}%`;
  image.style.top = `${view.y / 19.2}%`;
  image.style.transform = `translate(-50%, -50%) rotate(${view.rotationDegrees}deg) scale(${view.scale})`;
  positionTransformControls(controls, view, bounds);
}

function visualBoundsFor(image: HTMLImageElement | HTMLElement): Promise<VisualBounds> {
  if (!(image instanceof HTMLImageElement) || !image.src) return Promise.resolve(DEFAULT_VISUAL_BOUNDS);
  const cached = visualBoundsCache.get(image.src);
  if (cached) return cached;
  const measured = new Promise<VisualBounds>((resolve) => {
    const inspect = (): void => {
      try {
        const width = 180;
        const height = 320;
        const sample = document.createElement('canvas');
        sample.width = width;
        sample.height = height;
        const context = sample.getContext('2d', { willReadFrequently: true });
        if (!context) return resolve(DEFAULT_VISUAL_BOUNDS);
        context.drawImage(image as HTMLImageElement, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        let minX = width;
        let minY = height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            if (pixels[(y * width + x) * 4 + 3] <= 8) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
        if (maxX < minX || maxY < minY) return resolve(DEFAULT_VISUAL_BOUNDS);
        const paddingX = 4 / width;
        const paddingY = 4 / height;
        const x = Math.max(0, minX / width - paddingX);
        const y = Math.max(0, minY / height - paddingY);
        resolve({
          x,
          y,
          width: Math.min(1 - x, (maxX - minX + 1) / width + paddingX * 2),
          height: Math.min(1 - y, (maxY - minY + 1) / height + paddingY * 2),
        });
      } catch {
        resolve(DEFAULT_VISUAL_BOUNDS);
      }
    };
    if ((image as HTMLImageElement).complete) inspect();
    else image.addEventListener('load', inspect, { once: true });
  });
  visualBoundsCache.set(image.src, measured);
  return measured;
}

function applyTransformValue(
  store: ProjectStore,
  scene: SceneView,
  element: ElementView,
  parameterId: 'scale' | 'rotationDegrees',
  value: number,
): void {
  if (isAnimationModeOn(scene.id, element.id)) {
    applyAnimated(store, scene, element, [{ parameterId, value }]);
    return;
  }
  store.dispatch({
    type: 'set-element-transform',
    sceneId: scene.id,
    elementId: element.id,
    [parameterId]: value,
  });
}

function normalizeDegrees(value: number): number {
  let normalized = value;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
    reportPlacement('Sin voz medida no se puede ubicar un keyframe: medí los tiempos para volver a animar en el lienzo.', true);
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
      .some((type) => [CHARACTER_DRAG_TYPE, PROP_DRAG_TYPE, TEMPLATE_DRAG_TYPE].includes(type))) return;
    event.preventDefault();
    transfer.dropEffect = 'copy';
    canvas.classList.add('is-character-drag-over');
  });
  canvas.addEventListener('dragleave', () => canvas.classList.remove('is-character-drag-over'));
  canvas.addEventListener('drop', (event) => {
    canvas.classList.remove('is-character-drag-over');
    const placement = readTemplateDrag(event.dataTransfer)
      || readPropDrag(event.dataTransfer)
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
  if (placement.type === 'template') {
    // La plantilla cubre el cuadro completo: el punto donde se soltó no importa,
    // solo la capa, que va arriba de todo lo que ya hay en la escena.
    const elementId = nextElementId(scene.id, scene.elements.map((element) => element.id), 'plantilla');
    const error = store.dispatch({
      type: 'add-template',
      sceneId: scene.id,
      elementId,
      templateId: placement.resourceId,
      word: placement.word ?? 'IDEA',
      zIndex: nextVisualZIndex(scene),
    });
    reportPlacement(error || `«${placement.label}» se agregó a la escena.`, Boolean(error));
    if (!error) finishCharacterPlacement();
    return;
  }
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

function nextElementId(sceneId: string, existing: string[], kind: 'personaje' | 'prop' | 'plantilla'): string {
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

function requestRigManifest(manifestPath: string, rerender: () => void): unknown | null {
  if (rigManifestCache.has(manifestPath)) return rigManifestCache.get(manifestPath) ?? null;
  if (loadingRigManifests.has(manifestPath)) return null;
  loadingRigManifests.add(manifestPath);
  void fetch(`/${manifestPath}`, { cache: 'force-cache' })
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    })
    .then((manifest) => {
      rigManifestCache.set(manifestPath, manifest);
      rerender();
    })
    .catch(() => {
      // La miniatura permanece como fallback si el manifest no está disponible.
    })
    .finally(() => loadingRigManifests.delete(manifestPath));
  return null;
}

async function loadBackgroundLayers(manifestPath: string): Promise<string[]> {
  try {
    const response = await fetch(`/${manifestPath}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error(String(response.status));
    const manifest = await response.json() as { layers?: Record<string, string> };
    const base = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
    return ['far', 'mid', 'front'].flatMap((key) => (
      manifest.layers?.[key] ? [`/${base}${manifest.layers[key]}`] : []
    ));
  } catch {
    return [];
  }
}

function backgroundNodes(paths: readonly string[]): HTMLElement[] {
  return paths.map((src) => {
    const image = document.createElement('img');
    image.className = 'composition-layer';
    image.src = src;
    image.alt = '';
    image.style.zIndex = '0';
    return image;
  });
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
