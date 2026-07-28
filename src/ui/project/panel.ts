import { optional } from '../dom.js';
import { notify } from '../notifications.js';
import { editorWorkspace, measuredTimelineFor } from '../editor-workspace.js';
import type { ProjectStore } from './store.js';
import type { ElementView, SceneView, TurnView } from './types.js';
import { PROJECT_SELECTION_EVENT, projectSelection, selectProjectItem, type ProjectSelection } from './selection.js';
import {
  baseValueForParameter,
  buildAnimationLanes,
  clampParameterValue,
  listAnimatableParameters,
  nearestAnchorFor,
  nextKeyframeId,
  parameterLabel,
  sceneAnimationReference,
  sceneAnimationTiming,
  type AnimationKeyframeItem,
  type AnimationLane,
} from '../timeline-animation.js';
import { ANIMATION_PARAMETERS } from '../../../shared/animation-contract.js';
import { listApplicablePresets } from '../../../shared/animation-presets.js';
import type { SceneTiming } from '../../../shared/animation-evaluator.js';

const TRANSITIONS = ['cut', 'fade'];
const PROPOSAL_TABS = ['scene', 'elements', 'background', 'transition'] as const;
type ProposalTab = typeof PROPOSAL_TABS[number];

export function initProjectEditor(store: ProjectStore): void {
  const root = optional<HTMLElement>('#project-editor');
  const inspector = optional<HTMLElement>('#scene-inspector');
  const status = optional<HTMLElement>('#project-status');
  if (!root || !inspector) return;
  root.hidden = false;

  const toolUndo = optional<HTMLButtonElement>('#tool-undo');
  const toolRedo = optional<HTMLButtonElement>('#tool-redo');
  const proposalTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-proposal-tab]'));
  let activeProposalTab: ProposalTab = 'scene';

  // U5: el rechazo del motor se notifica además de escribirse en el panel.
  function report(message: string | null, ok = false): void {
    if (status) {
      status.textContent = message ?? '';
      status.classList.toggle('error', Boolean(message) && !ok);
      status.classList.toggle('ok', Boolean(message) && ok);
    }
    if (message && !ok) notify({ message, level: 'error' });
  }

  // Todo cambio pasa por un comando semántico; el error del motor se muestra tal cual.
  function send(command: Record<string, unknown>): void {
    report(store.dispatch(command));
  }

  const doUndo = (): void => { store.undo(); report(null); };
  const doRedo = (): void => { store.redo(); report(null); };
  toolUndo?.addEventListener('click', doUndo);
  toolRedo?.addEventListener('click', doRedo);
  window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || event.altKey || event.metaKey || isTyping(event.target)) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? doRedo() : doUndo();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      doRedo();
    }
  });

  for (const tab of proposalTabs) {
    tab.addEventListener('click', () => {
      const requested = tab.dataset.proposalTab;
      if (!isProposalTab(requested)) return;
      selectProposalTab(requested);
    });
  }
  // La navegación por flechas vive en el helper compartido src/ui/tabs.ts.
  window.addEventListener(PROJECT_SELECTION_EVENT, (event) => {
    const selection = (event as CustomEvent<ProjectSelection>).detail;
    if (!selection) return;
    if (store.selectedSceneId() !== selection.sceneId) {
      send({ type: 'select-scene', sceneId: selection.sceneId });
    }
    selectProposalTab(isElementSelection(selection) ? 'elements' : 'scene');
  });

  function renderInspector(): void {
    const project = store.project();
    const selectedScene = project.scenes.find((item) => item.id === store.selectedSceneId());
    const selection = projectSelection();
    if (selection && selection.sceneId === selectedScene?.id) {
      activeProposalTab = isElementSelection(selection) ? 'elements' : 'scene';
    }
    syncProposalTabs();
    if (project.scenes.length === 0) {
      inspector!.replaceChildren(note('No hay escenas disponibles.'));
      return;
    }
    const sectionFactories: Record<ProposalTab, () => HTMLElement> = {
      scene: () => sceneSection(),
      elements: () => elementsSection(),
      background: () => backgroundSection(),
      transition: () => transitionSection(),
    };
    inspector!.replaceChildren(...(status ? [status] : []), sectionFactories[activeProposalTab]());
  }

  function syncProposalTabs(): void {
    for (const tab of proposalTabs) {
      const selected = tab.dataset.proposalTab === activeProposalTab;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
  }

  function selectProposalTab(tab: ProposalTab): void {
    activeProposalTab = tab;
    renderInspector();
  }

  function sceneSection(): HTMLElement {
    const project = store.project();
    return focusedView(project.scenes.map((scene, index) => sceneScriptCard(scene, index)));
  }

  function sceneScriptCard(scene: SceneView, index: number): HTMLElement {
    const title = document.createElement('input');
    title.type = 'text';
    title.value = scene.title;
    title.maxLength = 120;
    title.setAttribute('aria-label', `Título de la escena ${index + 1}`);
    title.addEventListener('change', () => {
      const value = title.value.trim();
      if (value) send({ type: 'set-scene-title', sceneId: scene.id, title: value });
    });
    const heading = document.createElement('header');
    heading.className = 'proposal-card-heading';
    const number = document.createElement('span');
    number.className = 'eyebrow';
    number.textContent = `Escena ${index + 1}`;
    heading.append(number, title);
    const card = proposalCard();
    // C2: anclas para que la selección de la timeline o el lienzo pueda
    // localizar este bloque y destacarlo.
    card.dataset.inspectorScene = scene.id;
    card.append(heading, ...dialogueScriptFields(scene));
    return card;
  }

  function dialogueScriptFields(scene: SceneView): HTMLElement[] {
    const characters = store.resources('character');
    const fields: HTMLElement[] = [];

    for (const [index, turn] of scene.dialogue.entries()) {
      const speaker = scene.elements.find((element) => element.id === turn.speakerElementId);
      const character = characters.find((resource) => resource.id === speaker?.resourceId);
      const speakerIndex = scene.elements.findIndex((element) => element.id === turn.speakerElementId);
      const fallbackName = speakerIndex >= 0 ? `Personaje ${speakerIndex + 1}` : `Personaje ${index + 1}`;
      const item = document.createElement('label');
      item.className = 'proposal-dialogue';
      item.dataset.inspectorTurn = turn.id;
      const meta = document.createElement('span');
      meta.className = 'proposal-dialogue-meta';
      meta.textContent = `Personaje · ${character?.label ?? fallbackName}`;
      item.append(meta, dialogueText(scene, turn));
      fields.push(item);
    }

    if (fields.length === 0) fields.push(note('Esta escena todavía no tiene diálogos.'));
    return fields;
  }

  function backgroundSection(): HTMLElement {
    return focusedView(store.project().scenes.map((scene, index) => backgroundCard(scene, index)));
  }

  function backgroundCard(scene: SceneView, index: number): HTMLElement {
    const backgrounds = store.resources('background');
    const resource = select(
      backgrounds.map((entry) => ({ value: entry.id, label: entry.label })),
      scene.background.resourceId,
    );
    const entry = backgrounds.find((item) => item.id === scene.background.resourceId);
    const presets = readPresets(entry?.capabilities) ?? [scene.background.cameraPreset];
    const camera = select(presets.map((value) => ({ value, label: value })), scene.background.cameraPreset);

    const apply = (): void => send({
      type: 'set-scene-background',
      sceneId: scene.id,
      resourceId: resource.value,
      cameraPreset: camera.value,
    });
    resource.addEventListener('change', apply);
    camera.addEventListener('change', apply);
    return sceneControlCard(scene, index, [
      controlGrid(field('Fondo', resource), field('Cámara', camera)),
    ]);
  }

  function transitionSection(): HTMLElement {
    const scenes = store.project().scenes;
    const cards = scenes.slice(0, -1).map((scene, index) => transitionCard(scene, index));
    if (cards.length === 0) return focusedView([note('Hace falta más de una escena para configurar una transición.')]);
    return focusedView(cards);
  }

  function transitionCard(scene: SceneView, index: number): HTMLElement {
    const preset = select(TRANSITIONS.map((value) => ({
      value,
      label: value === 'cut' ? 'Corte' : 'Fundido',
    })), scene.transitionToNext?.preset ?? 'cut');
    const duration = document.createElement('input');
    duration.type = 'number';
    duration.min = '0';
    duration.max = '2';
    duration.step = '0.05';
    duration.value = String(scene.transitionToNext?.durationSeconds ?? 0);

    // El motor exige duración 0 para «cut».
    const syncDuration = (): void => {
      const isCut = preset.value === 'cut';
      duration.disabled = isCut;
      if (isCut) duration.value = '0';
    };
    syncDuration();

    const apply = (): void => {
      syncDuration();
      send({
        type: 'set-transition',
        sceneId: scene.id,
        preset: preset.value,
        durationSeconds: Number(duration.value),
      });
    };
    preset.addEventListener('change', apply);
    duration.addEventListener('change', apply);

    return sceneControlCard(scene, index, [
      controlGrid(field('Tipo', preset), field('Duración (s)', duration)),
    ]);
  }

  function elementsSection(): HTMLElement {
    const cards = store.project().scenes.map((scene, index) => elementsCard(scene, index));
    // Fase 4: con un keyframe seleccionado, su ficha encabeza la pestaña; el
    // resto del elemento sigue accesible debajo.
    const keyframe = keyframeCard();
    return focusedView(keyframe ? [keyframe, ...cards] : cards);
  }

  function elementsCard(scene: SceneView, index: number): HTMLElement {
    const characters = store.resources('character');
    const fields: HTMLElement[] = [];
    let characterNumber = 0;

    for (const element of scene.elements) {
      if (element.type !== 'character') {
        fields.push(note(`«${element.id}» todavía no tiene ajustes disponibles.`));
        continue;
      }
      characterNumber += 1;
      const resource = select(
        characters.map((entry) => ({ value: entry.id, label: entry.label })),
        element.resourceId ?? '',
      );
      resource.addEventListener('change', () => send({
        type: 'set-character-resource',
        sceneId: scene.id,
        elementId: element.id,
        resourceId: resource.value,
      }));

      // C2: cada personaje queda en un grupo localizable desde timeline/lienzo.
      const group = document.createElement('div');
      group.className = 'inspector-element-group';
      group.dataset.inspectorElement = element.id;
      group.append(subheading(`Personaje ${characterNumber}`));
      fields.push(group);
      const identityFields: HTMLElement[] = [field('Personaje', resource)];
      const selectedResource = characters.find((entry) => entry.id === element.resourceId);
      const animationPresets = readStringCapability(selectedResource?.capabilities, 'animationPresets');
      if (animationPresets.length > 0) {
        const animation = select(animationPresets.map((value) => ({
          value,
          label: value === 'idle-calm' ? 'Reposo suave' : value === 'talk-calm' ? 'Habla suave' : value,
        })), element.animationPreset ?? animationPresets[0]);
        animation.addEventListener('change', () => send({
          type: 'set-character-animation',
          sceneId: scene.id,
          elementId: element.id,
          animationPreset: animation.value,
        }));
        identityFields.push(field('Movimiento', animation));
      }
      group.append(controlGrid(...identityFields));
      group.append(controlGrid(
        transformField(scene, element, 'x', 'X', -1080, 2160, 1),
        transformField(scene, element, 'y', 'Y', -1920, 3840, 1),
        transformField(scene, element, 'scale', 'Escala', 0.01, 10, 0.01),
        transformField(scene, element, 'zIndex', 'Capa', -1000, 1000, 1),
      ));
      group.append(...animationControls(scene, element));
      const remove = actionButton('Quitar personaje', () => send({
        type: 'delete-element', sceneId: scene.id, elementId: element.id,
      }), true);
      remove.disabled = scene.dialogue.some((turn) => turn.speakerElementId === element.id);
      if (remove.disabled) remove.title = 'Este personaje todavía tiene diálogos asignados.';
      group.append(remove);
    }
    const characterPicker = select(characters.map((entry) => ({ value: entry.id, label: entry.label })), characters[0]?.id ?? '');
    const add = actionButton('Agregar personaje', () => {
      if (!characterPicker.value) return;
      const id = nextId(`${scene.id}-personaje`, scene.elements.map((element) => element.id));
      const index = scene.elements.filter((element) => element.type === 'character').length;
      send({
        type: 'add-character',
        sceneId: scene.id,
        elementId: id,
        resourceId: characterPicker.value,
        x: index % 2 === 0 ? 360 : 720,
        y: 1180,
        scale: 0.75,
        zIndex: 20 + index,
      });
    });
    fields.push(subheading('Agregar desde la biblioteca'), field('Personaje', characterPicker), add);
    return sceneControlCard(scene, index, fields);
  }

  function transformField(
    scene: SceneView,
    element: ElementView,
    key: 'x' | 'y' | 'scale' | 'zIndex',
    label: string,
    min: number,
    max: number,
    step: number,
  ): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(element.transform[key]);
    input.addEventListener('change', () => send({
      type: 'set-character-transform',
      sceneId: scene.id,
      elementId: element.id,
      [key]: Number(input.value),
    }));
    return field(label, input);
  }

  // ---- Fase 4: animación por keyframes en el inspector ----
  //
  // El estado visible está en docs/FASE_0_CONTRATO_ANIMACION_V1.md, sección 6.
  // Todo cambio sale por los mismos comandos del motor que usa la timeline; acá
  // no hay una segunda representación de las pistas.

  interface AnimationScope {
    timing: SceneTiming | null;
    reference: ReturnType<typeof sceneAnimationReference>;
    fps: number;
  }

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

  /**
   * Referencia semántica desde la que colgar algo nuevo.
   *
   * Con medición vigente y el cabezal dentro de la escena se usa el punto
   * semántico más cercano; si no, el inicio de la escena. Nunca un segundo
   * absoluto inventado: sin voz medida no se sabe dónde cae el cabezal.
   */
  function anchorFromPlayhead(scope: AnimationScope): { anchor: ReturnType<typeof nearestAnchorFor>['anchor']; offsetSeconds: number } {
    const { timing, fps } = scope;
    const playhead = editorWorkspace().currentTime;
    if (timing && playhead >= timing.startSeconds && playhead <= timing.endSeconds) {
      const proposal = nearestAnchorFor(playhead, timing, fps);
      return { anchor: proposal.anchor, offsetSeconds: proposal.offsetSeconds };
    }
    return { anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0 };
  }

  function animationControls(scene: SceneView, element: ElementView): HTMLElement[] {
    const resource = store.resources('character').find((entry) => entry.id === element.resourceId);
    const declared = readStringCapability(resource?.capabilities, 'parameters');
    const scope = animationScope(scene);
    const lanes = buildAnimationLanes(element.id, element.tracks ?? [], scope);
    const nodes: HTMLElement[] = [subheading('Animación por keyframes')];

    const presets = document.createElement('div');
    presets.className = 'animation-preset-row';
    for (const preset of listApplicablePresets(declared)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'animation-preset';
      button.textContent = preset.label;
      button.title = `${preset.id} · anima ${parameterLabel(preset.parameterId)} desde ${anchorFromPlayhead(scope).anchor.kind === 'scene' ? 'el inicio de la escena' : 'la referencia más cercana al cabezal'}`;
      button.addEventListener('click', () => {
        const { anchor } = anchorFromPlayhead(scope);
        send({
          type: 'apply-animation-preset',
          sceneId: scene.id,
          elementId: element.id,
          presetId: preset.id,
          anchor,
          intensity: 'medium',
        });
      });
      presets.append(button);
    }
    nodes.push(presets);

    const parameterPicker = select(
      listAnimatableParameters(declared).map((id) => ({ value: id, label: parameterLabel(id) })),
      'position.x',
    );
    const animate = actionButton('Animar desde el cabezal', () => animateParameter(scene, element, parameterPicker.value));
    animate.title = 'Crea la pista con dos keyframes (una pista de un solo punto no cumple el contrato) o agrega uno si la pista ya existe.';
    nodes.push(controlGrid(field('Parámetro', parameterPicker), field(' ', animate)));

    if (lanes.length === 0) {
      nodes.push(note('Este personaje todavía no tiene pistas. Aplicá un preset o animá un parámetro desde el cabezal.'));
      return nodes;
    }
    for (const lane of lanes) nodes.push(trackRow(scene, element, lane));
    return nodes;
  }

  function trackRow(scene: SceneView, element: ElementView, lane: AnimationLane): HTMLElement {
    const row = document.createElement('div');
    row.className = 'animation-track-row';
    const name = document.createElement('span');
    name.className = 'animation-track-name';
    name.textContent = `${lane.label} · ${lane.sourceLabel}`;
    const count = document.createElement('span');
    count.className = 'animation-track-count';
    count.textContent = lane.reviewCount > 0
      ? `${lane.keyframes.length} kf · ⚠ ${lane.reviewCount}`
      : `${lane.keyframes.length} kf`;
    if (lane.reviewCount > 0) count.classList.add('is-review');
    const remove = actionButton('Eliminar pista', () => send({
      type: 'delete-track',
      sceneId: scene.id,
      elementId: element.id,
      parameterId: lane.parameterId,
    }), true);
    row.append(name, count, remove);
    return row;
  }

  function animateParameter(scene: SceneView, element: ElementView, parameterId: string): void {
    const scope = animationScope(scene);
    const start = anchorFromPlayhead(scope);
    const tracks = element.tracks ?? [];
    const taken = tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.id));
    const value = clampParameterValue(parameterId, baseValueForParameter(parameterId, element.transform));
    const first = nextKeyframeId(parameterId, taken);
    if (tracks.some((track) => track.parameterId === parameterId)) {
      send({
        type: 'add-keyframe',
        sceneId: scene.id,
        elementId: element.id,
        parameterId,
        keyframeId: first,
        anchor: start.anchor,
        offsetSeconds: start.offsetSeconds,
        value,
        interpolation: 'ease',
      });
      selectProjectItem({ kind: 'keyframe', sceneId: scene.id, elementId: element.id, parameterId, keyframeId: first });
      return;
    }
    // `create-track` es atómico: la pista nace con los dos keyframes que el
    // contrato exige, y el usuario ajusta el segundo valor desde su ficha.
    const second = nextKeyframeId(parameterId, [...taken, first]);
    send({
      type: 'create-track',
      sceneId: scene.id,
      elementId: element.id,
      parameterId,
      source: { kind: 'manual' },
      keyframes: [
        { id: first, anchor: start.anchor, offsetSeconds: start.offsetSeconds, value, interpolation: 'ease' },
        { id: second, anchor: start.anchor, offsetSeconds: followingOffset(start.offsetSeconds), value, interpolation: 'hold' },
      ],
    });
    selectProjectItem({ kind: 'keyframe', sceneId: scene.id, elementId: element.id, parameterId, keyframeId: second });
  }

  function keyframeCard(): HTMLElement | null {
    const selection = projectSelection();
    if (selection?.kind !== 'keyframe') return null;
    const scene = store.project().scenes.find((item) => item.id === selection.sceneId);
    const element = scene?.elements.find((item) => item.id === selection.elementId);
    if (!scene || !element) return null;
    const scope = animationScope(scene);
    const lane = buildAnimationLanes(element.id, element.tracks ?? [], scope)
      .find((item) => item.parameterId === selection.parameterId);
    const keyframe = lane?.keyframes.find((item) => item.id === selection.keyframeId);
    if (!lane || !keyframe) return null;

    const edit = (patch: Record<string, unknown>): void => send({
      type: 'set-keyframe',
      sceneId: scene.id,
      elementId: element.id,
      parameterId: lane.parameterId,
      keyframeId: keyframe.id,
      ...patch,
    });

    const card = proposalCard();
    card.classList.add('keyframe-card');
    card.dataset.inspectorKeyframe = keyframe.id;
    const heading = document.createElement('header');
    heading.className = 'proposal-control-heading';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'Keyframe';
    const title = document.createElement('strong');
    title.textContent = `${lane.label} · ${keyframe.valueLabel}`;
    heading.append(eyebrow, title);
    card.append(heading);

    const parameter = ANIMATION_PARAMETERS[lane.parameterId];
    const value = document.createElement('input');
    value.type = 'number';
    value.min = String(parameter?.exclusiveMinimum ?? parameter?.minimum ?? 0);
    value.max = String(parameter?.maximum ?? 1);
    value.step = lane.parameterId === 'position.x' || lane.parameterId === 'position.y' ? '1' : '0.01';
    value.value = String(keyframe.value);
    value.addEventListener('change', () => edit({ value: clampParameterValue(lane.parameterId, Number(value.value)) }));

    const offset = document.createElement('input');
    offset.type = 'number';
    offset.min = '-5';
    offset.max = '5';
    offset.step = '0.05';
    offset.value = String(keyframe.offsetSeconds);
    offset.addEventListener('change', () => edit({ offsetSeconds: Number(offset.value) }));

    const interpolation = select(
      ['linear', 'ease', 'hold'].map((id) => ({ value: id, label: id })),
      keyframe.interpolation,
    );
    // El contrato obliga al último keyframe de la pista a congelar el valor.
    interpolation.disabled = keyframe.isLast;
    if (keyframe.isLast) interpolation.title = 'El último keyframe de una pista siempre usa hold: después de él el valor queda congelado.';
    interpolation.addEventListener('change', () => edit({ interpolation: interpolation.value }));

    card.append(controlGrid(
      field('Valor', value),
      field('Desplazamiento (s)', offset),
      field('Interpolación', interpolation),
    ));

    card.append(readOnlyRow('Ancla', keyframe.anchorLabel));
    card.append(readOnlyRow('Tiempo resuelto', keyframe.timeLabel));
    card.append(readOnlyRow('Procedencia', lane.sourceLabel === 'manual' ? 'pista manual' : `preset ${lane.sourceLabel}`));

    if (keyframe.status === 'ok') {
      card.append(readOnlyRow('Estado', 'Normal'));
    } else {
      const state = readOnlyRow('Estado', `⚠ ${keyframe.message ?? 'Requiere revisión'}`);
      state.classList.add('is-review');
      card.append(state);
    }

    const actions = document.createElement('div');
    actions.className = 'animation-actions';
    if (scope.timing && keyframe.seconds !== null) {
      const proposal = nearestAnchorFor(keyframe.seconds, scope.timing, scope.fps);
      const reanchor = actionButton(`Reanclar a ${proposal.label}`, () => edit({
        anchor: proposal.anchor,
        offsetSeconds: proposal.offsetSeconds,
      }));
      reanchor.title = 'Cuelga el keyframe de la referencia semántica más cercana, para que siga al diálogo si el texto cambia.';
      actions.append(reanchor);
    }
    actions.append(actionButton('Duplicar keyframe', () => duplicateKeyframe(scene, element, lane, keyframe)));
    actions.append(actionButton('Eliminar keyframe', () => {
      send({
        type: 'delete-keyframe',
        sceneId: scene.id,
        elementId: element.id,
        parameterId: lane.parameterId,
        keyframeId: keyframe.id,
      });
      selectProjectItem({ kind: 'element', sceneId: scene.id, elementId: element.id });
    }, true));
    card.append(actions);
    return card;
  }

  function duplicateKeyframe(
    scene: SceneView,
    element: ElementView,
    lane: AnimationLane,
    keyframe: AnimationKeyframeItem,
  ): void {
    const taken = (element.tracks ?? []).flatMap((track) => track.keyframes.map((item) => item.id));
    const keyframeId = nextKeyframeId(lane.parameterId, taken);
    send({
      type: 'add-keyframe',
      sceneId: scene.id,
      elementId: element.id,
      parameterId: lane.parameterId,
      keyframeId,
      anchor: keyframe.anchor,
      offsetSeconds: followingOffset(keyframe.offsetSeconds),
      value: keyframe.value,
      interpolation: keyframe.interpolation,
    });
    selectProjectItem({
      kind: 'keyframe', sceneId: scene.id, elementId: element.id, parameterId: lane.parameterId, keyframeId,
    });
  }

  function dialogueText(scene: SceneView, turn: TurnView): HTMLTextAreaElement {
    const area = document.createElement('textarea');
    area.className = 'proposal-dialogue-text';
    area.rows = dialogueRows(turn.text);
    area.maxLength = 500;
    area.value = turn.text;
    area.addEventListener('change', () => {
      const text = area.value.trim();
      if (text) send({ type: 'set-dialogue-turn', sceneId: scene.id, turnId: turn.id, text });
    });
    return area;
  }

  function render(): void {
    const canUndo = store.canUndo();
    const canRedo = store.canRedo();
    if (toolUndo) toolUndo.disabled = !canUndo;
    if (toolRedo) toolRedo.disabled = !canRedo;
    renderInspector();
  }

  store.subscribe(render);
  render();
}

