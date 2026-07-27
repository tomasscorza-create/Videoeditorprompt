import { readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';

// A1 — Guardia de contraste WCAG. Lee los tokens de color de src/style.css y
// verifica que cada texto alcance AA (4.5:1) sobre todas las superficies de su
// tema. Evita que un retoque de paleta degrade la legibilidad sin que nadie lo
// note, sobre todo en los tamaños chicos que dejó la escala tipográfica.

const AA = 4.5;

function parseBlock(css, selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No se encontró el bloque ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const tokens = new Map();
  for (const match of css.slice(open + 1, close).matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/gu)) {
    tokens.set(match[1], match[2]);
  }
  return tokens;
}

function toRgb(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? [...clean].map((character) => character + character).join('') : clean;
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
}

const css = readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8');
const dark = parseBlock(css, ':root {');
const lightOverrides = parseBlock(css, ':root[data-theme="light"] {');
const light = new Map([...dark, ...lightOverrides]);

const SURFACES = ['bg', 'surface', 'surface-2', 'surface-3', 'input-bg'];
const FOREGROUNDS = ['text', 'muted', 'accent', 'danger', 'warning', 'ok'];

const failures = [];
let checked = 0;

for (const [themeName, palette] of [['oscuro', dark], ['claro', light]]) {
  for (const foreground of FOREGROUNDS) {
    for (const surface of SURFACES) {
      const front = palette.get(foreground);
      const back = palette.get(surface);
      if (!front || !back) continue;
      checked += 1;
      const ratio = contrast(front, back);
      if (ratio < AA) failures.push(`tema ${themeName}: --${foreground} sobre --${surface} = ${ratio}:1 (mínimo ${AA})`);
    }
  }
}

// Los presets de acento se verifican sobre las dos superficies más frecuentes.
for (const match of css.matchAll(/:root(\[data-theme="light"\])?\[data-accent="([a-z]+)"\]\s*\{([^}]*)\}/gu)) {
  const isLight = Boolean(match[1]);
  const accent = /--accent\s*:\s*(#[0-9a-fA-F]{3,8})/u.exec(match[3])?.[1];
  if (!accent) continue;
  const palette = isLight ? light : dark;
  for (const surface of ['bg', 'surface']) {
    checked += 1;
    const ratio = contrast(accent, palette.get(surface));
    if (ratio < AA) {
      failures.push(`tema ${isLight ? 'claro' : 'oscuro'}: acento ${match[2]} sobre --${surface} = ${ratio}:1 (mínimo ${AA})`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.stdout.write(`${JSON.stringify({ version: 1, passed: checked - failures.length, failed: failures.length })}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ version: 1, passed: checked, failed: 0 })}\n`);
