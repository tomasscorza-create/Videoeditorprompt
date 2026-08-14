import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, ffprobe, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { compileVideoProject } from '../stage3a/compile-video-project.mjs';
import { createProjectCompilationContext } from '../stage3a/project-compilation-context.mjs';
import { BACKGROUND_PACK, generateBackgroundPack } from './background-pack.mjs';

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'background-pack-v1-'));
const generatedRoot = path.join(temporaryRoot, 'generated');
const workRoot = ensureDirectory(path.join(temporaryRoot, 'work'));
const outputRoot = ensureDirectory(path.join(temporaryRoot, 'output'));
const projectsRoot = ensureDirectory(path.join(temporaryRoot, 'projects'));
const assetsRoot = path.join(projectRoot, 'public');
let passed = false;
process.on('exit', () => {
  if (passed) rmSync(temporaryRoot, { recursive: true, force: true });
});

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateManifest = ajv.compile(readJson(path.join(projectRoot, 'schema', 'background-manifest.schema.json')));
const catalog = readJson(path.join(assetsRoot, 'assets', 'catalog', 'authoring-resources.json'));
const catalogById = new Map(catalog.entries.map((entry) => [entry.id, entry]));
const generated = new Map(generateBackgroundPack({ assetBase: generatedRoot }).map((item) => [item.id, item]));
const sourceProject = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));

for (const definition of BACKGROUND_PACK) {
  const catalogEntry = catalogById.get(definition.resourceId);
  assert.equal(catalogEntry?.type, 'background');
  assert.deepEqual(catalogEntry.capabilities.cameraPresets, ['static', 'slow-pan', 'slow-zoom']);

  const committedRoot = path.join(assetsRoot, 'assets', 'backgrounds', definition.id);
  const manifest = readJson(path.join(committedRoot, 'background.manifest.json'));
  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors));
  assert.equal(manifest.id, definition.id);

  for (const layer of ['far', 'mid', 'front']) {
    const stream = ffprobe(path.join(committedRoot, `${layer}.png`)).streams[0];
    assert.equal(stream.width, 1080);
    assert.equal(stream.height, 1920);
    assert.equal(stream.pix_fmt, layer === 'far' ? 'rgb24' : 'rgba');
  }

  const generatedAsset = generated.get(definition.id);
  for (const relative of [
    'background.manifest.json',
    'far.png', 'mid.png', 'front.png',
    'source/far.svg', 'source/mid.svg', 'source/front.svg',
  ]) {
    assert.equal(
      comparableHash(path.join(committedRoot, relative)),
      comparableHash(path.join(generatedAsset.assetRoot, relative)),
      `${definition.id}/${relative}`,
    );
  }

  const project = structuredClone(sourceProject);
  project.scenes[0].background = { resourceId: definition.resourceId, cameraPreset: 'slow-pan' };
  project.scenes[1].background = { resourceId: definition.resourceId, cameraPreset: 'slow-zoom' };
  const projectPath = path.join(projectsRoot, `${definition.id}.json`);
  writeJson(projectPath, project);
  const context = createProjectCompilationContext({
    'job-id': `background-pack-${definition.id}`,
    project: projectPath,
    'assets-dir': assetsRoot,
    'work-dir': workRoot,
    'output-dir': outputRoot,
  });
  const compilation = compileVideoProject(context, { report: () => undefined });
  for (const scene of compilation.manifest.scenes) {
    const config = readJson(path.join(context.jobRoot, scene.config));
    assert.equal(config.backgroundAnimation.layers.length, 3);
    assert.ok(config.backgroundAnimation.layers.every((layer) => layer.asset.includes(`/backgrounds/${definition.id}/`)));
  }
}

const summary = {
  version: 1,
  passed: 5,
  failed: 0,
  backgrounds: BACKGROUND_PACK.length,
  layers: BACKGROUND_PACK.length * 3,
  resources: BACKGROUND_PACK.map((definition) => definition.resourceId),
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'background-pack-v1-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;

function comparableHash(file) {
  const content = readFileSync(file);
  const comparable = /\.(?:json|svg)$/i.test(file)
    ? Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
    : content;
  return createHash('sha256').update(comparable).digest('hex');
}
