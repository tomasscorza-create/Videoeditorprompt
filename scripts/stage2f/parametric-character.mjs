import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, projectRoot, readJson, run, writeJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateDefinitionSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'parametric-character.schema.json')));
const validateManifestSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'character-manifest-v2.schema.json')));
const validateCatalogSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'asset-catalog.schema.json')));

export function loadParametricCharacterDefinition(definitionPath) {
  let definition;
  try {
    definition = JSON.parse(readFileSync(definitionPath, 'utf8'));
  } catch (error) {
    throw new PipelineError({
      code: 'PARAMETRIC_DEFINITION_JSON_INVALID',
      stage: 'generating_assets',
      message: 'La definición paramétrica no contiene JSON válido.',
      cause: error,
      suggestedAction: 'Corrija la sintaxis de la definición del personaje.',
    });
  }
  assertSchema(validateDefinitionSchema, definition, 'PARAMETRIC_DEFINITION_SCHEMA_INVALID', 'La definición paramétrica no cumple el contrato versión 1.');
  validateDefinitionSemantics(definition);
  return definition;
}

export function validateCompiledCharacterManifest(manifest) {
  assertSchema(validateManifestSchema, manifest, 'CHARACTER_MANIFEST_SCHEMA_INVALID', 'El manifest compilado no cumple el contrato de rig versión 2.');
  validateRigSemantics(manifest);
  return manifest;
}

export function validateAssetCatalog(catalog) {
  assertSchema(validateCatalogSchema, catalog, 'ASSET_CATALOG_SCHEMA_INVALID', 'El catálogo no cumple el contrato versión 1.');
  const ids = new Set();
  for (const entry of catalog.entries) {
    if (ids.has(entry.id)) semanticError('ASSET_CATALOG_SEMANTIC_INVALID', `ID de catálogo duplicado: ${entry.id}`);
    ids.add(entry.id);
    for (const value of [entry.manifest, entry.thumbnail, catalog.generatedFrom]) assertPortablePath(value, 'catálogo');
  }
  return catalog;
}

export function compileParametricCharacter(options) {
  const assetsRoot = path.resolve(options.assetsRoot);
  const definitionPath = path.resolve(options.definitionPath);
  const outputBase = path.resolve(assetsRoot, options.outputBase || 'assets/characters');
  const catalogPath = path.resolve(assetsRoot, options.catalogRelative || 'assets/catalog/index.json');
  assertWithin(assetsRoot, definitionPath, 'definición');
  assertWithin(assetsRoot, outputBase, 'salida de personajes');
  assertWithin(assetsRoot, catalogPath, 'catálogo');
  const sourceDefinition = toPortable(path.relative(assetsRoot, definitionPath));
  assertPortablePath(sourceDefinition, 'sourceDefinition');
  const definition = loadParametricCharacterDefinition(definitionPath);
  const browserExecutable = resolveBrowserExecutable();
  const browserProfile = mkdtempSync(path.join(tmpdir(), 'local-video-stage2f-'));
  const artifacts = [];

  try {
    for (const variant of definition.variants) {
      const variantRoot = path.join(outputBase, variant.outputId);
      assertWithin(outputBase, variantRoot, `variante ${variant.id}`);
      if (existsSync(variantRoot)) rmSync(variantRoot, { recursive: true, force: true });
      const sourceRoot = ensureDirectory(path.join(variantRoot, 'source'));
      const layerShapes = flattenLayers(definition.layers);
      const files = [];

      for (const [name, shapes] of Object.entries(layerShapes)) {
        const svgPath = path.join(sourceRoot, `${name}.svg`);
        const pngPath = path.join(variantRoot, `${name}.png`);
        writeFileSync(svgPath, renderSvg(definition.canvas, shapes, variant.palette), 'utf8');
        rasterizeSvg(browserExecutable, browserProfile, svgPath, pngPath, definition.canvas);
        files.push(svgPath, pngPath);
      }

      const poseFiles = {};
      for (const pose of definition.poses) {
        const handShapes = definition.layers.hands[pose.handState];
        const shapes = [
          ...definition.layers.body,
          ...definition.layers.eyes.open,
          ...definition.layers.mouth.closed,
          ...handShapes,
        ];
        const svgPath = path.join(sourceRoot, `pose_${pose.id}.svg`);
        const pngPath = path.join(variantRoot, `pose_${pose.id}.png`);
        writeFileSync(svgPath, renderSvg(definition.canvas, shapes, variant.palette), 'utf8');
        rasterizeSvg(browserExecutable, browserProfile, svgPath, pngPath, definition.canvas);
        poseFiles[pose.id] = `pose_${pose.id}.png`;
        files.push(svgPath, pngPath);
      }

      const manifest = {
        version: 2,
        id: variant.outputId,
        canvas: definition.canvas,
        pivot: definition.pivot,
        sourceDefinition,
        variant: { id: variant.id, label: variant.label, palette: variant.palette },
        layers: {
          body: 'body.png',
          eyes: { open: 'eyes_open.png', closed: 'eyes_closed.png' },
          mouth: { closed: 'mouth_closed.png', medium: 'mouth_medium.png', open: 'mouth_open.png' },
          hands: { neutral: 'hand_neutral.png', point: 'hand_point.png' },
          thumbnails: { neutral: poseFiles.neutral, point: poseFiles.point },
        },
        joints: definition.joints,
        poses: definition.poses,
        provenance: definition.provenance,
      };
      validateCompiledCharacterManifest(manifest);
      const manifestPath = path.join(variantRoot, 'character.manifest.json');
      writeJson(manifestPath, manifest);
      files.push(manifestPath);
      artifacts.push({
        variant,
        root: variantRoot,
        manifestPath,
        hashes: Object.fromEntries(files.sort().map((file) => [toPortable(path.relative(variantRoot, file)), fileHash(file)])),
      });
    }
  } finally {
    rmSync(browserProfile, { recursive: true, force: true });
  }

  const catalog = {
    version: 1,
    generatedFrom: sourceDefinition,
    entries: artifacts.map(({ variant, root }) => ({
      id: variant.outputId,
      type: 'character',
      label: variant.label,
      manifest: toPortable(path.relative(assetsRoot, path.join(root, 'character.manifest.json'))),
      thumbnail: toPortable(path.relative(assetsRoot, path.join(root, 'pose_neutral.png'))),
      tags: ['geometrico', 'mono', 'parametrico'],
      capabilities: {
        poses: definition.poses.map((pose) => pose.id),
        mouthStates: ['closed', 'medium', 'open'],
        joints: definition.joints.map((joint) => joint.id),
      },
      provenance: definition.provenance,
    })),
  };
  validateAssetCatalog(catalog);
  writeJson(catalogPath, catalog);
  return { definition, sourceDefinition, catalog, catalogPath, artifacts };
}

