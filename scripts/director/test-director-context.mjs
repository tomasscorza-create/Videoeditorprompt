import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  buildDirectorContext,
  compactNarrativeTemplates,
  compactResourceEntries,
  loadNarrativeTemplates,
} from './director-context.mjs';

const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const templates = loadNarrativeTemplates();
assert.equal(templates.templates.length, 5);
assert.equal(new Set(templates.templates.map((template) => template.id)).size, templates.templates.length);

const expandedCatalog = structuredClone(catalog);
for (let index = 0; index < 20; index += 1) {
  const source = structuredClone(catalog.entries.find((entry) => entry.type === 'character'));
  source.id = `personaje-extra-${String(index).padStart(2, '0')}`;
  source.label = `Personaje extra ${index}`;
  source.tags = ['generico', `grupo-${index}`];
  source.characterRef.entryId = `personaje-extra-${String(index).padStart(2, '0')}`;
  expandedCatalog.entries.push(source);
}
const specialist = expandedCatalog.entries.at(-1);
specialist.id = 'especialista-ciberseguridad-v1';
specialist.label = 'Especialista en ciberseguridad';
specialist.tags = ['ciberseguridad', 'privacidad', 'analista'];
specialist.characterRef.entryId = 'especialista-ciberseguridad-v1';

const options = {
  prompt: 'Explicá tres errores de ciberseguridad y cómo mejorar la privacidad.',
  constraints: { tone: 'educational', sceneCount: 2 },
  catalog: expandedCatalog,
  templates,
};
const first = buildDirectorContext(options);
const second = buildDirectorContext(options);
assert.deepEqual(first, second);
assert.equal(first.catalog.entries.filter((entry) => entry.type === 'character').length, 6);
assert.equal(first.catalog.entries.filter((entry) => entry.type === 'voice').length, 3);
assert.equal(first.catalog.entries.filter((entry) => entry.type === 'background').length, 4);
assert.equal(first.catalog.entries.filter((entry) => entry.type === 'music').length, 3);
assert.ok(first.summary.resourceIds.includes('especialista-ciberseguridad-v1'));
assert.ok(first.summary.shortlistedEntries < first.summary.totalCatalogEntries);
assert.equal(first.templates.length, 3);
assert.ok(first.summary.recommendedTemplateId);

const compactResources = compactResourceEntries(first.catalog);
assert.equal(Object.hasOwn(compactResources[0], 'provenance'), false);
assert.equal(Object.hasOwn(compactResources[0], 'characterRef'), false);
const compactTemplates = compactNarrativeTemplates(first.templates);
assert.equal(Object.hasOwn(compactTemplates[0], 'tags'), false);
assert.ok(compactTemplates[0].beats.length >= 3);

const listContext = buildDirectorContext({
  prompt: 'Una lista de tres tips y errores frecuentes.',
  catalog,
  templates,
});
assert.equal(listContext.summary.recommendedTemplateId, 'countdown-list-v1');

const invalidPath = path.join(projectRoot, '.local-video', 'tests', 'invalid-narrative-templates.json');
writeJson(invalidPath, { version: 1, templates: [] });
assert.throws(
  () => loadNarrativeTemplates(invalidPath),
  (error) => error.code === 'DIRECTOR_TEMPLATE_CATALOG_INVALID',
);

process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: 16,
  failed: 0,
  shortlisted: first.summary.shortlistedEntries,
  total: first.summary.totalCatalogEntries,
  recommendedTemplateId: first.summary.recommendedTemplateId,
})}\n`);
