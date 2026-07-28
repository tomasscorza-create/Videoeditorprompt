// Fase 1 del plan de capacidades creativas editables — manifest de recurso v3.
//
// El rig v2 declara joints con pivote y jerarquía, pero nada ata esos joints a
// píxeles: el brazo está horneado dentro de `body.png` y los gestos son PNG con
// el brazo pre-posicionado. Por eso un parámetro continuo como `armRaise` no
// puede mover nada en un recurso v2.
//
// El v3 agrega tres cosas, todas aditivas: piezas compositables con pivote y
// jerarquía, el tipo `prop`, y la declaración explícita de qué parámetros
// animables ofrece el recurso con su binding a una pieza. El vocabulario de
// parámetros no se repite acá: sale del contrato congelado en la Fase 0.
//
// El adaptador de lectura convierte un manifest v2 en una vista v3 sin pérdida:
// los joints se vuelven piezas sin capa (pivotes declarados sin píxeles) y la
// lista de parámetros queda vacía, que es la verdad — un recurso v2 no articula.

import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { ANIMATION_PARAMETERS, RESOURCE_DECLARED_PARAMETERS } from '../animation/animation-contract.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'resource-manifest-v3.schema.json')));

const BINDING_CHANNELS = new Set(['rotationDegrees', 'offsetX', 'offsetY', 'scale', 'opacity']);

function semanticError(detail) {
  throw new PipelineError({
    code: 'RESOURCE_MANIFEST_SEMANTIC_INVALID',
    stage: 'generating_assets',
    message: 'El manifest de recurso contiene referencias incompatibles.',
    technicalDetail: detail,
    suggestedAction: 'Corrija ids, jerarquía de piezas, parámetros o bindings.',
  });
}

function assertPortablePath(value, label) {
  const traversal = value.split('/').includes('..') || value.split('\\').includes('..');
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\') || value.includes(':') || traversal || value.includes('\0')) {
    throw new PipelineError({
      code: 'ASSET_PATH_INVALID',
      stage: 'generating_assets',
      message: 'El manifest de recurso referencia una ruta no portable.',
      technicalDetail: `${label}: ${value}`,
      suggestedAction: 'Use rutas relativas dentro de la carpeta de assets.',
    });
  }
}

/** Valida estructura y semántica de un manifest v3. Devuelve el manifest. */
export function validateResourceManifestV3(manifest) {
  if (!validateSchema(manifest)) {
    const detail = (validateSchema.errors || []).slice(0, 12).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new PipelineError({
      code: 'RESOURCE_MANIFEST_SCHEMA_INVALID',
      stage: 'generating_assets',
      message: 'El manifest de recurso no cumple el contrato versión 3.',
      technicalDetail: detail,
      suggestedAction: 'Revise el schema y los campos indicados.',
    });
  }

  const partIds = new Set();
  const zIndexes = new Set();
  for (const part of manifest.parts) {
    if (partIds.has(part.id)) semanticError(`Pieza duplicada: ${part.id}`);
    partIds.add(part.id);
    // El orden de dibujo no admite empates: dos piezas con el mismo zIndex
    // dejarían la composición a merced del orden del array.
    if (zIndexes.has(part.zIndex)) semanticError(`zIndex repetido en ${part.id}: ${part.zIndex}`);
    zIndexes.add(part.zIndex);
    if (part.layer !== undefined) assertPortablePath(part.layer, `parts/${part.id}/layer`);
  }
  if (manifest.stateParentPartId !== undefined && !partIds.has(manifest.stateParentPartId)) {
    semanticError(`La pieza padre de estados no existe: ${manifest.stateParentPartId}`);
  }

  const roots = manifest.parts.filter((part) => part.parentId === null);
  if (roots.length !== 1) semanticError(`El recurso debe tener exactamente una pieza raíz y tiene ${roots.length}.`);
  for (const part of manifest.parts) {
    if (part.parentId !== null && !partIds.has(part.parentId)) semanticError(`Pieza padre inexistente: ${part.parentId}`);
    const visited = new Set([part.id]);
    let parentId = part.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) semanticError(`Ciclo de piezas detectado desde ${part.id}.`);
      visited.add(parentId);
      parentId = manifest.parts.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
  }

  assertPortablePath(manifest.sourceDefinition, 'sourceDefinition');

  const declared = new Set();
  for (const parameter of manifest.parameters) {
    if (declared.has(parameter.id)) semanticError(`Parámetro declarado dos veces: ${parameter.id}`);
    declared.add(parameter.id);
    if (!RESOURCE_DECLARED_PARAMETERS.includes(parameter.id)) {
      semanticError(`El parámetro ${parameter.id} no requiere declaración del recurso o no existe en el vocabulario V1.`);
    }
    if (parameter.minimum >= parameter.maximum) semanticError(`El parámetro ${parameter.id} tiene un rango vacío.`);
    if (parameter.default < parameter.minimum || parameter.default > parameter.maximum) {
      semanticError(`El valor por defecto de ${parameter.id} cae fuera de su rango.`);
    }
    // El recurso puede acotar el rango del vocabulario, nunca ampliarlo.
    const frozen = ANIMATION_PARAMETERS[parameter.id];
    if (parameter.minimum < frozen.minimum || parameter.maximum > frozen.maximum) {
      semanticError(`El parámetro ${parameter.id} excede el rango congelado ${frozen.minimum}..${frozen.maximum}.`);
    }
  }

  const seenBindings = new Set();
  const occupiedChannels = new Set();
  for (const binding of manifest.bindings) {
    if (!declared.has(binding.parameterId)) semanticError(`El binding apunta a ${binding.parameterId}, que el recurso no declara.`);
    if (!partIds.has(binding.partId)) semanticError(`El binding apunta a la pieza inexistente ${binding.partId}.`);
    if (!BINDING_CHANNELS.has(binding.channel)) semanticError(`Canal de binding no soportado: ${binding.channel}`);
    const key = `${binding.parameterId}:${binding.partId}:${binding.channel}`;
    if (seenBindings.has(key)) semanticError(`Binding duplicado: ${key}`);
    seenBindings.add(key);
    const occupiedKey = `${binding.partId}:${binding.channel}`;
    if (occupiedChannels.has(occupiedKey)) {
      semanticError(`Dos parámetros intentan controlar el mismo canal de pieza: ${occupiedKey}`);
    }
    occupiedChannels.add(occupiedKey);
    if (binding.from === binding.to) semanticError(`El binding ${key} no produce movimiento.`);
  }

  // Un parámetro declarado sin binding es una promesa que el recurso no cumple.
  for (const parameter of manifest.parameters) {
    if (!manifest.bindings.some((binding) => binding.parameterId === parameter.id)) {
      semanticError(`El parámetro ${parameter.id} no tiene ningún binding.`);
    }
  }

  if (manifest.kind === 'character') {
    const handStates = new Set(Object.keys(manifest.states.hands ?? {}));
    const poseIds = new Set();
    for (const pose of manifest.poses) {
      if (poseIds.has(pose.id)) semanticError(`Pose duplicada: ${pose.id}`);
      poseIds.add(pose.id);
      // Un gesto se expresa de una de dos maneras: intercambiando la capa de la
      // mano (recursos traducidos desde v2) o rotando piezas (recursos v3
      // articulados). Una pose que no hace ninguna de las dos no es una pose.
      if (pose.handState !== undefined && !handStates.has(pose.handState)) {
        semanticError(`La pose ${pose.id} usa el estado de manos inexistente ${pose.handState}.`);
      }
      if (pose.handState === undefined && pose.parts.length === 0) {
        semanticError(`La pose ${pose.id} no cambia nada: sin estado de manos y sin rotación de piezas.`);
      }
      const posed = new Set();
      for (const item of pose.parts) {
        if (!partIds.has(item.partId)) semanticError(`La pose ${pose.id} referencia la pieza inexistente ${item.partId}.`);
        if (posed.has(item.partId)) semanticError(`La pose ${pose.id} repite la pieza ${item.partId}.`);
        posed.add(item.partId);
      }
    }
    for (const required of ['neutral', 'point']) {
      if (!poseIds.has(required)) semanticError(`Falta la pose ${required}.`);
    }
    for (const [group, states] of Object.entries(manifest.states)) {
      for (const [state, file] of Object.entries(states)) assertPortablePath(file, `states/${group}/${state}`);
    }
  }

  return manifest;
}