function isProposalTab(value: string | undefined): value is ProposalTab {
  return PROPOSAL_TABS.some((tab) => tab === value);
}

/** Un keyframe pertenece a un elemento: las dos selecciones abren la misma pestaña. */
function isElementSelection(selection: ProjectSelection | null): boolean {
  return selection?.kind === 'element' || selection?.kind === 'keyframe';
}

/**
 * Punto siguiente al crear o duplicar: medio segundo después, o antes si el
 * desplazamiento ya está en el tope del contrato. Dos keyframes en el mismo
 * punto son un error visible, no una elección implícita.
 */
function followingOffset(offsetSeconds: number): number {
  const forward = Math.round((offsetSeconds + 0.5) * 1000) / 1000;
  return forward <= 5 ? forward : Math.round((offsetSeconds - 0.5) * 1000) / 1000;
}

/** Dato derivado que la interfaz muestra pero nadie edita a mano. */
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

function focusedView(children: HTMLElement[]): HTMLElement {
  const view = document.createElement('div');
  view.className = 'proposal-focused-view';
  view.append(...children);
  return view;
}

function proposalCard(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'proposal-focus-card';
  return section;
}

function sceneControlCard(scene: SceneView, index: number, children: HTMLElement[]): HTMLElement {
  const card = proposalCard();
  const heading = document.createElement('header');
  heading.className = 'proposal-control-heading';
  const number = document.createElement('span');
  number.className = 'eyebrow';
  number.textContent = `Escena ${index + 1}`;
  const title = document.createElement('strong');
  title.textContent = scene.title;
  heading.append(number, title);
  card.append(heading, ...children);
  return card;
}

