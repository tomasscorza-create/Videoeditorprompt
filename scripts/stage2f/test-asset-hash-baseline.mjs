// Fase 1 — guardia del gate «los recursos existentes conservan sus hashes».
//
// El test de determinismo vigente compara dos ejecuciones entre sí, así que una
// regresión del renderizador de primitivas pasaría desapercibida: las dos
// ejecuciones estarían igual de mal. Esta guardia compara contra los PNG, SVG y
// manifests que ya están commiteados en `public/assets/characters`.
//
// Si falla después de tocar el renderizador, la salida cambió y los recursos
// publicados quedaron invalidados. Si el cambio es intencional, hay que
// regenerar los assets y revisar el diff a conciencia, no ajustar la guardia.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { compileParametricCharacter } from './parametric-character.mjs';

const definitionRelative = path.join('assets', 'character-definitions', 'mono-parametrico-v1.json');
const committedRoot = path.join(projectRoot, 'public', 'assets', 'characters');
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'asset-hash-baseline');
const results = [];
let passed = false;

process.on('exit', () => {
  if (passed) rmSync(testRoot, { recursive: true, force: true });
});

rmSync(testRoot, { recursive: true, force: true });
mkdirSync(path.join(testRoot, path.dirname(definitionRelative)), { recursive: true });

// Solo la primera variante: el renderizador no depende de la paleta, así que una
// variante da la misma señal de regresión que seis y deja la suite central
// rápida. `stage2f:test-parametric` sigue compilando las seis.
const definition = readJson(path.join(projectRoot, 'public', definitionRelative));
definition.variants = definition.variants.slice(0, 1);
writeJson(path.join(testRoot, definitionRelative), definition);

const compiled = compileParametricCharacter({
  assetsRoot: testRoot,
  definitionPath: path.join(testRoot, definitionRelative),
  outputBase: 'assets/characters',
  catalogRelative: 'assets/catalog/index.json',
});

function hashOf(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const differences = [];
let compared = 0;

for (const artifact of compiled.artifacts) {
  const variantId = path.basename(artifact.root);
  for (const [relative, hash] of Object.entries(artifact.hashes)) {
    // Los SVG intermedios no se publican; el contrato son los PNG y el manifest.
    if (relative.startsWith('source/')) continue;
    const committed = path.join(committedRoot, variantId, relative);
    compared += 1;
    let committedHash = null;
    try {
      committedHash = hashOf(committed);
    } catch {
      differences.push(`${variantId}/${relative}: no existe en public/assets/characters`);
      continue;
    }
    if (committedHash !== hash) differences.push(`${variantId}/${relative}: hash distinto`);
  }
}

assert.deepEqual(differences, [], `La salida compilada dejó de coincidir con los recursos publicados:\n${differences.join('\n')}`);
assert.ok(compared >= 20, `se esperaban al menos 20 archivos comparados y se compararon ${compared}`);
results.push({ name: 'compiled-assets-match-committed-hashes', passed: true, compared });

// El SVG intermedio también se congela: es la entrada exacta del rasterizador y
// cualquier cambio en el orden de atributos lo delataría antes que el PNG.
const sampleSvg = path.join(compiled.artifacts[0].root, 'source', 'body.svg');
const svgText = readFileSync(sampleSvg, 'utf8');
assert.ok(svgText.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"'));
assert.match(svgText, /<ellipse cx="[\d.-]+" cy="[\d.-]+" rx="[\d.-]+" ry="[\d.-]+" fill="#[0-9a-f]{6}"/u);
results.push({ name: 'svg-attribute-order-frozen', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'asset-hash-baseline-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;
