// Genera los frames dorados del compositor headless.
//
// Se corre a mano, nunca desde la suite: los dorados son la referencia contra la
// que se compara, así que regenerarlos automáticamente al fallar la comparación
// convertiría la prueba en un espejo. Cuando el compositor cambia a propósito,
// se regeneran, se miran y se commitean.

import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureDirectory, projectRoot, readJson } from '../stage1/common.mjs';
import { buildFrame } from '../../shared/compositor-contract.js';
import { composeFramesWithPixi } from './pixi-compositor.mjs';

const assetsRoot = path.join(projectRoot, 'public');
const resourceDirectory = 'assets/resources/mono-articulado-azul-v1';
const manifest = readJson(path.join(assetsRoot, resourceDirectory, 'resource.manifest.json'));
const goldenRoot = ensureDirectory(path.join(projectRoot, 'pilots', 'compositor-v3', 'golden'));
const video = { width: 1080, height: 1920 };
const temporary = mkdtempSync(path.join(tmpdir(), 'compositor-golden-'));

// El mismo recorrido que comprueba `test-pixi-compositor.mjs`.
const frames = [0, 0.5, 1].map((armRaise) => buildFrame(video, [{
  manifest,
  basePath: resourceDirectory,
  transform: { x: 0, y: 0, scale: 1, opacity: 1, zIndex: 0 },
  params: { armRaise },
  poseId: 'neutral',
  states: { eyes: 'open', mouth: 'closed' },
}]));

const result = await composeFramesWithPixi({ video, frames, assetsRoot, framesDirectory: temporary });
for (const file of result.files) copyFileSync(file, path.join(goldenRoot, path.basename(file)));
rmSync(temporary, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({
  version: 1,
  golden: goldenRoot,
  frames: result.frameCount,
  renderer: result.renderer,
  seconds: result.seconds,
}, null, 2)}\n`);
