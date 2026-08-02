import { ANIMATION_PARAMETERS } from '../../../shared/animation-contract.js';
import {
  ANIMATION_PRESETS,
  animationPresetWindow,
  listApplicablePresets,
} from '../../../shared/animation-presets.js';
import { resolveAnchorSeconds, type SceneTiming } from '../../../shared/animation-evaluator.js';
import {
  EDITOR_PLAYBACK_EVENT,
  EDITOR_WORKSPACE_EVENT,
  editorPlayhead,
  measuredTimelineFor,
  setEditorPlayhead,
} from '../editor-workspace.js';
import { optional } from '../dom.js';
import { notify } from '../notifications.js';
import {
  buildAnimationLanes,
  clampParameterValue,
  duplicateKeyframeCommand,
  evaluateLanesAt,
  keyframeCommandsForValue,
  nearestAnchorFor,
  nextKeyframeId,
  parameterLabel,
  sceneAnimationReference,
  sceneAnimationTiming,
  type AnimationLane,
} from '../timeline-animation.js';
import { ANIMATION_MODE_EVENT, isAnimationModeOn, setAnimationMode } from './animation-mode.js';
import { setVisualLayerCommands, visualElementsByLayer, visualLayerNumber } from './layers.js';
import {
  PROJECT_SELECTION_EVENT,
  projectSelection,
  selectProjectItem,
  type ProjectSelection,
} from './selection.js';
import type { ProjectStore } from './store.js';
import type { ElementView, SceneView, TrackView } from './types.js';

interface AnimationScope {
  timing: SceneTiming | null;
  reference: ReturnType<typeof sceneAnimationReference>;
  fps: number;
}

interface PlayheadReference {
  available: boolean;
  label: string;
  detail: string;
}

type AnimationIntensity = 'soft' | 'medium' | 'strong';

export type EditingSubpage =
  | 'scene'
  | 'background'
  | 'transition'
  | 'dialogue'
  | 'performance'
  | 'adjustments'
  | 'create-animation'
  | 'tracks';

interface EditingSubpageOption {
  id: EditingSubpage;
  label: string;
}

const EDITING_SUBPAGE_EVENT = 'local-video:editing-subpage';

export function showEditingSubpage(page: EditingSubpage): void {
  window.dispatchEvent(new CustomEvent(EDITING_SUBPAGE_EVENT, { detail: page }));
}

/**
 * U2: mando manual contextual del panel derecho.
 *
 * No conserva un modelo propio. Lee selección, cabezal y medición compartidos y
 * escribe únicamente mediante los comandos semánticos del ProjectStore.
 */
