import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, projectRoot } from '../stage1/common.mjs';
import {
  compileParametricCharacter,
  validateAssetCatalog,
  validateCompiledCharacterManifest,
} from '../stage2f/parametric-character.mjs';
import { validateResourceCatalogSemantics } from '../stage3a/validate-video-project.mjs';
import {
  applyCharacterDesign,
  customCharacterDesignIssues,
} from '../../shared/character-design-presets.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) => !Number.isNaN(Date.parse(value)),
});
const validateLibrarySchema = ajv.compile(JSON.parse(
  readFileSync(path.join(projectRoot, 'schema', 'local-resource-library.schema.json'), 'utf8'),
));
const validateCatalogSchema = ajv.compile(JSON.parse(
  readFileSync(path.join(projectRoot, 'schema', 'authoring-resource-catalog.schema.json'), 'utf8'),
));
const validateCharacterDesignSchema = ajv.compile(JSON.parse(
  readFileSync(path.join(projectRoot, 'schema', 'local-character-design.schema.json'), 'utf8'),
));
const MAX_BACKGROUND_BYTES = 12 * 1024 * 1024;
const MAX_BACKGROUND_PIXELS = 25_000_000;
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
  'base64',
);

export function createResourceLibrary(options = {}) {
  const assetsRoot = path.resolve(options.assetsRoot || path.join(projectRoot, 'public'));
  const usesDefaultStorage = !options.storageRoot && !process.env.LOCAL_VIDEO_LIBRARY_ROOT;
  const storageRoot = ensureDirectory(path.resolve(
    options.storageRoot
      || process.env.LOCAL_VIDEO_LIBRARY_ROOT
      || defaultLibraryStorageRoot(),
  ));
  const storageAssetsRoot = ensureDirectory(path.join(storageRoot, 'assets'));
  const publishRoot = ensureDirectory(path.resolve(
    options.publishRoot || path.join(assetsRoot, 'assets', 'library'),
  ));
  assertWithin(assetsRoot, publishRoot, 'publicación de biblioteca');
  const indexPath = path.join(storageRoot, 'library-index.json');
  if (usesDefaultStorage || options.legacyIndexPath) {
    migrateLegacyIndex({
      indexPath,
      legacyIndexPath: options.legacyIndexPath || path.join(projectRoot, '.local-video-library', 'library-index.json'),
    });
  }
  const catalogPath = path.join(publishRoot, 'authoring-resources.json');
  const catalogRelative = portable(path.relative(assetsRoot, catalogPath));
  const publishedAssetsRelative = portable(path.relative(assetsRoot, publishRoot));
  const builtinCatalog = clone(options.builtinCatalog || JSON.parse(
    readFileSync(path.join(assetsRoot, 'assets', 'catalog', 'authoring-resources.json'), 'utf8'),
  ));
  validateCatalog(builtinCatalog, assetsRoot);
  let registry = readRegistry(indexPath);
  validateRegistry(registry);
  publish();

  return {
    storageRoot,
    storageAssetsRoot,
    publishRoot,
    indexPath,
    catalogPath,
    catalogRelative,
    catalog: () => mergedCatalog(),
    list: () => [
      ...builtinCatalog.entries.map((entry) => summary(entry, 'builtin', null)),
      ...registry.entries.map((record) => summary(record.entry, 'local', record)),
    ],
    register(input) {
      const entry = clone(input);
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw libraryError('LIBRARY_RESOURCE_INVALID', 'El recurso debe ser un objeto compatible.');
      }
      try {
        validateCatalog({ version: 1, entries: [entry] }, assetsRoot);
      } catch (error) {
        const wrapped = libraryError('LIBRARY_RESOURCE_INVALID', 'El recurso no cumple el contrato o referencia archivos inválidos.');
        wrapped.cause = error;
        throw wrapped;
      }
      const idConflict = [...builtinCatalog.entries, ...registry.entries.map((record) => record.entry)]
        .find((candidate) => candidate.id === entry.id);
      const contentHash = resourceFingerprint(entry);
      if (idConflict) {
        if (resourceFingerprint(idConflict) === contentHash) {
          return { created: false, resource: findSummary(idConflict.id) };
        }
        throw libraryError('LIBRARY_RESOURCE_ID_CONFLICT', `Ya existe un recurso diferente con el ID «${entry.id}».`);
      }
      const duplicate = [...builtinCatalog.entries, ...registry.entries.map((record) => record.entry)]
        .find((candidate) => resourceFingerprint(candidate) === contentHash);
      if (duplicate) return { created: false, resource: findSummary(duplicate.id) };

      const candidateCatalog = {
        version: 1,
        entries: [...builtinCatalog.entries, ...registry.entries.map((record) => record.entry), entry],
      };
      try {
        validateCatalog(candidateCatalog, assetsRoot);
      } catch (error) {
        const wrapped = libraryError('LIBRARY_RESOURCE_INVALID', 'El recurso no cumple el contrato o referencia archivos inválidos.');
        wrapped.cause = error;
        throw wrapped;
      }
      const record = {
        id: entry.id,
        contentHash,
        registeredAt: (options.now ? options.now() : new Date()).toISOString(),
        entry,
      };
      const next = { version: 1, entries: [...registry.entries, record] };
      validateRegistry(next);
      atomicWriteJson(indexPath, next);
      registry = next;
      publish();
      return { created: true, resource: summary(entry, 'local', record) };
    },
    importBackground(input) {
      const bytes = Buffer.isBuffer(input?.bytes) ? input.bytes : Buffer.from(input?.bytes || []);
      const image = inspectBackgroundImage(bytes, input?.mimeType);
      const sourceName = safeDisplayName(input?.fileName || `fondo.${image.extension}`, 180);
      const label = safeDisplayName(input?.label || path.parse(sourceName).name || 'Fondo local', 100);
      const imageHash = createHash('sha256').update(bytes).digest('hex');
      const id = `fondo-local-${imageHash.slice(0, 12)}`;
      const existing = findSummary(id);
      if (existing) return { created: false, resource: existing };

      const backgroundRoot = ensureDirectory(path.join(storageAssetsRoot, 'backgrounds'));
      const targetDirectory = path.join(backgroundRoot, id);
      assertWithin(storageRoot, backgroundRoot, 'carpeta durable de fondos');
      if (existsSync(targetDirectory)) {
        throw libraryError('LIBRARY_RESOURCE_ID_CONFLICT', `Ya existe una carpeta administrada para «${id}».`);
      }
      const publishedTargetDirectory = path.join(publishRoot, 'backgrounds', id);

      const temporaryDirectory = path.join(backgroundRoot, `.${id}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
      ensureDirectory(temporaryDirectory);
      const imageName = `background.${image.extension}`;
      const manifestName = 'background.manifest.json';
      const source = safeDisplayName(
        input?.source || `Archivo local importado: ${sourceName}`,
        300,
      );
      const license = safeDisplayName(
        input?.license || 'Licencia no declarada; uso local.',
        160,
      );
      const manifest = {
        version: 1,
        id,
        canvas: { width: 1080, height: 1920 },
        layers: {
          far: imageName,
          mid: 'transparent.png',
          front: 'transparent.png',
        },
        provenance: { source, license },
      };
      try {
        normalizeBackgroundImage({
          bytes,
          image,
          directory: temporaryDirectory,
          outputName: imageName,
          ffmpegExecutable: options.ffmpegExecutable || 'ffmpeg',
        });
        atomicWriteBuffer(path.join(temporaryDirectory, 'transparent.png'), TRANSPARENT_PNG);
        atomicWriteJson(path.join(temporaryDirectory, manifestName), manifest);
        renameSync(temporaryDirectory, targetDirectory);
        syncDirectory(targetDirectory, publishedTargetDirectory, {
          sourceRoot: storageAssetsRoot,
          targetRoot: publishRoot,
        });
        const manifestRelative = path.posix.join(publishedAssetsRelative, 'backgrounds', id, manifestName);
        const result = this.register({
          id,
          type: 'background',
          label,
          tags: ['local', 'importado', 'fondo-estatico'],
          backgroundManifest: manifestRelative,
          capabilities: { cameraPresets: ['static', 'slow-pan', 'slow-zoom'] },
          provenance: { source, license },
        });
        return {
          ...result,
          image: {
            width: 1080,
            height: 1920,
            sourceWidth: image.width,
            sourceHeight: image.height,
            mimeType: image.mimeType,
            bytes: bytes.length,
          },
        };
      } catch (error) {
        removeManagedDirectory(temporaryDirectory, backgroundRoot);
        removeManagedDirectory(targetDirectory, backgroundRoot);
        removeManagedDirectory(publishedTargetDirectory, publishRoot);
        throw error;
      }
    },
    characterDesigns() {
      return registry.entries
        .filter((record) => isManagedCharacter(record.entry, publishedAssetsRelative))
        .map((record) => {
          const designPath = path.join(storageAssetsRoot, 'characters', record.entry.characterRef.entryId, 'design.json');
          if (!existsSync(designPath)) return null;
          const design = JSON.parse(readFileSync(designPath, 'utf8'));
          validateCharacterDesign(design);
          return {
            id: record.entry.id,
            name: record.entry.label,
            design,
            thumbnail: `/${publishedAssetsRelative}/characters/${record.entry.id}/pose_neutral.png`,
          };
        })
        .filter(Boolean);
    },
    saveCharacterDesign(input) {
      const design = clone(input);
      validateCharacterDesign(design);
      const designHash = createHash('sha256')
        .update(JSON.stringify(canonicalize(design)))
        .digest('hex');
      const id = `personaje-local-${designHash.slice(0, 12)}`;
      const existing = findSummary(id);
      if (existing) return { created: false, resource: existing };

      const charactersRoot = ensureDirectory(path.join(storageAssetsRoot, 'characters'));
      const targetDirectory = path.join(charactersRoot, id);
      const publishedTargetDirectory = path.join(publishRoot, 'characters', id);
      const workRoot = ensureDirectory(path.join(storageRoot, '.work'));
      const temporaryDirectory = path.join(workRoot, `${id}.${process.pid}.${randomBytes(6).toString('hex')}`);
      const temporaryAssetsRoot = path.join(temporaryDirectory, 'public');
      ensureDirectory(temporaryAssetsRoot);
      assertWithin(storageRoot, charactersRoot, 'raíz durable de personajes');
      assertWithin(storageRoot, temporaryDirectory, 'trabajo temporal del personaje');
      if (existsSync(targetDirectory)) {
        throw libraryError('LIBRARY_RESOURCE_ID_CONFLICT', `Ya existe una carpeta administrada para «${id}».`);
      }

      const baseDefinition = JSON.parse(readFileSync(
        path.join(assetsRoot, 'assets', 'character-definitions', 'mono-parametrico-v1.json'),
        'utf8',
      ));
      const compiledDefinition = applyCharacterDesign(baseDefinition, design, id);
      const definitionPath = path.join(temporaryAssetsRoot, 'definition.json');
      atomicWriteJson(definitionPath, compiledDefinition);
      const characterCatalogRelative = path.posix.join(publishedAssetsRelative, 'characters', 'index.json');
      const entry = {
        id,
        type: 'character',
        label: design.name,
        tags: ['local', 'parametrico', 'personalizado'],
        characterRef: { catalog: characterCatalogRelative, entryId: id },
        capabilities: {
          poses: ['neutral', 'point'],
          animationPresets: ['idle', 'dialogue'],
        },
        provenance: {
          source: 'Creado con el diseñador local de personajes.',
          license: 'Creación local del usuario.',
        },
      };

      try {
        const compilation = compileParametricCharacter({
          assetsRoot: temporaryAssetsRoot,
          definitionPath,
          outputBase: 'characters',
          catalogRelative: 'characters/index.json',
        });
        const compiledDirectory = compilation.artifacts[0].root;
        const manifestPath = path.join(compiledDirectory, 'character.manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest.sourceDefinition = path.posix.join(
          publishedAssetsRelative,
          'characters',
          id,
          'definition.json',
        );
        validateCompiledCharacterManifest(manifest);
        atomicWriteJson(manifestPath, manifest);
        atomicWriteJson(path.join(compiledDirectory, 'definition.json'), compiledDefinition);
        atomicWriteJson(path.join(compiledDirectory, 'design.json'), design);
        syncDirectory(compiledDirectory, targetDirectory, {
          sourceRoot: temporaryAssetsRoot,
          targetRoot: storageAssetsRoot,
        });
        syncDirectory(targetDirectory, publishedTargetDirectory, {
          sourceRoot: storageAssetsRoot,
          targetRoot: publishRoot,
        });
        publishCharacterAssetCatalog([
          ...registry.entries.map((record) => record.entry),
          entry,
        ]);
        return this.register(entry);
      } catch (error) {
        // Si register() alcanzó a persistir el índice, el paquete ya pertenece a la
        // biblioteca y debe conservarse para que el próximo arranque repare la publicación.
        if (!findSummary(id)) {
          removeManagedDirectory(targetDirectory, charactersRoot);
          removeManagedDirectory(publishedTargetDirectory, publishRoot);
          publish();
        }
        throw error;
      } finally {
        removeManagedDirectory(temporaryDirectory, workRoot);
      }
    },
  };

  function mergedCatalog() {
    return {
      version: 1,
      entries: clone([...builtinCatalog.entries, ...registry.entries.map((record) => record.entry)]),
    };
  }

  function publish() {
    materializeManagedAssets({
      registry,
      assetsRoot,
      storageAssetsRoot,
      publishRoot,
      publishedAssetsRelative,
    });
    publishCharacterAssetCatalog(registry.entries.map((record) => record.entry));
    const catalog = mergedCatalog();
    validateCatalog(catalog, assetsRoot);
    atomicWriteJson(catalogPath, catalog);
  }

  function publishCharacterAssetCatalog(entries) {
    const characters = entries.filter((entry) => isManagedCharacter(entry, publishedAssetsRelative));
    if (characters.length === 0) return;
    const generatedFrom = path.posix.join(publishedAssetsRelative, 'characters', 'generated-locally.json');
    atomicWriteJson(path.join(publishRoot, 'characters', 'generated-locally.json'), {
      version: 1,
      source: 'Diseñador local de personajes',
    });
    const catalog = {
      version: 1,
      generatedFrom,
      entries: characters.map((entry) => {
        const characterRoot = path.join(storageAssetsRoot, 'characters', entry.id);
        const manifest = JSON.parse(readFileSync(path.join(characterRoot, 'character.manifest.json'), 'utf8'));
        validateCompiledCharacterManifest(manifest);
        return {
          id: entry.id,
          type: 'character',
          label: entry.label,
          manifest: path.posix.join(publishedAssetsRelative, 'characters', entry.id, 'character.manifest.json'),
          thumbnail: path.posix.join(publishedAssetsRelative, 'characters', entry.id, 'pose_neutral.png'),
          tags: entry.tags,
          capabilities: {
            poses: manifest.poses.map((pose) => pose.id),
            mouthStates: Object.keys(manifest.layers.mouth),
            joints: manifest.joints.map((joint) => joint.id),
          },
          provenance: entry.provenance,
        };
      }),
    };
    validateAssetCatalog(catalog);
    atomicWriteJson(path.join(publishRoot, 'characters', 'index.json'), catalog);
  }

  function findSummary(id) {
    return [
      ...builtinCatalog.entries.map((entry) => summary(entry, 'builtin', null)),
      ...registry.entries.map((record) => summary(record.entry, 'local', record)),
    ].find((resource) => resource.id === id);
  }
}

export function defaultLibraryStorageRoot({
  environment = process.env,
  platform = process.platform,
  homeDirectory = homedir(),
} = {}) {
  if (platform === 'win32') {
    return path.join(environment.LOCALAPPDATA || path.join(homeDirectory, 'AppData', 'Local'), 'DisenadorVideosLocal', 'library');
  }
  if (platform === 'darwin') {
    return path.join(homeDirectory, 'Library', 'Application Support', 'DisenadorVideosLocal', 'library');
  }
  return path.join(environment.XDG_DATA_HOME || path.join(homeDirectory, '.local', 'share'), 'disenador-videos-local', 'library');
}

function migrateLegacyIndex({ indexPath, legacyIndexPath }) {
  if (existsSync(indexPath) || !existsSync(legacyIndexPath) || path.resolve(indexPath) === path.resolve(legacyIndexPath)) return;
  atomicWriteBuffer(indexPath, readFileSync(legacyIndexPath));
}

function materializeManagedAssets({
  registry,
  assetsRoot,
  storageAssetsRoot,
  publishRoot,
  publishedAssetsRelative,
}) {
  const managedPrefix = `${publishedAssetsRelative}/`;
  for (const record of registry.entries) {
    const manifestRelative = record.entry?.type === 'background'
      ? record.entry.backgroundManifest
      : isManagedCharacter(record.entry, publishedAssetsRelative)
        ? path.posix.join(publishedAssetsRelative, 'characters', record.entry.characterRef.entryId, 'character.manifest.json')
        : null;
    if (typeof manifestRelative !== 'string' || !manifestRelative.startsWith(managedPrefix)) continue;
    const packageRelative = path.posix.dirname(manifestRelative.slice(managedPrefix.length));
    const sourceDirectory = resolveManagedRelative(storageAssetsRoot, packageRelative, 'paquete durable');
    const publishedDirectory = resolveManagedRelative(publishRoot, packageRelative, 'paquete publicado');
    if (!existsSync(sourceDirectory)) {
      const legacyManifest = resolveManagedRelative(assetsRoot, manifestRelative, 'manifest publicado anterior');
      if (existsSync(legacyManifest)) {
        syncDirectory(path.dirname(legacyManifest), sourceDirectory, {
          sourceRoot: assetsRoot,
          targetRoot: storageAssetsRoot,
        });
      }
    }
    if (!existsSync(sourceDirectory)) {
      throw libraryError('LIBRARY_ASSET_MISSING', `Falta el paquete durable del recurso «${record.id}».`);
    }
    syncDirectory(sourceDirectory, publishedDirectory, {
      sourceRoot: storageAssetsRoot,
      targetRoot: publishRoot,
    });
  }
}

function isManagedCharacter(entry, publishedAssetsRelative) {
  return entry?.type === 'character'
    && entry.characterRef?.catalog === path.posix.join(publishedAssetsRelative, 'characters', 'index.json')
    && entry.characterRef.entryId === entry.id;
}

function validateCharacterDesign(design) {
  if (!validateCharacterDesignSchema(design)) {
    const detail = (validateCharacterDesignSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    const error = libraryError('LIBRARY_CHARACTER_DESIGN_INVALID', 'El diseño del personaje no cumple el contrato permitido.');
    error.technicalDetail = detail;
    throw error;
  }
  const issues = customCharacterDesignIssues(design);
  if (design.version === 2 && issues.length > 0) {
    const error = libraryError('LIBRARY_CHARACTER_DESIGN_INVALID', 'El personaje necesita todas las piezas funcionales para poder animarse.');
    error.technicalDetail = issues.slice(0, 12).join('; ');
    throw error;
  }
  return design;
}

function resolveManagedRelative(root, relativePath, label) {
  const segments = String(relativePath).split('/');
  if (!relativePath || segments.includes('..') || segments.includes('.') || path.isAbsolute(relativePath)) {
    throw libraryError('LIBRARY_PATH_INVALID', `La ruta del ${label} no es portable.`);
  }
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(path.resolve(root), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw libraryError('LIBRARY_PATH_INVALID', `La ruta del ${label} sale de la raíz controlada.`);
  }
  return resolved;
}

function syncDirectory(source, target, roots) {
  assertWithin(roots.sourceRoot, source, 'fuente de copia');
  const sourceStats = lstatSync(source);
  if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
    throw libraryError('LIBRARY_PATH_INVALID', 'El paquete durable debe ser una carpeta real.');
  }
  ensureDirectory(target);
  assertWithin(roots.targetRoot, target, 'destino de copia');
  for (const name of readdirSync(source)) {
    const sourceItem = path.join(source, name);
    const targetItem = path.join(target, name);
    const stats = lstatSync(sourceItem);
    if (stats.isSymbolicLink()) {
      throw libraryError('LIBRARY_PATH_INVALID', 'Los paquetes de recursos no admiten enlaces simbólicos.');
    }
    if (stats.isDirectory()) {
      syncDirectory(sourceItem, targetItem, roots);
    } else if (stats.isFile()) {
      atomicWriteBuffer(targetItem, readFileSync(sourceItem));
    } else {
      throw libraryError('LIBRARY_PATH_INVALID', 'El paquete contiene un tipo de archivo no permitido.');
    }
  }
}

function validateCatalog(catalog, assetsRoot) {
  if (!validateCatalogSchema(catalog)) {
    const detail = (validateCatalogSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    const error = libraryError('LIBRARY_RESOURCE_INVALID', 'El catálogo de recursos no cumple el contrato versión 1.');
    error.technicalDetail = detail;
    throw error;
  }
  validateResourceCatalogSemantics(catalog, assetsRoot);
}

function readRegistry(indexPath) {
  if (!existsSync(indexPath)) return { version: 1, entries: [] };
  try {
    return JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (error) {
    const wrapped = libraryError('LIBRARY_INDEX_INVALID', 'El índice de la biblioteca local no contiene JSON válido.');
    wrapped.cause = error;
    throw wrapped;
  }
}

function validateRegistry(registry) {
  if (!validateLibrarySchema(registry)) {
    const detail = (validateLibrarySchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    const error = libraryError('LIBRARY_INDEX_INVALID', 'El índice de la biblioteca local no cumple el contrato versión 1.');
    error.technicalDetail = detail;
    throw error;
  }
  const ids = new Set();
  for (const record of registry.entries) {
    if (record.id !== record.entry.id || record.contentHash !== resourceFingerprint(record.entry) || ids.has(record.id)) {
      throw libraryError('LIBRARY_INDEX_INVALID', 'El índice de la biblioteca local contiene un registro inconsistente.');
    }
    ids.add(record.id);
  }
}

function summary(entry, origin, record) {
  return {
    id: entry.id,
    type: entry.type,
    label: entry.label,
    origin,
    contentHash: record?.contentHash || resourceFingerprint(entry),
    registeredAt: record?.registeredAt || null,
    entry: clone(entry),
  };
}

function resourceFingerprint(entry) {
  const identity = entry?.type === 'character' ? { type: entry.type, characterRef: entry.characterRef }
    : entry?.type === 'background' ? { type: entry.type, backgroundManifest: entry.backgroundManifest }
      : entry?.type === 'voice' ? { type: entry.type, voice: entry.voice }
        : entry?.type === 'image' ? { type: entry.type, asset: entry.asset }
          : entry;
  return createHash('sha256').update(JSON.stringify(canonicalize(identity))).digest('hex');
}

function inspectBackgroundImage(bytes, declaredMimeType) {
  if (bytes.length === 0 || bytes.length > MAX_BACKGROUND_BYTES) {
    throw libraryError('LIBRARY_BACKGROUND_SIZE_INVALID', 'El fondo debe pesar entre 1 byte y 12 MB.');
  }
  let image;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    image = {
      extension: 'png',
      mimeType: 'image/png',
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dimensions = readJpegDimensions(bytes);
    image = { extension: 'jpg', mimeType: 'image/jpeg', ...dimensions };
  } else {
    throw libraryError('LIBRARY_BACKGROUND_FORMAT_INVALID', 'El archivo no es un PNG o JPG válido.');
  }
  if (declaredMimeType && String(declaredMimeType).split(';', 1)[0].trim().toLowerCase() !== image.mimeType) {
    throw libraryError('LIBRARY_BACKGROUND_FORMAT_INVALID', 'El contenido del archivo no coincide con su tipo declarado.');
  }
  if (
    image.width < 64
    || image.height < 64
    || image.width > 8192
    || image.height > 8192
    || image.width * image.height > MAX_BACKGROUND_PIXELS
  ) {
    throw libraryError(
      'LIBRARY_BACKGROUND_DIMENSIONS_INVALID',
      'El fondo debe medir entre 64 y 8192 píxeles por lado y no superar 25 megapíxeles.',
    );
  }
  return image;
}

function readJpegDimensions(bytes) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  throw libraryError('LIBRARY_BACKGROUND_FORMAT_INVALID', 'No se pudieron leer las dimensiones del JPG.');
}

function normalizeBackgroundImage({ bytes, image, directory, outputName, ffmpegExecutable }) {
  const outputFile = path.join(directory, outputName);
  const sourceFile = path.join(directory, `source.${image.extension}`);
  atomicWriteBuffer(sourceFile, bytes);
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', sourceFile,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
    '-frames:v', '1',
    ...(image.extension === 'jpg' ? ['-q:v', '2'] : []),
    outputFile,
  ];
  const result = spawnSync(ffmpegExecutable, args, {
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  rmSync(sourceFile, { force: true });
  if (result.error || result.status !== 0 || !existsSync(outputFile)) {
    const error = libraryError('LIBRARY_BACKGROUND_PROCESSING_FAILED', 'No se pudo adaptar el fondo al formato vertical 1080 × 1920.');
    error.technicalDetail = result.error?.code
      ? `FFmpeg no disponible o interrumpido (${result.error.code}).`
      : `FFmpeg finalizó con código ${result.status ?? 'desconocido'}.`;
    throw error;
  }
  const normalized = inspectBackgroundImage(readFileSync(outputFile), image.mimeType);
  if (normalized.width !== 1080 || normalized.height !== 1920) {
    throw libraryError('LIBRARY_BACKGROUND_PROCESSING_FAILED', 'FFmpeg no produjo un fondo con dimensiones válidas.');
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function atomicWriteJson(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function atomicWriteBuffer(file, value) {
  ensureDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, value, { flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function removeManagedDirectory(target, allowedRoot) {
  if (!existsSync(target)) return;
  const relative = path.relative(realpathSync(allowedRoot), realpathSync(target));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw libraryError('LIBRARY_PATH_INVALID', 'La limpieza intentó salir de la carpeta administrada.');
  }
  rmSync(target, { recursive: true, force: true });
}

function safeDisplayName(value, maximumLength) {
  const normalized = String(value || '').replace(/[\u0000-\u001f\u007f]/gu, '').trim();
  return (normalized || 'Recurso local').slice(0, maximumLength);
}

function assertWithin(root, target, label) {
  const relative = path.relative(realpathSync(root), realpathSync(target));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return;
  throw libraryError('LIBRARY_PATH_INVALID', `La ${label} debe permanecer dentro de su raíz controlada.`);
}

function portable(value) {
  return value.split(path.sep).join('/');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function libraryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
