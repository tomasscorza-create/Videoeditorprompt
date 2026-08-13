// Gate visual real para las seis secuencias coordinadas V2.
// Construye tres escenas, materializa los presets mediante el mismo lote que
// usan Director y UI, renderiza con PixiJS/FFmpeg y conserva el MP4 para gate
// humano bajo .local-video/visual-gates/.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import {
  applyProjectEditorCommandBatch,
  createProjectEditor,
} from '../../shared/project-editor.js';
import { expandEffectSequenceCommands } from '../../shared/animation-sequences.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { createProjectCompilationContext } from '../stage3a/project-compilation-context.mjs';
import { runProjectPipeline } from '../stage3a/project-pipeline.mjs';
import { loadCreativeRecipeCatalog } from '../director/creative-contract.mjs';

const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const recipes = loadCreativeRecipeCatalog();
const visualGateRoot = ensureDirectory(path.join(projectRoot, '.local-video', 'visual-gates'));
const reuseRoot = process.argv.find((argument) => argument.startsWith('--reuse-root='))?.slice('--reuse-root='.length);
const gateRoot = reuseRoot
  ? path.resolve(projectRoot, reuseRoot)
  : mkdtempSync(path.join(visualGateRoot, 'sequences-v2-'));
const project = buildPilotProject();
const projectPath = path.join(gateRoot, 'project.json');
writeJson(projectPath, project);

const context = createProjectCompilationContext({
  'job-id': 'coordinated-sequences-v2',
  project: projectPath,
  'assets-dir': path.join(projectRoot, 'public'),
  'work-dir': path.join(gateRoot, 'work'),
  'output-dir': path.join(gateRoot, 'output'),
  'verification-mode': 'interactive',
});
const result = await runProjectPipeline(context);
assert.equal(result.manifest.timeline.scenes.length, 3);
assert.equal(result.manifest.verificationMode, 'interactive');

const expectations = [
  {
    sceneJobId: 'scene-001-escena-rise-pop',
    checks: [
      ['guide-rise-pop', 'position.y', (values) => Math.max(...values) - Math.min(...values) >= 500],
      ['card-rise-pop', 'scale', (values) => Math.min(...values) <= 0.01 && Math.max(...values) >= 0.65],
      ['card-rise-pop', 'rotationDegrees', (values) => Math.min(...values) <= -4 && Math.max(...values) >= 4],
    ],
  },
  {
    sceneJobId: 'scene-002-escena-jump-shake',
    checks: [
      ['guide-jump-shake', 'position.y', (values) => Math.max(...values) - Math.min(...values) >= 230],
      ['card-jump-shake', 'position.x', (values) => Math.max(...values) - Math.min(...values) >= 55],
      ['card-jump-shake', 'scale', (values) => Math.max(...values) >= 0.66],
    ],
  },
  {
    sceneJobId: 'scene-003-escena-float-exit',
    checks: [
      ['guide-float-exit', 'position.y', (values) => Math.max(...values) - Math.min(...values) >= 40],
      ['card-float-exit', 'position.y', (values) => Math.max(...values) - Math.min(...values) >= 500],
      ['card-float-exit', 'opacity', (values) => Math.min(...values) <= 0.05 && Math.max(...values) >= 0.95],
    ],
  },
];

const sceneEvidence = [];
for (const expectation of expectations) {
  const sceneRoot = path.join(context.jobRoot, 'scene-output', expectation.sceneJobId);
  const metrics = readJson(path.join(sceneRoot, 'export-metrics-1.json'));
  const framePlan = readJson(path.join(sceneRoot, 'frame-plan-1.json'));
  assert.equal(metrics.compositorBackend, 'pixi-headless');
  assert.equal(metrics.compositorRenderer, 'webgl');
  const ranges = [];
  for (const [elementId, parameterId, accepts] of expectation.checks) {
    const values = framePlan.frames
      .map((frame) => frame.elements?.[elementId]?.params?.[parameterId])
      .filter(Number.isFinite);
    assert.equal(values.length, metrics.frameCount, `${elementId}.${parameterId} debe evaluarse en cada frame`);
    assert.ok(accepts(values), `${elementId}.${parameterId} no recorrió el rango visual esperado`);
    ranges.push({ elementId, parameterId, minimum: Math.min(...values), maximum: Math.max(...values) });
  }
  sceneEvidence.push({
    sceneJobId: expectation.sceneJobId,
    frameCount: metrics.frameCount,
    renderDurationSeconds: metrics.renderDurationSeconds,
    ranges,
  });
}