export function initEditingPanel(store: ProjectStore): void {
  const host = optional<HTMLElement>('#editing-tool-host');
  if (!host) return;
  const toolHost = host;

  let localMessage: { text: string; error: boolean } | null = null;
  let activeSubpage: EditingSubpage = 'adjustments';
  let selectionIdentity = '';
  let animationIntensity: AnimationIntensity = 'medium';

  const report = (message: string | null, ok = false): boolean => {
    const visibleMessage = message && !ok ? friendlyEditingError(message) : message;
    localMessage = visibleMessage ? { text: visibleMessage, error: !ok } : null;
    if (visibleMessage && !ok) notify({ message: visibleMessage, level: 'error' });
    render();
    return message === null;
  };
  const send = (command: Record<string, unknown>): boolean => report(store.dispatch(command));
  const sendBatch = (commands: Array<Record<string, unknown>>): boolean => {
    if (commands.length === 0) {
      report('Ya existe un keyframe con ese valor en el cabezal.', true);
      return false;
    }
    return report(store.dispatchBatch(commands));
  };

  function animationScope(scene: SceneView): AnimationScope {
    const project = store.project();
    const measured = measuredTimelineFor(project.scenes.map((item) => item.id));
    const reference = sceneAnimationReference(scene.dialogue);
    return {
      timing: sceneAnimationTiming(measured?.scenes.find((item) => item.id === scene.id) ?? null, reference),
      reference,
      fps: project.video?.fps ?? 30,
    };
  }

  function render(): void {
    const selection = projectSelection();
    toolHost.dataset.selectionKind = selection?.kind ?? 'none';

    const nodes: HTMLElement[] = [];
    if (localMessage) nodes.push(statusMessage(localMessage.text, localMessage.error));
    if (!selection) {
      nodes.push(emptyState('Seleccioná una escena, diálogo, elemento o keyframe en el visor o la timeline.'));
    } else {
      const identity = editingSelectionIdentity(selection);
      const pages = editingSubpages(selection);
      if (identity !== selectionIdentity) {
        selectionIdentity = identity;
        activeSubpage = defaultEditingSubpage(selection);
        animationIntensity = 'medium';
      }
      if (!pages.some((page) => page.id === activeSubpage)) activeSubpage = pages[0].id;
      nodes.push(subpageNavigation(pages));
      if (selection.kind === 'scene') {
        nodes.push(sceneEditor(selection, activeSubpage));
      } else if (selection.kind === 'dialogue') {
        nodes.push(dialogueEditor(selection, activeSubpage));
      } else {
        nodes.push(elementEditor(selection, activeSubpage));
      }
    }
    toolHost.replaceChildren(...nodes);
  }

  function subpageNavigation(pages: EditingSubpageOption[]): HTMLElement {
    const navigation = document.createElement('div');
    navigation.className = 'editing-subpage-tabs';
    navigation.dataset.editingSubnav = 'true';
    navigation.setAttribute('role', 'tablist');
    navigation.setAttribute('aria-label', 'Secciones de edición');
    const buttons = pages.map((page) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'editing-subpage-tab';
      button.textContent = page.label;
      button.dataset.editingSubpage = page.id;
      button.setAttribute('role', 'tab');
      const selected = page.id === activeSubpage;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.addEventListener('click', () => {
        activeSubpage = page.id;
        render();
      });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const current = pages.findIndex((entry) => entry.id === activeSubpage);
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        activeSubpage = pages[(current + direction + pages.length) % pages.length].id;
        render();
        requestAnimationFrame(() => {
          toolHost.querySelector<HTMLButtonElement>(`[data-editing-subpage="${activeSubpage}"]`)?.focus();
        });
      });
      return button;
    });
    navigation.append(...buttons);
    return navigation;
  }

  function sceneEditor(
    selection: Extract<ProjectSelection, { kind: 'scene' }>,
    page: EditingSubpage,
  ): HTMLElement {
    const scene = store.project().scenes.find((item) => item.id === selection.sceneId);
    if (!scene) return emptyState('La escena seleccionada ya no existe.');
    if (page === 'background') return sceneBackgroundEditor(scene);
    if (page === 'transition') return sceneTransitionEditor(scene);
    const card = editingCard('Escena', scene.title);
    card.dataset.inspectorScene = scene.id;
    const titleInput = input('text', scene.title, { maxLength: 120 });
    titleInput.addEventListener('change', () => {
      const value = titleInput.value.trim();
      if (value) send({ type: 'set-scene-title', sceneId: scene.id, title: value });
    });
    card.append(compactFieldRow('Título', titleInput, 'wide'));
    card.append(contextNote('Ordenar, duplicar, dividir y eliminar escenas corresponde a la timeline. Acá se ajustan sus propiedades.'));
    return card;
  }

  function sceneBackgroundEditor(scene: SceneView): HTMLElement {
    const card = editingCard('Fondo y cámara', scene.title);
    const backgrounds = store.resources('background');
    const current = backgrounds.find((item) => item.id === scene.background.resourceId);
    const background = select(
      backgrounds.map((item) => ({ value: item.id, label: item.label })),
      scene.background.resourceId,
    );
    const camera = select(
      (readStringCapability(current?.capabilities, 'cameraPresets').length > 0
        ? readStringCapability(current?.capabilities, 'cameraPresets')
        : [scene.background.cameraPreset])
        .map((value) => ({ value, label: readableOption(value) })),
      scene.background.cameraPreset,
    );
    background.addEventListener('change', () => {
      const resource = backgrounds.find((item) => item.id === background.value);
      const presets = readStringCapability(resource?.capabilities, 'cameraPresets');
      send({
        type: 'set-scene-background',
        sceneId: scene.id,
        resourceId: background.value,
        cameraPreset: presets.includes(scene.background.cameraPreset)
          ? scene.background.cameraPreset
          : (presets[0] ?? scene.background.cameraPreset),
      });
    });
    camera.addEventListener('change', () => send({
      type: 'set-scene-background',
      sceneId: scene.id,
      resourceId: scene.background.resourceId,
      cameraPreset: camera.value,
    }));
    card.append(
      compactFieldRow('Fondo', background, 'wide'),
      compactFieldRow('Cámara', camera, 'wide'),
    );
    return card;
  }

  function sceneTransitionEditor(scene: SceneView): HTMLElement {
    const project = store.project();
    const index = project.scenes.findIndex((item) => item.id === scene.id);
    const card = editingCard('Salida de escena', scene.title);
    if (index < 0 || index === project.scenes.length - 1) {
      card.append(contextNote('La última escena termina el video y no tiene transición de salida.'));
      return card;
    }
    const preset = select([
      { value: 'cut', label: 'Corte' },
      { value: 'fade', label: 'Fundido' },
    ], scene.transitionToNext?.preset ?? 'cut');
    const duration = compactNumberInput(scene.transitionToNext?.durationSeconds ?? 0, {
      min: 0, max: 2, step: 0.05,
    });
    const sync = (): void => {
      const isCut = preset.value === 'cut';
      duration.disabled = isCut;
      if (isCut) duration.value = '0';
    };
    const apply = (): void => {
      sync();
      send({
        type: 'set-transition',
        sceneId: scene.id,
        preset: preset.value,
        durationSeconds: Number(duration.value),
      });
    };
    sync();
    preset.addEventListener('change', apply);
    duration.addEventListener('change', apply);
    card.append(
      compactFieldRow('Tipo', preset),
      compactFieldRow('Duración', duration, 'number', 's'),
    );
    return card;
  }

  function dialogueEditor(
    selection: Extract<ProjectSelection, { kind: 'dialogue' }>,
    page: EditingSubpage,
  ): HTMLElement {
    const scene = store.project().scenes.find((item) => item.id === selection.sceneId);
    const turn = scene?.dialogue.find((item) => item.id === selection.turnId);
    if (!scene || !turn) return emptyState('El diálogo seleccionado ya no existe.');
    const index = scene.dialogue.findIndex((item) => item.id === turn.id);
    const card = editingCard(page === 'performance' ? 'Interpretación' : `Diálogo ${index + 1}`, scene.title);
    card.dataset.inspectorTurn = turn.id;

    if (page === 'performance') {
      const characters = scene.elements.filter((item) => item.type === 'character');
      const speaker = select(
        characters.map((item, speakerIndex) => ({
          value: item.id,
          label: resourceLabel(store, item, `Personaje ${speakerIndex + 1}`),
        })),
        turn.speakerElementId,
      );
      const speakerElement = characters.find((item) => item.id === turn.speakerElementId);
      const speakerResource = store.resources('character')
        .find((item) => item.id === speakerElement?.resourceId);
      const gestures = readStringCapability(speakerResource?.capabilities, 'poses');
      const gesture = select(
        gestures.map((value) => ({ value, label: readableOption(value) })),
        turn.gestureId,
      );
      const voice = select(
        store.resources('voice').map((item) => ({ value: item.id, label: item.label })),
        turn.voiceId,
      );
      const gap = compactNumberInput(turn.gapAfterSeconds, { min: 0, max: 5, step: 0.05 });
      speaker.addEventListener('change', () => {
        const nextElement = characters.find((item) => item.id === speaker.value);
        const nextResource = store.resources('character').find((item) => item.id === nextElement?.resourceId);
        const nextGestures = readStringCapability(nextResource?.capabilities, 'poses');
        const commands: Array<Record<string, unknown>> = [{
          type: 'set-dialogue-speaker',
          sceneId: scene.id,
          turnId: turn.id,
          speakerElementId: speaker.value,
        }];
        if (!nextGestures.includes(turn.gestureId) && nextGestures[0]) {
          commands.push({
            type: 'set-dialogue-turn',
            sceneId: scene.id,
            turnId: turn.id,
            gestureId: nextGestures[0],
          });
        }
        if (commands.length === 1) send(commands[0]);
        else sendBatch(commands);
      });
      gesture.addEventListener('change', () => send({
        type: 'set-dialogue-turn',
        sceneId: scene.id,
        turnId: turn.id,
        gestureId: gesture.value,
      }));
      voice.addEventListener('change', () => send({
        type: 'set-dialogue-turn',
        sceneId: scene.id,
        turnId: turn.id,
        voiceId: voice.value,
      }));
      gap.addEventListener('change', () => send({
        type: 'set-dialogue-turn',
        sceneId: scene.id,
        turnId: turn.id,
        gapAfterSeconds: Number(gap.value),
      }));
      card.append(
        compactFieldRow('Personaje', speaker, 'wide'),
        compactFieldRow('Voz', voice, 'wide'),
        compactFieldRow('Gesto', gesture, 'wide'),
        compactFieldRow('Pausa', gap, 'number', 's'),
      );
      return card;
    }

    const text = document.createElement('textarea');
    text.rows = Math.min(12, Math.max(3, Math.ceil(turn.text.length / 34)));
    text.maxLength = 500;
    text.value = turn.text;
    text.addEventListener('change', () => {
      const value = text.value.trim();
      if (value) send({ type: 'set-dialogue-turn', sceneId: scene.id, turnId: turn.id, text: value });
    });
    card.append(field('Texto y subtítulo', text));
    card.append(contextNote('Mover, dividir o borrar este turno corresponde a la timeline.'));
    return card;
  }

  function elementEditor(
    selection: Extract<ProjectSelection, { kind: 'element' | 'keyframe' }>,
    page: EditingSubpage,
  ): HTMLElement {
    const scene = store.project().scenes.find((item) => item.id === selection.sceneId);
    const element = scene?.elements.find((item) => item.id === selection.elementId);
    if (!scene || !element) return emptyState('El elemento seleccionado ya no existe.');
    const container = document.createElement('div');
    container.className = 'editing-tool-stack';
    container.dataset.inspectorElement = element.id;
    // Una plantilla resuelve su propio ciclo: no tiene pistas ni transformaciones
    // editables, así que su única página es la palabra que compone.
    if (element.type === 'template') {
      container.append(templateElementEditor(scene, element));
      return container;
    }
    if (page === 'adjustments') {
      container.append(baseElementEditor(scene, element));
    } else if (page === 'create-animation') {
      container.append(animationCreationEditor(scene, element));
    } else {
      if (selection.kind === 'keyframe') {
        const keyframe = keyframeEditor(scene, element, selection);
        if (keyframe) container.append(keyframe);
      }
      container.append(tracksEditor(scene, element));
    }
    return container;
  }

  function templateElementEditor(scene: SceneView, element: ElementView): HTMLElement {
    const resource = store.resources('template').find((item) => item.id === element.templateId);
    const card = editingCard('Plantilla', resource?.label ?? element.templateId ?? element.id);
    const word = document.createElement('input');
    word.type = 'text';
    word.value = element.values?.word ?? '';
    word.maxLength = 24;
    word.autocomplete = 'off';
    word.addEventListener('change', () => {
      const value = word.value.trim();
      if (!value) {
        word.value = element.values?.word ?? '';
        return;
      }
      send({ type: 'set-template-word', sceneId: scene.id, elementId: element.id, word: value });
    });
    card.append(field('Palabra destacada', word));
    card.append(layerOrderField(scene, element));
    card.append(contextNote(
      'El efecto ocupa el cuadro completo y repite su ciclo mientras dura la escena. '
      + 'Para quitarlo, borralo desde la timeline.',
    ));
    return card;
  }

  function baseElementEditor(scene: SceneView, element: ElementView): HTMLElement {
    const card = editingCard(element.type === 'prop' ? 'Prop' : 'Elemento', element.resourceId || element.id);
    const resourceType = element.type === 'prop' ? 'prop' : 'character';
    const resources = store.resources(resourceType);
    const scope = animationScope(scene);
    const lanes = buildAnimationLanes(element.id, element.tracks ?? [], scope);
    const animatedValues = evaluateLanesAt(lanes, editorPlayhead());
    const resource = select(resources.map((item) => ({ value: item.id, label: item.label })), element.resourceId ?? '');
    resource.addEventListener('change', () => send({
      type: element.type === 'prop' ? 'set-prop-resource' : 'set-character-resource',
      sceneId: scene.id,
      elementId: element.id,
      resourceId: resource.value,
    }));
    card.append(compactFieldRow('Recurso', resource, 'wide'));
    if (element.type === 'character') {
      const selectedResource = resources.find((item) => item.id === element.resourceId);
      const movementPresets = readStringCapability(selectedResource?.capabilities, 'animationPresets');
      if (movementPresets.length > 0) {
        const movement = select(movementPresets.map((value) => ({
          value,
          label: value === 'idle-calm' ? 'Reposo suave' : value === 'talk-calm' ? 'Habla suave' : value,
        })), element.animationPreset ?? movementPresets[0]);
        movement.addEventListener('change', () => send({
          type: 'set-character-animation',
          sceneId: scene.id,
          elementId: element.id,
          animationPreset: movement.value,
        }));
        card.append(compactFieldRow('Movimiento', movement, 'wide'));
      }
    }
    card.append(
      transformField(scene, element, 'x', 'position.x', 'X', -1080, 2160, 1, scope, lanes, animatedValues),
      transformField(scene, element, 'y', 'position.y', 'Y', -1920, 3840, 1, scope, lanes, animatedValues),
      transformField(scene, element, 'scale', 'scale', 'Escala', 0.01, 10, 0.01, scope, lanes, animatedValues),
      transformField(scene, element, 'rotationDegrees', 'rotationDegrees', 'Rotación', -180, 180, 1, scope, lanes, animatedValues),
      opacityField(scene, element, scope, lanes, animatedValues),
    );
    const selectedResource = resources.find((item) => item.id === element.resourceId);
    const articulatedParameters = readStringCapability(selectedResource?.capabilities, 'parameters')
      .filter((parameterId) => ANIMATION_PARAMETERS[parameterId]?.requiresResourceSupport);
    if (articulatedParameters.length > 0) {
      const articulation = document.createElement('section');
      articulation.className = 'editing-articulation';
      const title = document.createElement('strong');
      title.textContent = 'Articulaciones';
      articulation.append(title, ...articulatedParameters.map((parameterId) => (
        articulatedField(scene, element, parameterId, scope, lanes, animatedValues)
      )));
      card.append(articulation);
    }
    card.append(layerOrderField(scene, element));
    return card;
  }

  function transformField(
    scene: SceneView,
    element: ElementView,
    key: 'x' | 'y' | 'scale' | 'rotationDegrees',
    parameterId: string,
    label: string,
    minimum: number,
    maximum: number,
    step: number,
    scope: AnimationScope,
    lanes: AnimationLane[],
    animatedValues: Record<string, number>,
  ): HTMLElement {
    const control = compactNumberInput(animatedValues[parameterId] ?? element.transform[key], {
      min: minimum, max: maximum, step,
    });
    const lane = lanes.find((item) => item.parameterId === parameterId) ?? null;
    const reference = describePlayheadReference(scope);
    if (lane && !reference.available) {
      control.disabled = true;
      control.title = reference.detail;
    }
    const commit = (): void => {
      if (control.value === '' || !Number.isFinite(Number(control.value))) return;
      if (lane) {
        setKeyframedValue(scene, element, parameterId, Number(control.value), lane, scope);
        return;
      }
      send({
        type: 'set-element-transform',
        sceneId: scene.id,
        elementId: element.id,
        [key]: Number(control.value),
      });
    };
    control.addEventListener('change', commit);
    control.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      commit();
      control.blur();
    });
    return keyframedField(scene, element, parameterId, label, control, lane, scope);
  }

  function opacityField(
    scene: SceneView,
    element: ElementView,
    scope: AnimationScope,
    lanes: AnimationLane[],
    animatedValues: Record<string, number>,
  ): HTMLElement {
    const opacityTrack = (element.tracks ?? []).find((track) => track.parameterId === 'opacity');
    const constantTrack = opacityTrack && isConstantSceneOpacityTrack(opacityTrack) ? opacityTrack : null;
    const lane = lanes.find((item) => item.parameterId === 'opacity') ?? null;
    const reference = describePlayheadReference(scope);
    const initialOpacity = animatedValues.opacity ?? constantTrack?.keyframes[0]?.value ?? element.transform.opacity;
    const control = compactNumberInput(initialOpacity * 100, { min: 0, max: 100, step: 0.01 });
    if (lane && !reference.available) {
      control.disabled = true;
      control.title = reference.detail;
    }
    const paint = (): void => {
      const percent = Number(control.value);
      const preview = document.querySelector<HTMLElement>(
        `.composition-character[data-element-id="${CSS.escape(element.id)}"]`,
      );
      if (preview) preview.style.opacity = String(percent / 100);
    };
    control.addEventListener('input', paint);
    control.addEventListener('change', () => {
      const opacity = Number(control.value) / 100;
      if (lane) {
        setKeyframedValue(scene, element, 'opacity', opacity, lane, scope);
        return;
      }
      if (element.type === 'character') {
        const commands = constantCharacterOpacityCommands(scene, element, opacity);
        if (commands.length > 0) report(store.dispatchBatch(commands));
      } else {
        send({
          type: 'set-element-transform',
          sceneId: scene.id,
          elementId: element.id,
          opacity,
        });
      }
    });
    paint();
    return keyframedField(scene, element, 'opacity', 'Opacidad', control, lane, scope, initialOpacity, '%');
  }

  function articulatedField(
    scene: SceneView,
    element: ElementView,
    parameterId: string,
    scope: AnimationScope,
    lanes: AnimationLane[],
    animatedValues: Record<string, number>,
  ): HTMLElement {
    const parameter = ANIMATION_PARAMETERS[parameterId];
    const lane = lanes.find((item) => item.parameterId === parameterId) ?? null;
    const current = animatedValues[parameterId] ?? lane?.keyframes[0]?.value ?? 0;
    const reference = describePlayheadReference(scope);
    const control = compactNumberInput(current, {
      min: parameter.exclusiveMinimum ?? parameter.minimum,
      max: parameter.maximum,
      step: 0.01,
    });
    control.disabled = !reference.available;
    control.title = reference.available ? '' : reference.detail;
    control.addEventListener('change', () => {
      if (reference.available) setKeyframedValue(scene, element, parameterId, Number(control.value), lane, scope);
    });
    return keyframedField(scene, element, parameterId, parameterLabel(parameterId), control, lane, scope, current);
  }

  function setKeyframedValue(
    scene: SceneView,
    element: ElementView,
    parameterId: string,
    value: number,
    lane: AnimationLane | null,
    scope: AnimationScope,
  ): boolean {
    if (!scope.timing || !describePlayheadReference(scope).available) return false;
    const commands = keyframeCommandsForValue({
      sceneId: scene.id,
      elementId: element.id,
      parameterId,
      value: clampParameterValue(parameterId, value),
      playheadSeconds: editorPlayhead(),
      lane,
      timing: scope.timing,
      fps: scope.fps,
      takenKeyframeIds: (element.tracks ?? []).flatMap((track) => track.keyframes.map((item) => item.id)),
    });
    return sendBatch(commands);
  }

  function keyframedField(
    scene: SceneView,
    element: ElementView,
    parameterId: string,
    label: string,
    control: HTMLElement,
    lane: AnimationLane | null,
    scope: AnimationScope,
    currentValue?: number,
    suffix?: string,
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'keyframed-field';
    const text = document.createElement('span');
    text.className = 'compact-field-label';
    text.textContent = label;
    const controlSlot = document.createElement('div');
    controlSlot.className = 'compact-field-control is-number';
    control.classList.add('compact-value-control');
    controlSlot.append(control);
    if (suffix) {
      const unit = document.createElement('span');
      unit.className = 'compact-field-unit';
      unit.textContent = suffix;
      controlSlot.append(unit);
    }
    const navigation = document.createElement('div');
    navigation.className = 'keyframe-property-actions';
    const playhead = editorPlayhead();
    const reference = describePlayheadReference(scope);
    const tolerance = 0.5 / scope.fps;
    const resolved = lane?.keyframes.filter((item) => item.seconds !== null) ?? [];
    const exact = resolved.find((item) => Math.abs((item.seconds as number) - playhead) <= tolerance) ?? null;
    const previous = [...resolved].reverse()
      .find((item) => (item.seconds as number) < playhead - tolerance) ?? null;
    const next = resolved.find((item) => (item.seconds as number) > playhead + tolerance) ?? null;
    const jump = (
      direction: 'anterior' | 'siguiente',
      target: AnimationLane['keyframes'][number] | null,
    ): HTMLButtonElement => {
      const button = actionButton(direction === 'anterior' ? '‹' : '›', () => {
        if (target?.seconds !== null && target?.seconds !== undefined) setEditorPlayhead(target.seconds);
      });
      button.className = 'keyframe-jump-button';
      button.disabled = !target;
      button.setAttribute('aria-label', `Keyframe ${direction} de ${label}`);
      return button;
    };
    const diamond = actionButton(exact ? '◆' : '◇', () => {
      if (exact) {
        send({
          type: 'delete-keyframe',
          sceneId: scene.id,
          elementId: element.id,
          parameterId,
          keyframeId: exact.id,
        });
        return;
      }
      const value = currentValue ?? Number((control as HTMLInputElement).value);
      setKeyframedValue(scene, element, parameterId, value, lane, scope);
    });
    diamond.className = `keyframe-diamond-button${exact ? ' is-active' : ''}`;
    diamond.disabled = !reference.available;
    diamond.setAttribute('aria-label', exact
      ? `Eliminar keyframe de ${label} en el cabezal`
      : `Agregar keyframe de ${label} en el cabezal`);
    diamond.title = reference.available
      ? (exact ? 'Keyframe activo en el cabezal. Clic para eliminarlo.' : 'Agregar un keyframe exactamente en el cabezal.')
      : reference.detail;
    navigation.append(jump('anterior', previous), diamond, jump('siguiente', next));
    wrapper.append(text, controlSlot, navigation);
    return wrapper;
  }

  function layerOrderField(scene: SceneView, element: ElementView): HTMLElement {
    const layer = visualLayerNumber(scene, element.id);
    const total = visualElementsByLayer(scene).length;
    const section = document.createElement('section');
    section.className = 'editing-layer-order';
    const control = compactNumberInput(layer ?? 1, {
      min: 1,
      max: Math.max(1, total),
      step: 1,
    });
    control.addEventListener('input', () => {
      if (control.value === '') return;
      const commands = setVisualLayerCommands(scene, element.id, Number(control.value));
      if (commands.length > 0) report(store.dispatchBatch(commands));
    });
    const hint = document.createElement('small');
    hint.textContent = 'Fondo: capa 0 · el número más alto queda encima.';
    section.append(compactFieldRow('Capa', control, 'number'), hint);
    return section;
  }

  function animationCreationEditor(scene: SceneView, element: ElementView): HTMLElement {
    const scope = animationScope(scene);
    const lanes = buildAnimationLanes(element.id, element.tracks ?? [], scope);
    const resource = store.resources(element.type === 'prop' ? 'prop' : 'character')
      .find((item) => item.id === element.resourceId);
    const declared = readStringCapability(resource?.capabilities, 'parameters');
    const card = editingCard('Crear animación', element.resourceId || element.id);
    const reference = describePlayheadReference(scope);
    card.append(playheadCard(reference));

    const presetSection = animationSection(
      'Animaciones prediseñadas',
      'Elegí un efecto completo. Se aplicará tomando el cabezal como referencia exacta.',
    );
    const intensity = select([
      { value: 'soft', label: 'Suave' },
      { value: 'medium', label: 'Media' },
      { value: 'strong', label: 'Fuerte' },
    ], animationIntensity);
    intensity.addEventListener('change', () => {
      animationIntensity = intensity.value as AnimationIntensity;
      render();
    });
    presetSection.append(compactFieldRow('Intensidad', intensity, 'wide'));

    const applicable = listApplicablePresets(declared);
    const categories = [
      { label: 'Entradas', ids: ['enter-left', 'enter-right'] },
      { label: 'Visibilidad', ids: ['fade-in', 'fade-out'] },
      { label: 'Énfasis', ids: ['emphasis-pulse'] },
      {
        label: 'Cuerpo y articulaciones',
        ids: [
          'arm-raise', 'left-arm-raise', 'right-elbow-bend', 'left-elbow-bend',
          'head-tilt', 'head-nod', 'body-lean', 'body-bounce',
        ],
      },
    ];
    const protectedParameters = new Map<string, AnimationLane>();
    for (const category of categories) {
      const entries = applicable.filter((preset) => category.ids.includes(preset.id));
      if (entries.length === 0) continue;
      const group = document.createElement('section');
      group.className = 'animation-preset-group';
      const title = document.createElement('strong');
      title.textContent = category.label;
      const options = document.createElement('div');
      options.className = 'animation-preset-grid';
      for (const preset of entries) {
        const definition = ANIMATION_PRESETS[preset.id];
        const lane = lanes.find((item) => item.parameterId === preset.parameterId) ?? null;
        const protectedLane = lane && (lane.sourceLabel === 'manual' || lane.customized) ? lane : null;
        if (protectedLane) protectedParameters.set(preset.parameterId, protectedLane);
        const placement = presetPlacement(scope, preset.id, animationIntensity);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'animation-preset';
        button.classList.toggle(
          'is-applied',
          lane?.sourceLabel === preset.id && !lane.customized,
        );
        button.setAttribute('aria-label', `Aplicar ${preset.label}`);
        const name = document.createElement('strong');
        name.textContent = preset.label;
        const detail = document.createElement('span');
        const window = animationPresetWindow(preset.id, animationIntensity);
        detail.textContent = `${parameterLabel(preset.parameterId)} · ${formatDuration(window.endOffsetSeconds - window.startOffsetSeconds)}`;
        button.append(name, detail);
        button.disabled = Boolean(protectedLane) || !placement.allowed;
        button.title = protectedLane
          ? `${parameterLabel(preset.parameterId)} ya tiene una pista manual o editada. Abrila en Pistas para decidir qué conservar.`
          : placement.reason;
        button.addEventListener('click', () => {
          if (!scope.timing || !placement.allowed || !placement.proposal) return;
          const applied = send({
            type: 'apply-animation-preset',
            sceneId: scene.id,
            elementId: element.id,
            presetId: preset.id,
            anchor: placement.proposal.anchor,
            offsetSeconds: placement.proposal.offsetSeconds,
            intensity: animationIntensity,
          });
          if (applied) {
            report(
              `${preset.label} aplicada en ${formatSeconds(editorPlayhead())} · ${definition.steps.length} keyframes.`,
              true,
            );
          }
        });
        options.append(button);
      }
      group.append(title, options);
      presetSection.append(group);
    }
    for (const [parameterId] of protectedParameters) {
      const conflict = document.createElement('div');
      conflict.className = 'animation-preset-conflict';
      const text = document.createElement('span');
      text.textContent = `${parameterLabel(parameterId)} ya tiene una pista manual o editada.`;
      const open = actionButton('Abrir Pistas', () => {
        activeSubpage = 'tracks';
        render();
      });
      conflict.append(text, open);
      presetSection.append(conflict);
    }
    card.append(presetSection);

    const animating = isAnimationModeOn(scene.id, element.id);
    const mouseSection = animationSection(
      'Animar con el mouse',
      'Mover, escalar o rotar el elemento escribe keyframes en el cabezal sin cambiar su posición base.',
    );
    const canvasMode = actionButton(
      animating ? '◆ Animación con mouse activa' : 'Activar animación con mouse',
      () => setAnimationMode(animating ? null : { sceneId: scene.id, elementId: element.id }),
    );
    canvasMode.className = 'animation-mode-toggle';
    canvasMode.classList.toggle('is-active', animating);
    canvasMode.disabled = !animating && !reference.available;
    canvasMode.title = canvasMode.disabled ? reference.detail : (animating
      ? 'Volver a editar la posición base.'
      : 'Mover, escalar o rotar escribirá keyframes en la posición actual.');
    mouseSection.append(canvasMode);
    card.append(mouseSection);

    const manualSection = animationSection(
      'Edición manual',
      'Para crear un punto manual, abrí Ajustes y pulsá el rombo de la propiedad que quieras animar.',
    );
    const openAdjustments = actionButton('Ir a Ajustes', () => {
      activeSubpage = 'adjustments';
      render();
    });
    openAdjustments.className = 'full-button';
    manualSection.append(openAdjustments);
    card.append(manualSection);
    return card;
  }

  function tracksEditor(scene: SceneView, element: ElementView): HTMLElement {
    const scope = animationScope(scene);
    const lanes = buildAnimationLanes(element.id, element.tracks ?? [], scope);
    const card = editingCard('Pistas', element.resourceId || element.id);
    if (lanes.length === 0) {
      card.append(contextNote(
        'Sin pistas. Aplicá una animación prediseñada o abrí Ajustes y pulsá el rombo de una propiedad.',
      ));
      return card;
    }
    for (const lane of lanes) {
      const group = document.createElement('div');
      group.className = 'editing-track-group';
      group.append(trackRow(scene, element, lane), keyframePicker(scene, element, lane));
      card.append(group);
    }
    return card;
  }

  function keyframePicker(scene: SceneView, element: ElementView, lane: AnimationLane): HTMLElement {
    const list = document.createElement('div');
    list.className = 'editing-keyframe-list';
    list.setAttribute('aria-label', `Keyframes de ${lane.label}`);
    const selection = projectSelection();
    for (const [index, keyframe] of lane.keyframes.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'editing-keyframe-item';
      button.classList.toggle(
        'is-active',
        selection?.kind === 'keyframe'
          && selection.elementId === element.id
          && selection.parameterId === lane.parameterId
          && selection.keyframeId === keyframe.id,
      );
      const name = document.createElement('strong');
      name.textContent = `${index + 1}. ${keyframe.anchorLabel}`;
      const detail = document.createElement('span');
      detail.textContent = `${keyframe.valueLabel} · ${keyframe.timeLabel}`;
      button.append(name, detail);
      button.addEventListener('click', () => selectProjectItem({
        kind: 'keyframe',
        sceneId: scene.id,
        elementId: element.id,
        parameterId: lane.parameterId,
        keyframeId: keyframe.id,
      }));
      list.append(button);
    }
    return list;
  }

  function keyframeEditor(
    scene: SceneView,
    element: ElementView,
    selection: Extract<ProjectSelection, { kind: 'keyframe' }>,
  ): HTMLElement | null {
    const scope = animationScope(scene);
    const lane = buildAnimationLanes(element.id, element.tracks ?? [], scope)
      .find((item) => item.parameterId === selection.parameterId);
    const keyframe = lane?.keyframes.find((item) => item.id === selection.keyframeId);
    if (!lane || !keyframe) return null;
    const edit = (patch: Record<string, unknown>): boolean => send({
      type: 'set-keyframe', sceneId: scene.id, elementId: element.id,
      parameterId: lane.parameterId, keyframeId: keyframe.id, ...patch,
    });
    const card = editingCard('Keyframe seleccionado', `${lane.label} · ${keyframe.valueLabel}`);
    card.classList.add('keyframe-card');
    card.dataset.inspectorKeyframe = keyframe.id;
    const parameter = ANIMATION_PARAMETERS[lane.parameterId];
    const value = compactNumberInput(keyframe.value, {
      min: parameter?.exclusiveMinimum ?? parameter?.minimum ?? 0,
      max: parameter?.maximum ?? 1,
      step: lane.parameterId === 'position.x' || lane.parameterId === 'position.y' ? 1 : 0.01,
    });
    value.addEventListener('change', () => edit({ value: clampParameterValue(lane.parameterId, Number(value.value)) }));
    const offset = compactNumberInput(keyframe.offsetSeconds, { min: -5, max: 5, step: 0.05 });
    offset.addEventListener('change', () => edit({ offsetSeconds: Number(offset.value) }));
    const interpolation = select([
      { value: 'linear', label: 'Lineal' },
      { value: 'ease', label: 'Suave' },
      { value: 'hold', label: 'Mantener' },
    ], keyframe.interpolation);
    interpolation.addEventListener('change', () => edit({ interpolation: interpolation.value }));
    card.append(
      compactFieldRow('Valor', value, 'number'),
      compactFieldRow('Desplazamiento', offset, 'number', 's'),
      compactFieldRow('Interpolación', interpolation, 'wide'),
    );
    card.append(
      readOnlyRow('Ancla', keyframe.anchorLabel),
      readOnlyRow('Tiempo', keyframe.timeLabel),
      readOnlyRow('Origen', lane.sourceLabel === 'manual' ? 'pista manual' : `preset ${lane.sourceLabel}`),
      readOnlyRow('Estado', keyframe.status === 'ok' ? 'Normal' : `⚠ ${keyframe.message ?? 'Requiere revisión'}`),
    );
    const actions = document.createElement('div');
    actions.className = 'animation-actions';
    const reanchor = actionButton('Usar posición del cabezal', () => {
      if (!scope.timing || !isPlayheadInside(scope.timing)) return;
      const proposal = nearestAnchorFor(editorPlayhead(), scope.timing, scope.fps);
      edit({ anchor: proposal.anchor, offsetSeconds: proposal.offsetSeconds });
    });
    reanchor.disabled = !scope.timing || !isPlayheadInside(scope.timing);
    reanchor.title = reanchor.disabled ? 'El cabezal debe estar dentro de esta escena medida.' : 'Mueve este keyframe a la línea del cabezal.';
    actions.append(reanchor);
    actions.append(actionButton('Duplicar', () => {
      const command = duplicateKeyframeCommand({
        sceneId: scene.id, elementId: element.id, parameterId: lane.parameterId, keyframe,
        takenKeyframeIds: (element.tracks ?? []).flatMap((track) => track.keyframes.map((item) => item.id)),
        fps: scope.fps,
      });
      if (!send(command)) return;
      selectProjectItem({
        kind: 'keyframe', sceneId: scene.id, elementId: element.id,
        parameterId: lane.parameterId, keyframeId: String(command.keyframeId),
      });
    }));
    actions.append(actionButton('Eliminar', () => {
      if (!send({
        type: 'delete-keyframe', sceneId: scene.id, elementId: element.id,
        parameterId: lane.parameterId, keyframeId: keyframe.id,
      })) return;
      selectProjectItem({ kind: 'element', sceneId: scene.id, elementId: element.id });
    }, true));
    card.append(actions);
    return card;
  }

  function trackRow(scene: SceneView, element: ElementView, lane: AnimationLane): HTMLElement {
    const row = document.createElement('div');
    row.className = 'animation-track-row';
    const name = document.createElement('span');
    name.className = 'animation-track-name';
    name.textContent = `${lane.label} · ${lane.sourceLabel}`;
    const count = document.createElement('span');
    count.className = 'animation-track-count';
    count.textContent = lane.reviewCount > 0 ? `${lane.keyframes.length} kf · ⚠ ${lane.reviewCount}` : `${lane.keyframes.length} kf`;
    const remove = actionButton('Eliminar pista', () => send({
      type: 'delete-track', sceneId: scene.id, elementId: element.id, parameterId: lane.parameterId,
    }), true);
    row.append(name, count, remove);
    return row;
  }

  function describePlayheadReference(scope: AnimationScope): PlayheadReference {
    if (!scope.timing) return {
      available: false,
      label: 'Cabezal sin medición',
      detail: 'Medí las voces para ubicar keyframes con tiempos reales, sin exportar un video.',
    };
    if (!isPlayheadInside(scope.timing)) return {
      available: false,
      label: `Cabezal en ${formatSeconds(editorPlayhead())}`,
      detail: 'Mové el cabezal dentro de la escena seleccionada.',
    };
    const proposal = nearestAnchorFor(editorPlayhead(), scope.timing, scope.fps);
    return {
      available: true,
      label: `Cabezal en ${formatSeconds(editorPlayhead())}`,
      detail: `Punto exacto: ${humanPlayheadReference(proposal, scope.timing)}.`,
    };
  }

  function isPlayheadInside(timing: SceneTiming): boolean {
    const seconds = editorPlayhead();
    return seconds >= timing.startSeconds && seconds <= timing.endSeconds;
  }

  const renderPlayback = (): void => {
    const selection = projectSelection();
    if (selection?.kind === 'element' || selection?.kind === 'keyframe') render();
  };
  store.subscribe(render);
  window.addEventListener(PROJECT_SELECTION_EVENT, () => {
    localMessage = null;
    render();
  });
  window.addEventListener(EDITOR_PLAYBACK_EVENT, renderPlayback);
  window.addEventListener(EDITOR_WORKSPACE_EVENT, render);
  window.addEventListener(ANIMATION_MODE_EVENT, render);
  window.addEventListener(EDITING_SUBPAGE_EVENT, (event) => {
    const requested = (event as CustomEvent<EditingSubpage>).detail;
    const selection = projectSelection();
    if (!selection || !editingSubpages(selection).some((page) => page.id === requested)) return;
    activeSubpage = requested;
    render();
  });
  render();
}