function validateDefinitionSemantics(definition) {
  const variantIds = new Set();
  const outputIds = new Set();
  for (const variant of definition.variants) {
    if (variantIds.has(variant.id)) semanticError('PARAMETRIC_DEFINITION_SEMANTIC_INVALID', `Variante duplicada: ${variant.id}`);
    if (outputIds.has(variant.outputId)) semanticError('PARAMETRIC_DEFINITION_SEMANTIC_INVALID', `outputId duplicado: ${variant.outputId}`);
    variantIds.add(variant.id);
    outputIds.add(variant.outputId);
  }
  validateRigSemantics(definition);
  const tokens = new Set();
  for (const shapes of Object.values(flattenLayers(definition.layers))) {
    for (const shape of shapes) {
      for (const value of [shape.fill, shape.stroke]) {
        if (typeof value === 'string' && value.startsWith('$')) tokens.add(value.slice(1));
      }
    }
  }
  for (const variant of definition.variants) {
    for (const token of tokens) {
      if (!variant.palette[token]) semanticError('PARAMETRIC_DEFINITION_SEMANTIC_INVALID', `La variante ${variant.id} no define el color ${token}.`);
    }
  }
}

function validateRigSemantics(value) {
  const jointIds = new Set();
  for (const joint of value.joints) {
    if (jointIds.has(joint.id)) semanticError('CHARACTER_RIG_SEMANTIC_INVALID', `Joint duplicado: ${joint.id}`);
    jointIds.add(joint.id);
  }
  const roots = value.joints.filter((joint) => joint.parentId === null);
  if (roots.length !== 1) semanticError('CHARACTER_RIG_SEMANTIC_INVALID', 'El rig debe tener exactamente un joint raíz.');
  for (const joint of value.joints) {
    if (joint.parentId !== null && !jointIds.has(joint.parentId)) semanticError('CHARACTER_RIG_SEMANTIC_INVALID', `Parent inexistente: ${joint.parentId}`);
    const visited = new Set([joint.id]);
    let parentId = joint.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) semanticError('CHARACTER_RIG_SEMANTIC_INVALID', `Ciclo detectado desde ${joint.id}.`);
      visited.add(parentId);
      parentId = value.joints.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
  }
  const poseIds = new Set();
  for (const pose of value.poses) {
    if (poseIds.has(pose.id)) semanticError('CHARACTER_RIG_SEMANTIC_INVALID', `Pose duplicada: ${pose.id}`);
    poseIds.add(pose.id);
    const poseJoints = new Set();
    for (const item of pose.joints) {
      if (!jointIds.has(item.jointId)) semanticError('CHARACTER_RIG_SEMANTIC_INVALID', `La pose ${pose.id} referencia ${item.jointId}, que no existe.`);
      if (poseJoints.has(item.jointId)) semanticError('CHARACTER_RIG_SEMANTIC_INVALID', `La pose ${pose.id} repite ${item.jointId}.`);
      poseJoints.add(item.jointId);
    }
  }
  for (const required of ['neutral', 'point']) {
    if (!poseIds.has(required)) semanticError('CHARACTER_RIG_SEMANTIC_INVALID', `Falta la pose ${required}.`);
  }
}

