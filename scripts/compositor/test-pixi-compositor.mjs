// Fase 3 — pruebas del compositor headless con PixiJS.
//
// Nivel 3: levanta un navegador de verdad y compone frames reales del recurso v3
// articulado. Es la única forma de probar esto: el punto del compositor es que
// dibuja con el MISMO PixiJS que la vista previa, así que simular el navegador
// probaría otra cosa.
//
// Las tres mitades del gate de la fase se comprueban acá:
//
//   1. Doble ejecución: componer el mismo trabajo dos veces da los mismos PNG.
//   2. Frames dorados: la salida se compara contra los frames versionados en
//      `pilots/compositor-v3/golden/`. La comparación es por SSIM y no por bytes
//      porque SwiftShader es determinista dentro de una máquina y versión de
//      navegador, pero no está garantizado entre máquinas distintas.
//   3. La articulación se mueve: `armRaise` tiene que cambiar la imagen, o el rig
//      v3 estaría dibujándose como si fuera un personaje v2.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { projectRoot, readJson, run, writeJson } from '../stage1/common.mjs';
import { buildFrame } from '../../shared/compositor-contract.js';
import { composeFramesWithPixi } from './pixi-compositor.mjs';

const assetsRoot = path.join(projectRoot, 'public');
const resourceDirectory = 'assets/resources/mono-articulado-azul-v1';
const manifest = readJson(path.join(assetsRoot, resourceDirectory, 'resource.manifest.json'));
const goldenRoot = path.join(projectRoot, 'pilots', 'compositor-v3', 'golden');
const video = { width: 1080, height: 1920 };
const results = [];
const framesRoot = mkdtempSync(path.join(tmpdir(), 'compositor-test-'));
let passed = false;

process.on('exit', () => {
  if (passed) rmSync(framesRoot, { recursive: true, force: true });
});

// El brazo recorre todo su rango: reposo, medio y levantado.
const ARM_RAISE_STEPS = [0, 0.5, 1];

function frameFor(armRaise) {
  return buildFrame(video, [{
    manifest,
    basePath: resourceDirectory,
    transform: { x: 0, y: 0, scale: 1, opacity: 1, zIndex: 0 },
    params: { armRaise },
    poseId: 'neutral',
    states: { eyes: 'open', mouth: 'closed' },
  }]);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * SSIM entre dos PNG, con FFmpeg, que ya es dependencia del proyecto. Devuelve el
 * promedio del canal de luminancia, que es donde vive la estructura de la imagen.
 */
function ssim(left, right) {
  const result = run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', left, '-i', right,
    '-lavfi', '[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim=f=-',
    '-f', 'null', '-',
  ], { stage: 'rendering_frames', errorCode: 'COMPOSITOR_SSIM_FAILED', capture: true });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = /All:([0-9.]+)/u.exec(output);
  assert.ok(match, `FFmpeg no devolvió SSIM: ${output.slice(0, 300)}`);
  return Number(match[1]);
}

const started = performance.now();
const first = await composeFramesWithPixi({
  video,
  frames: ARM_RAISE_STEPS.map(frameFor),
  assetsRoot,
  framesDirectory: path.join(framesRoot, 'corrida-1'),
});
const secondsPerFrame = (performance.now() - started) / 1000 / first.frameCount;

assert.equal(first.frameCount, ARM_RAISE_STEPS.length);
assert.equal(first.backend, 'pixi-headless');
for (const file of first.files) {
  const probe = run('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=width,height,pix_fmt', '-of', 'csv=p=0', file,
  ], { stage: 'rendering_frames', errorCode: 'COMPOSITOR_PROBE_FAILED', capture: true }).stdout;
  assert.match(String(probe), /1080,1920,rgba/u, `el frame no salió en 1080x1920 con alfa: ${probe}`);
}
results.push({ name: 'compone-el-rig-v3-en-el-formato-del-video', accepted: true, renderer: first.renderer });

// 1. Doble ejecución.
const second = await composeFramesWithPixi({
  video,
  frames: ARM_RAISE_STEPS.map(frameFor),
  assetsRoot,
  framesDirectory: path.join(framesRoot, 'corrida-2'),
});
assert.deepEqual(second.files.map(sha256), first.files.map(sha256), 'dos corridas del mismo trabajo divergieron');
results.push({ name: 'doble-ejecucion-da-los-mismos-frames', accepted: true });

// 2. La articulación se mueve de verdad.
const reposoContraLevantado = ssim(first.files[0], first.files[2]);
assert.ok(reposoContraLevantado < 0.999, `armRaise no cambió la imagen (SSIM ${reposoContraLevantado})`);
const reposoContraMedio = ssim(first.files[0], first.files[1]);
assert.ok(
  reposoContraMedio > reposoContraLevantado,
  `medio camino tendría que parecerse más al reposo que el brazo levantado (${reposoContraMedio} vs ${reposoContraLevantado})`,
);
results.push({
  name: 'armraise-mueve-la-pieza-y-el-recorrido-es-monotono',
  accepted: true,
  ssim: { reposoContraMedio, reposoContraLevantado },
});

// 3. Frames dorados.
const MINIMUM_SSIM = 0.995;
const golden = ARM_RAISE_STEPS.map((_, index) => path.join(goldenRoot, `frame_${String(index).padStart(4, '0')}.png`));
assert.ok(
  golden.every((file) => existsSync(file)),
  `faltan frames dorados en ${goldenRoot}; regenerarlos con node scripts/compositor/generate-golden-frames.mjs`,
);
const goldenScores = golden.map((file, index) => ssim(file, first.files[index]));
assert.ok(
  goldenScores.every((score) => score >= MINIMUM_SSIM),
  `la salida se apartó de los frames dorados: ${goldenScores.join(', ')}`,
);
results.push({ name: 'coincide-con-los-frames-dorados', accepted: true, minimum: MINIMUM_SSIM, scores: goldenScores });

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  passed: results.length,
  failed: 0,
  renderer: first.renderer,
  secondsPerFrame: Number(secondsPerFrame.toFixed(3)),
  results,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'pixi-compositor-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;