export function editingSubpages(selection: ProjectSelection): EditingSubpageOption[] {
  if (selection.kind === 'scene') return [
    { id: 'scene', label: 'General' },
    { id: 'background', label: 'Fondo' },
    { id: 'transition', label: 'Transición' },
  ];
  if (selection.kind === 'dialogue') return [
    { id: 'dialogue', label: 'Texto' },
    { id: 'performance', label: 'Voz y gesto' },
  ];
  return [
    { id: 'adjustments', label: 'Ajustes' },
    { id: 'create-animation', label: 'Crear animación' },
    { id: 'tracks', label: 'Pistas' },
  ];
}

export function defaultEditingSubpage(selection: ProjectSelection): EditingSubpage {
  if (selection.kind === 'scene') return 'scene';
  if (selection.kind === 'dialogue') return 'dialogue';
  return selection.kind === 'keyframe' ? 'tracks' : 'adjustments';
}

function editingSelectionIdentity(selection: ProjectSelection): string {
  if (selection.kind === 'keyframe') {
    return `${selection.kind}:${selection.sceneId}:${selection.elementId}:${selection.keyframeId}`;
  }
  if (selection.kind === 'element') return `${selection.kind}:${selection.sceneId}:${selection.elementId}`;
  if (selection.kind === 'dialogue') return `${selection.kind}:${selection.sceneId}:${selection.turnId}`;
  return `${selection.kind}:${selection.sceneId}`;
}