const output = path.join(context.resultRoot, result.manifest.outputs[0].file);
const summary = {
  version: 2,
  passed: expectations.length,
  failed: 0,
  sequenceIds: [
    'rise-and-settle-v2', 'pop-and-wobble-v2', 'jump-and-flash-v2',
    'shake-and-pulse-v2', 'float-and-pulse-v2', 'exit-up-and-fade-v2',
  ],
  durationSeconds: result.manifest.timeline.durationSeconds,
  output,
  sceneEvidence,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'coordinated-sequence-pilot-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

function buildPilotProject() {
  const definitions = [
    {
      id: 'rise-pop', title: 'Entrada y rebote', characterSequence: 'rise-and-settle-v2',
      propSequence: 'pop-and-wobble-v2', text: 'Primero probamos una entrada vertical con rebote y asentamiento.',
    },
    {
      id: 'jump-shake', title: 'Salto y énfasis', characterSequence: 'jump-and-flash-v2',
      propSequence: 'shake-and-pulse-v2', text: 'Después combinamos un salto breve con una sacudida de énfasis.',
    },
    {
      id: 'float-exit', title: 'Flotación y salida', characterSequence: 'float-and-pulse-v2',
      propSequence: 'exit-up-and-fade-v2', text: 'Finalmente revisamos la flotación suave y una salida ascendente.',
    },
  ];
  const base = {
    version: 1,
    id: 'piloto-secuencias-coordinadas-v2',
    title: 'Piloto de secuencias coordinadas V2',
    video: { width: 1080, height: 1920, fps: 30 },
    seed: 6022026,
    resourceCatalog: 'assets/catalog/authoring-resources.json',
    scenes: definitions.map((definition, index) => sceneFor(definition, index)),
  };
  let state = createProjectEditor(base, catalog);
  for (const definition of definitions) {
    const sceneId = `escena-${definition.id}`;
    const turnId = `turno-${definition.id}`;
    const anchor = { kind: 'turn', turnId, edge: 'start' };
    for (const [sequenceId, elementId] of [
      [definition.characterSequence, `guide-${definition.id}`],
      [definition.propSequence, `card-${definition.id}`],
    ]) {
      const sequence = recipes.effectSequences.find((entry) => entry.id === sequenceId);
      const commands = expandEffectSequenceCommands({
        sequenceId,
        anchor,
        offsetSeconds: 0.2,
        intensity: 'medium',
        bindings: [{ slotId: sequence.slots[0].id, sceneId, elementId }],
      }, state.project, catalog, recipes);
      state = applyProjectEditorCommandBatch(state, commands);
    }
  }
  return state.project;
}

function sceneFor(definition, index) {
  const sceneId = `escena-${definition.id}`;
  return {
    id: sceneId,
    title: definition.title,
    background: {
      resourceId: 'fondo-estudio-parallax-v1',
      cameraPreset: index % 2 === 0 ? 'slow-pan' : 'slow-zoom',
    },
    elements: [
      {
        id: `guide-${definition.id}`,
        type: 'character',
        resourceId: index === 1 ? 'mono-ciruela-v1' : 'mono-azul-v1',
        transform: {
          x: 325, y: 1120, anchorX: 0.5, anchorY: 0.5,
          scale: 0.7, rotationDegrees: 0, opacity: 1, zIndex: 20,
        },
        poseId: 'neutral',
        animationPreset: 'talk-calm',
      },
      {
        id: `card-${definition.id}`,
        type: 'prop',
        resourceId: 'cartel-dato-v1',
        transform: {
          x: 760, y: 820, anchorX: 0.5, anchorY: 0.5,
          scale: 0.62, rotationDegrees: 0, opacity: 1, zIndex: 40,
        },
      },
    ],
    dialogue: [{
      id: `turno-${definition.id}`,
      speakerElementId: `guide-${definition.id}`,
      text: definition.text,
      voiceId: 'voz-davefx-es-v1',
      gestureId: 'neutral',
      gapAfterSeconds: 0,
    }],
    ...(index < 2 ? { transitionToNext: { preset: 'fade', durationSeconds: 0.25 } } : {}),
  };
}
