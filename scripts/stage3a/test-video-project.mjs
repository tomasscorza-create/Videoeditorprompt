import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { loadAndValidateVideoProject, validateResourceCatalogSemantics } from './validate-video-project.mjs';

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'video-project', stamp);
const configRoot = ensureDirectory(path.join(testRoot, 'projects'));
const assetsRoot = path.join(projectRoot, 'public');
const source = readJson(path.join(projectRoot, 'pilots', 'proyecto-editable-01', 'project.json'));
const results = [];

function validate(name, project = source) {
  const projectPath = path.join(configRoot, `${name}.json`);
  writeJson(projectPath, project);
  return loadAndValidateVideoProject({ projectPath, assetsRoot });
}

function invalidCase(name, expectedCode, change) {
  const project = structuredClone(source);
  change(project);
  assert.throws(() => validate(name, project), (error) => error.code === expectedCode);
  results.push({ name, accepted: false, expectedCode });
}

const valid = validate('valid');
assert.equal(valid.project.scenes.length, 2);
assert.equal(valid.catalog.entries.length, 19);
assert.deepEqual([...valid.resources.values()].map((entry) => entry.type), [
  'character', 'character', 'character', 'character', 'character', 'character', 'character', 'character', 'character', 'character',
  'voice', 'voice', 'voice', 'voice', 'prop', 'background', 'music', 'music', 'music',
]);
results.push({ name: 'valid-project-resolves-authoring-catalog', accepted: true });

assert.ok(valid.project.scenes.every((scene) => scene.elements.every((element) => {
  if (!element.transform) return true;
  return Number.isFinite(element.transform.x) && Number.isFinite(element.transform.y)
    && element.transform.anchorX >= 0 && element.transform.anchorX <= 1
    && element.transform.anchorY >= 0 && element.transform.anchorY <= 1;
})));
results.push({ name: 'canvas-transforms-are-explicit-and-bounded', accepted: true });

const capabilitiesGate = loadAndValidateVideoProject({
  projectPath: path.join(projectRoot, 'pilots', 'gate-capacidades-v1', 'project.json'),
  assetsRoot,
});
const gateElements = capabilitiesGate.project.scenes.flatMap((scene) => scene.elements);
const gateParameters = new Set(gateElements.flatMap((element) => (element.tracks ?? []).map((track) => track.parameterId)));
assert.deepEqual([...gateParameters].sort(), [
  'armRaise', 'opacity', 'position.x', 'position.y', 'rotationDegrees', 'scale',
]);
assert.equal(gateElements.some((element) => element.type === 'prop'), true);
assert.equal(capabilitiesGate.project.musicResourceId, 'musica-brillante-v1');
results.push({ name: 'integrated-capabilities-gate-covers-six-parameters-prop-and-music', accepted: true });

invalidCase('duplicate-scene-id', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  project.scenes[1].id = project.scenes[0].id;
});

invalidCase('missing-transition', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  delete project.scenes[0].transitionToNext;
});

invalidCase('transition-on-last-scene', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  project.scenes[1].transitionToNext = { preset: 'cut', durationSeconds: 0 };
});

invalidCase('cut-duration-must-be-zero', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  project.scenes[0].transitionToNext = { preset: 'cut', durationSeconds: 0.2 };
});

invalidCase('unknown-character-resource', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  project.scenes[0].elements[0].resourceId = 'personaje-inexistente';
});

invalidCase('voice-resource-type', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  project.scenes[0].dialogue[0].voiceId = 'fondo-estudio-parallax-v1';
});

invalidCase('speaker-must-be-character-in-scene', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  project.scenes[0].dialogue[0].speakerElementId = 'titulo';
});

invalidCase('unsupported-pose', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  project.scenes[0].elements[0].poseId = 'wave';
});

invalidCase('unsupported-camera-preset', 'AUTHORING_PROJECT_SEMANTIC_INVALID', (project) => {
  project.scenes[0].background.cameraPreset = 'camera-inventada';
});

invalidCase('coordinate-limit', 'AUTHORING_PROJECT_SCHEMA_INVALID', (project) => {
  project.scenes[0].elements[0].transform.x = 9999;
});

invalidCase('unknown-project-field', 'AUTHORING_PROJECT_SCHEMA_INVALID', (project) => {
  project.command = 'ffmpeg -i input';
});

invalidCase('absolute-catalog-path', 'AUTHORING_ASSET_PATH_INVALID', (project) => {
  project.resourceCatalog = 'C:/recursos/catalog.json';
});

const sourceCatalog = readJson(path.join(assetsRoot, 'assets', 'catalog', 'authoring-resources.json'));
const duplicateResource = structuredClone(sourceCatalog);
duplicateResource.entries[1].id = duplicateResource.entries[0].id;
assert.throws(() => validateResourceCatalogSemantics(duplicateResource, assetsRoot), (error) => error.code === 'AUTHORING_PROJECT_SEMANTIC_INVALID');
results.push({ name: 'authoring-resource-ids-unique', accepted: false, expectedCode: 'AUTHORING_PROJECT_SEMANTIC_INVALID' });

const unknownCompiledCharacter = structuredClone(sourceCatalog);
unknownCompiledCharacter.entries[0].characterRef.entryId = 'personaje-compilado-inexistente';
assert.throws(() => validateResourceCatalogSemantics(unknownCompiledCharacter, assetsRoot), (error) => error.code === 'AUTHORING_PROJECT_SEMANTIC_INVALID');
results.push({ name: 'compiled-character-reference-required', accepted: false, expectedCode: 'AUTHORING_PROJECT_SEMANTIC_INVALID' });

const unsafeBackground = structuredClone(sourceCatalog);
unsafeBackground.entries.find((entry) => entry.type === 'background').backgroundManifest = '../fuera.json';
assert.throws(() => validateResourceCatalogSemantics(unsafeBackground, assetsRoot), (error) => error.code === 'AUTHORING_ASSET_PATH_INVALID');
results.push({ name: 'nested-resource-path-portable', accepted: false, expectedCode: 'AUTHORING_ASSET_PATH_INVALID' });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'video-project-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