function isConstantSceneOpacityTrack(track: TrackView): boolean {
  if (track.source.kind !== 'manual' || track.keyframes.length !== 2) return false;
  const [first, second] = track.keyframes;
  const sceneEdges = new Set(track.keyframes.map((keyframe) => (
    keyframe.anchor.kind === 'scene' ? keyframe.anchor.edge : null
  )));
  return sceneEdges.has('start')
    && sceneEdges.has('end')
    && track.keyframes.every((keyframe) => keyframe.offsetSeconds === 0)
    && first.value === second.value;
}

export function constantCharacterOpacityCommands(
  scene: SceneView,
  element: ElementView,
  requestedOpacity: number,
): Array<Record<string, unknown>> {
  const opacity = clampParameterValue('opacity', requestedOpacity);
  const track = (element.tracks ?? []).find((candidate) => candidate.parameterId === 'opacity');
  const constantTrack = track && isConstantSceneOpacityTrack(track) ? track : null;
  const commands: Array<Record<string, unknown>> = [];

  // El compilador de personajes exige opacidad base 1. Una opacidad visual
  // persistente se representa como una pista constante, que sí comparte el
  // evaluador temporal con preview y render.
  if (element.transform.opacity !== 1) {
    commands.push({
      type: 'set-element-transform',
      sceneId: scene.id,
      elementId: element.id,
      opacity: 1,
    });
  }

  if (opacity === 1) {
    if (constantTrack) {
      commands.push({
        type: 'delete-track',
        sceneId: scene.id,
        elementId: element.id,
        parameterId: 'opacity',
      });
    }
    return commands;
  }

  if (constantTrack) {
    for (const keyframe of constantTrack.keyframes) {
      if (keyframe.value === opacity) continue;
      commands.push({
        type: 'set-keyframe',
        sceneId: scene.id,
        elementId: element.id,
        parameterId: 'opacity',
        keyframeId: keyframe.id,
        value: opacity,
      });
    }
    return commands;
  }

  if (track) return commands;
  const takenIds = (element.tracks ?? []).flatMap((candidate) => (
    candidate.keyframes.map((keyframe) => keyframe.id)
  ));
  const startKeyframeId = nextKeyframeId('opacity', takenIds);
  const endKeyframeId = nextKeyframeId('opacity', [...takenIds, startKeyframeId]);
  commands.push({
    type: 'create-track',
    sceneId: scene.id,
    elementId: element.id,
    parameterId: 'opacity',
    source: { kind: 'manual' },
    keyframes: [
      {
        id: startKeyframeId,
        anchor: { kind: 'scene', edge: 'start' },
        offsetSeconds: 0,
        value: opacity,
        interpolation: 'linear',
      },
      {
        id: endKeyframeId,
        anchor: { kind: 'scene', edge: 'end' },
        offsetSeconds: 0,
        value: opacity,
        interpolation: 'hold',
      },
    ],
  });
  return commands;
}

