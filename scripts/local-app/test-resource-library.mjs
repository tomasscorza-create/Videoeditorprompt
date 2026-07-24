import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';
import { createResourceLibrary } from './resource-library.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-library-test-'));
const assetsRoot = path.join(projectRoot, 'public');
const storageRoot = path.join(root, 'durable');
const publishBase = path.join(assetsRoot, 'assets', 'library');
mkdirSync(publishBase, { recursive: true });
const publishRoot = mkdtempSync(path.join(publishBase, 'test-'));
const builtinCatalog = JSON.parse(readFileSync(
  path.join(assetsRoot, 'assets', 'catalog', 'authoring-resources.json'),
  'utf8',
));

try {
  const library = createResourceLibrary({
    assetsRoot,
    storageRoot,
    publishRoot,
    builtinCatalog,
    now: () => new Date('2026-07-24T00:00:00.000Z'),
  });
  assert.equal(library.list().length, 5);
  assert.equal(library.catalog().entries.length, 5);
  assert.match(library.catalogRelative, /^assets\/library\/test-[^/]+\/authoring-resources\.json$/);

  const voice = {
    id: 'voz-prueba-local-v1',
    type: 'voice',
    label: 'Voz local de prueba',
    tags: ['local', 'prueba'],
    voice: {
      provider: 'piper',
      model: 'es_TEST-local-medium',
      locale: 'es_AR',
      lengthScale: 1,
      volume: 1
    },
    provenance: {
      source: 'Prueba automatizada.',
      license: 'Uso interno de prueba.'
    }
  };
  const registered = library.register(voice);
  assert.equal(registered.created, true);
  assert.equal(registered.resource.origin, 'local');
  assert.equal(library.catalog().entries.length, 6);

  const same = library.register(voice);
  assert.equal(same.created, false);
  assert.equal(same.resource.id, voice.id);

  const alias = library.register({
    ...voice,
    id: 'voz-prueba-alias-v1',
    label: 'Alias',
    voice: {
      volume: voice.voice.volume,
      locale: voice.voice.locale,
      provider: voice.voice.provider,
      lengthScale: voice.voice.lengthScale,
      model: voice.voice.model,
    },
  });
  assert.equal(alias.created, false);
  assert.equal(alias.resource.id, voice.id);

  assert.throws(
    () => library.register({ ...voice, label: 'Conflicto', voice: { ...voice.voice, model: 'otro-modelo' } }),
    (error) => error.code === 'LIBRARY_RESOURCE_ID_CONFLICT',
  );
  assert.throws(
    () => library.register({ ...voice, id: '../escape' }),
    (error) => error.code === 'LIBRARY_RESOURCE_INVALID',
  );

  const restored = createResourceLibrary({ assetsRoot, storageRoot, publishRoot, builtinCatalog });
  assert.equal(restored.list().length, 6);
  assert.equal(restored.catalog().entries.at(-1).id, voice.id);
  assert.equal(JSON.parse(readFileSync(restored.indexPath, 'utf8')).entries.length, 1);
  assert.equal(JSON.parse(readFileSync(restored.catalogPath, 'utf8')).entries.length, 6);

  const inconsistent = JSON.parse(readFileSync(restored.indexPath, 'utf8'));
  inconsistent.entries[0].contentHash = '0'.repeat(64);
  writeFileSync(restored.indexPath, JSON.stringify(inconsistent), 'utf8');
  assert.throws(
    () => createResourceLibrary({ assetsRoot, storageRoot, publishRoot, builtinCatalog }),
    (error) => error.code === 'LIBRARY_INDEX_INVALID',
  );

  process.stdout.write(`${JSON.stringify({ version: 1, passed: 13, failed: 0 })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(publishRoot, { recursive: true, force: true });
}
