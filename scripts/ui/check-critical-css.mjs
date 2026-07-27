import { readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';

// Guardia del CSS crítico anti-FOUC: el <style> inline de index.html duplica
// tokens del :root (tema oscuro) de src/style.css para pintar el esqueleto sin
// esperar el bundle. Esta prueba falla si esa copia se desincroniza, para que
// cambiar la paleta en style.css nunca requiera acordarse de index.html.
// Los bloques están marcados con el comentario SYNC:critical-css en ambos archivos.

const MARKER = 'SYNC:critical-css';

function parseTokens(cssBlock) {
  const tokens = new Map();
  for (const match of cssBlock.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/giu)) {
    tokens.set(`--${match[1]}`, match[2].replace(/\s+/gu, ' ').trim());
  }
  return tokens;
}

function rootBlock(css, source) {
  const start = css.search(/:root\s*\{/u);
  if (start === -1) throw new Error(`No se encontró el bloque :root en ${source}.`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

const indexHtml = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const styleCss = readFileSync(path.join(projectRoot, 'src', 'style.css'), 'utf8');

const failures = [];

const styleTag = indexHtml.match(/<style>([\s\S]*?)<\/style>/u);
if (!styleTag) failures.push('index.html no tiene bloque <style> inline.');
if (styleTag && !styleTag[1].includes(MARKER)) {
  failures.push(`El bloque <style> de index.html perdió el marcador ${MARKER}.`);
}
if (!styleCss.includes(MARKER)) {
  failures.push(`src/style.css perdió el marcador ${MARKER} junto a su :root.`);
}

let compared = 0;
if (styleTag) {
  const inlineTokens = parseTokens(rootBlock(styleTag[1], 'el <style> de index.html'));
  const canonTokens = parseTokens(rootBlock(styleCss, 'src/style.css'));
  if (inlineTokens.size === 0) failures.push('El :root inline de index.html no declara tokens.');
  for (const [name, value] of inlineTokens) {
    compared += 1;
    if (!canonTokens.has(name)) {
      failures.push(`${name} está en index.html pero no existe en el :root de src/style.css.`);
    } else if (canonTokens.get(name) !== value) {
      failures.push(`${name} difiere: index.html="${value}" vs style.css="${canonTokens.get(name)}".`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.stdout.write(`${JSON.stringify({ version: 1, passed: compared - failures.length, failed: failures.length })}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ version: 1, passed: compared, failed: 0 })}\n`);
