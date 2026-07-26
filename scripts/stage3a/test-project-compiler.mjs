import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { compileVideoProject } from './compile-video-project.mjs';
import { createProjectCompilationContext } from './project-compilation-context.mjs';

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'project-compiler', stamp);
const workRoot = path.join(testRoot, 'work');
const projectsRoot = ensureDirectory(path.join(testRoot, 'projects'));
const assetsRoot = path.join(projectRoot, 'public');
const sourcePath = path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json');
const source = readJson(sourcePath);
const results = [];
const silentReport = () => undefined;

function contextFor(name, projectPath = sourcePath) {
  return createProjectCompilationContext({
    'job-id': `compile-${name}-${stamp}`,
    project: projectPath,
    'assets-dir': assetsRoot,
    'work-dir': workRoot,
  });
}

function compileCase(name, project) {
  const projectPath = path.join(projectsRoot, `${name}.json`);
  writeJson(projectPath, project);
  return compileVideoProject(contextFor(name, projectPath), { report: silentReport });
}

const compiledRuns = ['run-a', 'run-b'].map((name) => compileVideoProject(contextFor(name), { report: silentReport }));
assert.equal(compiledRuns[0].manifest.scenes.length, 2);
assert.equal(compiledRuns[0].manifest.semanticHash, compiledRuns[1].manifest.semanticHash);
results.push({ name: 'two-scenes-compile-deterministically', passed: true });

for (const scene of compiledRuns[0].manifest.scenes) {
  assert.ok(!path.isAbsolute(scene.config));
  assert.ok(!scene.config.includes('..'));
  const configA = readFileSync(path.join(contextFor('run-a').jobRoot, scene.config));
  const counterpart = compiledRuns[1].manifest.scenes.find((candidate) => candidate.id === scene.id);
  const configB = readFileSync(path.join(contextFor('run-b').jobRoot, counterpart.config));
  assert.deepEqual(configA, configB);
}
results.push({ name: 'compiled-scene-files-portable-and-identical', passed: true });

const firstContext = contextFor('run-a');
const firstConfig = readJson(path.join(firstContext.jobRoot, compiledRuns[0].manifest.scenes[0].config));
assert.equal(firstConfig.version, 2);
assert.equal(firstConfig.characters.length, 2);
assert.equal(firstConfig.characters[0].transform.toX, source.scenes[0].elements[0].transform.x - 540);
assert.equal(firstConfig.characters[0].transform.baseY, source.scenes[0].elements[0].transform.y - 960);
assert.equal(firstConfig.characters[0].characterAssetId, 'mono-parametrico-azul-v1');
results.push({ name: 'canvas-transforms-and-character-ids-compile-to-v2', passed: true });

assert.equal(firstConfig.dialogue[0].speakerId, 'presentadora');
assert.equal(firstConfig.dialogue[0].voice.model, 'es_MX-claude-high');
assert.equal(firstConfig.dialogue[1].voice.model, 'es_ES-davefx-medium');
results.push({ name: 'speaker-and-voice-ids-resolve-to-runtime-values', passed: true });

assert.deepEqual(compiledRuns[0].manifest.scenes[0].transitionToNext, { preset: 'fade', durationSeconds: 0.35 });
assert.equal(compiledRuns[0].manifest.scenes[1].transitionToNext, undefined);
results.push({ name: 'scene-order-and-transition-preserved', passed: true });

assert.ok(compiledRuns[0].manifest.sourceHashes.every((item) => !path.isAbsolute(item.path) && /^[a-f0-9]{64}$/.test(item.sha256)));
assert.ok(/^[a-f0-9]{64}$/.test(compiledRuns[0].manifest.projectSha256));
assert.ok(/^[a-f0-9]{64}$/.test(compiledRuns[0].manifest.catalogSha256));
results.push({ name: 'compilation-input-hashes-recorded', passed: true });

const mixedCatalogProject = structuredClone(source);
mixedCatalogProject.scenes[0].elements[1].resourceId = 'tucan-gala-v1';
const mixedCatalogRun = compileCase('mixed-character-catalogs', mixedCatalogProject);
const mixedCatalogContext = contextFor('mixed-character-catalogs', path.join(projectsRoot, 'mixed-character-catalogs.json'));
const mixedConfig = readJson(path.join(mixedCatalogContext.jobRoot, mixedCatalogRun.manifest.scenes[0].config));
assert.equal(mixedConfig.assetCatalog, undefined);
assert.deepEqual(
  mixedConfig.characters.map((character) => character.characterManifest),
  [
    'assets/characters/mono-parametrico-azul-v1/character.manifest.json',
    'assets/characters/tucan-gala-v1/character.manifest.json',
  ],
);
assert.deepEqual(
  mixedCatalogRun.manifest.scenes[0].bindings.map((binding) => binding.characterAssetId),
  ['mono-parametrico-azul-v1', 'tucan-gala-v1'],
);
results.push({ name: 'mixed-character-catalogs-compile-through-direct-manifests', passed: true });

const expressiveProject = path.join(projectRoot, 'pilots', 'proyecto-editable-01', 'project.json');
assert.throws(() => compileVideoProject(contextFor('unsupported-text', expressiveProject), { report: silentReport }), (error) => error.code === 'PROJECT_SCENE_UNSUPPORTED');
results.push({ name: 'unsupported-elements-are-not-dropped', passed: true });

const rotated = structuredClone(source);
rotated.scenes[0].elements[0].transform.rotationDegrees = 12;
assert.throws(() => compileCase('unsupported-rotation', rotated), (error) => error.code === 'PROJECT_SCENE_UNSUPPORTED');
results.push({ name: 'unsupported-transform-is-explicit', passed: true });

const oneCharacter = structuredClone(source);
oneCharacter.scenes[0].elements = oneCharacter.scenes[0].elements.slice(0, 1);
oneCharacter.scenes[0].dialogue = oneCharacter.scenes[0].dialogue.map((turn) => ({ ...turn, speakerElementId: 'presentadora' }));
assert.throws(() => compileCase('one-character', oneCharacter), (error) => error.code === 'PROJECT_SCENE_UNSUPPORTED');
results.push({ name: 'current-two-character-limit-is-enforced', passed: true });

const pointed = structuredClone(source);
pointed.scenes[0].elements[0].poseId = 'point';
assert.throws(() => compileCase('initial-point-pose', pointed), (error) => error.code === 'PROJECT_SCENE_UNSUPPORTED');
results.push({ name: 'unsupported-initial-pose-is-explicit', passed: true });

const conflictContext = createProjectCompilationContext({
  'job-id': `compile-conflict-${stamp}`,
  project: sourcePath,
  'assets-dir': assetsRoot,
  'work-dir': workRoot,
});
const changed = structuredClone(source);
changed.title = 'Otro proyecto';
const changedPath = path.join(projectsRoot, 'changed-project.json');
writeJson(changedPath, changed);
assert.throws(() => createProjectCompilationContext({
  'job-id': conflictContext.jobId,
  project: changedPath,
  'assets-dir': assetsRoot,
  'work-dir': workRoot,
}), (error) => error.code === 'JOB_PROJECT_CONFLICT');
results.push({ name: 'job-freezes-authoring-project', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'project-compiler-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
