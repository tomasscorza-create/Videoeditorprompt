import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { isMain, parseArguments, projectRoot } from '../stage1/common.mjs';
import { PipelineError, serializeError } from '../stage1/errors.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateProjectSchema = ajv.compile(readSchema('video-project.schema.json'));
const validateResourceCatalogSchema = ajv.compile(readSchema('authoring-resource-catalog.schema.json'));
const validateCharacterCatalogSchema = ajv.compile(readSchema('asset-catalog.schema.json'));
const validateBackgroundManifestSchema = ajv.compile(readSchema('background-manifest.schema.json'));

export function loadAndValidateVideoProject({ projectPath, assetsRoot }) {
  const resolvedProjectPath = path.resolve(projectPath);
  const resolvedAssetsRoot = path.resolve(assetsRoot);
  const project = readJsonDocument(resolvedProjectPath, {
    code: 'AUTHORING_PROJECT_JSON_INVALID',
    message: 'El proyecto editable no contiene JSON válido.',
  });
  assertSchema(validateProjectSchema, project, {
    code: 'AUTHORING_PROJECT_SCHEMA_INVALID',
    message: 'El proyecto editable no cumple el contrato versión 1.',
  });
  assertPortableRelativePath(project.resourceCatalog, '/resourceCatalog');
  const catalogPath = resolveAuthoringAsset(resolvedAssetsRoot, project.resourceCatalog, 'catálogo de autoría');
  const catalog = readJsonDocument(catalogPath, {
    code: 'AUTHORING_RESOURCE_CATALOG_JSON_INVALID',
    message: 'El catálogo de autoría no contiene JSON válido.',
  });
  const { resources } = validateVideoProjectDocument({
    project,
    catalog,
    assetsRoot: resolvedAssetsRoot,
  });
  return {
    project,
    catalog,
    projectPath: resolvedProjectPath,
    catalogPath,
    assetsRoot: resolvedAssetsRoot,
    resources,
  };
}

export function validateVideoProjectDocument({ project, catalog, assetsRoot }) {
  const resolvedAssetsRoot = path.resolve(assetsRoot);
  assertSchema(validateProjectSchema, project, {
    code: 'AUTHORING_PROJECT_SCHEMA_INVALID',
    message: 'El proyecto editable no cumple el contrato versión 1.',
  });
  assertPortableRelativePath(project.resourceCatalog, '/resourceCatalog');
  assertSchema(validateResourceCatalogSchema, catalog, {
    code: 'AUTHORING_RESOURCE_CATALOG_SCHEMA_INVALID',
    message: 'El catálogo de autoría no cumple el contrato versión 1.',
  });
  const resources = validateResourceCatalogSemantics(catalog, resolvedAssetsRoot);
  validateProjectSemantics(project, resources);
  return { project, catalog, assetsRoot: resolvedAssetsRoot, resources };
}

