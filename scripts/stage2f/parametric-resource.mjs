// Compilador de recursos v3 (Fase 1 del plan de capacidades creativas editables).
//
// Diferencia central con el compilador v1 → v2 de `parametric-character.mjs`:
// acá cada pieza se rasteriza en su propia capa, con su pivote, para que una
// rotación continua pueda moverla en tiempo de composición. En v2 el brazo está
// horneado en `body.png` y los gestos son PNG pre-posados; por eso ningún
// recurso v2 puede animar `armRaise`.
//
// El compilador v2 no se toca: los recursos ya publicados tienen que conservar
// sus hashes, y de eso se ocupa la guardia `stage2f:test-hash-baseline`.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { shapeGroupsToSvgDocument, shapesToSvgDocument } from '../../shared/shape-renderer.js';
import { rasterizeSvg, withBrowserProfile } from './rasterizer.mjs';
import { validateResourceManifestV3 } from './resource-manifest.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: true });
// El vocabulario geométrico se reutiliza del contrato v1 por referencia.
ajv.addSchema(readJson(path.join(projectRoot, 'schema', 'parametric-character.schema.json')));
const validateDefinitionSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'parametric-resource-v3.schema.json')));

function definitionError(code, message, detail, action = 'Corrija la definición del recurso.') {
  throw new PipelineError({ code, stage: 'generating_assets', message, technicalDetail: detail, suggestedAction: action });
}

export function loadResourceDefinition(definitionPath) {
  let definition;
  try {
    definition = JSON.parse(readFileSync(definitionPath, 'utf8'));
  } catch (error) {
    throw new PipelineError({
      code: 'RESOURCE_DEFINITION_JSON_INVALID',
      stage: 'generating_assets',
      message: 'La definición del recurso no contiene JSON válido.',
      cause: error,
      suggestedAction: 'Corrija la sintaxis de la definición.',
    });
  }
  if (!validateDefinitionSchema(definition)) {
    const detail = (validateDefinitionSchema.errors || []).slice(0, 12).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    definitionError('RESOURCE_DEFINITION_SCHEMA_INVALID', 'La definición del recurso no cumple el contrato versión 3.', detail);
  }
  validateDefinitionSemantics(definition);
  return definition;
}

function validateDefinitionSemantics(definition) {
  const variantIds = new Set();
  const outputIds = new Set();
  for (const variant of definition.variants) {
    if (variantIds.has(variant.id)) definitionError('RESOURCE_DEFINITION_SEMANTIC_INVALID', 'La definición repite una variante.', variant.id);
    if (outputIds.has(variant.outputId)) definitionError('RESOURCE_DEFINITION_SEMANTIC_INVALID', 'La definición repite un outputId.', variant.outputId);
    variantIds.add(variant.id);
    outputIds.add(variant.outputId);
  }

  // Toda la validación de piezas, parámetros y bindings vive en el contrato del
  // manifest: se valida el manifest que sale de esta definición, así no hay dos
  // implementaciones de las mismas reglas.

  const tokens = new Set();
  for (const shapes of allShapeLists(definition)) {
    for (const shape of shapes) {
      for (const value of [shape.fill, shape.stroke]) {
        if (typeof value === 'string' && value.startsWith('$')) tokens.add(value.slice(1));
      }
    }
  }
  for (const variant of definition.variants) {
    for (const token of tokens) {
      if (!variant.palette[token]) {
        definitionError('RESOURCE_DEFINITION_SEMANTIC_INVALID', 'Una variante no define un color usado por las primitivas.', `${variant.id} · ${token}`);
      }
    }
  }
}

function allShapeLists(definition) {
  const lists = definition.parts.map((part) => part.shapes);
  if (definition.kind !== 'character') return lists;
  lists.push(definition.states.eyes.open, definition.states.eyes.closed);
  for (const shapes of Object.values(definition.states.mouth)) lists.push(shapes);
  return lists;
}

function toPortable(value) {
  return value.split(path.sep).join('/');
}

function fileHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function assertWithin(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    definitionError('ASSET_PATH_INVALID', 'Una ruta de salida sale de la raíz permitida.', label, 'Use rutas dentro de la carpeta de assets.');
  }
}

/**
 * Piezas ordenadas por zIndex: es el orden de dibujo de la composición y del
 * SVG de las miniaturas.
 */
function drawOrder(parts) {
  return [...parts].sort((a, b) => a.zIndex - b.zIndex);
}

/**
 * Compila una definición v3 en un recurso por variante. Cada pieza produce su
 * PNG, cada estado de ojos y boca el suyo, y cada pose una miniatura compuesta
 * con las piezas ya rotadas.
 *
 * El catálogo se **fusiona**: las entradas existentes de otros recursos se
 * conservan y solo se reemplazan las de este recurso. El compilador v2 aplica
 * la misma regla para que cualquiera de los dos pueda regenerarse sin borrar
 * entradas ajenas.
 */
