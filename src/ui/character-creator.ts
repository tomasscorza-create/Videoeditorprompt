import {
  applyCharacterDesign,
  CHARACTER_PALETTE_KEYS,
  CHARACTER_PALETTE_PRESETS,
  createCustomPart,
  createDefaultCustomCharacterDesign,
  createEmptyCustomCharacterDesign,
  customCharacterDesignIssues,
  CUSTOM_PART_ROLE_LABELS,
  type CharacterDesign,
  type CharacterRole,
  type CustomCharacterDesign,
  type CustomCharacterPart,
  type TemplateCharacterDesign,
} from '../../shared/character-design-presets.js';
import { shapeAttributes } from '../../shared/shape-renderer.js';
import { optional } from './dom.js';
import { showRightPanelPage } from './right-panel.js';
import { EDITOR_WORKSPACE_EVENT, editorWorkspace } from './editor-workspace.js';
import {
  listCharacterDesigns,
  saveCharacterDesign,
  type SavedCharacterDesign,
} from './director/api.js';
import { showViewerWorkspace } from './viewer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLOR_LABELS: Record<string, string> = {
  outline: 'Contorno', fur: 'Pelaje', lightFur: 'Rostro', suit: 'Ropa',
  shirt: 'Camisa', accent: 'Acento', white: 'Ojos', mouthDark: 'Boca',
  tongue: 'Lengua', shadow: 'Sombra',
};

let baseDefinition: Record<string, any> | null = null;
let savedDesigns: SavedCharacterDesign[] = [];
let templateDraft = createTemplateDesign();
let customDraft = createEmptyCustomCharacterDesign();
let design: CharacterDesign = templateDraft;
let selectedPartId = customDraft.parts.at(-1)?.id || null;
let draggingPartId: string | null = null;

export function initCharacterCreator(): void {
  optional<HTMLButtonElement>('[data-create-type="character"]')?.addEventListener('click', () => void openCreator());
  optional<HTMLButtonElement>('#character-creator-close')?.addEventListener('click', closeCreator);
  optional<HTMLButtonElement>('#character-save')?.addEventListener('click', () => void save());
  optional<HTMLButtonElement>('#character-mode-template')?.addEventListener('click', () => switchMode('template'));
  optional<HTMLButtonElement>('#character-mode-scratch')?.addEventListener('click', () => switchMode('scratch'));
  optional<HTMLSelectElement>('#character-existing')?.addEventListener('change', loadSelectedDesign);
  optional<HTMLInputElement>('#character-name')?.addEventListener('input', () => {
    design.name = optional<HTMLInputElement>('#character-name')?.value.trim() || '';
    rememberDraft();
  });
  for (const id of ['character-accessory', 'character-headwear', 'character-pose', 'character-eyes', 'character-mouth']) {
    optional<HTMLSelectElement>(`#${id}`)?.addEventListener('change', render);
  }
  optional<HTMLSelectElement>('#character-palette-preset')?.addEventListener('change', applyPalettePreset);
  optional<HTMLSelectElement>('#character-scratch-preview-state')?.addEventListener('change', render);
  optional<HTMLButtonElement>('#character-add-part')?.addEventListener('click', addPart);
  optional<HTMLButtonElement>('#character-empty-canvas')?.addEventListener('click', clearCustomCanvas);
  optional<HTMLButtonElement>('#character-load-minimal')?.addEventListener('click', loadMinimalBase);
  optional<HTMLButtonElement>('#character-part-up')?.addEventListener('click', () => movePart(1));
  optional<HTMLButtonElement>('#character-part-down')?.addEventListener('click', () => movePart(-1));
  optional<HTMLButtonElement>('#character-part-delete')?.addEventListener('click', deletePart);
  window.addEventListener(EDITOR_WORKSPACE_EVENT, () => {
    if (editorWorkspace().mode !== 'editor' || optional<HTMLElement>('#character-creator-panel')?.hidden) return;
    suspendCreator();
  });
  for (const checkbox of document.querySelectorAll<HTMLInputElement>('[data-character-layer]')) {
    checkbox.addEventListener('change', render);
  }
  for (const id of [
    'character-part-name', 'character-part-role', 'character-part-shape',
    'character-part-x', 'character-part-y', 'character-part-width', 'character-part-height',
    'character-part-rotation', 'character-part-fill', 'character-part-stroke',
    'character-part-stroke-width',
  ]) {
    optional<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.addEventListener('input', updateSelectedPart);
  }
  const canvas = optional<SVGSVGElement>('#character-creator-canvas');
  canvas?.addEventListener('pointerdown', startDrag);
  canvas?.addEventListener('pointermove', continueDrag);
  canvas?.addEventListener('pointerup', endDrag);
  canvas?.addEventListener('pointercancel', endDrag);
  buildColorControls();
  buildRoleOptions();
}

