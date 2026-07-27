import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';

// Guardia del acoplamiento por IDs: los módulos de src/ui resuelven nodos con
// required('#x') / optional('#x') / getElementById('x'), que fallan en runtime y
// no en compilación. Esta prueba convierte esa rotura en fallo de test: cada ID
// referenciado por la UI debe existir en index.html.
//
// required() lanza al no encontrar el nodo, así que su ausencia es un error.
// optional() está pensado para degradar sin romper, pero un ID que ya no existe
// en ningún lado suele ser código muerto: se reporta aparte, sin hacer fallar.

const UI_DIR = path.join(projectRoot, 'src', 'ui');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function declaredIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(/\sid="([^"]+)"/gu)) ids.add(match[1]);
  return ids;
}

// Nodos que la propia UI crea y bautiza en runtime (elemento.id = 'x'): existen
// aunque no estén en index.html, así que no son referencias rotas.
function runtimeIds(sources) {
  const ids = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/\.id\s*=\s*'([^']+)'/gu)) ids.add(match[1]);
  }
  return ids;
}

// Solo selectores de ID simples y literales: '#foo' o '#foo <resto>'. Los
// selectores compuestos se validan por su ID raíz, que es lo que puede romperse
// al renombrar en el HTML.
function referencedIds(source) {
  const found = [];
  const patterns = [
    /\b(?:required|optional)\s*(?:<[^>]*>)?\s*\(\s*'(#[^']+)'/gu,
    /\bquerySelector(?:All)?\s*(?:<[^>]*>)?\s*\(\s*'(#[^']+)'/gu,
    /\bgetElementById\s*\(\s*'([^']+)'/gu,
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of source.matchAll(pattern)) {
      const raw = match[1];
      const selector = index === 2 ? raw : raw.slice(1);
      const id = selector.split(/[\s>+~.:[]/u)[0];
      if (id && /^[A-Za-z][\w-]*$/u.test(id)) found.push({ id, whole: raw });
    }
  }
  return found;
}

const html = readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const files = walk(UI_DIR);
const contents = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const ids = declaredIds(html);
const created = runtimeIds(contents.values());

const missingRequired = [];
const missingOptional = [];
let checked = 0;

for (const file of files) {
  const source = contents.get(file);
  const relative = path.relative(projectRoot, file).replace(/\\/gu, '/');
  for (const { id, whole } of referencedIds(source)) {
    checked += 1;
    if (ids.has(id) || created.has(id)) continue;
    const isRequired = new RegExp(`required\\s*(?:<[^>]*>)?\\s*\\(\\s*'${whole.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}'`, 'u').test(source);
    (isRequired ? missingRequired : missingOptional).push(`${relative}: ${whole}`);
  }
}

for (const entry of missingOptional) {
  process.stderr.write(`aviso: ${entry} no existe en index.html (referencia opcional)\n`);
}
if (missingRequired.length > 0) {
  for (const entry of missingRequired) {
    process.stderr.write(`error: ${entry} no existe en index.html y se resuelve con required()\n`);
  }
  process.stdout.write(`${JSON.stringify({ version: 1, passed: checked - missingRequired.length, failed: missingRequired.length })}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ version: 1, passed: checked, failed: 0, warnings: missingOptional.length })}\n`);
