import { optional } from '../dom.js';
import type { ProjectStore } from './store.js';
import type { ElementView, SceneView, TurnView } from './types.js';

const TRANSITIONS = ['cut', 'fade'];
const PROPOSAL_TABS = ['scene', 'elements', 'background', 'transition'] as const;
type ProposalTab = typeof PROPOSAL_TABS[number];

export function initProjectEditor(store: ProjectStore): void {
  const root = optional<HTMLElement>('#project-editor');
  const inspector = optional<HTMLElement>('#scene-inspector');
  const status = optional<HTMLElement>('#project-status');
  const proposalDetails = optional<HTMLDetailsElement>('#director-proposal-details');
  if (!root || !inspector) return;
  root.hidden = false;
  if (proposalDetails) {
    proposalDetails.hidden = false;
    proposalDetails.open = true;
  }

  const toolUndo = optional<HTMLButtonElement>('#tool-undo');
  const toolRedo = optional<HTMLButtonElement>('#tool-redo');
  const proposalTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-proposal-tab]'));
  let activeProposalTab: ProposalTab = 'scene';

  function report(message: string | null, ok = false): void {
    if (!status) return;
    status.textContent = message ?? '';
    status.classList.toggle('error', Boolean(message) && !ok);
    status.classList.toggle('ok', Boolean(message) && ok);
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
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = PROPOSAL_TABS.indexOf(activeProposalTab);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? PROPOSAL_TABS.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + PROPOSAL_TABS.length) % PROPOSAL_TABS.length;
      selectProposalTab(PROPOSAL_TABS[nextIndex]);
      proposalTabs.find((candidate) => candidate.dataset.proposalTab === activeProposalTab)?.focus();
    });
  }

  function renderInspector(): void {
    const project = store.project();
    const scene = project.scenes.find((item) => item.id === store.selectedSceneId());
    syncProposalTabs();
    if (!scene) {
      inspector!.replaceChildren(note('No hay escena seleccionada.'));
      return;
    }
    const sectionFactories: Record<ProposalTab, () => HTMLElement> = {
      scene: () => sceneSection(scene),
      elements: () => elementsSection(scene),
      background: () => backgroundSection(scene),
      transition: () => transitionSection(scene),
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

  function sceneSection(scene: SceneView): HTMLElement {
    const project = store.project();
    const projectTitle = document.createElement('input');
    projectTitle.type = 'text';
    projectTitle.value = project.title;
    projectTitle.maxLength = 120;
    projectTitle.addEventListener('change', () => {
      const title = projectTitle.value.trim();
      if (title) send({ type: 'set-project-title', title });
    });

    const sceneSelector = select(
      project.scenes.map((item, index) => ({ value: item.id, label: `Escena ${index + 1} · ${item.title}` })),
      scene.id,
    );
    sceneSelector.addEventListener('change', () => send({ type: 'select-scene', sceneId: sceneSelector.value }));

    const sceneTitle = document.createElement('input');
    sceneTitle.type = 'text';
    sceneTitle.value = scene.title;
    sceneTitle.maxLength = 120;
    sceneTitle.addEventListener('change', () => {
      const title = sceneTitle.value.trim();
      if (title) send({ type: 'set-scene-title', sceneId: scene.id, title });
    });
    const sceneActions = document.createElement('div');
    sceneActions.className = 'inspector-actions';
    const addScene = actionButton('Nueva escena', () => {
      const id = nextId('escena', project.scenes.map((item) => item.id));
      send({
        type: 'add-scene',
        scene: {
          id,
          title: `Escena ${project.scenes.length + 1}`,
          background: { ...scene.background },
          elements: [],
          dialogue: [],
        },
      });
      send({ type: 'select-scene', sceneId: id });
    });
    const duplicate = actionButton('Duplicar', () => {
      const id = nextId('escena', project.scenes.map((item) => item.id));
      send({ type: 'duplicate-scene', sceneId: scene.id, newSceneId: id, title: `${scene.title} copia` });
      send({ type: 'select-scene', sceneId: id });
    });
    const remove = actionButton('Eliminar', () => {
      if (project.scenes.length > 1 && window.confirm(`¿Eliminar «${scene.title}»?`)) {
        send({ type: 'delete-scene', sceneId: scene.id });
      }
    }, true);
    remove.disabled = project.scenes.length === 1;
    sceneActions.append(addScene, duplicate, remove);
    return group('Escena', [
      field('Título del proyecto', projectTitle),
      field('Escena a editar', sceneSelector),
      field('Título de la escena', sceneTitle),
      sceneActions,
      ...dialogueScriptFields(scene),
    ]);
  }

  function dialogueScriptFields(scene: SceneView): HTMLElement[] {
    const characters = store.resources('character');
    const voices = store.resources('voice');
    const sceneCharacters = scene.elements.filter((element) => element.type === 'character');
    const fields: HTMLElement[] = [subheading('Guion y diálogos')];

    for (const [index, turn] of scene.dialogue.entries()) {
      const speaker = scene.elements.find((element) => element.id === turn.speakerElementId);
      const character = characters.find((resource) => resource.id === speaker?.resourceId);
      const speakerIndex = scene.elements.findIndex((element) => element.id === turn.speakerElementId);
      const fallbackName = speakerIndex >= 0 ? `Personaje ${speakerIndex + 1}` : `Personaje ${index + 1}`;
      fields.push(subheading(character?.label ?? fallbackName));
      fields.push(field('Diálogo', dialogueText(scene, turn)));
      const speakerSelect = select(sceneCharacters.map((element, characterIndex) => {
        const resource = characters.find((candidate) => candidate.id === element.resourceId);
        return { value: element.id, label: resource?.label ?? `Personaje ${characterIndex + 1}` };
      }), turn.speakerElementId);
      speakerSelect.addEventListener('change', () => send({
        type: 'set-dialogue-speaker', sceneId: scene.id, turnId: turn.id, speakerElementId: speakerSelect.value,
      }));
      const voiceSelect = select(voices.map((voice) => ({ value: voice.id, label: voice.label })), turn.voiceId);
      voiceSelect.addEventListener('change', () => send({
        type: 'set-dialogue-turn', sceneId: scene.id, turnId: turn.id, voiceId: voiceSelect.value,
      }));
      const row = document.createElement('div');
      row.className = 'inspector-inline-fields';
      row.append(field('Personaje', speakerSelect), field('Voz', voiceSelect));
      fields.push(row);
      fields.push(actionButton('Eliminar diálogo', () => send({
        type: 'delete-dialogue-turn', sceneId: scene.id, turnId: turn.id,
      }), true));
    }

    fields.push(actionButton('Agregar diálogo', () => {
      const speaker = sceneCharacters[scene.dialogue.length % Math.max(1, sceneCharacters.length)];
      const voice = voices[scene.dialogue.length % Math.max(1, voices.length)];
      if (!speaker || !voice) {
        report('Agregá al menos un personaje y una voz antes de crear diálogo.');
        return;
      }
      send({
        type: 'add-dialogue-turn',
        sceneId: scene.id,
        turnId: nextId(`${scene.id}-turno`, scene.dialogue.map((turn) => turn.id)),
        speakerElementId: speaker.id,
        text: 'Nuevo diálogo',
        voiceId: voice.id,
        gestureId: 'neutral',
        gapAfterSeconds: 0.25,
      });
    }));
    return fields;
  }

  function backgroundSection(scene: SceneView): HTMLElement {
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
    return group('Fondo', [field('Recurso', resource), field('Cámara', camera)]);
  }

  function transitionSection(scene: SceneView): HTMLElement {
    const isLast = store.project().scenes.at(-1)?.id === scene.id;
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

    if (isLast) {
      preset.disabled = true;
      duration.disabled = true;
    }

    const fields = [field('Preset', preset), field('Duración (s)', duration)];
    if (isLast) fields.push(note('La última escena no tiene transición siguiente.'));
    return group('Transición', fields);
  }

  function elementsSection(scene: SceneView): HTMLElement {
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

      fields.push(subheading(`Personaje ${characterNumber}`));
      fields.push(field('Personaje', resource));
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
        fields.push(field('Movimiento', animation));
      }
      fields.push(transformField(scene, element, 'x', 'X', -1080, 2160, 1));
      fields.push(transformField(scene, element, 'y', 'Y', -1920, 3840, 1));
      fields.push(transformField(scene, element, 'scale', 'Escala', 0.01, 10, 0.01));
      fields.push(transformField(scene, element, 'zIndex', 'Orden de capa', -1000, 1000, 1));
      const remove = actionButton('Quitar personaje', () => send({
        type: 'delete-element', sceneId: scene.id, elementId: element.id,
      }), true);
      remove.disabled = scene.dialogue.some((turn) => turn.speakerElementId === element.id);
      if (remove.disabled) remove.title = 'Este personaje todavía tiene diálogos asignados.';
      fields.push(remove);
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
    return group('Personajes y elementos', fields);
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

  function dialogueText(scene: SceneView, turn: TurnView): HTMLTextAreaElement {
    const area = document.createElement('textarea');
    area.rows = 3;
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

function group(title: string, children: HTMLElement[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'inspector-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  heading.tabIndex = 0;
  heading.setAttribute('role', 'button');
  heading.setAttribute('aria-expanded', 'true');
  const toggle = (): void => {
    const collapsed = section.classList.toggle('is-collapsed');
    heading.setAttribute('aria-expanded', String(!collapsed));
  };
  heading.addEventListener('click', toggle);
  heading.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
  section.append(heading, ...children);
  return section;
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
  wrapper.className = 'inspector-field';
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
