import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, '..');

const authoringPath = path.join(repositoryRoot, 'public', 'assets', 'catalog', 'authoring-resources.json');
const authoring = JSON.parse(fs.readFileSync(authoringPath, 'utf8'));

const conejoEntry = {
  id: "conejo-traje-v1",
  type: "character",
  label: "Conejo de Traje",
  tags: ["conejo", "traje", "geometrico", "animal"],
  characterRef: {
    catalog: "assets/catalog/index.json",
    entryId: "conejo-traje-v1"
  },
  capabilities: {
    poses: ["neutral", "point"],
    animationPresets: ["idle-calm", "talk-calm"]
  },
  provenance: {
    "source": "Propuesta AI Conejo de Traje",
    "license": "Creación local del usuario."
  }
};

if (!authoring.entries.some(e => e.id === conejoEntry.id)) {
  const characters = authoring.entries.filter(e => e.type === 'character');
  const index = authoring.entries.indexOf(characters[characters.length - 1]);
  authoring.entries.splice(index + 1, 0, conejoEntry);
}

fs.writeFileSync(authoringPath, JSON.stringify(authoring, null, 2), 'utf8');
console.log('Merged conejo into authoring-resources.json');
