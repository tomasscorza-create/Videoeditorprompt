import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';

export const DIRECTOR_CONTEXT_VERSION = 2;
export const DEFAULT_RESOURCE_LIMITS = Object.freeze({
  character: 6,
  voice: 4,
  background: 4,
  music: 3,
  prop: 4,
  template: 3,
});

const TONE_TERMS = Object.freeze({
  educational: ['educational', 'educacion', 'explicar', 'tutorial', 'claro', 'divulgador'],
  ironic: ['ironic', 'ironia', 'humor', 'contraste', 'analista'],
  serious: ['serious', 'serio', 'sobrio', 'analista', 'enfoque'],
  energetic: ['energetic', 'energia', 'rapido', 'ritmo', 'dinamico'],
  inspirational: ['inspirational', 'inspiracion', 'motivacion', 'progreso', 'calma'],
});

const QUERY_SYNONYM_GROUPS = Object.freeze([
  ['ia', 'inteligencia', 'artificial', 'tecnologia', 'digital'],
  ['educacion', 'educativo', 'explicar', 'tutorial', 'aprender', 'ensenar'],
  ['humor', 'comedia', 'gracioso', 'ironico', 'ironia'],
  ['dinamico', 'energia', 'rapido', 'ritmo', 'impacto'],
  ['serio', 'sobrio', 'formal', 'analista'],
  ['inspiracion', 'motivacion', 'progreso', 'superacion'],
  ['dinero', 'finanza', 'ahorro', 'presupuesto', 'economia'],
  ['trabajo', 'laboral', 'profesional', 'oficina'],
  ['privacidad', 'seguridad', 'ciberseguridad', 'proteccion'],
]);

const templateSchema = readJson(path.join(projectRoot, 'schema', 'narrative-template-catalog.schema.json'));
const validateTemplateCatalog = new Ajv2020({ allErrors: true, strict: true }).compile(templateSchema);
const layoutIds = new Set(readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'layout-presets.json')).presets.map((preset) => preset.id));
const gestureIds = new Set(['neutral', 'point', 'celebrate', 'doubt', 'deny']);

