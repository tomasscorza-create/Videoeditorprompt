// Integración real y deliberadamente fuera de la suite central: compila un
// proyecto editable con un rig v3 y un prop, prepara voz, compone con PixiJS,
// encodea con FFmpeg y verifica el MP4 final.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { createProjectCompilationContext } from '../stage3a/project-compilation-context.mjs';
import { runProjectPipeline } from '../stage3a/project-pipeline.mjs';

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'pixi-pipeline-test-'));
let passed = false;
process.on('exit', () => {
  if (passed) rmSync(temporaryRoot, { recursive: true, force: true });
});

const project = readJson(path.join(projectRoot, 'pilots', 'animacion-render-01', 'project.json'));
project.id = 'piloto-pixi-v3-01';
project.title = 'Piloto Pixi v3 articulado';
project.scenes = [project.scenes[0]];
delete project.scenes[0].transitionToNext;
const articulated = project.scenes[0].elements[0];
articulated.resourceId = 'mono-articulado-azul-v1';
articulated.tracks = [{
  parameterId: 'armRaise',
  source: { kind: 'preset', presetId: 'arm-raise', version: 1, customized: false },
  keyframes: [
    {
      id: 'kf-brazo-1',
      anchor: { kind: 'turn', turnId: project.scenes[0].dialogue[0].id, edge: 'start' },
      offsetSeconds: 0.2,
      value: 0,
      interpolation: 'ease',
    },
    {
      id: 'kf-brazo-2',
      anchor: { kind: 'turn', turnId: project.scenes[0].dialogue[0].id, edge: 'start' },
      offsetSeconds: 0.8,
      value: 1,
      interpolation: 'hold',
    },
  ],
}];
project.scenes[0].elements.push({
  id: 'cartel-dato',
  type: 'prop',
  resourceId: 'cartel-dato-v1',
  transform: {
    x: 540,
    y: 760,
    anchorX: 0.5,
    anchorY: 0.5,
    scale: 0.62,
    rotationDegrees: -8,
    opacity: 0.92,
    zIndex: 40,
  },
  tracks: [{
    parameterId: 'rotationDegrees',
    source: { kind: 'manual' },
    keyframes: [
      {
        id: 'kf-cartel-1',
        anchor: { kind: 'scene', edge: 'start' },
        offsetSeconds: 0,
        value: -8,
        interpolation: 'ease',
      },
      {
        id: 'kf-cartel-2',
        anchor: { kind: 'scene', edge: 'start' },
        offsetSeconds: 0.8,
        value: 8,
        interpolation: 'hold',
      },
    ],
  }],
});

const projectPath = path.join(temporaryRoot, 'project.json');
writeJson(projectPath, project);
const context = createProjectCompilationContext({
  'job-id': 'pixi-v3-integration',
  project: projectPath,
  'assets-dir': path.join(projectRoot, 'public'),
  'work-dir': path.join(temporaryRoot, 'work'),
  'output-dir': path.join(temporaryRoot, 'output'),
  'verification-mode': 'interactive',
});
const result = await runProjectPipeline(context);
assert.equal(result.manifest.timeline.scenes.length, 1);
assert.equal(result.manifest.verificationMode, 'interactive');
const metrics = readJson(path.join(
  context.jobRoot,
  'scene-output',
  'scene-001-escena-presentacion',
  'export-metrics-1.json',
));
assert.equal(metrics.compositorBackend, 'pixi-headless');
assert.equal(metrics.compositorRenderer, 'webgl');
assert.equal(metrics.probe.streams.some((stream) => stream.codec_name === 'h264'), true);
assert.equal(metrics.probe.streams.some((stream) => stream.codec_name === 'aac'), true);
const framePlan = readJson(path.join(
  context.jobRoot,
  'scene-output',
  'scene-001-escena-presentacion',
  'frame-plan-1.json',
));
const propRotations = framePlan.frames
  .map((frame) => frame.elements?.['cartel-dato']?.params?.rotationDegrees)
  .filter(Number.isFinite);
assert.equal(propRotations.length, metrics.frameCount);
assert.ok(Math.min(...propRotations) <= -7.9);
assert.ok(Math.max(...propRotations) >= 7.9);

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  passed: 1,
  failed: 0,
  compositorBackend: metrics.compositorBackend,
  compositorRenderer: metrics.compositorRenderer,
  frameCount: metrics.frameCount,
  renderDurationSeconds: metrics.renderDurationSeconds,
  outputBytes: metrics.outputBytes,
  propId: 'cartel-dato',
  propRotationRange: [Math.min(...propRotations), Math.max(...propRotations)],
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'pixi-pipeline-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;