async function openCreator(): Promise<void> {
  showRightPanelPage('resources');
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
    optional<HTMLElement>('#creator-empty-state')!.hidden = true;
    optional<HTMLElement>('#character-view')!.hidden = false;
    showViewerWorkspace('creator');
    syncControlsFromDesign();
    setStatus('Elegí un camino de creación. Los diseños guardados se editan como copias.', false);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'No se pudo abrir el diseñador.', true);
  }
}

function closeCreator(): void {
  suspendCreator();
  showViewerWorkspace('editor');
}

function suspendCreator(): void {
  optional<HTMLElement>('#character-creator-panel')!.hidden = true;
  optional<HTMLElement>('#resource-library')!.hidden = false;
  optional<HTMLElement>('#creator-empty-state')!.hidden = false;
  optional<HTMLElement>('#character-view')!.hidden = true;
}

function createTemplateDesign(): TemplateCharacterDesign {
  return {
    version: 1,
    preset: 'mono-parametrico-v1',
    name: 'Mi personaje',
    accessory: 'none',
    headwear: 'none',
    palette: structuredClone(CHARACTER_PALETTE_PRESETS.azul),
  };
}

function switchMode(mode: 'template' | 'scratch'): void {
  design = mode === 'template' ? templateDraft : customDraft;
  if (mode === 'scratch' && !selectedPart()) selectedPartId = customDraft.parts.at(-1)?.id || null;
  const existing = optional<HTMLSelectElement>('#character-existing');
  if (existing) existing.value = '';
  syncControlsFromDesign();
  setStatus(
    mode === 'template'
      ? 'Modo rápido: personalizá una base animable.'
      : 'Modo desde cero: cada etiqueta funcional permite generar ojos, boca y gesto.',
    false,
  );
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
    option.textContent = `${item.name} · ${item.design.version === 2 ? 'desde cero' : 'plantilla'} (editar copia)`;
    return option;
  }));
}

function loadSelectedDesign(): void {
  const id = optional<HTMLSelectElement>('#character-existing')?.value;
  const selected = savedDesigns.find((item) => item.id === id);
  if (!selected) {
    switchMode(isCustomDesign(design) ? 'scratch' : 'template');
    return;
  }
  design = structuredClone(selected.design);
  if (isCustomDesign(design)) {
    customDraft = design;
    selectedPartId = design.parts.at(-1)?.id || null;
  } else {
    templateDraft = design;
  }
  syncControlsFromDesign();
  setStatus('Estás editando una copia; el personaje original no se modificará.', false);
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
      if (isCustomDesign(design)) return;
      design.palette[key] = input.value;
      const preset = optional<HTMLSelectElement>('#character-palette-preset');
      if (preset) preset.value = 'custom';
      templateDraft = design;
      render();
    });
    label.append(text, input);
    return label;
  }));
}

function buildRoleOptions(): void {
  const select = optional<HTMLSelectElement>('#character-part-role');
  if (!select) return;
  select.replaceChildren(...Object.entries(CUSTOM_PART_ROLE_LABELS).map(([role, label]) => {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = label;
    return option;
  }));
}

function syncControlsFromDesign(): void {
  const custom = isCustomDesign(design);
  optional<HTMLElement>('#character-template-editor')!.hidden = custom;
  optional<HTMLElement>('#character-scratch-editor')!.hidden = !custom;
  toggleModeButton('#character-mode-template', !custom);
  toggleModeButton('#character-mode-scratch', custom);
  const name = optional<HTMLInputElement>('#character-name');
  if (name) name.value = design.name;
  if (!isCustomDesign(design)) {
    const template = design;
    const accessory = optional<HTMLSelectElement>('#character-accessory');
    const headwear = optional<HTMLSelectElement>('#character-headwear');
    if (accessory) accessory.value = template.accessory;
    if (headwear) headwear.value = template.headwear;
    const matchingPreset = Object.entries(CHARACTER_PALETTE_PRESETS)
      .find(([, palette]) => JSON.stringify(palette) === JSON.stringify(template.palette))?.[0] || 'custom';
    const preset = optional<HTMLSelectElement>('#character-palette-preset');
    if (preset) preset.value = matchingPreset;
    for (const input of document.querySelectorAll<HTMLInputElement>('[data-palette-key]')) {
      input.value = normalizeColorForInput(template.palette[input.dataset.paletteKey || '']);
    }
  } else {
    renderPartsList();
    syncPartInspector();
  }
  render();
}

