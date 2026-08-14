import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureDirectory, ffprobe, projectRoot, readJson, run, writeJson } from '../stage1/common.mjs';
import { composeFramesWithPixi } from '../compositor/pixi-compositor.mjs';
import { compileVideoProject } from '../stage3a/compile-video-project.mjs';
import { createProjectCompilationContext } from '../stage3a/project-compilation-context.mjs';
import { parseVideoTemplateDefinition } from '../../shared/video-template-definition.js';
import { evaluateMotionCard } from '../../shared/video-template-evaluator.js';

const ids = [
  'procedural-title-reveal-v1',
  'procedural-list-stack-v1',
  'procedural-comparison-split-v1',
  'procedural-cta-pulse-v1',
];
const assetsRoot = path.join(projectRoot, 'public');
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'motion-card-templates-'));
const visualRoot = ensureDirectory(path.join(projectRoot, '.local-video', 'visual-gates', 'templates-v1'));
let passed = false;
process.on('exit', () => {
  if (passed) rmSync(temporaryRoot, { recursive: true, force: true });
});

const definitions = ids.map((id) => parseVideoTemplateDefinition(
  readJson(path.join(assetsRoot, 'assets', 'templates', `${id}.json`)),
  id,
));
assert.deepEqual(definitions.map((definition) => definition.layout), ['title', 'list', 'comparison', 'cta']);
assert.ok(definitions.every((definition) => definition.kind === 'procedural-motion-card'));
const invalidPalette = structuredClone(readJson(path.join(assetsRoot, 'assets', 'templates', `${ids[0]}.json`)));
invalidPalette.palette.untrusted = '#000000';
assert.throws(() => parseVideoTemplateDefinition(invalidPalette, ids[0]), /color|formato/iu);

for (const definition of definitions) {
  const start = evaluateMotionCard(definition, 0);
  const middle = evaluateMotionCard(definition, definition.durationSeconds / 2);
  const repeated = evaluateMotionCard(definition, definition.durationSeconds);
  const { frameIndex: startFrameIndex, ...startLoop } = start;
  const { frameIndex: repeatedFrameIndex, ...repeatedLoop } = repeated;
  assert.equal(startFrameIndex, 0);
  assert.ok(repeatedFrameIndex > startFrameIndex);
  assert.deepEqual(startLoop, repeatedLoop);
  assert.equal(start.opacity, 0);
  assert.equal(middle.opacity, 1);
  assert.ok(middle.accentProgress > 0.7);
  assert.deepEqual(middle, evaluateMotionCard(definition, definition.durationSeconds / 2));
}

const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
project.scenes[0].elements.push(...definitions.map((definition, index) => ({
  id: `plantilla-${index + 1}`,
  type: 'template',
  templateId: definition.id,
  values: { word: definition.defaultValues.word },
  transform: {
    x: 540,
    y: 960,
    anchorX: 0.5,
    anchorY: 0.5,
    scale: 1,
    rotationDegrees: 0,
    opacity: 1,
    zIndex: 20 + index,
  },
})));
const projectPath = path.join(temporaryRoot, 'project.json');
writeJson(projectPath, project);
const compilationContext = createProjectCompilationContext({
  'job-id': 'motion-card-template-compile',
  project: projectPath,
  'assets-dir': assetsRoot,
  'work-dir': path.join(temporaryRoot, 'compile-work'),
  'output-dir': path.join(temporaryRoot, 'compile-output'),
});
const compilation = compileVideoProject(compilationContext, { report: () => undefined });
const compiledScene = readJson(path.join(compilationContext.jobRoot, compilation.manifest.scenes[0].config));
assert.deepEqual(compiledScene.templates.map((template) => template.definition), ids.map((id) => `assets/templates/${id}.json`));

const video = { width: 540, height: 960 };
const frames = definitions.map((definition) => ({
  sprites: [],
  templates: [{
    id: definition.id,
    definition: `assets/templates/${definition.id}.json`,
    word: definition.defaultValues.word,
    seconds: definition.durationSeconds * 0.55,
    transform: { x: 0, y: 0, scale: 1, rotationDegrees: 0, opacity: 1, zIndex: 1 },
  }],
}));
const first = await composeFramesWithPixi({
  video,
  frames,
  assetsRoot,
  framesDirectory: path.join(temporaryRoot, 'run-1'),
});
const second = await composeFramesWithPixi({
  video,
  frames,
  assetsRoot,
  framesDirectory: path.join(temporaryRoot, 'run-2'),
});
assert.deepEqual(first.files.map(hashOf), second.files.map(hashOf));
assert.equal(new Set(first.files.map(hashOf)).size, ids.length);
for (const file of first.files) {
  const stream = ffprobe(file).streams[0];
  assert.equal(stream.width, video.width);
  assert.equal(stream.height, video.height);
  assert.equal(stream.pix_fmt, 'rgba');
}

const contactSheet = path.join(visualRoot, 'contact-sheet.png');
run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  ...first.files.flatMap((file) => ['-i', file]),
  '-filter_complex', '[0:v][1:v][2:v][3:v]hstack=inputs=4[out]',
  '-map', '[out]', '-frames:v', '1', '-update', '1', contactSheet,
], { stage: 'verifying', errorCode: 'TEMPLATE_CONTACT_SHEET_FAILED' });

const summary = {
  version: 1,
  passed: 6,
  failed: 0,
  templates: ids.length,
  layouts: definitions.map((definition) => definition.layout),
  renderer: first.renderer,
  contactSheet: path.relative(projectRoot, contactSheet).replaceAll('\\', '/'),
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'motion-card-templates-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;

function hashOf(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
