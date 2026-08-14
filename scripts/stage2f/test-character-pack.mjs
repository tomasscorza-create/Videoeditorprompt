import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ffprobe, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { compileParametricResource, loadResourceDefinition } from './parametric-resource.mjs';
import { readResourceManifest } from './resource-manifest.mjs';
import { writeCharacterPackDefinitions } from './character-pack-definitions.mjs';

const families = [
  { definition: 'presentadora-modular-v1', outputs: ['presentadora-coral-v1', 'presentadora-indigo-v1'] },
  { definition: 'analista-modular-v1', outputs: ['analista-menta-v1', 'analista-mostaza-v1'] },
  { definition: 'robot-asistente-v1', outputs: ['robot-asistente-cian-v1', 'robot-asistente-lima-v1'] },
];
const parameters = ['armRaise', 'leftArmRaise', 'headTilt', 'headNod', 'bodyLean', 'bodyBounce'];
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'character-pack-'));
let passed = false;
process.on('exit', () => {
  if (passed) rmSync(temporaryRoot, { recursive: true, force: true });
});

const generatedDefinitions = writeCharacterPackDefinitions(path.join(temporaryRoot, 'assets', 'resource-definitions'));
assert.equal(generatedDefinitions.length, families.length);
for (const family of families) {
  const generated = path.join(temporaryRoot, 'assets', 'resource-definitions', `${family.definition}.json`);
  const committed = path.join(projectRoot, 'public', 'assets', 'resource-definitions', `${family.definition}.json`);
  assert.equal(hashOf(generated), hashOf(committed), `${family.definition} debe ser reproducible`);
  const definition = loadResourceDefinition(committed);
  assert.equal(definition.kind, 'character');
  assert.equal(definition.parts.length, 5);
  assert.deepEqual(definition.parameters.map(({ id }) => id), parameters);
  assert.deepEqual(definition.variants.map(({ outputId }) => outputId), family.outputs);
}

const expectedIds = families.flatMap(({ outputs }) => outputs);
const authoringCatalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const licenseCatalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'resource-licenses.json'));
for (const id of expectedIds) {
  const authoring = authoringCatalog.entries.find((entry) => entry.id === id);
  assert.equal(authoring?.type, 'character');
  assert.deepEqual(authoring.capabilities.parameters, parameters);
  const license = licenseCatalog.resources.find((entry) => entry.resourceId === id);
  assert.equal(license?.status, 'cleared');
  assert.equal(license?.commercialUse, 'allowed');
  assert.equal(license?.redistribution, 'product-only');
}

const compiledIds = [];
for (const family of families) {
  const compiled = compileParametricResource({
    assetsRoot: temporaryRoot,
    definitionPath: path.join(temporaryRoot, 'assets', 'resource-definitions', `${family.definition}.json`),
    outputBase: 'assets/resources',
    catalogRelative: 'assets/catalog/index.json',
  });
  for (const artifact of compiled.artifacts) {
    compiledIds.push(artifact.variant.outputId);
    const committedRoot = path.join(projectRoot, 'public', 'assets', 'resources', artifact.variant.outputId);
    assert.ok(existsSync(path.join(committedRoot, 'pose_neutral.png')));
    const manifest = readResourceManifest(readJson(path.join(committedRoot, 'resource.manifest.json')));
    assert.equal(manifest.parts.length, 5);
    assert.equal(manifest.bindings.length, parameters.length);
    assert.deepEqual(manifest.parameters.map(({ id }) => id), parameters);
    assert.equal(Object.keys(manifest.states.mouth).length, 6);
    assert.equal(manifest.poses.length, 5);
    assert.notEqual(hashOf(path.join(committedRoot, 'pose_neutral.png')), hashOf(path.join(committedRoot, 'pose_celebrate.png')));
    const stream = ffprobe(path.join(committedRoot, 'pose_neutral.png')).streams[0];
    assert.equal(stream.width, 1080);
    assert.equal(stream.height, 1920);
    assert.equal(stream.pix_fmt, 'rgba');
    for (const relative of Object.keys(artifact.hashes)) {
      assert.equal(hashOf(path.join(committedRoot, relative)), hashOf(path.join(artifact.root, relative)), `${artifact.variant.outputId}/${relative}`);
    }
  }
}
assert.deepEqual(compiledIds.sort(), [...expectedIds].sort());

const summary = {
  version: 1,
  passed: 5,
  failed: 0,
  definitions: families.length,
  characters: expectedIds.length,
  piecesPerCharacter: 5,
  parameters,
  outputs: expectedIds,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'character-pack-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;

function hashOf(file) {
  const content = readFileSync(file);
  const comparable = /\.(?:json|svg)$/i.test(file)
    ? Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    : content;
  return createHash('sha256').update(comparable).digest('hex');
}