export function selectedKeyframeId(
  commands: Array<Record<string, unknown>>,
  lane: AnimationLane | null,
  playheadSeconds: number,
  fps: number,
): string | null {
  const command = commands.find((item) => item.type === 'add-keyframe')
    ?? commands.find((item) => item.type === 'create-track')
    ?? commands[0];
  if (!command) return null;
  if (command.type === 'set-keyframe' || command.type === 'add-keyframe') return String(command.keyframeId);
  if (command.type === 'create-track') {
    const keyframes = command.keyframes;
    if (!Array.isArray(keyframes)) return null;
    return String((keyframes.at(-1) as { id?: unknown } | undefined)?.id ?? '') || null;
  }
  return lane?.keyframes.find(
    (item) => item.seconds !== null && Math.abs(item.seconds - playheadSeconds) <= 0.5 / fps,
  )?.id ?? null;
}

function editingCard(eyebrow: string, title: string): HTMLElement {
  const card = document.createElement('section');
  card.className = 'editing-tool-card';
  const header = document.createElement('header');
  header.className = 'proposal-control-heading';
  const label = document.createElement('span');
  label.className = 'eyebrow';
  label.textContent = eyebrow;
  const heading = document.createElement('strong');
  heading.textContent = title;
  header.append(label, heading);
  card.append(header);
  return card;
}

