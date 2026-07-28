// Checkpoint de la Fase 3: compone el mismo conjunto representativo de frames
// de una escena v2 con FFmpeg y PixiJS y mide la equivalencia entre backends.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { composeFramesWithFfmpeg } from './ffmpeg-compositor.mjs';
import { composeFramesWithPixi } from './pixi-compositor.mjs';
import { buildPixiFrameFromV2 } from './v2-frame-adapter.mjs';
import { projectRoot, readJson, run, writeJson } from '../stage1/common.mjs';
import { selectCompositorBackend } from '../stage1/export-dialogue.mjs';

const video = { width: 1080, height: 1920 };
const fps = 30;
const assetsRoot = path.join(projectRoot, 'public');
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'compositor-v2-comparison-'));
let passed = false;

process.on('exit', () => {
  if (passed) rmSync(temporaryRoot, { recursive: true, force: true });
});

const characterDefinitions = [
  {
    id: 'izquierda',
    directory: 'assets/characters/mono-parametrico-azul-v1',
    x: -250,
    gesture: 'point',
  },
  {
    id: 'derecha',
    directory: 'assets/characters/mono-parametrico-ciruela-v1',
    x: 250,
    gesture: 'neutral',
  },
];

function runtimeCharacter(definition) {
  const manifestPath = `${definition.directory}/character.manifest.json`;
  const manifest = readJson(path.join(assetsRoot, manifestPath));
  return {
    id: definition.id,
    assets: {
      body: `${definition.directory}/${manifest.layers.body}`,
      eyesOpen: `${definition.directory}/${manifest.layers.eyes.open}`,
      eyesClosed: `${definition.directory}/${manifest.layers.eyes.closed}`,
      mouthClosed: `${definition.directory}/${manifest.layers.mouth.closed}`,
      mouthMedium: `${definition.directory}/${manifest.layers.mouth.medium}`,
      mouthOpen: `${definition.directory}/${manifest.layers.mouth.open}`,
      mouthRound: `${definition.directory}/${manifest.layers.mouth.round}`,
      mouthLabiodental: `${definition.directory}/${manifest.layers.mouth.labiodental}`,
      mouthBilabial: `${definition.directory}/${manifest.layers.mouth.bilabial}`,
      handNeutral: `${definition.directory}/${manifest.layers.hands.neutral}`,
      handPoint: `${definition.directory}/${manifest.layers.hands.point}`,
      handCelebrate: `${definition.directory}/${manifest.layers.hands.celebrate}`,
      handDoubt: `${definition.directory}/${manifest.layers.hands.doubt}`,
      handDeny: `${definition.directory}/${manifest.layers.hands.deny}`,
    },
    characterRig: { manifestPath },
    transform: {
      fromX: definition.x,
      toX: definition.x,
      baseY: 145,
      entrySeconds: 0.01,
      bobAmplitude: 0,
      bobPeriodSeconds: 3,
      baseScale: 0.7,
      scalePulse: 0,
    },
  };
}

const runtime = {
  assets: { background: 'assets/characters/mono-presentador-v1/background.png' },
  characters: characterDefinitions.map(runtimeCharacter),
  audio: { durationSeconds: 5 / fps },
};
const config = {
  version: 2,
  video: { ...video, fps },
  characters: runtime.characters.map((character) => ({
    id: character.id,
    transform: character.transform,
  })),
};

// Ojos, boca y gesto cambian entre muestras. La opacidad se declara animada
// para que FFmpeg lea el mismo valor resuelto del frame y no aplique su fade de
// entrada implícito.
const sampledStates = [
  { eyes: 'open', mouth: 'closed' },
  { eyes: 'closed', mouth: 'medium' },
  { eyes: 'open', mouth: 'open' },
  { eyes: 'open', mouth: 'round' },
  { eyes: 'open', mouth: 'bilabial' },
];
const framePlan = sampledStates.map((sample, frameIndex) => ({
  frameIndex,
  timeSeconds: frameIndex / fps,
  activeTurnId: null,
  characters: characterDefinitions.map((definition) => ({
    id: definition.id,
    character: { x: definition.x, y: 145, scale: 0.7, opacity: 1 },
    eyes: sample.eyes,
    mouth: sample.mouth,
    gesture: definition.gesture,
    speaking: definition.id === 'izquierda',
  })),
}));
const animation = {
  elements: characterDefinitions.map((definition) => ({
    elementId: definition.id,
    tracks: [{ parameterId: 'opacity', keyframes: [] }],
  })),
};