export function loadNarrativeTemplates(
  templatesPath = path.join(projectRoot, 'public', 'assets', 'catalog', 'narrative-templates.json'),
) {
  const document = readJson(templatesPath);
  if (!validateTemplateCatalog(document)) {
    const detail = (validateTemplateCatalog.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    contextError('DIRECTOR_TEMPLATE_CATALOG_INVALID', 'El catálogo de plantillas narrativas no es válido.', detail);
  }
  const ids = new Set();
  for (const [index, template] of document.templates.entries()) {
    if (ids.has(template.id)) contextError('DIRECTOR_TEMPLATE_CATALOG_INVALID', 'Las plantillas deben tener IDs únicos.', `/templates/${index}/id`);
    if (template.sceneRange.min > template.sceneRange.max) {
      contextError('DIRECTOR_TEMPLATE_CATALOG_INVALID', 'El rango de escenas de la plantilla es inválido.', `/templates/${index}/sceneRange`);
    }
    for (const [beatIndex, beat] of template.beats.entries()) {
      if (beat.layouts.some((id) => !layoutIds.has(id))) {
        contextError('DIRECTOR_TEMPLATE_CATALOG_INVALID', 'La plantilla referencia un layout inexistente.', `/templates/${index}/beats/${beatIndex}/layouts`);
      }
      if (beat.gestures.some((id) => !gestureIds.has(id))) {
        contextError('DIRECTOR_TEMPLATE_CATALOG_INVALID', 'La plantilla referencia un gesto inexistente.', `/templates/${index}/beats/${beatIndex}/gestures`);
      }
    }
    ids.add(template.id);
  }
  return document;
}

export function buildDirectorContext({
  prompt,
  constraints = {},
  catalog,
  templates = loadNarrativeTemplates(),
  resourceLimits = DEFAULT_RESOURCE_LIMITS,
  templateLimit = 3,
  requiredResourceIds = [],
} = {}) {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.entries)) {
    contextError('DIRECTOR_CONTEXT_INVALID', 'Se necesita un catálogo de recursos válido para construir el contexto.');
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    contextError('DIRECTOR_CONTEXT_INVALID', 'Se necesita una idea de video para buscar recursos.');
  }
  const queryTokens = expandQueryTokens(new Set([
    ...tokenize(prompt),
    ...(TONE_TERMS[constraints.tone] || []),
  ]));
  const explicitResourceIds = findExplicitResourceIds(catalog.entries, prompt);
  const rankedTemplates = rankTemplates(templates.templates, queryTokens, constraints);
  const templateCandidates = rankedTemplates.slice(0, boundedInteger(templateLimit, 1, 8, 'templateLimit'));
  const recommendedTemplate = templateCandidates[0];
  for (const tag of recommendedTemplate?.musicTags || []) queryTokens.add(normalizeToken(tag));

  const selectedEntries = [];
  const scores = {};
  for (const type of Object.keys(DEFAULT_RESOURCE_LIMITS)) {
    const limit = boundedInteger(
      resourceLimits[type] ?? DEFAULT_RESOURCE_LIMITS[type],
      type === 'character' || type === 'voice' ? 2 : 1,
      50,
      `resourceLimits.${type}`,
    );
    const ranked = catalog.entries
      .map((entry, index) => ({ entry, index, score: scoreResource(entry, queryTokens, constraints, recommendedTemplate) }))
      .filter((item) => item.entry.type === type)
      .sort(compareRanked);
    const minimum = type === 'character' || type === 'voice' ? 2 : type === 'background' ? 1 : 0;
    if (ranked.length < minimum) {
      contextError('DIRECTOR_CATALOG_INSUFFICIENT', `El catálogo no tiene suficientes recursos de tipo ${type}.`);
    }
    for (const item of ranked.slice(0, limit)) {
      selectedEntries.push(item.entry);
      scores[item.entry.id] = item.score;
    }
  }
  const selectedIds = new Set(selectedEntries.map((entry) => entry.id));
  const requiredIds = new Set([...requiredResourceIds, ...explicitResourceIds]);
  for (const entry of catalog.entries) {
    if (!requiredIds.has(entry.id) || selectedIds.has(entry.id)) continue;
    selectedEntries.push(entry);
    selectedIds.add(entry.id);
    scores[entry.id] = Number.MAX_SAFE_INTEGER;
  }
  const missingRequired = [...requiredIds].filter((id) => !selectedIds.has(id));
  if (missingRequired.length > 0) {
    contextError('DIRECTOR_CONTEXT_INVALID', 'Un recurso requerido no existe en el catálogo.', missingRequired.join(','));
  }

  const shortlistedCatalog = { version: 1, entries: selectedEntries };
  const availableByType = countEntriesByType(catalog.entries);
  const shortlistedByType = countEntriesByType(selectedEntries);
  return {
    version: DIRECTOR_CONTEXT_VERSION,
    catalog: shortlistedCatalog,
    templates: templateCandidates,
    summary: {
      version: DIRECTOR_CONTEXT_VERSION,
      queryTokens: [...queryTokens].sort(),
      resourceIds: selectedEntries.map((entry) => entry.id),
      resourceScores: scores,
      explicitResourceIds: [...explicitResourceIds].sort(),
      templateIds: templateCandidates.map((template) => template.id),
      recommendedTemplateId: recommendedTemplate?.id ?? null,
      totalCatalogEntries: catalog.entries.length,
      shortlistedEntries: selectedEntries.length,
      availableByType,
      shortlistedByType,
      unsupportedResourceTypes: Object.keys(availableByType)
        .filter((type) => !Object.hasOwn(DEFAULT_RESOURCE_LIMITS, type))
        .sort(),
    },
  };
}