/**
 * Vista v3 de cualquier manifest compilado. Un v3 se valida y se devuelve; un v2
 * se traduce sin pérdida: cada joint se vuelve una pieza (la raíz carga la capa
 * del cuerpo) y la lista de parámetros queda vacía porque un recurso v2 no puede
 * articular. El pipeline vigente sigue leyendo el v2 directamente.
 */
export function readResourceManifest(manifest) {
  if (manifest?.version === 3) return validateResourceManifestV3(manifest);
  if (manifest?.version !== 2) {
    throw new PipelineError({
      code: 'RESOURCE_MANIFEST_VERSION_UNSUPPORTED',
      stage: 'generating_assets',
      message: 'Solo se pueden leer manifests de recurso versión 2 o 3.',
      technicalDetail: `version=${manifest?.version}`,
      suggestedAction: 'Regenere el recurso con el compilador vigente.',
    });
  }

  const rootJointId = manifest.joints.find((joint) => joint.parentId === null)?.id ?? null;
  const view = {
    version: 3,
    id: manifest.id,
    kind: 'character',
    canvas: manifest.canvas,
    pivot: manifest.pivot,
    sourceDefinition: manifest.sourceDefinition,
    variant: manifest.variant,
    parts: manifest.joints.map((joint, index) => ({
      id: joint.id,
      parentId: joint.parentId,
      pivot: { x: joint.pivotX, y: joint.pivotY },
      zIndex: index,
      // Solo la raíz tiene píxeles: en v2 todo el cuerpo es una sola capa plana.
      ...(joint.id === rootJointId ? { layer: manifest.layers.body } : {}),
    })),
    states: {
      eyes: manifest.layers.eyes,
      mouth: manifest.layers.mouth,
      hands: manifest.layers.hands,
      thumbnails: manifest.layers.thumbnails,
    },
    poses: manifest.poses.map((pose) => ({
      id: pose.id,
      handState: pose.handState,
      parts: pose.joints.map((item) => ({ partId: item.jointId, rotationDegrees: item.rotationDegrees })),
    })),
    parameters: [],
    bindings: [],
    provenance: manifest.provenance,
  };
  return validateResourceManifestV3(view);
}

// El mapeo lineal del binding se movió a `shared/compositor-contract.js` cuando
// el compositor headless necesitó aplicarlo dentro del navegador. Se reexporta
// para no cambiar a los consumidores.
export { resolveBindingChannel } from '../../shared/compositor-contract.js';