const ffmpeg = composeFramesWithFfmpeg({
  context: { assetsRoot },
  config,
  runtime,
  dialogueData: { turns: [] },
  framePlan,
  animation,
  framesDirectory: path.join(temporaryRoot, 'ffmpeg'),
  fps,
  renderDuration: framePlan.length / fps,
  frameCount: framePlan.length,
  generatedPath: () => {
    throw new Error('La comparación no usa archivos generados.');
  },
  report: () => {},
  renderId: 'comparison-ffmpeg',
});

const pixiFrames = framePlan.map((frame) => buildPixiFrameFromV2({
  video,
  runtime,
  evaluatedFrame: frame,
  assetsRoot,
}));
const pixi = await composeFramesWithPixi({
  video,
  frames: pixiFrames,
  assetsRoot,
  framesDirectory: path.join(temporaryRoot, 'pixi'),
});

assert.equal(ffmpeg.frameCount, framePlan.length);
assert.equal(pixi.frameCount, framePlan.length);

function ssim(left, right, crop = null) {
  const cropFilter = crop ? `crop=${crop},` : '';
  const result = run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', left, '-i', right,
    '-lavfi', `[0:v]${cropFilter}format=yuv420p[a];[1:v]${cropFilter}format=yuv420p[b];[a][b]ssim=f=-`,
    '-f', 'null', '-',
  ], { stage: 'rendering_frames', errorCode: 'COMPOSITOR_SSIM_FAILED', capture: true });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = /All:([0-9.]+)/u.exec(output);
  assert.ok(match, `FFmpeg no devolvió SSIM: ${output.slice(0, 300)}`);
  return Number(match[1]);
}

const scores = ffmpeg.files.map((file, index) => ({
  frameIndex: index,
  fullFrame: ssim(file, pixi.files[index]),
  // Región que concentra ambos personajes y evita que el fondo infle el valor.
  characterRegion: ssim(file, pixi.files[index], '1000:1500:40:210'),
}));
const minimumFullFrame = Math.min(...scores.map((score) => score.fullFrame));
const averageFullFrame = scores.reduce((sum, score) => sum + score.fullFrame, 0) / scores.length;
const minimumCharacterRegion = Math.min(...scores.map((score) => score.characterRegion));
const averageCharacterRegion = scores.reduce((sum, score) => sum + score.characterRegion, 0) / scores.length;
const HIGH_EQUIVALENCE_SSIM = 0.995;
const routeBySceneIsSafe = minimumCharacterRegion >= HIGH_EQUIVALENCE_SSIM;
assert.equal(selectCompositorBackend(runtime), 'ffmpeg', 'una escena v2 debe conservar FFmpeg');
assert.equal(
  selectCompositorBackend({ characters: [{ characterRig: { version: 3 } }] }),
  'pixi',
  'una escena con un rig v3 debe usar PixiJS',
);
assert.equal(
  selectCompositorBackend({ characters: [], props: [{ resourceRig: { version: 3 } }] }),
  'pixi',
  'una escena con props debe usar PixiJS',
);

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  sceneContractVersion: 2,
  framesCompared: scores.length,
  threshold: HIGH_EQUIVALENCE_SSIM,
  scores,
  aggregate: {
    fullFrame: {
      minimum: Number(minimumFullFrame.toFixed(6)),
      average: Number(averageFullFrame.toFixed(6)),
    },
    characterRegion: {
      minimum: Number(minimumCharacterRegion.toFixed(6)),
      average: Number(averageCharacterRegion.toFixed(6)),
    },
  },
  decision: {
    routeBySceneIsSafe,
    recommendedRouting: routeBySceneIsSafe ? 'scene' : 'project',
    reason: routeBySceneIsSafe
      ? 'Los dos backends superan el umbral en la región de personajes.'
      : 'La equivalencia visual no alcanza el umbral; mezclar backends entre escenas puede producir un salto visible.',
  },
  renderers: {
    ffmpeg: ffmpeg.renderer,
    pixi: pixi.renderer,
  },
};

writeJson(path.join(projectRoot, '.local-video', 'test-results', 'compositor-v2-comparison-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;
