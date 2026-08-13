import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ffprobe, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { compileParametricResource, loadResourceDefinition } from './parametric-resource.mjs';
import { readResourceManifest } from './resource-manifest.mjs';

const families = [
  {
    definition: 'telefono-social-v1',
    outputs: ['telefono-social-claro-v1', 'telefono-social-oscuro-v1'],
  },
  {
    definition: 'globo-dialogo-v1',
    outputs: ['globo-dialogo-coral-v1', 'globo-dialogo-azul-v1'],
  },
  {
    definition: 'grafico-crecimiento-v1',
    outputs: ['grafico-crecimiento-verde-v1', 'grafico-crecimiento-violeta-v1'],
  },
];
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'visual-prop-pack-'));
let passed = false;
process.on('exit', () => {
  if (passed) rmSync(temporaryRoot, { recursive: true, force: true });
});

const definitionRoot = path.join(temporaryRoot, 'assets', 'resource-definitions');
mkdirSync(definitionRoot, { recursive: true });
for (const family of families) {
  const source = path.join(projectRoot, 'public', 'assets', 'resource-definitions', `${family.definition}.json`);
  const definition = loadResourceDefinition(source);
  assert.equal(definition.kind, 'prop');
  assert.deepEqual(definition.variants.map((variant) => variant.outputId), family.outputs);
  copyFileSync(source, path.join(definitionRoot, `${family.definition}.json`));
}

const expectedIds = families.flatMap((family) => family.outputs);
const authoringCatalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const authoringIds = new Set(authoringCatalog.entries.map((entry) => entry.id));
assert.ok(expectedIds.every((id) => authoringIds.has(id)));

const compiledIds = [];
for (const family of families) {
  const compiled = compileParametricResource({
    assetsRoot: temporaryRoot,
    definitionPath: path.join(definitionRoot, `${family.definition}.json`),
    outputBase: 'assets/resources',
    catalogRelative: 'assets/catalog/index.json',
  });
  for (const artifact of compiled.artifacts) {
    compiledIds.push(artifact.variant.outputId);
    const committedRoot = path.join(projectRoot, 'public', 'assets', 'resources', artifact.variant.outputId);
    assert.ok(existsSync(path.join(committedRoot, 'preview.png')));
    readResourceManifest(readJson(path.join(committedRoot, 'resource.manifest.json')));
    const stream = ffprobe(path.join(committedRoot, 'preview.png')).streams[0];
    assert.equal(stream.width, 1080);
    assert.equal(stream.height, 1920);
    assert.equal(stream.pix_fmt, 'rgba');
    for (const relative of Object.keys(artifact.hashes)) {
      assert.equal(
        hashOf(path.join(committedRoot, relative)),
        hashOf(path.join(artifact.root, relative)),
        `${artifact.variant.outputId}/${relative}`,
      );
    }
  }
}
assert.deepEqual(compiledIds.sort(), [...expectedIds].sort());

const summary = {
  version: 1,
  passed: 4,
  failed: 0,
  definitions: families.length,
  props: expectedIds.length,
  outputs: expectedIds,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'visual-prop-pack-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;

function hashOf(file) {
  const content = readFileSync(file);
  const comparable = /\.(?:json|svg)$/i.test(file)
    ? Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    : content;
  return createHash('sha256').update(comparable).digest('hex');
}