function playheadCard(reference: PlayheadReference): HTMLElement {
  const row = document.createElement('div');
  row.className = `editing-playhead-reference${reference.available ? ' is-ready' : ' is-pending'}`;
  const marker = document.createElement('span');
  marker.className = 'editing-playhead-marker';
  marker.textContent = '│';
  marker.setAttribute('aria-hidden', 'true');
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = reference.label;
  const detail = document.createElement('p');
  detail.textContent = reference.detail;
  content.append(title, detail);
  row.append(marker, content);
  return row;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'inspector-field is-compact';
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.append(text, control);
  return wrapper;
}

function compactFieldRow(
  label: string,
  control: HTMLElement,
  width: 'number' | 'wide' = 'wide',
  suffix?: string,
): HTMLElement {
  const row = document.createElement('label');
  row.className = 'compact-field-row';
  const text = document.createElement('span');
  text.className = 'compact-field-label';
  text.textContent = label;
  const slot = document.createElement('span');
  slot.className = `compact-field-control is-${width}`;
  control.classList.add('compact-value-control');
  slot.append(control);
  if (suffix) {
    const unit = document.createElement('span');
    unit.className = 'compact-field-unit';
    unit.textContent = suffix;
    slot.append(unit);
  }
  row.append(text, slot);
  return row;
}