export function compileParametricResource(options) {
  const assetsRoot = path.resolve(options.assetsRoot);
  const definitionPath = path.resolve(options.definitionPath);
  const outputBase = path.resolve(assetsRoot, options.outputBase || 'assets/resources');
  const catalogPath = path.resolve(assetsRoot, options.catalogRelative || 'assets/catalog/index.json');
  assertWithin(assetsRoot, definitionPath, 'definición');
  assertWithin(assetsRoot, outputBase, 'salida de recursos');
  assertWithin(assetsRoot, catalogPath, 'catálogo');
  const sourceDefinition = toPortable(path.relative(assetsRoot, definitionPath));
  const definition = loadResourceDefinition(definitionPath);
  const artifacts = [];

  withBrowserProfile(({ browserExecutable, browserProfile }) => {
    for (const variant of definition.variants) {
      const variantRoot = path.join(outputBase, variant.outputId);
      assertWithin(outputBase, variantRoot, `variante ${variant.id}`);
      if (existsSync(variantRoot)) rmSync(variantRoot, { recursive: true, force: true });
      const sourceRoot = ensureDirectory(path.join(variantRoot, 'source'));
      const files = [];

      const emit = (name, shapes) => {
        const svgPath = path.join(sourceRoot, `${name}.svg`);
        const pngPath = path.join(variantRoot, `${name}.png`);
        writeFileSync(svgPath, shapesToSvgDocument(definition.canvas, shapes, variant.palette), 'utf8');
        rasterizeSvg(browserExecutable, browserProfile, svgPath, pngPath, definition.canvas);
        files.push(svgPath, pngPath);
        return `${name}.png`;
      };

      const partLayers = {};
      for (const part of definition.parts) partLayers[part.id] = emit(`part_${part.id}`, part.shapes);

      const composite = (name, groups) => {
        const svgPath = path.join(sourceRoot, `${name}.svg`);
        const pngPath = path.join(variantRoot, `${name}.png`);
        writeFileSync(svgPath, shapeGroupsToSvgDocument(definition.canvas, groups, variant.palette), 'utf8');
        rasterizeSvg(browserExecutable, browserProfile, svgPath, pngPath, definition.canvas);
        files.push(svgPath, pngPath);
        return `${name}.png`;
      };

      let previewLayer = null;
      const states = {};
      if (definition.kind === 'character') {
        states.eyes = {
          open: emit('eyes_open', definition.states.eyes.open),
          closed: emit('eyes_closed', definition.states.eyes.closed),
        };
        states.mouth = Object.fromEntries(
          Object.entries(definition.states.mouth).map(([state, shapes]) => [state, emit(`mouth_${state}`, shapes)]),
        );
        states.thumbnails = {};
        for (const pose of definition.poses) {
          // La miniatura compone las piezas en orden de dibujo, con el brazo
          // rotado por la pose en vez de redibujado en otra posición.
          const rotations = new Map(pose.parts.map((item) => [item.partId, item.rotationDegrees]));
          const groups = drawOrder(definition.parts).map((part) => ({
            shapes: part.shapes,
            rotation: rotations.has(part.id)
              ? { degrees: rotations.get(part.id), x: part.pivot.x, y: part.pivot.y }
              : null,
          }));
          groups.push({ shapes: definition.states.eyes.open, rotation: null });
          groups.push({ shapes: definition.states.mouth.closed, rotation: null });
          states.thumbnails[pose.id] = composite(`pose_${pose.id}`, groups);
        }
      } else {
        // Un prop no tiene poses, pero la biblioteca necesita verlo entero: una
        // sola pieza suelta no sirve como miniatura.
        previewLayer = composite('preview', drawOrder(definition.parts).map((part) => ({ shapes: part.shapes, rotation: null })));
      }

      const manifest = {
        version: 3,
        id: variant.outputId,
        kind: definition.kind,
        canvas: definition.canvas,
        pivot: definition.pivot,
        sourceDefinition,
        variant: { id: variant.id, label: variant.label, palette: variant.palette },
        parts: definition.parts.map((part) => ({
          id: part.id,
          parentId: part.parentId,
          pivot: part.pivot,
          zIndex: part.zIndex,
          layer: partLayers[part.id],
        })),
        ...(definition.kind === 'character' ? { states, poses: definition.poses } : {}),
        parameters: definition.parameters,
        bindings: definition.bindings,
        provenance: definition.provenance,
      };
      validateResourceManifestV3(manifest);
      const manifestPath = path.join(variantRoot, 'resource.manifest.json');
      writeJson(manifestPath, manifest);
      files.push(manifestPath);

      artifacts.push({
        variant,
        manifest,
        previewLayer,
        root: variantRoot,
        manifestPath,
        hashes: Object.fromEntries(files.sort().map((file) => [toPortable(path.relative(variantRoot, file)), fileHash(file)])),
      });
    }
  });

  const catalog = existsSync(catalogPath) ? readJson(catalogPath) : { version: 1, generatedFrom: sourceDefinition, entries: [] };
  const own = new Set(artifacts.map(({ variant }) => variant.outputId));
  catalog.entries = [
    ...catalog.entries.filter((entry) => !own.has(entry.id)),
    ...artifacts.map(({ variant, manifest, previewLayer, root }) => ({
      id: variant.outputId,
      type: definition.kind,
      label: variant.label,
      manifest: toPortable(path.relative(assetsRoot, path.join(root, 'resource.manifest.json'))),
      thumbnail: toPortable(path.relative(assetsRoot, path.join(root, previewLayer ?? 'pose_neutral.png'))),
      tags: options.tags ?? ['parametrico', definition.kind],
      capabilities: definition.kind === 'character'
        ? {
            poses: definition.poses.map((pose) => pose.id),
            mouthStates: Object.keys(definition.states.mouth),
            parts: definition.parts.map((part) => part.id),
            parameters: manifest.parameters.map((parameter) => parameter.id),
          }
        : {
            parts: definition.parts.map((part) => part.id),
            parameters: manifest.parameters.map((parameter) => parameter.id),
          },
      provenance: definition.provenance,
    })),
  ];
  writeJson(catalogPath, catalog);
  return { definition, sourceDefinition, catalog, catalogPath, artifacts };
}
