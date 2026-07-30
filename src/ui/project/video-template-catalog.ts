import {
  parseVideoTemplateDefinition,
  type VideoTemplateDefinition,
} from '../../../shared/video-template-definition.js';

export type { VideoTemplateDefinition };

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