function controlGrid(...controls: HTMLElement[]): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'proposal-control-grid';
  grid.append(...controls);
  return grid;
}

function dialogueRows(text: string): number {
  const rows = text.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 34)), 0);
  return Math.min(18, Math.max(3, rows));
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function subheading(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'inspector-subheading';
  element.textContent = text;
  return element;
}

function note(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'inspector-note';
  element.textContent = text;
  return element;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'inspector-field is-compact';
  const span = document.createElement('span');
  span.textContent = label;
  wrapper.append(span, control);
  return wrapper;
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

function readPresets(capabilities: Record<string, unknown> | undefined): string[] | null {
  const presets = capabilities?.cameraPresets;
  if (!Array.isArray(presets)) return null;
  return presets.filter((item): item is string => typeof item === 'string');
}

function readStringCapability(capabilities: Record<string, unknown> | undefined, key: string): string[] {
  const values = capabilities?.[key];
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

function actionButton(label: string, action: () => void, danger = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (danger) button.className = 'danger-button';
  button.addEventListener('click', action);
  return button;
}

function nextId(prefix: string, existing: string[]): string {
  const used = new Set(existing);
  for (let index = 1; index <= 999; index += 1) {
    const candidate = `${prefix}-${String(index).padStart(2, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}-${Date.now().toString(36)}`;
}