function countEntriesByType(entries) {
  const counts = {};
  for (const entry of entries) counts[entry.type] = (counts[entry.type] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function compactResourceEntries(catalog) {
  return catalog.entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    label: entry.label,
    tags: entry.tags,
    capabilities: entry.capabilities || null,
  }));
}

export function compactNarrativeTemplates(templates) {
  return templates.map((template) => ({
    id: template.id,
    label: template.label,
    description: template.description,
    sceneRange: template.sceneRange,
    beats: template.beats,
    musicTags: template.musicTags,
  }));
}

function rankTemplates(templates, queryTokens, constraints) {
  return templates
    .map((template, index) => {
      const searchable = searchableTokens(template);
      let score = template.tones.includes(constraints.tone) ? 24 : 0;
      score += tokenOverlapScore(queryTokens, searchable);
      if (constraints.sceneCount !== undefined
        && constraints.sceneCount >= template.sceneRange.min
        && constraints.sceneCount <= template.sceneRange.max) score += 8;
      return { template, index, score };
    })
    .sort(compareRanked)
    .map((item) => item.template);
}

function scoreResource(entry, queryTokens, constraints, template) {
  const searchable = searchableTokens(entry);
  let score = tokenOverlapScore(queryTokens, searchable);
  if (entry.tags?.some((tag) => TONE_TERMS[constraints.tone]?.includes(normalizeToken(tag)))) score += 8;
  if (entry.type === 'music' && entry.tags?.some((tag) => template?.musicTags.includes(tag))) score += 10;
  if (entry.type === 'character' && entry.capabilities?.poses?.includes('point')) score += 1;
  return score;
}

function searchableTokens(value) {
  return new Set(tokenize(JSON.stringify(value)));
}

function tokenOverlapScore(queryTokens, searchable) {
  let score = 0;
  for (const query of queryTokens) {
    if (!query) continue;
    if (searchable.has(query)) {
      score += 6;
      continue;
    }
    if ([...searchable].some((candidate) => candidate.startsWith(query) || query.startsWith(candidate))) score += 2;
  }
  return score;
}

function compareRanked(a, b) {
  return b.score - a.score
    || String(a.entry?.id || a.template?.id).localeCompare(String(b.entry?.id || b.template?.id))
    || a.index - b.index;
}

function tokenize(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map(normalizeToken)
    .filter((token) => token.length >= 2);
}

function normalizeToken(value) {
  const token = String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (token.length > 5 && token.endsWith('ciones')) return `${token.slice(0, -6)}cion`;
  if (token.length > 5 && token.endsWith('es')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function expandQueryTokens(tokens) {
  const expanded = new Set([...tokens].map(normalizeToken));
  for (const group of QUERY_SYNONYM_GROUPS) {
    const normalized = group.map(normalizeToken);
    if (normalized.some((term) => expanded.has(term))) {
      for (const term of normalized) expanded.add(term);
    }
  }
  return expanded;
}

function findExplicitResourceIds(entries, prompt) {
  const phrase = normalizePhrase(prompt);
  return new Set(entries.filter((entry) => {
    if (!Object.hasOwn(DEFAULT_RESOURCE_LIMITS, entry.type)) return false;
    const id = normalizePhrase(entry.id);
    const label = normalizePhrase(entry.label);
    return (id.length >= 3 && containsPhrase(phrase, id))
      || (label.length >= 3 && containsPhrase(phrase, label));
  }).map((entry) => entry.id));
}

function normalizePhrase(value) {
  return String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

function containsPhrase(haystack, needle) {
  return ` ${haystack} `.includes(` ${needle} `);
}

function boundedInteger(value, min, max, field) {
  if (!Number.isInteger(value) || value < min || value > max) {
    contextError('DIRECTOR_CONTEXT_INVALID', `${field} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function contextError(code, message, technicalDetail) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message,
    technicalDetail,
    suggestedAction: 'Revise el catálogo, sus etiquetas y las plantillas narrativas.',
  });
}
