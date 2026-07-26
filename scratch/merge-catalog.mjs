import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, '..');

const mainCatalogPath = path.join(repositoryRoot, 'public', 'assets', 'catalog', 'index.json');
const conejoCatalogPath = path.join(repositoryRoot, 'public', 'assets', 'catalog', 'conejo.json');

const mainCatalog = JSON.parse(fs.readFileSync(mainCatalogPath, 'utf8'));
const conejoCatalog = JSON.parse(fs.readFileSync(conejoCatalogPath, 'utf8'));

// Append entries if they don't already exist
for (const entry of conejoCatalog.entries) {
  if (!mainCatalog.entries.some(e => e.id === entry.id)) {
    mainCatalog.entries.push(entry);
  }
}

fs.writeFileSync(mainCatalogPath, JSON.stringify(mainCatalog, null, 2), 'utf8');
console.log('Merged conejo into index.json');