export function validateResourceCatalogSemantics(catalog, assetsRoot) {
  const resources = new Map();
  const characterCatalogs = new Map();
  for (const [index, entry] of catalog.entries.entries()) {
    if (resources.has(entry.id)) semanticError(`/resourceCatalog/entries/${index}/id`, 'debe ser único');
    resources.set(entry.id, entry);
    if (entry.type === 'character') {
      assertPortableRelativePath(entry.characterRef.catalog, `/resourceCatalog/entries/${index}/characterRef/catalog`);
      let characterCatalog = characterCatalogs.get(entry.characterRef.catalog);
      if (!characterCatalog) {
        const catalogFile = resolveAuthoringAsset(assetsRoot, entry.characterRef.catalog, `catálogo de personaje ${entry.id}`);
        characterCatalog = readJsonDocument(catalogFile, {
          code: 'CHARACTER_CATALOG_JSON_INVALID',
          message: 'Un catálogo de personajes referenciado no contiene JSON válido.',
        });
        assertSchema(validateCharacterCatalogSchema, characterCatalog, {
          code: 'CHARACTER_CATALOG_SCHEMA_INVALID',
          message: 'Un catálogo de personajes referenciado no cumple su contrato.',
        });
        assertPortableRelativePath(characterCatalog.generatedFrom, '/characterCatalog/generatedFrom');
        resolveAuthoringAsset(assetsRoot, characterCatalog.generatedFrom, 'definición fuente del catálogo de personajes');
        for (const [compiledIndex, compiledEntry] of characterCatalog.entries.entries()) {
          for (const name of ['manifest', 'thumbnail']) {
            assertPortableRelativePath(compiledEntry[name], `/characterCatalog/entries/${compiledIndex}/${name}`);
            resolveAuthoringAsset(assetsRoot, compiledEntry[name], `${name} de personaje ${compiledEntry.id}`);
          }
        }
        characterCatalogs.set(entry.characterRef.catalog, characterCatalog);
      }
      const compiled = characterCatalog.entries.find((candidate) => candidate.id === entry.characterRef.entryId);
      if (!compiled) semanticError(`/resourceCatalog/entries/${index}/characterRef/entryId`, 'debe existir en el catálogo de personajes referenciado');
      for (const pose of entry.capabilities.poses) {
        if (!compiled.capabilities.poses.includes(pose)) {
          semanticError(`/resourceCatalog/entries/${index}/capabilities/poses`, `declara ${pose}, pero el personaje compilado no la soporta`);
        }
      }
    } else if (entry.type === 'background') {
      assertPortableRelativePath(entry.backgroundManifest, `/resourceCatalog/entries/${index}/backgroundManifest`);
      const manifestFile = resolveAuthoringAsset(assetsRoot, entry.backgroundManifest, `manifest de fondo ${entry.id}`);
      const manifest = readJsonDocument(manifestFile, {
        code: 'BACKGROUND_MANIFEST_JSON_INVALID',
        message: 'Un manifest de fondo referenciado no contiene JSON válido.',
      });
      assertSchema(validateBackgroundManifestSchema, manifest, {
        code: 'BACKGROUND_MANIFEST_SCHEMA_INVALID',
        message: 'Un manifest de fondo referenciado no cumple su contrato.',
      });
      const manifestDirectory = path.posix.dirname(entry.backgroundManifest);
      for (const [name, layerPath] of Object.entries(manifest.layers)) {
        assertPortableRelativePath(layerPath, `/backgroundManifest/layers/${name}`);
        resolveAuthoringAsset(assetsRoot, path.posix.join(manifestDirectory, layerPath), `capa ${name} del fondo ${entry.id}`);
      }
    } else if (entry.type === 'image') {
      for (const name of ['asset', 'thumbnail']) {
        assertPortableRelativePath(entry[name], `/resourceCatalog/entries/${index}/${name}`);
        resolveAuthoringAsset(assetsRoot, entry[name], `${name} de imagen ${entry.id}`);
      }
    }
  }
  return resources;
}

function validateProjectSemantics(project, resources) {
  const sceneIds = new Set();
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    if (sceneIds.has(scene.id)) semanticError(`/scenes/${sceneIndex}/id`, 'debe ser único dentro del proyecto');
    sceneIds.add(scene.id);
    const isLast = sceneIndex === project.scenes.length - 1;
    if (!isLast && !scene.transitionToNext) semanticError(`/scenes/${sceneIndex}/transitionToNext`, 'es obligatoria salvo en la última escena');
    if (isLast && scene.transitionToNext) semanticError(`/scenes/${sceneIndex}/transitionToNext`, 'no debe existir en la última escena');
    if (scene.transitionToNext?.preset === 'cut' && scene.transitionToNext.durationSeconds !== 0) {
      semanticError(`/scenes/${sceneIndex}/transitionToNext/durationSeconds`, 'debe ser 0 para un corte');
    }
    if (scene.transitionToNext?.preset === 'fade' && scene.transitionToNext.durationSeconds <= 0) {
      semanticError(`/scenes/${sceneIndex}/transitionToNext/durationSeconds`, 'debe ser mayor que 0 para un fundido');
    }

    const background = requireResource(resources, scene.background.resourceId, 'background', `/scenes/${sceneIndex}/background/resourceId`);
    if (!background.capabilities.cameraPresets.includes(scene.background.cameraPreset)) {
      semanticError(`/scenes/${sceneIndex}/background/cameraPreset`, 'debe estar declarado por el fondo seleccionado');
    }

    const elements = new Map();
    for (const [elementIndex, element] of scene.elements.entries()) {
      const elementPath = `/scenes/${sceneIndex}/elements/${elementIndex}`;
      if (elements.has(element.id)) semanticError(`${elementPath}/id`, 'debe ser único dentro de la escena');
      elements.set(element.id, element);
      if (element.type === 'character') {
        const resource = requireResource(resources, element.resourceId, 'character', `${elementPath}/resourceId`);
        if (!resource.capabilities.poses.includes(element.poseId)) semanticError(`${elementPath}/poseId`, 'debe estar soportada por el personaje');
        if (!resource.capabilities.animationPresets.includes(element.animationPreset)) semanticError(`${elementPath}/animationPreset`, 'debe estar soportado por el personaje');
      } else if (element.type === 'image') {
        requireResource(resources, element.resourceId, 'image', `${elementPath}/resourceId`);
      }
    }

    const turnIds = new Set();
    for (const [turnIndex, turn] of scene.dialogue.entries()) {
      const turnPath = `/scenes/${sceneIndex}/dialogue/${turnIndex}`;
      if (turnIds.has(turn.id)) semanticError(`${turnPath}/id`, 'debe ser único dentro de la escena');
      turnIds.add(turn.id);
      const speaker = elements.get(turn.speakerElementId);
      if (!speaker || speaker.type !== 'character') semanticError(`${turnPath}/speakerElementId`, 'debe referenciar un personaje de la misma escena');
      const speakerResource = resources.get(speaker.resourceId);
      if (!speakerResource.capabilities.poses.includes(turn.gestureId)) semanticError(`${turnPath}/gestureId`, 'debe estar soportado por el personaje que habla');
      requireResource(resources, turn.voiceId, 'voice', `${turnPath}/voiceId`);
    }
  }
}