function flattenLayers(layers) {
  return {
    body: layers.body,
    eyes_open: layers.eyes.open,
    eyes_closed: layers.eyes.closed,
    mouth_closed: layers.mouth.closed,
    mouth_medium: layers.mouth.medium,
    mouth_open: layers.mouth.open,
    hand_neutral: layers.hands.neutral,
    hand_point: layers.hands.point,
  };
}

function renderSvg(canvas, shapes, palette) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">\n${shapes.map((shape) => `  ${renderShape(shape, palette)}`).join('\n')}\n</svg>\n`;
}

function renderShape(shape, palette) {
  const style = [
    `fill="${resolveColor(shape.fill, palette)}"`,
    shape.stroke !== undefined ? `stroke="${resolveColor(shape.stroke, palette)}"` : null,
    shape.strokeWidth !== undefined ? `stroke-width="${shape.strokeWidth}"` : null,
    shape.opacity !== undefined ? `opacity="${shape.opacity}"` : null,
    shape.lineCap ? `stroke-linecap="${shape.lineCap}"` : null,
    shape.lineJoin ? `stroke-linejoin="${shape.lineJoin}"` : null,
  ].filter(Boolean).join(' ');
  if (shape.type === 'ellipse') {
    const transform = shape.rotationDegrees ? ` transform="rotate(${shape.rotationDegrees} ${shape.cx} ${shape.cy})"` : '';
    return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" ${style}${transform}/>`;
  }
  if (shape.type === 'rect') return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx || 0}" ${style}/>`;
  if (shape.type === 'path') return `<path d="${shape.d}" ${style}/>`;
  if (shape.type === 'polygon') return `<polygon points="${shape.points.map((point) => `${point.x},${point.y}`).join(' ')}" ${style}/>`;
  throw new Error(`Primitiva no soportada: ${shape.type}`);
}

function resolveColor(value, palette) {
  if (!value?.startsWith('$')) return value;
  return palette[value.slice(1)];
}

function rasterizeSvg(browserExecutable, browserProfile, svgPath, pngPath, canvas) {
  run(browserExecutable, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${canvas.width},${canvas.height}`,
    `--user-data-dir=${browserProfile}`, `--screenshot=${pngPath}`, pathToFileURL(svgPath).href,
  ], { stage: 'generating_assets', errorCode: 'BROWSER_ASSET_GENERATION_FAILED' });
}

function resolveBrowserExecutable() {
  const executable = [
    process.env.LOCAL_VIDEO_CHROMIUM,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new PipelineError({
    code: 'BROWSER_RUNTIME_NOT_FOUND', stage: 'generating_assets',
    message: 'No se encontró Chrome/Edge para rasterizar los SVG.',
    suggestedAction: 'Configure LOCAL_VIDEO_CHROMIUM con un navegador compatible.',
  });
  return executable;
}

function assertSchema(validate, value, code, message) {
  if (validate(value)) return;
  const detail = (validate.errors || []).slice(0, 12).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
  throw new PipelineError({ code, stage: 'generating_assets', message, technicalDetail: detail, suggestedAction: 'Revise el schema y los campos indicados.' });
}

function semanticError(code, detail) {
  throw new PipelineError({ code, stage: 'generating_assets', message: 'La definición del asset contiene referencias incompatibles.', technicalDetail: detail, suggestedAction: 'Corrija IDs, jerarquía, poses o paletas.' });
}

function assertPortablePath(value, label) {
  const traversal = value.split('/').includes('..') || value.split('\\').includes('..');
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\') || value.includes(':') || traversal || value.includes('\0')) {
    semanticError('ASSET_PATH_INVALID', `${label}: ${value}`);
  }
}

function assertWithin(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) semanticError('ASSET_PATH_INVALID', `${label} sale de la raíz permitida.`);
}

function toPortable(value) {
  return value.split(path.sep).join('/');
}

function fileHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
