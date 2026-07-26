import assert from 'node:assert/strict';
import { copyFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ensureDirectory, ffprobe, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { createJobContext } from '../stage1/job-context.mjs';
import { loadAndValidateJobConfig } from '../stage1/validate-scene-config.mjs';
import { compileParametricCharacter, loadParametricCharacterDefinition, validateAssetCatalog } from './parametric-character.mjs';

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'parametric-character', stamp);
const sourceDefinitionPath = path.join(projectRoot, 'public', 'assets', 'character-definitions', 'mono-parametrico-v1.json');
const source = loadParametricCharacterDefinition(sourceDefinitionPath);
const results = [];
let passed = false;

process.on('exit', () => {
  if (passed) rmSync(testRoot, { recursive: true, force: true });
});

assert.equal(source.variants.length, 6);
assert.ok(source.joints.some((joint) => joint.id === 'shoulder_right'));
assert.deepEqual(source.poses.map((pose) => pose.id), ['neutral', 'point', 'celebrate', 'doubt', 'deny']);
results.push({ name: 'definition-valid-with-variants-joints-poses', passed: true });

const unsafe = structuredClone(source);
unsafe.layers.mouth.closed[0].d += '<script>';
const unsafePath = path.join(testRoot, 'unsafe.json');
writeJson(unsafePath, unsafe);
assert.throws(() => loadParametricCharacterDefinition(unsafePath), (error) => error.code === 'PARAMETRIC_DEFINITION_SCHEMA_INVALID');
results.push({ name: 'unsafe-svg-path-rejected', passed: true });

const brokenParent = structuredClone(source);
brokenParent.joints[1].parentId = 'missing_joint';
const brokenParentPath = path.join(testRoot, 'broken-parent.json');
writeJson(brokenParentPath, brokenParent);
assert.throws(() => loadParametricCharacterDefinition(brokenParentPath), (error) => error.code === 'CHARACTER_RIG_SEMANTIC_INVALID');
results.push({ name: 'missing-joint-parent-rejected', passed: true });

const compiledRuns = [];
for (const name of ['run-a', 'run-b']) {
  const assetsRoot = path.join(testRoot, name);
  const definitionPath = path.join(assetsRoot, 'assets', 'character-definitions', 'mono-parametrico-v1.json');
  ensureDirectory(path.dirname(definitionPath));
  copyFileSync(sourceDefinitionPath, definitionPath);
  compiledRuns.push(compileParametricCharacter({
    assetsRoot,
    definitionPath,
    outputBase: 'assets/characters',
    catalogRelative: 'assets/catalog/index.json',
  }));
}

for (const compiled of compiledRuns) {
  const catalog = validateAssetCatalog(readJson(compiled.catalogPath));
  assert.equal(catalog.entries.length, 6);
  assert.ok(catalog.entries.every((entry) => !path.isAbsolute(entry.manifest) && !entry.manifest.includes('..') && entry.capabilities.poses.includes('point')));
}
results.push({ name: 'portable-catalog-with-two-variants', passed: true });

for (let index = 0; index < compiledRuns[0].artifacts.length; index += 1) {
  assert.deepEqual(compiledRuns[0].artifacts[index].hashes, compiledRuns[1].artifacts[index].hashes);
}
const catalogHash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(catalogHash(compiledRuns[0].catalogPath), catalogHash(compiledRuns[1].catalogPath));
results.push({ name: 'svg-png-manifest-catalog-deterministic', passed: true });

const firstBody = path.join(compiledRuns[0].artifacts[0].root, 'body.png');
const secondBody = path.join(compiledRuns[0].artifacts[1].root, 'body.png');
assert.notEqual(catalogHash(firstBody), catalogHash(secondBody));
results.push({ name: 'palette-variants-produce-distinct-png', passed: true });

for (const artifact of compiledRuns[0].artifacts) {
  for (const name of [
    'body.png', 'eyes_open.png', 'eyes_closed.png',
    'mouth_closed.png', 'mouth_medium.png', 'mouth_open.png', 'mouth_round.png',
    'mouth_labiodental.png', 'mouth_bilabial.png',
    'hand_neutral.png', 'hand_point.png', 'hand_celebrate.png', 'hand_doubt.png', 'hand_deny.png',
    'pose_neutral.png', 'pose_point.png', 'pose_celebrate.png', 'pose_doubt.png', 'pose_deny.png',
  ]) {
    const stream = ffprobe(path.join(artifact.root, name)).streams[0];
    assert.equal(stream.width, 1080);
    assert.equal(stream.height, 1920);
    assert.equal(stream.pix_fmt, 'rgba');
  }
}
results.push({ name: 'compiled-pngs-vertical-transparent', passed: true });

const pilot = readJson(path.join(projectRoot, 'pilots', 'parametric-character-01', 'scene.config.json'));
const configRoot = ensureDirectory(path.join(testRoot, 'configs'));
function contextFor(name, config) {
  const configPath = path.join(configRoot, `${name}.json`);
  writeJson(configPath, config);
  return createJobContext({
    'job-id': `parametric-${name}-${stamp}`,
    config: configPath,
    'assets-dir': path.join(projectRoot, 'public'),
    'work-dir': path.join(testRoot, 'work'),
    'output-dir': path.join(testRoot, 'output'),
  });
}
const pilotContext = contextFor('catalog-valid', pilot);
loadAndValidateJobConfig(pilotContext);
assert.deepEqual(pilotContext.resolvedCharacters.map((character) => character.catalogEntry.id), ['mono-parametrico-azul-v1', 'mono-parametrico-ciruela-v1']);
assert.ok(pilotContext.resolvedCharacters.every((character) => character.characterRig.version === 2 && character.characterRig.joints.length >= 4));
results.push({ name: 'scene-resolves-character-ids-through-catalog', passed: true });

const unknownAsset = structuredClone(pilot);
unknownAsset.characters[0].characterAssetId = 'character-not-in-catalog';
assert.throws(() => loadAndValidateJobConfig(contextFor('catalog-unknown', unknownAsset)), (error) => error.code === 'CONFIG_SEMANTIC_INVALID');
results.push({ name: 'unknown-catalog-id-rejected', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'parametric-character-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;
