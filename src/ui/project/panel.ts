import { optional } from '../dom.js';
import type { ProjectStore } from './store.js';
import type { ElementView, SceneView, TurnView } from './types.js';

const GESTURES = ['neutral', 'point'];
const TRANSITIONS = ['cut', 'fade'];
const MAX_SCENES_PER_REORDER = 8;

export function initProjectEditor(store: ProjectStore): void {
  const root = optional<HTMLElement>('#project-editor');
  const strip = optional<HTMLElement>('#scene-strip');
  const inspector = optional<HTMLElement>('#scene-inspector');
  const status = optional<HTMLElement>('#project-status');
  if (!root || !strip || !inspector) return;
  root.hidden = false;

  const titleInput = optional<HTMLInputElement>('#project-title');
  const undoBtn = optional<HTMLButtonElement>('#project-undo');
  const redoBtn = optional<HTMLButtonElement>('#project-redo');
  const toolUndo = optional<HTMLButtonElement>('#tool-undo');
  const toolRedo = optional<HTMLButtonElement>('#tool-redo');
  const validateBtn = optional<HTMLButtonElement>('#project-validate');
  const exportBtn = optional<HTMLButtonElement>('#project-export');

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

  titleInput?.addEventListener('change', () => {
    const title = titleInput.value.trim();
    if (title) send({ type: 'set-project-title', title });
  });

  const doUndo = (): void => { store.undo(); report(null); };
  const doRedo = (): void => { store.redo(); report(null); };
  undoBtn?.addEventListener('click', doUndo);
  redoBtn?.addEventListener('click', doRedo);
  toolUndo?.addEventListener('click', doUndo);
  toolRedo?.addEventListener('click', doRedo);

  validateBtn?.addEventListener('click', () => {
    const error = store.validate();
    report(error ?? 'Proyecto válido.', error === null);
  });

  exportBtn?.addEventListener('click', () => {
    const blob = new Blob([store.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${store.project().id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    report('Proyecto exportado como JSON.', true);
  });

  function moveScene(sceneId: string, delta: number): void {
    const ids = store.project().scenes.map((scene) => scene.id);
    const from = ids.indexOf(sceneId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    if (ids.length > MAX_SCENES_PER_REORDER) {
      report(`El motor admite reordenar hasta ${MAX_SCENES_PER_REORDER} escenas.`);
      return;
    }
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    send({ type: 'reorder-scenes', sceneIds: ids });
  }

  function renderStrip(): void {
    const project = store.project();
    const selectedId = store.selectedSceneId();
    const nodes: HTMLElement[] = [];

    project.scenes.forEach((scene, index) => {
      const chip = document.createElement('div');
      chip.className = 'scene-chip';
      chip.classList.toggle('is-selected', scene.id === selectedId);

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'scene-chip-select';
      select.setAttribute('aria-pressed', String(scene.id === selectedId));
      const name = document.createElement('span');
      name.className = 'scene-chip-title';
      name.textContent = scene.title;
      // La duración real la produce el motor tras el render; nunca se estima acá.
      const pending = document.createElement('span');
      pending.className = 'scene-chip-duration';
      pending.textContent = 'duración pendiente';
      select.append(name, pending);
      select.addEventListener('click', () => send({ type: 'select-scene', sceneId: scene.id }));

      const move = document.createElement('span');
      move.className = 'scene-chip-move';
      move.append(
        moveButton('◀', 'Mover antes', index === 0, () => moveScene(scene.id, -1)),
        moveButton('▶', 'Mover después', index === project.scenes.length - 1, () => moveScene(scene.id, 1)),
      );

      chip.append(select, move);
      nodes.push(chip);

      if (index < project.scenes.length - 1) {
        const badge = document.createElement('span');
        const preset = scene.transitionToNext?.preset ?? 'cut';
        badge.className = `transition-badge transition-${preset}`;
        badge.textContent = preset === 'fade'
          ? `fade ${scene.transitionToNext?.durationSeconds ?? 0}s`
          : 'cut';
        nodes.push(badge);
      }
    });

    strip!.replaceChildren(...nodes);
  }

  function renderInspector(): void {
    const project = store.project();
    const scene = project.scenes.find((item) => item.id === store.selectedSceneId());
    if (!scene) {
      inspector!.replaceChildren(note('No hay escena seleccionada.'));
      return;
    }
    inspector!.replaceChildren(
      sceneSection(scene),
      backgroundSection(scene),
      transitionSection(scene),
      elementsSection(scene),
      dialogueSection(scene),
    );
  }

  function sceneSection(scene: SceneView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = scene.title;
    input.maxLength = 120;
    input.addEventListener('change', () => {
      const title = input.value.trim();
      if (title) send({ type: 'set-scene-title', sceneId: scene.id, title });
    });
    return group('Escena', [field('Título', input)]);
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
    const preset = select(TRANSITIONS.map((value) => ({ value, label: value })), scene.transitionToNext?.preset ?? 'cut');
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

    for (const element of scene.elements) {
      if (element.type !== 'character') {
        // No existe comando para editar elementos de texto todavía.
        fields.push(note(`«${element.id}» (${element.type}): sin comando de edición en el contrato.`));
        continue;
      }
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

      fields.push(subheading(element.id));
      fields.push(field('Personaje', resource));
      fields.push(transformField(scene, element, 'x', 'X', -1080, 2160, 1));
      fields.push(transformField(scene, element, 'y', 'Y', -1920, 3840, 1));
      fields.push(transformField(scene, element, 'scale', 'Escala', 0.01, 10, 0.01));
      fields.push(transformField(scene, element, 'zIndex', 'zIndex', -1000, 1000, 1));
      if (element.poseId) {
        fields.push(note(`Pose actual «${element.poseId}»: sin comando de edición en el contrato.`));
      }
    }
    return group('Elementos', fields);
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

  function dialogueSection(scene: SceneView): HTMLElement {
    const voices = store.resources('voice');
    const fields: HTMLElement[] = [];

    for (const turn of scene.dialogue) {
      fields.push(subheading(`${turn.id} · ${turn.speakerElementId}`));
      fields.push(field('Texto', dialogueText(scene, turn)));

      const voice = select(voices.map((entry) => ({ value: entry.id, label: entry.label })), turn.voiceId);
      voice.addEventListener('change', () => send({
        type: 'set-dialogue-turn', sceneId: scene.id, turnId: turn.id, voiceId: voice.value,
      }));
      fields.push(field('Voz', voice));

      const gesture = select(GESTURES.map((value) => ({ value, label: value })), turn.gestureId);
      gesture.addEventListener('change', () => send({
        type: 'set-dialogue-turn', sceneId: scene.id, turnId: turn.id, gestureId: gesture.value,
      }));
      fields.push(field('Gesto', gesture));

      const gap = document.createElement('input');
      gap.type = 'number';
      gap.min = '0';
      gap.max = '5';
      gap.step = '0.05';
      gap.value = String(turn.gapAfterSeconds);
      gap.addEventListener('change', () => send({
        type: 'set-dialogue-turn', sceneId: scene.id, turnId: turn.id, gapAfterSeconds: Number(gap.value),
      }));
      fields.push(field('Pausa después (s)', gap));
    }

    fields.push(note('La duración hablada la mide el motor con Piper/FFprobe al renderizar.'));
    return group('Diálogo', fields);
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
    const project = store.project();
    if (titleInput && document.activeElement !== titleInput) titleInput.value = project.title;
    const canUndo = store.canUndo();
    const canRedo = store.canRedo();
    for (const button of [undoBtn, toolUndo]) if (button) button.disabled = !canUndo;
    for (const button of [redoBtn, toolRedo]) if (button) button.disabled = !canRedo;
    renderStrip();
    renderInspector();
  }

  store.subscribe(render);
  render();
}

function moveButton(label: string, title: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'scene-chip-move-btn';
  button.textContent = label;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function group(title: string, children: HTMLElement[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'inspector-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading, ...children);
  return section;
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
