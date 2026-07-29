import { optional } from '../dom.js';
import { notify } from '../notifications.js';
import { showRightPanelPage } from '../right-panel.js';
import type { ProjectStore } from './store.js';
import type { SceneView, TurnView } from './types.js';
import { PROJECT_SELECTION_EVENT, selectProjectItem, type ProjectSelection } from './selection.js';

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
  });
  function renderInspector(): void {
    const project = store.project();
    const selectedScene = project.scenes.find((item) => item.id === store.selectedSceneId());
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
    const project = store.project();
    const selectedScene = project.scenes.find((scene) => scene.id === store.selectedSceneId()) ?? project.scenes[0];
    if (!selectedScene) return focusedView([note('No hay escenas disponibles.')]);
    const card = sceneControlCard(selectedScene, project.scenes.indexOf(selectedScene), [
      note('La edición manual vive en Edición. Elegí un elemento para abrir sus ajustes, pistas y keyframes sin duplicar el estado del proyecto.'),
    ]);
    for (const element of selectedScene.elements) {
      const open = actionButton(element.resourceId || element.id, () => {
        selectProjectItem({ kind: 'element', sceneId: selectedScene.id, elementId: element.id });
        showRightPanelPage('editing');
      });
      open.classList.add('full-button');
      card.append(open);
    }
    return focusedView([card]);
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
