import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ANIMATION_PARAMETERS } from '../../shared/animation-contract.js';
import { ANIMATION_PRESETS } from '../../shared/animation-presets.js';
import {
  CREATIVE_CAPABILITY_DEFINITIONS,
  CREATIVE_ERROR_CATALOG,
  CREATIVE_LIMITS,
  CREATIVE_SCENE_MODES,
  buildCreativeCapabilityMatrix,
  capabilityStatus,
  loadCreativeRecipeCatalog,
  validateCreativeRecipeCatalog,
  validateCreativeSceneBlueprint,
} from './creative-contract.mjs';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';

const fixturesRoot = path.join(projectRoot, 'pilots', 'director-flexible-v1');
const resourceCatalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const recipeCatalog = loadCreativeRecipeCatalog();
const results = [];

function pass(name, detail = {}) {
  results.push({ name, ...detail });
}

// 1. El catálogo real es estructural y semánticamente válido.
assert.equal(validateCreativeRecipeCatalog(recipeCatalog), recipeCatalog);
assert.equal(recipeCatalog.sceneRecipes.length, 4);
assert.equal(recipeCatalog.effectSequences.length, 4);
pass('catalogo-creativo-valido', {
  sceneRecipes: recipeCatalog.sceneRecipes.length,
  effectSequences: recipeCatalog.effectSequences.length,
});

// 2. Los cuatro modos objetivo tienen fixtures válidos y no dependen del orden.
const validFiles = readdirSync(path.join(fixturesRoot, 'valid')).filter((file) => file.endsWith('.json')).sort();
const seenModes = new Set();
for (const file of validFiles) {
  const document = readJson(path.join(fixturesRoot, 'valid', file));
  assert.equal(validateCreativeSceneBlueprint(document, { resourceCatalog, recipeCatalog }), document);
  seenModes.add(document.mode);
  pass(`valid/${file}`, { accepted: true, mode: document.mode });
}
assert.deepEqual([...seenModes].sort(), Object.keys(CREATIVE_SCENE_MODES).sort());
pass('todos-los-modos-tienen-fixture', { modes: [...seenModes].sort() });

// 3. Los casos inválidos fallan en la capa semántica correcta.
const invalidExpectations = {
  'dialogue-one-participant.json': 'CREATIVE_MODE_PARTICIPANTS_INVALID',
  'recipe-missing-template.json': 'CREATIVE_RECIPE_INCOMPATIBLE',
  'sequence-unsupported-parameter.json': 'CREATIVE_PARAMETER_UNSUPPORTED',
  'sequence-wrong-binding.json': 'CREATIVE_SEQUENCE_INCOMPATIBLE',
  'voiceover-character-speech.json': 'CREATIVE_MODE_SPEECH_INVALID',
};
const invalidFiles = readdirSync(path.join(fixturesRoot, 'invalid')).filter((file) => file.endsWith('.json')).sort();
assert.deepEqual(invalidFiles, Object.keys(invalidExpectations).sort());
for (const file of invalidFiles) {
  const expectedCode = invalidExpectations[file];
  const document = readJson(path.join(fixturesRoot, 'invalid', file));
  assert.throws(
    () => validateCreativeSceneBlueprint(document, { resourceCatalog, recipeCatalog }),
    (error) => {
      assert.equal(error.code, expectedCode, `${file} esperaba ${expectedCode} y devolvió ${error.code}`);
      assert.ok(error.path.startsWith('/'));
      assert.ok(error.message.length > 0);
      assert.ok(error.suggestedAction.length > 0);
      return true;
    },
  );
  pass(`invalid/${file}`, { accepted: false, expectedCode });
}

// 4. El schema es cerrado: no permite duración absoluta ni propiedades libres.
const voiceover = readJson(path.join(fixturesRoot, 'valid', 'voiceover-prop.json'));
assert.throws(
  () => validateCreativeSceneBlueprint({ ...voiceover, durationSeconds: 8 }, { resourceCatalog, recipeCatalog }),
  (error) => error.code === 'CREATIVE_DOCUMENT_INVALID',
);
pass('duracion-absoluta-no-permitida', { accepted: false });

