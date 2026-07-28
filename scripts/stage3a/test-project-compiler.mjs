import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
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
let passed = false;

process.on('exit', () => {
  if (passed) rmSync(testRoot, { recursive: true, force: true });
});

function contextFor(name, projectPath = sourcePath) {
  return createProjectCompilationContext({
    'job-id': `compile-${name}-${stamp}`,
    project: projectPath,
    'assets-dir': assetsRoot,
    'work-dir': workRoot,
    'output-dir': path.join(testRoot, 'output'),
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

const phase2Project = structuredClone(source);
phase2Project.musicResourceId = 'musica-calma-v1';
phase2Project.scenes[0].dialogue[0] = {
  ...phase2Project.scenes[0].dialogue[0],
  gestureId: 'celebrate',
  gestureAtWord: 2,
  pace: 'fast',
  layoutPreset: 'focus-a',
};
const phase2Run = compileCase('phase2-directing-controls', phase2Project);
const phase2Context = contextFor('phase2-directing-controls', path.join(projectsRoot, 'phase2-directing-controls.json'));
const phase2Config = readJson(path.join(phase2Context.jobRoot, phase2Run.manifest.scenes[0].config));
assert.equal(phase2Config.assets.music, 'assets/audio/music/calm-loop-v1.wav');
assert.equal(phase2Config.dialogue[0].voice.lengthScale, 0.9);
assert.equal(phase2Config.dialogue[0].gesture, 'celebrate');
assert.equal(phase2Config.dialogue[0].gestureAtWord, 2);
assert.equal(phase2Config.dialogue[0].layout.length, 2);
assert.ok(phase2Config.characters.every((character) => character.transform.idleProfile && Number.isInteger(character.transform.motionSeed)));
assert.ok(phase2Run.manifest.sourceHashes.some((item) => item.path === 'assets/audio/music/calm-loop-v1.wav'));
results.push({ name: 'phase2-controls-compile-to-runtime-and-hashes', passed: true });

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

// Fase 4 — las pistas viajan al runtime, y las que el compositor no sabe llevar
// al MP4 se rechazan en vez de exportarse distinto de la vista previa.
const trackFor = (parameterId, values) => ({
  parameterId,
  source: { kind: 'manual' },
  keyframes: [
    { id: `kf-${parameterId.replace('.', '-')}-1`, anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: values[0], interpolation: 'ease' },
    { id: `kf-${parameterId.replace('.', '-')}-2`, anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0.6, value: values[1], interpolation: 'hold' },
  ],
});

const animated = structuredClone(source);
animated.scenes[0].elements[0].tracks = [trackFor('position.x', [-130, 290])];
animated.scenes[0].elements[1].tracks = [trackFor('opacity', [0, 1])];
const animatedRun = compileCase('animated-tracks', animated);
const animatedConfig = readJson(path.join(contextFor('animated-tracks', path.join(projectsRoot, 'animated-tracks.json')).jobRoot, animatedRun.manifest.scenes[0].config));
assert.deepEqual(
  animatedConfig.characters.map((character) => character.tracks?.map((track) => track.parameterId) ?? null),
  [['position.x'], ['opacity']],
);
assert.deepEqual(
  animatedConfig.characters[0].tracks[0].keyframes.map((keyframe) => keyframe.value),
  [-130, 290],
  'las pistas viajan en coordenadas de autoría; el exportador las traslada',
);
results.push({ name: 'animation-tracks-reach-the-runtime-config', passed: true });

const unanimatedConfig = readJson(path.join(contextFor('run-a').jobRoot, compiledRuns[0].manifest.scenes[0].config));
assert.equal(unanimatedConfig.characters.every((character) => character.tracks === undefined), true);
assert.notEqual(animatedRun.manifest.semanticHash, compiledRuns[0].manifest.semanticHash);
results.push({ name: 'animating-changes-the-compilation-identity', passed: true });

const rotationTrack = structuredClone(source);
rotationTrack.scenes[0].elements[0].tracks = [trackFor('rotationDegrees', [0, 12])];
assert.throws(() => compileCase('animated-rotation', rotationTrack), (error) => error.code === 'PROJECT_SCENE_UNSUPPORTED');
results.push({ name: 'unrenderable-animated-parameter-is-explicit', passed: true });

const articulated = structuredClone(source);
articulated.scenes[0].elements[0].resourceId = 'mono-articulado-azul-v1';
articulated.scenes[0].elements[0].tracks = [trackFor('armRaise', [0, 1])];
const articulatedRun = compileCase('articulated-v3', articulated);
const articulatedConfig = readJson(path.join(
  contextFor('articulated-v3', path.join(projectsRoot, 'articulated-v3.json')).jobRoot,
  articulatedRun.manifest.scenes[0].config,
));
assert.equal(articulatedConfig.characters[0].characterAssetId, 'mono-articulado-azul-v1');
assert.equal(articulatedConfig.characters[0].tracks[0].parameterId, 'armRaise');
results.push({ name: 'v3-character-and-articulation-compile-for-pixi', passed: true });

const withProp = structuredClone(source);
withProp.scenes[0].elements.push({
  id: 'cartel-dato',
  type: 'prop',
  resourceId: 'cartel-dato-v1',
  transform: {
    x: 540,
    y: 780,
    anchorX: 0.5,
    anchorY: 0.5,
    scale: 0.6,
    rotationDegrees: -8,
    opacity: 0.9,
    zIndex: 40,
  },
  tracks: [trackFor('rotationDegrees', [-8, 8])],
});
const propRun = compileCase('prop-v3', withProp);
const propConfig = readJson(path.join(
  contextFor('prop-v3', path.join(projectsRoot, 'prop-v3.json')).jobRoot,
  propRun.manifest.scenes[0].config,
));
assert.deepEqual(propConfig.props, [{
  id: 'cartel-dato',
  resourceManifest: 'assets/resources/cartel-dato-v1/resource.manifest.json',
  transform: { x: 0, y: -180, scale: 0.6, rotationDegrees: -8, opacity: 0.9, zIndex: 40 },
  tracks: [trackFor('rotationDegrees', [-8, 8])],
}]);
assert.equal(propRun.manifest.scenes[0].bindings.length, 2, 'los bindings de diálogo siguen describiendo solo personajes');
results.push({ name: 'prop-v3-compiles-with-transform-and-tracks-for-pixi', passed: true });

const conflictContext = createProjectCompilationContext({
  'job-id': `compile-conflict-${stamp}`,
  project: sourcePath,
  'assets-dir': assetsRoot,
  'work-dir': workRoot,
  'output-dir': path.join(testRoot, 'output'),
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
  'output-dir': path.join(testRoot, 'output'),
}), (error) => error.code === 'JOB_PROJECT_CONFLICT');
results.push({ name: 'job-freezes-authoring-project', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'project-compiler-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;