function toggleModeButton(selector: string, active: boolean): void {
  const button = optional<HTMLButtonElement>(selector);
  button?.classList.toggle('is-active', active);
  button?.setAttribute('aria-selected', String(active));
}

function syncTemplateFromControls(): void {
  if (isCustomDesign(design)) return;
  design.name = optional<HTMLInputElement>('#character-name')?.value.trim() || '';
  design.accessory = (optional<HTMLSelectElement>('#character-accessory')?.value || 'none') as TemplateCharacterDesign['accessory'];
  design.headwear = (optional<HTMLSelectElement>('#character-headwear')?.value || 'none') as TemplateCharacterDesign['headwear'];
  templateDraft = design;
}

function applyPalettePreset(): void {
  if (isCustomDesign(design)) return;
  const preset = optional<HTMLSelectElement>('#character-palette-preset')?.value || 'custom';
  if (preset !== 'custom' && CHARACTER_PALETTE_PRESETS[preset]) {
    design.palette = structuredClone(CHARACTER_PALETTE_PRESETS[preset]);
    templateDraft = design;
    syncControlsFromDesign();
  }
}

function addPart(): void {
  if (!isCustomDesign(design) || design.parts.length >= 40) return;
  const role = (optional<HTMLSelectElement>('#character-add-role')?.value || 'accessory') as CharacterRole;
  let index = design.parts.length;
  let part = createCustomPart(role, index);
  while (design.parts.some((candidate) => candidate.id === part.id)) {
    index += 1;
    part = createCustomPart(role, index);
  }
  design.parts.push(part);
  selectedPartId = part.id;
  customDraft = design;
  syncControlsFromDesign();
}

function clearCustomCanvas(): void {
  if (!isCustomDesign(design)) return;
  design.parts = [];
  selectedPartId = null;
  customDraft = design;
  syncControlsFromDesign();
  setStatus('Lienzo vacío. Agregá y etiquetá las piezas funcionales una por una.', false);
}

function loadMinimalBase(): void {
  if (!isCustomDesign(design)) return;
  const name = design.name;
  design = createDefaultCustomCharacterDesign();
  design.name = name;
  customDraft = design;
  selectedPartId = design.parts.at(-1)?.id || null;
  syncControlsFromDesign();
  setStatus('Base geométrica mínima cargada. Todas sus piezas siguen siendo editables.', false);
}

function selectedPart(): CustomCharacterPart | null {
  return isCustomDesign(design)
    ? design.parts.find((part) => part.id === selectedPartId) || null
    : null;
}

function renderPartsList(): void {
  const root = optional<HTMLElement>('#character-parts-list');
  if (!root || !isCustomDesign(design)) return;
  root.replaceChildren(...[...design.parts].reverse().map((part) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'character-part-row';
    button.classList.toggle('is-active', part.id === selectedPartId);
    button.dataset.partId = part.id;
    const swatch = document.createElement('span');
    swatch.className = 'character-part-swatch';
    swatch.style.background = part.fill;
    const copy = document.createElement('span');
    copy.className = 'character-part-copy';
    const name = document.createElement('strong');
    name.textContent = part.name;
    const role = document.createElement('small');
    role.textContent = CUSTOM_PART_ROLE_LABELS[part.role];
    copy.append(name, role);
    button.append(swatch, copy);
    button.addEventListener('click', () => {
      selectedPartId = part.id;
      syncPartInspector();
      renderPartsList();
      render();
    });
    return button;
  }));
  updateCustomValidation();
}

function syncPartInspector(): void {
  const part = selectedPart();
  const inspector = optional<HTMLFieldSetElement>('#character-part-inspector');
  if (inspector) inspector.disabled = !part;
  if (!part) return;
  setInputValue('#character-part-name', part.name);
  setInputValue('#character-part-role', part.role);
  setInputValue('#character-part-shape', part.shape);
  setInputValue('#character-part-x', part.x);
  setInputValue('#character-part-y', part.y);
  setInputValue('#character-part-width', part.width);
  setInputValue('#character-part-height', part.height);
  setInputValue('#character-part-rotation', part.rotationDegrees);
  setInputValue('#character-part-fill', normalizeColorForInput(part.fill));
  setInputValue('#character-part-stroke', normalizeColorForInput(part.stroke));
  setInputValue('#character-part-stroke-width', part.strokeWidth);
}

