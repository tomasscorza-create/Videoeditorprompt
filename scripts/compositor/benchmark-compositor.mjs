// Medición del compositor headless para el checkpoint de la Fase 3.
//
// El plan pide revisar calidad, velocidad y consumo de RAM antes de convertir a
// PixiJS en el compositor predeterminado. Esto produce los números; la decisión
// es del usuario.
//
// No entra en la suite: tarda, y medir no es comprobar.
//
//   node scripts/compositor/benchmark-compositor.mjs --frames=235

import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { buildFrame } from '../../shared/compositor-contract.js';
import { composeFramesWithPixi } from './pixi-compositor.mjs';

const requested = Number((process.argv.find((argument) => argument.startsWith('--frames=')) ?? '').split('=')[1]);
const frameCount = Number.isInteger(requested) && requested > 0 ? requested : 235;
const assetsRoot = path.join(projectRoot, 'public');
const resourceDirectory = 'assets/resources/mono-articulado-azul-v1';
const manifest = readJson(path.join(assetsRoot, resourceDirectory, 'resource.manifest.json'));
const video = { width: 1080, height: 1920 };
const framesDirectory = mkdtempSync(path.join(tmpdir(), 'compositor-benchmark-'));

// Dos personajes, como una escena real, con el brazo recorriendo su rango y las
// bocas alternando: el trabajo que de verdad tendría que hacer.
const MOUTHS = ['closed', 'medium', 'open', 'round'];
const frames = Array.from({ length: frameCount }, (_, index) => {
  const phase = index / frameCount;
  return buildFrame(video, [0, 1].map((slot) => ({
    manifest,
    basePath: resourceDirectory,
    transform: { x: slot === 0 ? -220 : 220, y: 0, scale: 0.75, opacity: 1, zIndex: slot },
    params: { armRaise: slot === 0 ? phase : 1 - phase },
    poseId: 'neutral',
    states: { eyes: index % 40 < 3 ? 'closed' : 'open', mouth: MOUTHS[index % MOUTHS.length] },
  })));
});

/** Memoria de todo el árbol de procesos del navegador, en MB. Aproximada. */
function browserMemoryMb() {
  const result = spawnSync('powershell', [
    '-NoProfile', '-Command',
    '(Get-Process chrome -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum',
  ], { encoding: 'utf8', windowsHide: true });
  const bytes = Number((result.stdout ?? '').trim());
  return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1024 / 1024) : null;
}

const baseline = browserMemoryMb();
let peak = baseline ?? 0;
const sampler = setInterval(() => {
  const current = browserMemoryMb();
  if (current !== null && current > peak) peak = current;
}, 1000);

const started = performance.now();
const result = await composeFramesWithPixi({ video, frames, assetsRoot, framesDirectory, timeoutMs: 15 * 60 * 1000 });
const seconds = (performance.now() - started) / 1000;
clearInterval(sampler);

const bytes = result.files.reduce((total, file) => total + statSync(file).size, 0);
process.stdout.write(`${JSON.stringify({
  version: 1,
  frames: result.frameCount,
  video,
  renderer: result.renderer,
  seconds: Number(seconds.toFixed(2)),
  secondsPerFrame: Number((seconds / result.frameCount).toFixed(3)),
  framesPerSecond: Number((result.frameCount / seconds).toFixed(2)),
  pngMegabytes: Number((bytes / 1024 / 1024).toFixed(1)),
  memory: {
    note: 'suma del working set de todos los chrome.exe; aproximada si hay otro Chrome abierto',
    baselineMb: baseline,
    peakMb: peak,
  },
}, null, 2)}\n`);
rmSync(framesDirectory, { recursive: true, force: true });
