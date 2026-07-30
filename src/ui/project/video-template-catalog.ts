import {
  PROCEDURAL_PAGE_LAYOUTS,
  type ProceduralPageLayout,
  type ProceduralPageStyle,
} from '../../../shared/video-template-page.js';

export type { ProceduralPageLayout, ProceduralPageStyle };

export const VIDEO_TEMPLATE_CATALOG_URL = '/assets/catalog/video-templates.json';
export const OPEN_VIDEO_TEMPLATE_EVENT = 'local-video:open-video-template';

export interface VideoTemplateCategory {
  id: string;
  label: string;
  description: string;
}

export interface VideoTemplateSummary {
  id: string;
  label: string;
  description: string;
  categoryId: string;
  tags: string[];
  definitionPath: string;
  thumbnail?: string;
}

export interface VideoTemplateCatalog {
  version: number;
  categories: VideoTemplateCategory[];
  templates: VideoTemplateSummary[];
}

export interface VideoTemplateTextField {
  id: string;
  type: 'text';
  label: string;
  placeholder: string;
  minLength: number;
  maxLength: number;
}

export interface ProceduralWordMatchCutDefinition {
  version: 2;
  id: string;
  kind: 'procedural-word-match-cut';
  label: string;
  durationSeconds: number;
  fps: number;
  cutFrames: number;
  sequence: number[];
  pageStyles: ProceduralPageStyle[];
  defaultValues: { word: string };
  fields: VideoTemplateTextField[];
}

export type VideoTemplateDefinition = ProceduralWordMatchCutDefinition;

export async function loadVideoTemplateCatalog(): Promise<VideoTemplateCatalog> {
  const response = await fetch(VIDEO_TEMPLATE_CATALOG_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo cargar el catálogo de plantillas.');
  return parseVideoTemplateCatalog(await response.json());
}

export function parseVideoTemplateCatalog(value: unknown): VideoTemplateCatalog {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.categories) || !Array.isArray(value.templates)) {
    throw new Error('El catálogo de plantillas no tiene un formato compatible.');
  }
  const categories = value.categories.map(parseCategory);
  const categoryIds = new Set(categories.map((category) => category.id));
  const templates = value.templates.map((template) => parseTemplate(template, categoryIds));
  if (new Set(categories.map((category) => category.id)).size !== categories.length
    || new Set(templates.map((template) => template.id)).size !== templates.length) {
    throw new Error('El catálogo de plantillas contiene identificadores repetidos.');
  }
  return { version: 1, categories, templates };
}

export function openVideoTemplate(template: VideoTemplateSummary): void {
  window.dispatchEvent(new CustomEvent<VideoTemplateSummary>(OPEN_VIDEO_TEMPLATE_EVENT, { detail: template }));
}