function setInputValue(selector: string, value: string | number): void {
  const input = optional<HTMLInputElement | HTMLSelectElement>(selector);
  if (input) input.value = String(value);
}

function updateSelectedPart(): void {
  const part = selectedPart();
  if (!part) return;
  part.name = optional<HTMLInputElement>('#character-part-name')?.value.trim() || part.name;
  part.role = (optional<HTMLSelectElement>('#character-part-role')?.value || part.role) as CharacterRole;
  part.shape = (optional<HTMLSelectElement>('#character-part-shape')?.value || part.shape) as CustomCharacterPart['shape'];
  part.x = numberValue('#character-part-x', part.x, 0, 1080);
  part.y = numberValue('#character-part-y', part.y, 0, 1920);
  part.width = numberValue('#character-part-width', part.width, 10, 1080);
  part.height = numberValue('#character-part-height', part.height, 10, 1920);
  part.rotationDegrees = numberValue('#character-part-rotation', part.rotationDegrees, -180, 180);
  part.fill = optional<HTMLInputElement>('#character-part-fill')?.value || part.fill;
  part.stroke = optional<HTMLInputElement>('#character-part-stroke')?.value || part.stroke;
  part.strokeWidth = numberValue('#character-part-stroke-width', part.strokeWidth, 0, 80);
  customDraft = design as CustomCharacterDesign;
  renderPartsList();
  render();
}

function numberValue(selector: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(optional<HTMLInputElement>(selector)?.value);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function movePart(direction: -1 | 1): void {
  if (!isCustomDesign(design)) return;
  const index = design.parts.findIndex((part) => part.id === selectedPartId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= design.parts.length) return;
  [design.parts[index], design.parts[target]] = [design.parts[target], design.parts[index]];
  customDraft = design;
  renderPartsList();
  render();
}

function deletePart(): void {
  if (!isCustomDesign(design)) return;
  const index = design.parts.findIndex((part) => part.id === selectedPartId);
  if (index < 0) return;
  design.parts.splice(index, 1);
  selectedPartId = design.parts[Math.min(index, design.parts.length - 1)]?.id || null;
  customDraft = design;
  syncControlsFromDesign();
}

function render(): void {
  if (!baseDefinition) return;
  if (!isCustomDesign(design)) syncTemplateFromControls();
  const svg = optional<SVGSVGElement>('#character-creator-canvas');
  if (!svg) return;
  if (isCustomDesign(design) && scratchPreviewState() === 'design') {
    const elements = design.parts.map((part) => renderEditablePart(part));
    svg.replaceChildren(...elements);
    return;
  }
  const definition = applyCharacterDesign(baseDefinition, design, 'preview-character');
  const layers = definition.layers;
  let pose = optional<HTMLSelectElement>('#character-pose')?.value || 'neutral';
  let eyes = optional<HTMLSelectElement>('#character-eyes')?.value || 'open';
  let mouth = optional<HTMLSelectElement>('#character-mouth')?.value || 'closed';
  if (isCustomDesign(design)) {
    const state = scratchPreviewState();
    pose = state === 'point' ? 'point' : 'neutral';
    eyes = state === 'blink' ? 'closed' : 'open';
    mouth = state === 'talk' ? 'open' : 'closed';
  }
  const visible = new Set(
    [...document.querySelectorAll<HTMLInputElement>('[data-character-layer]:checked')]
      .map((input) => input.dataset.characterLayer),
  );
  const shapes = [
    ...(!isCustomDesign(design) && !visible.has('body') ? [] : layers.body),
    ...(!isCustomDesign(design) && !visible.has('eyes') ? [] : layers.eyes[eyes]),
    ...(!isCustomDesign(design) && !visible.has('mouth') ? [] : layers.mouth[mouth]),
    ...(!isCustomDesign(design) && !visible.has('hands') ? [] : layers.hands[pose]),
  ];
  svg.replaceChildren(...shapes.map((shape: Record<string, any>) => renderShape(shape, definition.variants[0].palette)));
}

function renderEditablePart(part: CustomCharacterPart): SVGElement {
  const shape = part.shape === 'ellipse'
    ? {
        type: 'ellipse', cx: part.x, cy: part.y, rx: part.width / 2, ry: part.height / 2,
        fill: part.fill, stroke: part.stroke, strokeWidth: part.strokeWidth, rotationDegrees: part.rotationDegrees,
      }
    : {
        type: 'rect', x: part.x - part.width / 2, y: part.y - part.height / 2,
        width: part.width, height: part.height, rx: Math.min(part.width, part.height) * .35,
        fill: part.fill, stroke: part.stroke, strokeWidth: part.strokeWidth, rotationDegrees: part.rotationDegrees,
      };
  const node = renderShape(shape, {});
  node.dataset.partId = part.id;
  node.classList.add('character-editable-part');
  if (part.id === selectedPartId) {
    node.classList.add('is-selected');
    node.setAttribute('stroke', '#72dfbc');
    node.setAttribute('stroke-width', String(Math.max(16, part.strokeWidth)));
  }
  return node;
}

// La geometría, la pintura y la rotación las resuelve `shared/shape-renderer.js`,
// el mismo módulo que usa el compilador de assets. Acá solo se materializan los
// atributos sobre un nodo del DOM. Antes había dos implementaciones y divergían
// en `opacity`: el Creador la ignoraba y el video la aplicaba.
function renderShape(shape: Record<string, any>, palette: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, shape.type);
  for (const [name, value] of shapeAttributes(shape, palette)) {
    if (value !== undefined) node.setAttribute(name, String(value));
  }
  return node;
}