function grid(...children: HTMLElement[]): HTMLElement {
  const element = document.createElement('div');
  element.className = 'proposal-control-grid';
  element.append(...children);
  return element;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round((value + Number.EPSILON) * 100) / 100);
}

function compactNumberInput(
  value: number,
  attributes: { min?: number; max?: number; step?: number } = {},
): HTMLInputElement {
  const control = input('number', formatCompactNumber(value), attributes as Record<string, number>);
  control.classList.add('compact-number-input');
  control.inputMode = 'decimal';
  return control;
}

function input(type: string, value: string, attributes: Record<string, string | number> = {}): HTMLInputElement {
  const element = document.createElement('input');
  element.type = type;
  element.value = value;
  for (const [key, attribute] of Object.entries(attributes)) {
    if (key === 'maxLength') element.maxLength = Number(attribute);
    else element.setAttribute(key, String(attribute));
  }
  return element;
}

function readableOption(value: string): string {
  const labels: Record<string, string> = {
    neutral: 'Neutral',
    point: 'Señalar',
    celebrate: 'Celebrar',
    doubt: 'Duda',
    deny: 'Negar',
    static: 'Estática',
    'slow-pan': 'Paneo suave',
    'slow-zoom': 'Zoom suave',
    'idle-calm': 'Reposo suave',
    'talk-calm': 'Habla suave',
  };
  return labels[value] ?? value.replaceAll('-', ' ');
}