// 5. Referencias internas y catálogo de recetas también son cerrados.
const brokenCatalog = structuredClone(recipeCatalog);
brokenCatalog.sceneRecipes[0].recommendedEffectSequenceIds.push('secuencia-inexistente');
assert.throws(
  () => validateCreativeRecipeCatalog(brokenCatalog),
  (error) => error.code === 'CREATIVE_REFERENCE_INVALID',
);
pass('referencia-de-receta-inexistente', { accepted: false });

const scriptedCatalog = structuredClone(recipeCatalog);
scriptedCatalog.effectSequences[0].actions[0].script = 'return process.env';
assert.throws(
  () => validateCreativeRecipeCatalog(scriptedCatalog),
  (error) => error.code === 'CREATIVE_RECIPE_CATALOG_INVALID',
);
pass('catalogo-no-admite-codigo', { accepted: false });

// 6. La matriz única se deriva de recursos, presets y recetas reales.
const firstMatrix = buildCreativeCapabilityMatrix({ resourceCatalog, recipeCatalog });
const secondMatrix = buildCreativeCapabilityMatrix({ resourceCatalog, recipeCatalog });
assert.deepEqual(firstMatrix, secondMatrix);
assert.ok(Object.isFrozen(firstMatrix));
assert.equal(firstMatrix.limits.scenesPerProject, 8);
assert.equal(firstMatrix.resources.length, resourceCatalog.entries.length);
assert.deepEqual(firstMatrix.animation.parameterIds, Object.keys(ANIMATION_PARAMETERS));
assert.deepEqual(firstMatrix.animation.presetIds, Object.keys(ANIMATION_PRESETS));
assert.deepEqual(firstMatrix.recipes.sceneRecipeIds, recipeCatalog.sceneRecipes.map((recipe) => recipe.id));
assert.deepEqual(firstMatrix.recipes.effectSequenceIds, recipeCatalog.effectSequences.map((sequence) => sequence.id));
assert.equal(capabilityStatus(firstMatrix, 'scene.dialogue', 'export'), 'available');
assert.equal(capabilityStatus(firstMatrix, 'scene.voiceover', 'export'), 'planned');
assert.equal(capabilityStatus(firstMatrix, 'element.prop', 'directorCreation'), 'planned');
assert.equal(capabilityStatus(firstMatrix, 'element.prop', 'export'), 'available');
pass('matriz-determinista-y-honesta', {
  capabilities: firstMatrix.capabilities.length,
  resources: firstMatrix.resources.length,
});

// 7. Cada estado y cada error tienen vocabulario conocido y texto útil.
for (const capability of CREATIVE_CAPABILITY_DEFINITIONS) {
  for (const status of Object.values(capability.support)) {
    assert.ok(['available', 'limited', 'draft-only', 'planned', 'excluded'].includes(status), `${capability.id}:${status}`);
  }
}
for (const [code, entry] of Object.entries(CREATIVE_ERROR_CATALOG)) {
  assert.ok(entry.message.length > 0 && entry.suggestedAction.length > 0, code);
}
assert.deepEqual(CREATIVE_LIMITS.visibleCharactersPerScene, { minimum: 0, maximum: 2 });
pass('vocabularios-completos', {
  errors: Object.keys(CREATIVE_ERROR_CATALOG).length,
  capabilities: CREATIVE_CAPABILITY_DEFINITIONS.length,
});

const summary = {
  version: 1,
  passed: results.length,
  failed: 0,
  modes: [...seenModes].sort(),
  sceneRecipes: recipeCatalog.sceneRecipes.length,
  effectSequences: recipeCatalog.effectSequences.length,
  results,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'creative-contract-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
