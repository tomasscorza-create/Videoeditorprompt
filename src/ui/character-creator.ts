import {
  applyCharacterDesign,
  CHARACTER_PALETTE_KEYS,
  CHARACTER_PALETTE_PRESETS,
  type CharacterDesign,
} from '../../shared/character-design-presets.js';
import { optional } from './dom.js';
import {
  listCharacterDesigns,
  saveCharacterDesign,
  type SavedCharacterDesign,
} from './director/api.js';
import { showViewerSource } from './viewer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLOR_LABELS: Record<string, string> = {
  outline: 'Contorno',
  fur: 'Pelaje',
  lightFur: 'Rostro',
  suit: 'Ropa',
  shirt: 'Camisa',
  accent: 'Acento',
  white: 'Ojos',
  mouthDark: 'Boca',
  tongue: 'Lengua',
  shadow: 'Sombra',
};

let baseDefinition: Record<string, any> | null = null;
let savedDesigns: SavedCharacterDesign[] = [];
let design: CharacterDesign = createDefaultDesign();

export function initCharacterCreator(): void {
  optional<HTMLButtonElement>('[data-create-type="character"]')?.addEventListener('click', () => void openCreator());
  optional<HTMLButtonElement>('#character-creator-close')?.addEventListener('click', closeCreator);
  optional<HTMLButtonElement>('#character-save')?.addEventListener('click', () => void save());
  optional<HTMLSelectElement>('#character-existing')?.addEventListener('change', loadSelectedDesign);
  for (const id of ['character-accessory', 'character-headwear', 'character-pose', 'character-eyes', 'character-mouth']) {
    optional<HTMLSelectElement>(`#${id}`)?.addEventListener('change', render);
  }
  optional<HTMLInputElement>('#character-name')?.addEventListener('input', syncDesignFromControls);
  optional<HTMLSelectElement>('#character-palette-preset')?.addEventListener('change', applyPalettePreset);
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('[data-character-layer]')) {
    checkbox.addEventListener('change', render);
  }
  buildColorControls();
}