export async function loadVideoTemplateDefinition(template: VideoTemplateSummary): Promise<VideoTemplateDefinition> {
  const response = await fetch(`/${template.definitionPath}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo cargar la definición de la plantilla.');
  return parseVideoTemplateDefinition(await response.json(), template.id);
}

export function parseVideoTemplateDefinition(value: unknown, expectedId?: string): VideoTemplateDefinition {
  if (!isRecord(value) || value.version !== 2
    || value.kind !== 'procedural-word-match-cut'
    || !isNonEmptyString(value.id) || (expectedId !== undefined && value.id !== expectedId)
    || !isNonEmptyString(value.label) || !isFiniteInRange(value.durationSeconds, 0.5, 30)
    || !Number.isInteger(value.fps) || !isFiniteInRange(value.fps, 12, 60)
    || !Number.isInteger(value.cutFrames) || !isFiniteInRange(value.cutFrames, 2, 30)
    || !Array.isArray(value.sequence) || value.sequence.length < 4 || value.sequence.length > 240
    || !isRecord(value.defaultValues) || !isNonEmptyString(value.defaultValues.word)
    || !Array.isArray(value.fields) || value.fields.length !== 1) {
    throw new Error('La definición de la plantilla no tiene un formato compatible.');
  }
  const field = parseTextField(value.fields[0]);
  if (field.id !== 'word' || value.defaultValues.word.length > field.maxLength) {
    throw new Error('La palabra de la plantilla es inválida.');
  }
  const itemCount = Array.isArray(value.pageStyles) ? value.pageStyles.length : 0;
  if (itemCount < 4 || itemCount > 40
    || !value.sequence.every((index) => Number.isInteger(index) && index >= 0 && index < itemCount)) {
    throw new Error('La palabra o la secuencia de la plantilla es inválida.');
  }
  const expectedDuration = value.sequence.length * value.cutFrames / value.fps;
  if (Math.abs(value.durationSeconds - expectedDuration) > 1 / value.fps) {
    throw new Error('La duración de la plantilla no coincide con su secuencia.');
  }
  return {
    version: 2,
    id: value.id,
    label: value.label,
    kind: 'procedural-word-match-cut',
    durationSeconds: value.durationSeconds,
    fps: value.fps,
    cutFrames: value.cutFrames,
    sequence: [...value.sequence] as number[],
    defaultValues: { word: value.defaultValues.word },
    fields: [field],
    pageStyles: (value.pageStyles as unknown[]).map(parseProceduralPageStyle),
  };
}

function parseProceduralPageStyle(value: unknown): ProceduralPageStyle {
  if (!isRecord(value)
    || !(PROCEDURAL_PAGE_LAYOUTS as readonly string[]).includes(String(value.layout))
    || !Number.isInteger(value.seed) || !isFiniteInRange(value.seed, 1, 2147483647)
    || !isNonEmptyString(value.fontFamily) || !['normal', 'italic'].includes(String(value.fontStyle))
    || !Number.isInteger(value.fontWeight) || !isFiniteInRange(value.fontWeight, 300, 900)
    || !isFiniteInRange(value.fontSize, 20, 90) || !isFiniteInRange(value.lineHeight, 1.05, 2)
    || !isHexColor(value.paperColor) || !isHexColor(value.inkColor) || !isHexColor(value.highlightColor)
    || !isFiniteInRange(value.age, 0, 1) || !isFiniteInRange(value.bleed, 0, 1)
    || !isNonEmptyString(value.leftPhrase) || !isNonEmptyString(value.rightPhrase)
    || value.leftPhrase.length > 80 || value.rightPhrase.length > 80) {
    throw new Error('Un estilo procedural de página es inválido.');
  }
  return {
    layout: value.layout as ProceduralPageLayout,
    seed: value.seed,
    fontFamily: value.fontFamily,
    fontStyle: value.fontStyle as 'normal' | 'italic',
    fontWeight: value.fontWeight,
    fontSize: value.fontSize,
    lineHeight: value.lineHeight,
    paperColor: value.paperColor,
    inkColor: value.inkColor,
    highlightColor: value.highlightColor,
    age: value.age,
    bleed: value.bleed,
    leftPhrase: value.leftPhrase,
    rightPhrase: value.rightPhrase,
  };
}

function parseCategory(value: unknown): VideoTemplateCategory {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.label)
    || !isNonEmptyString(value.description)) {
    throw new Error('Una categoría del catálogo de plantillas es inválida.');
  }
  return { id: value.id, label: value.label, description: value.description };
}

function parseTemplate(value: unknown, categoryIds: ReadonlySet<string>): VideoTemplateSummary {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.label)
    || !isNonEmptyString(value.description) || !isNonEmptyString(value.categoryId)
    || !categoryIds.has(value.categoryId) || !Array.isArray(value.tags)
    || !value.tags.every(isNonEmptyString) || !isPortableJsonPath(value.definitionPath)
    || (value.thumbnail !== undefined && !isPortablePath(value.thumbnail))) {
    throw new Error('Una plantilla del catálogo es inválida.');
  }
  return {
    id: value.id,
    label: value.label,
    description: value.description,
    categoryId: value.categoryId,
    tags: [...value.tags],
    definitionPath: value.definitionPath,
    ...(value.thumbnail ? { thumbnail: value.thumbnail } : {}),
  };
}

function parseTextField(value: unknown): VideoTemplateTextField {
  if (!isRecord(value) || value.type !== 'text' || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.label) || !isNonEmptyString(value.placeholder)
    || !Number.isInteger(value.minLength) || !isFiniteInRange(value.minLength, 1, 24)
    || !Number.isInteger(value.maxLength) || !isFiniteInRange(value.maxLength, value.minLength as number, 80)) {
    throw new Error('Un campo editable de la plantilla es inválido.');
  }
  return {
    id: value.id,
    type: 'text',
    label: value.label,
    placeholder: value.placeholder,
    minLength: value.minLength,
    maxLength: value.maxLength,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isPortableJsonPath(value: unknown): value is string {
  return isPortablePath(value) && value.toLowerCase().endsWith('.json');
}

function isPortablePath(value: unknown): value is string {
  return isNonEmptyString(value)
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !/^[A-Za-z]:/u.test(value)
    && !value.split(/[\\/]/u).includes('..');
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
}
