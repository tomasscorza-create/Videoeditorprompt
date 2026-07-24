import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';
import { createDefaultCustomCharacterDesign } from '../../shared/character-design-presets.js';
import { createResourceLibrary, defaultLibraryStorageRoot } from './resource-library.mjs';

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
  assert.equal(
    defaultLibraryStorageRoot({
      environment: { LOCALAPPDATA: 'C:\\datos-locales' },
      platform: 'win32',
      homeDirectory: 'C:\\usuario',
    }),
    path.join('C:\\datos-locales', 'DisenadorVideosLocal', 'library'),
  );
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

  const backgroundBytes = readFileSync(path.join(
    assetsRoot,
    'assets',
    'backgrounds',
    'studio-parallax-v1',
    'far.png',
  ));
  const importedBackground = library.importBackground({
    bytes: backgroundBytes,
    mimeType: 'image/png',
    fileName: 'Fondo de prueba.png',
  });
  assert.equal(importedBackground.created, true);
  assert.equal(importedBackground.resource.entry.type, 'background');
  assert.equal(importedBackground.image.mimeType, 'image/png');
  assert.equal(library.catalog().entries.length, 7);
  const importedManifest = JSON.parse(readFileSync(
    path.join(assetsRoot, importedBackground.resource.entry.backgroundManifest),
    'utf8',
  ));
  assert.equal(importedManifest.layers.far, 'background.png');
  assert.equal(importedManifest.layers.mid, 'transparent.png');
  assert.equal(existsSync(path.join(
    library.storageAssetsRoot,
    'backgrounds',
    importedBackground.resource.id,
    'background.png',
  )), true);
  assert.equal(library.importBackground({
    bytes: backgroundBytes,
    mimeType: 'image/png',
    fileName: 'El mismo fondo.png',
  }).created, false);
  assert.throws(
    () => library.importBackground({
      bytes: Buffer.from('no-es-una-imagen'),
      mimeType: 'image/png',
      fileName: 'invalido.png',
    }),
    (error) => error.code === 'LIBRARY_BACKGROUND_FORMAT_INVALID',
  );
  assert.throws(
    () => library.importBackground({
      bytes: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
        'base64',
      ),
      mimeType: 'image/png',
      fileName: 'demasiado-pequeno.png',
    }),
    (error) => error.code === 'LIBRARY_BACKGROUND_DIMENSIONS_INVALID',
  );
  const landscapeJpg = path.join(root, 'landscape.jpg');
  const jpegFixture = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x315f73:s=320x180',
    '-frames:v', '1', landscapeJpg,
  ], { shell: false, windowsHide: true, timeout: 30_000 });
  assert.equal(jpegFixture.status, 0);
  const normalizedBackground = library.importBackground({
    bytes: readFileSync(landscapeJpg),
    mimeType: 'image/jpeg',
    fileName: 'Paisaje horizontal.jpg',
  });
  assert.equal(normalizedBackground.created, true);
  assert.equal(normalizedBackground.image.sourceWidth, 320);
  assert.equal(normalizedBackground.image.sourceHeight, 180);
  assert.equal(normalizedBackground.image.width, 1080);
  assert.equal(normalizedBackground.image.height, 1920);

  const characterDesign = {
    version: 1,
    preset: 'mono-parametrico-v1',
    name: 'Presentadora local',
    accessory: 'glasses',
    headwear: 'cap',
    palette: {
      outline: '#24150f',
      fur: '#9a5636',
      lightFur: '#d89a69',
      suit: '#24385f',
      shirt: '#f4e9d9',
      accent: '#e35b55',
      white: '#fffaf0',
      mouthDark: '#3a1720',
      tongue: '#ef7c78',
      shadow: '#0a102059',
    },
  };
  const savedCharacter = library.saveCharacterDesign(characterDesign);
  assert.equal(savedCharacter.created, true);
  assert.equal(savedCharacter.resource.entry.type, 'character');
  assert.equal(library.characterDesigns()[0].design.accessory, 'glasses');
  assert.equal(existsSync(path.join(
    library.storageAssetsRoot,
    'characters',
    savedCharacter.resource.id,
    'character.manifest.json',
  )), true);
  const localCharacterCatalog = JSON.parse(readFileSync(
    path.join(publishRoot, 'characters', 'index.json'),
    'utf8',
  ));
  assert.equal(localCharacterCatalog.entries[0].id, savedCharacter.resource.id);
  assert.equal(library.saveCharacterDesign(characterDesign).created, false);
  assert.throws(
    () => library.saveCharacterDesign({ ...characterDesign, accessory: 'arbitrary-svg' }),
    (error) => error.code === 'LIBRARY_CHARACTER_DESIGN_INVALID',
  );
  const scratchDesign = createDefaultCustomCharacterDesign();
  scratchDesign.name = 'Personaje geométrico';
  scratchDesign.parts.find((part) => part.role === 'arm-right').rotationDegrees = -28;
  const scratchCharacter = library.saveCharacterDesign(scratchDesign);
  assert.equal(scratchCharacter.created, true);
  assert.deepEqual(
    scratchCharacter.resource.entry.capabilities.animationPresets,
    ['idle-calm', 'talk-calm'],
  );
  assert.equal(library.characterDesigns().find((item) => item.id === scratchCharacter.resource.id).design.version, 2);
  const scratchManifest = JSON.parse(readFileSync(path.join(
    library.storageAssetsRoot,
    'characters',
    scratchCharacter.resource.id,
    'character.manifest.json',
  ), 'utf8'));
  assert.deepEqual(Object.keys(scratchManifest.layers.mouth), ['closed', 'medium', 'open']);
  assert.equal(scratchManifest.poses.some((pose) => pose.id === 'point'), true);
  const incompleteScratch = createDefaultCustomCharacterDesign();
  incompleteScratch.parts = incompleteScratch.parts.filter((part) => part.role !== 'mouth');
  assert.throws(
    () => library.saveCharacterDesign(incompleteScratch),
    (error) => error.code === 'LIBRARY_CHARACTER_DESIGN_INVALID',
  );

  rmSync(path.join(publishRoot, 'backgrounds'), { recursive: true, force: true });
  rmSync(path.join(publishRoot, 'characters'), { recursive: true, force: true });
  const registryBeforeUpgrade = JSON.parse(readFileSync(library.indexPath, 'utf8'));
  const legacyCharacterRecord = registryBeforeUpgrade.entries.find((record) => record.entry.type === 'character');
  legacyCharacterRecord.entry.capabilities.animationPresets = ['idle', 'dialogue'];
  writeFileSync(library.indexPath, JSON.stringify(registryBeforeUpgrade), 'utf8');
  const restored = createResourceLibrary({ assetsRoot, storageRoot, publishRoot, builtinCatalog });
  assert.equal(restored.list().length, 10);
  assert.equal(restored.catalog().entries.at(-1).type, 'character');
  assert.equal(JSON.parse(readFileSync(restored.indexPath, 'utf8')).entries.length, 5);
  assert.equal(JSON.parse(readFileSync(restored.catalogPath, 'utf8')).entries.length, 10);
  assert.equal(existsSync(path.join(
    publishRoot,
    'backgrounds',
    importedBackground.resource.id,
    'background.png',
  )), true);
  assert.deepEqual(
    restored.list().find((resource) => resource.id === legacyCharacterRecord.id).entry.capabilities.animationPresets,
    ['idle-calm', 'talk-calm'],
  );
  assert.equal(existsSync(path.join(
    publishRoot,
    'characters',
    savedCharacter.resource.id,
    'pose_neutral.png',
  )), true);

  const migratedStorageRoot = path.join(root, 'migrated-durable');
  const migrated = createResourceLibrary({
    assetsRoot,
    storageRoot: migratedStorageRoot,
    publishRoot,
    builtinCatalog,
    legacyIndexPath: restored.indexPath,
  });
  assert.equal(migrated.list().length, 10);
  assert.equal(existsSync(migrated.indexPath), true);
  assert.equal(existsSync(path.join(
    migrated.storageAssetsRoot,
    'backgrounds',
    importedBackground.resource.id,
    'background.png',
  )), true);

  const inconsistent = JSON.parse(readFileSync(restored.indexPath, 'utf8'));
  inconsistent.entries[0].contentHash = '0'.repeat(64);
  writeFileSync(restored.indexPath, JSON.stringify(inconsistent), 'utf8');
  assert.throws(
    () => createResourceLibrary({ assetsRoot, storageRoot, publishRoot, builtinCatalog }),
    (error) => error.code === 'LIBRARY_INDEX_INVALID',
  );

  process.stdout.write(`${JSON.stringify({ version: 1, passed: 57, failed: 0 })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(publishRoot, { recursive: true, force: true });
}