function resourceLabel(store: ProjectStore, element: ElementView, fallback: string): string {
  return store.resources('character').find((item) => item.id === element.resourceId)?.label ?? fallback;
}

function select(options: Array<{ value: string; label: string }>, current: string): HTMLSelectElement {
  const element = document.createElement('select');
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === current;
    element.append(node);
  }
  return element;
}

function actionButton(label: string, action: () => void, danger = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (danger) button.className = 'danger-button';
  button.addEventListener('click', action);
  return button;
}

function readOnlyRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'animation-readonly';
  const name = document.createElement('span');
  name.textContent = label;
  const text = document.createElement('strong');
  text.textContent = value;
  row.append(name, text);
  return row;
}

function emptyState(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'empty-state';
  element.textContent = text;
  return element;
}

function contextNote(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'editing-context-note';
  element.textContent = text;
  return element;
}

function animationSection(title: string, description: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'animation-creation-section';
  const heading = document.createElement('div');
  heading.className = 'animation-section-heading';
  const name = document.createElement('strong');
  name.textContent = title;
  const detail = document.createElement('p');
  detail.textContent = description;
  heading.append(name, detail);
  section.append(heading);
  return section;
}

function presetPlacement(
  scope: AnimationScope,
  presetId: string,
  intensity: AnimationIntensity,
): {
  allowed: boolean;
  reason: string;
  proposal: ReturnType<typeof nearestAnchorFor> | null;
} {
  if (!scope.timing) return {
    allowed: false,
    reason: 'Medí la escena antes de ubicar esta animación; no hace falta exportar.',
    proposal: null,
  };
  const playhead = editorPlayhead();
  if (playhead < scope.timing.startSeconds || playhead > scope.timing.endSeconds) return {
    allowed: false,
    reason: 'Mové el cabezal dentro de la escena seleccionada.',
    proposal: null,
  };
  const proposal = nearestAnchorFor(playhead, scope.timing, scope.fps);
  const resolved = resolveAnchorSeconds(proposal.anchor, scope.timing) + proposal.offsetSeconds;
  if (Math.abs(resolved - playhead) > 0.5 / scope.fps) return {
    allowed: false,
    reason: 'No se pudo representar este punto con precisión. Acercá el cabezal a un diálogo o borde de escena.',
    proposal: null,
  };
  const window = animationPresetWindow(presetId, intensity);
  const tolerance = 0.5 / scope.fps;
  if (
    playhead + window.startOffsetSeconds < scope.timing.startSeconds - tolerance
    || playhead + window.endOffsetSeconds > scope.timing.endSeconds + tolerance
  ) {
    return {
      allowed: false,
      reason: 'La animación no entra completa desde este punto. Alejá el cabezal del borde de la escena.',
      proposal,
    };
  }
  return {
    allowed: true,
    reason: `Aplicar exactamente en ${formatSeconds(playhead)}.`,
    proposal,
  };
}

function humanPlayheadReference(
  proposal: ReturnType<typeof nearestAnchorFor>,
  timing: SceneTiming,
): string {
  const anchor = proposal.anchor;
  let reference: string;
  if (anchor.kind === 'scene') {
    reference = anchor.edge === 'start' ? 'el inicio de la escena' : 'el final de la escena';
  } else {
    const turnIndex = timing.turns.findIndex((turn) => turn.id === anchor.turnId);
    const dialogue = turnIndex >= 0 ? turnIndex + 1 : null;
    if (anchor.kind === 'turn') {
      reference = dialogue === null
        ? 'un diálogo'
        : `${anchor.edge === 'start' ? 'el inicio' : 'el final'} del diálogo ${dialogue}`;
    } else {
      reference = dialogue === null
        ? `la palabra ${anchor.wordIndex + 1} de un diálogo`
        : `la palabra ${anchor.wordIndex + 1} del diálogo ${dialogue}`;
    }
  }
  if (Math.abs(proposal.offsetSeconds) < 0.0005) return reference;
  const distance = `${Math.abs(proposal.offsetSeconds).toFixed(2)} s`;
  return proposal.offsetSeconds > 0
    ? `${distance} después de ${reference}`
    : `${distance} antes de ${reference}`;
}

function friendlyEditingError(message: string): string {
  if (message.includes('EDITOR_TRACK_CUSTOMIZED')) {
    return 'Esta propiedad ya tiene una pista manual o editada. Abrila en Pistas para decidir qué conservar.';
  }
  if (message.includes('ANIM_TRACK_OUT_OF_SCENE')) {
    return 'La animación quedó fuera de la escena. Mové el cabezal más lejos del borde y volvé a intentarlo.';
  }
  return message.replace(/^[A-Z0-9_]+(?:\s+\([^)]*\))?:\s*/u, '');
}

function statusMessage(text: string, error: boolean): HTMLElement {
  const element = document.createElement('p');
  element.className = `editing-local-status${error ? ' is-error' : ' is-ok'}`;
  element.textContent = text;
  element.setAttribute('role', 'status');
  return element;
}

function readStringCapability(capabilities: Record<string, unknown> | undefined, key: string): string[] {
  const values = capabilities?.[key];
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function formatDuration(seconds: number): string {
  return `${Number(seconds.toFixed(2))} s`;
}