function scratchPreviewState(): string {
  return optional<HTMLSelectElement>('#character-scratch-preview-state')?.value || 'design';
}

function startDrag(event: PointerEvent): void {
  if (!isCustomDesign(design) || scratchPreviewState() !== 'design') return;
  const target = (event.target as SVGElement).closest<SVGElement>('[data-part-id]');
  const partId = target?.dataset.partId;
  if (!partId) return;
  selectedPartId = partId;
  draggingPartId = partId;
  optional<SVGSVGElement>('#character-creator-canvas')?.setPointerCapture(event.pointerId);
  syncPartInspector();
  renderPartsList();
  continueDrag(event);
}

function continueDrag(event: PointerEvent): void {
  if (!draggingPartId || !isCustomDesign(design)) return;
  const part = design.parts.find((candidate) => candidate.id === draggingPartId);
  const canvas = optional<SVGSVGElement>('#character-creator-canvas');
  if (!part || !canvas) return;
  const bounds = canvas.getBoundingClientRect();
  part.x = Math.round(Math.max(0, Math.min(1080, (event.clientX - bounds.left) / bounds.width * 1080)));
  part.y = Math.round(Math.max(0, Math.min(1920, (event.clientY - bounds.top) / bounds.height * 1920)));
  customDraft = design;
  syncPartInspector();
  render();
}

function endDrag(event: PointerEvent): void {
  if (!draggingPartId) return;
  optional<SVGSVGElement>('#character-creator-canvas')?.releasePointerCapture(event.pointerId);
  draggingPartId = null;
}

function updateCustomValidation(): void {
  const status = optional<HTMLElement>('#character-parts-validation');
  if (!status || !isCustomDesign(design)) return;
  const issues = customCharacterDesignIssues(design);
  status.textContent = issues.length
    ? issues.join(' ')
    : `${design.parts.length} capas · todas las piezas necesarias están identificadas.`;
  status.classList.toggle('error', issues.length > 0);
  status.classList.toggle('ok', issues.length === 0);
}

function rememberDraft(): void {
  if (isCustomDesign(design)) customDraft = design;
  else templateDraft = design;
}

async function save(): Promise<void> {
  design.name = optional<HTMLInputElement>('#character-name')?.value.trim() || '';
  rememberDraft();
  if (!design.name) {
    setStatus('Escribí un nombre para guardar el personaje.', true);
    return;
  }
  if (isCustomDesign(design)) {
    const issues = customCharacterDesignIssues(design);
    if (issues.length) {
      setStatus(`No se puede animar todavía: ${issues.join(' ')}`, true);
      return;
    }
  }
  const button = optional<HTMLButtonElement>('#character-save');
  if (button) button.disabled = true;
  setStatus('Compilando capas, estados de boca, ojos y poses…', false);
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

function isCustomDesign(value: CharacterDesign): value is CustomCharacterDesign {
  return value.version === 2;
}