function requireResource(resources, id, expectedType, jsonPath) {
  const resource = resources.get(id);
  if (!resource) semanticError(jsonPath, 'debe existir en el catálogo de autoría');
  if (resource.type !== expectedType) semanticError(jsonPath, `debe referenciar un recurso de tipo ${expectedType}`);
  return resource;
}

export function resolveAuthoringAsset(assetsRoot, relativePath, label) {
  if (!existsSync(assetsRoot) || !statSync(assetsRoot).isDirectory()) {
    throw new PipelineError({
      code: 'AUTHORING_ASSETS_ROOT_INVALID',
      stage: 'validating_project',
      message: 'La raíz de recursos del proyecto no existe o no es una carpeta.',
      suggestedAction: 'Indique una carpeta válida mediante --assets-dir.',
    });
  }
  const target = path.resolve(assetsRoot, relativePath);
  const relative = path.relative(assetsRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) assetPathError(relativePath, label);
  if (!existsSync(target)) {
    throw new PipelineError({
      code: 'AUTHORING_ASSET_NOT_FOUND',
      stage: 'validating_project',
      message: `No existe ${label}.`,
      technicalDetail: relativePath,
      suggestedAction: 'Corrija el ID o la ruta del recurso dentro del catálogo.',
    });
  }
  const rootReal = realpathSync(assetsRoot);
  const targetReal = realpathSync(target);
  const realRelative = path.relative(rootReal, targetReal);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) assetPathError(relativePath, label);
  if (!statSync(targetReal).isFile()) assetPathError(relativePath, label);
  return targetReal;
}

function assertPortableRelativePath(value, jsonPath) {
  const traversal = value.split('/').includes('..') || value.split('\\').includes('..');
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\') || value.includes(':') || value.includes('\0') || traversal) {
    assetPathError(value, jsonPath);
  }
}

function assetPathError(value, label) {
  throw new PipelineError({
    code: 'AUTHORING_ASSET_PATH_INVALID',
    stage: 'validating_project',
    message: `La ruta de ${label} debe ser relativa, portable y permanecer dentro de assets-dir.`,
    technicalDetail: String(value),
    suggestedAction: 'Use IDs y rutas relativas con barras normales.',
  });
}

function readJsonDocument(file, options) {
  if (!existsSync(file)) {
    throw new PipelineError({
      code: 'AUTHORING_FILE_NOT_FOUND',
      stage: 'validating_project',
      message: 'No existe el archivo requerido para validar el proyecto.',
      technicalDetail: file,
      suggestedAction: 'Revise --project y las referencias del catálogo.',
    });
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new PipelineError({
      code: options.code,
      stage: 'validating_project',
      message: options.message,
      technicalDetail: error instanceof SyntaxError ? error.message : undefined,
      suggestedAction: 'Corrija el JSON y vuelva a validar.',
    });
  }
}

function assertSchema(validate, value, options) {
  if (validate(value)) return;
  const details = [...(validate.errors || [])]
    .slice(0, 12)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  throw new PipelineError({
    code: options.code,
    stage: 'validating_project',
    message: options.message,
    technicalDetail: details,
    suggestedAction: 'Revise los campos requeridos, tipos, IDs y límites indicados.',
  });
}

function semanticError(jsonPath, rule) {
  throw new PipelineError({
    code: 'AUTHORING_PROJECT_SEMANTIC_INVALID',
    stage: 'validating_project',
    message: 'El proyecto editable contiene referencias o valores incompatibles.',
    technicalDetail: `${jsonPath} ${rule}`,
    suggestedAction: 'Corrija la referencia indicada usando capacidades e IDs existentes del catálogo.',
  });
}

function readSchema(name) {
  return JSON.parse(readFileSync(path.join(projectRoot, 'schema', name), 'utf8'));
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArguments();
    const result = loadAndValidateVideoProject({
      projectPath: path.resolve(projectRoot, String(args.project || 'pilots/proyecto-editable-01/project.json')),
      assetsRoot: path.resolve(projectRoot, String(args['assets-dir'] || 'public')),
    });
    process.stdout.write(`${JSON.stringify({
      version: 1,
      valid: true,
      projectId: result.project.id,
      scenes: result.project.scenes.length,
      resources: result.catalog.entries.length,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ version: 1, valid: false, ...serializeError(error, 'validating_project') })}\n`);
    process.exitCode = 1;
  }
}