async function openCreator(): Promise<void> {
  optional<HTMLDetailsElement>('#create-menu')?.removeAttribute('open');
  setStatus('Cargando plantilla y diseños…', false);
  try {
    const [definitionResponse, designs] = await Promise.all([
      fetch('/assets/character-definitions/mono-parametrico-v1.json', { cache: 'no-store' }),
      listCharacterDesigns(),
    ]);
    if (!definitionResponse.ok) throw new Error('No se pudo cargar la plantilla paramétrica.');
    baseDefinition = await definitionResponse.json() as Record<string, any>;
    savedDesigns = designs;
    populateSavedDesigns();
    optional<HTMLElement>('#resource-library')!.hidden = true;
    optional<HTMLElement>('#character-creator-panel')!.hidden = false;
    const sourceButton = optional<HTMLButtonElement>('#source-character');
    if (sourceButton) sourceButton.hidden = false;
    showViewerSource('character');
    syncControlsFromDesign();
    setStatus('Editá las capas y guardá una variante cuando esté lista.', false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo abrir el diseñador.', true);
  }
}

function closeCreator(): void {
  optional<HTMLElement>('#character-creator-panel')!.hidden = true;
  optional<HTMLElement>('#resource-library')!.hidden = false;
  const sourceButton = optional<HTMLButtonElement>('#source-character');
  if (sourceButton) sourceButton.hidden = true;
  showViewerSource('composition');
}

function createDefaultDesign(): CharacterDesign {
  return {
    version: 1,
    preset: 'mono-parametrico-v1',
    name: 'Mi personaje',
    accessory: 'none',
    headwear: 'none',
    palette: structuredClone(CHARACTER_PALETTE_PRESETS.azul),
  };
}

function populateSavedDesigns(): void {
  const select = optional<HTMLSelectElement>('#character-existing');
  if (!select) return;
  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'Nuevo personaje';
  select.replaceChildren(first, ...savedDesigns.map((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name} (editar copia)`;
    return option;
  }));
}

function loadSelectedDesign(): void {
  const id = optional<HTMLSelectElement>('#character-existing')?.value;
  const selected = savedDesigns.find((item) => item.id === id);
  design = selected ? structuredClone(selected.design) : createDefaultDesign();
  syncControlsFromDesign();
  setStatus(selected ? 'Estás editando una copia; el personaje original no se modificará.' : 'Nuevo diseño.', false);
}

function buildColorControls(): void {
  const root = optional<HTMLElement>('#character-color-controls');
  if (!root) return;
  root.replaceChildren(...CHARACTER_PALETTE_KEYS.map((key) => {
    const label = document.createElement('label');
    label.className = 'character-color-field';
    const text = document.createElement('span');
    text.textContent = COLOR_LABELS[key] || key;
    const input = document.createElement('input');
    input.type = 'color';
    input.dataset.paletteKey = key;
    input.addEventListener('input', () => {
      design.palette[key] = input.value;
      const preset = optional<HTMLSelectElement>('#character-palette-preset');
      if (preset) preset.value = 'custom';
      render();
    });
    label.append(text, input);
    return label;
  }));
}

function syncControlsFromDesign(): void {
  const name = optional<HTMLInputElement>('#character-name');
  const accessory = optional<HTMLSelectElement>('#character-accessory');
  const headwear = optional<HTMLSelectElement>('#character-headwear');
  if (name) name.value = design.name;
  if (accessory) accessory.value = design.accessory;
  if (headwear) headwear.value = design.headwear;
  const matchingPreset = Object.entries(CHARACTER_PALETTE_PRESETS)
    .find(([, palette]) => JSON.stringify(palette) === JSON.stringify(design.palette))?.[0] || 'custom';
  const preset = optional<HTMLSelectElement>('#character-palette-preset');
  if (preset) preset.value = matchingPreset;
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-palette-key]')) {
    input.value = normalizeColorForInput(design.palette[input.dataset.paletteKey || '']);
  }
  render();
}

function syncDesignFromControls(): void {
  design.name = optional<HTMLInputElement>('#character-name')?.value.trim() || '';
  design.accessory = (optional<HTMLSelectElement>('#character-accessory')?.value || 'none') as CharacterDesign['accessory'];
  design.headwear = (optional<HTMLSelectElement>('#character-headwear')?.value || 'none') as CharacterDesign['headwear'];
}

function applyPalettePreset(): void {
  const preset = optional<HTMLSelectElement>('#character-palette-preset')?.value || 'custom';
  if (preset !== 'custom' && CHARACTER_PALETTE_PRESETS[preset]) {
    design.palette = structuredClone(CHARACTER_PALETTE_PRESETS[preset]);
    syncControlsFromDesign();
  }
}

function render(): void {
  if (!baseDefinition) return;
  syncDesignFromControls();
  const svg = optional<SVGSVGElement>('#character-creator-canvas');
  if (!svg) return;
  const definition = applyCharacterDesign(baseDefinition, design, 'preview-character');
  const layers = definition.layers;
  const pose = optional<HTMLSelectElement>('#character-pose')?.value || 'neutral';
  const eyes = optional<HTMLSelectElement>('#character-eyes')?.value || 'open';
  const mouth = optional<HTMLSelectElement>('#character-mouth')?.value || 'closed';
  const visible = new Set(
    [...document.querySelectorAll<HTMLInputElement>('[data-character-layer]:checked')]
      .map((input) => input.dataset.characterLayer),
  );
  const shapes = [
    ...(visible.has('body') ? layers.body : []),
    ...(visible.has('eyes') ? layers.eyes[eyes] : []),
    ...(visible.has('mouth') ? layers.mouth[mouth] : []),
    ...(visible.has('hands') ? layers.hands[pose] : []),
  ];
  svg.replaceChildren(...shapes.map((shape: Record<string, any>) => renderShape(shape, design.palette)));
}

function renderShape(shape: Record<string, any>, palette: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, shape.type);
  const attributes: Record<string, string | number | undefined> = shape.type === 'ellipse'
    ? { cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry }
    : shape.type === 'rect'
      ? { x: shape.x, y: shape.y, width: shape.width, height: shape.height, rx: shape.rx, ry: shape.ry }
      : shape.type === 'polygon'
        ? { points: shape.points.map((point: { x: number; y: number }) => `${point.x},${point.y}`).join(' ') }
        : { d: shape.d };
  attributes.fill = resolvePaint(shape.fill, palette);
  attributes.stroke = resolvePaint(shape.stroke, palette);
  attributes['stroke-width'] = shape.strokeWidth;
  attributes['stroke-linecap'] = shape.lineCap;
  attributes['stroke-linejoin'] = shape.lineJoin;
  if (shape.rotationDegrees) attributes.transform = `rotate(${shape.rotationDegrees} ${shape.cx || 540} ${shape.cy || 960})`;
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) node.setAttribute(name, String(value));
  }
  return node;
}

function resolvePaint(value: unknown, palette: Record<string, string>): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.startsWith('$') ? palette[value.slice(1)] : value;
}

async function save(): Promise<void> {
  syncDesignFromControls();
  if (!design.name) {
    setStatus('Escribí un nombre para guardar el personaje.', true);
    return;
  }
  const button = optional<HTMLButtonElement>('#character-save');
  if (button) button.disabled = true;
  setStatus('Compilando capas, poses y miniaturas…', false);
  try {
    const result = await saveCharacterDesign(design);
    sessionStorage.setItem('local-video.library-active-tab', 'character');
    setStatus(
      result.created
        ? `${result.resource.label} quedó guardado y disponible. Recargando la biblioteca…`
        : `${result.resource.label} ya existía. Recargando la biblioteca…`,
      false,
    );
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo guardar el personaje.', true);
    if (button) button.disabled = false;
  }
}

function setStatus(message: string, error: boolean): void {
  const status = optional<HTMLElement>('#character-creator-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', error);
}

function normalizeColorForInput(value: string): string {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value : `#${value.slice(1, 7).padEnd(6, '0')}`;
}
