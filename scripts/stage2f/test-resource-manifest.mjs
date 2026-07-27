// Fase 1 — pruebas del manifest de recurso v3 y del adaptador de lectura v2 → v3.
//
// Nivel 2 (lógica de módulo): no rasteriza ni toca el pipeline. Los casos
// inválidos se construyen mutando el fixture válido, igual que en
// `scripts/stage3a/test-video-project.mjs`.

import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  readResourceManifest,
  resolveBindingChannel,
  validateResourceManifestV3,
} from './resource-manifest.mjs';

const fixturesRoot = path.join(projectRoot, 'pilots', 'recursos-v3', 'fixtures', 'valid');
const character = readJson(path.join(fixturesRoot, 'personaje-articulado.json'));
const prop = readJson(path.join(fixturesRoot, 'prop-cartel.json'));
const results = [];

function pass(name, detail = {}) {
  results.push({ name, ...detail });
}

function invalidCase(name, expectedCode, change, base = character) {
  const manifest = structuredClone(base);
  change(manifest);
  assert.throws(() => validateResourceManifestV3(manifest), (error) => {
    assert.equal(error.code, expectedCode, `${name} esperaba ${expectedCode} y devolvió ${error.code}`);
    return true;
  });
  pass(name, { accepted: false, expectedCode });
}

// 1. Fixtures válidos.
validateResourceManifestV3(character);
pass('personaje-articulado-valido', { accepted: true, parts: character.parts.length });

validateResourceManifestV3(prop);
pass('prop-sin-poses-valido', { accepted: true, parts: prop.parts.length });

// Una pieza puede ser solo un grupo con pivote y sin píxeles.
assert.equal(character.parts.find((part) => part.id === 'shoulder_right').layer, undefined);
pass('pieza-grupo-sin-capa', { accepted: true });

// 2. Jerarquía de piezas.
invalidCase('dos-piezas-raiz', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.parts[1].parentId = null;
});

invalidCase('pieza-padre-inexistente', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.parts[1].parentId = 'pieza-que-no-existe';
});

invalidCase('ciclo-de-piezas', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.parts[0].parentId = 'arm_right';
});

invalidCase('pieza-duplicada', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.parts[1].id = 'torso';
});

invalidCase('zindex-repetido', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.parts[1].zIndex = manifest.parts[0].zIndex;
});

// 3. Parámetros y bindings.
invalidCase('parametro-que-no-requiere-recurso', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  // `scale` sale del transform del elemento: el recurso no lo declara.
  manifest.parameters[0].id = 'scale';
  manifest.bindings[0].parameterId = 'scale';
});

invalidCase('parametro-fuera-del-rango-congelado', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.parameters[0].maximum = 2;
});

invalidCase('parametro-sin-binding', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.bindings = [];
});

invalidCase('binding-a-pieza-inexistente', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.bindings[0].partId = 'brazo-inexistente';
});

invalidCase('binding-sin-movimiento', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.bindings[0].to = manifest.bindings[0].from;
});

invalidCase('default-fuera-de-rango', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.parameters[0].default = 1.5;
});

// 4. Poses y estados.
invalidCase('pose-con-estado-de-manos-inexistente', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.poses[1].handState = 'saludo';
});

invalidCase('pose-con-pieza-inexistente', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.poses[0].parts[0].partId = 'pieza-fantasma';
});

invalidCase('falta-la-pose-neutral', 'RESOURCE_MANIFEST_SEMANTIC_INVALID', (manifest) => {
  manifest.poses[0].id = 'saludo';
});

// 5. El tipo condiciona la forma: un prop no lleva poses ni estados.
invalidCase('prop-con-poses', 'RESOURCE_MANIFEST_SCHEMA_INVALID', (manifest) => {
  manifest.poses = structuredClone(character.poses);
}, prop);

invalidCase('personaje-sin-estados', 'RESOURCE_MANIFEST_SCHEMA_INVALID', (manifest) => {
  delete manifest.states;
});

invalidCase('ruta-de-capa-absoluta', 'ASSET_PATH_INVALID', (manifest) => {
  manifest.parts[0].layer = 'C:/recursos/torso.png';
});

// 6. Adaptador de lectura v2 → v3 sobre un recurso realmente publicado.
const v2Path = path.join(projectRoot, 'public', 'assets', 'characters', 'mono-parametrico-azul-v1', 'character.manifest.json');
const v2 = readJson(v2Path);
assert.equal(v2.version, 2);
const view = readResourceManifest(v2);

assert.equal(view.version, 3);
assert.equal(view.kind, 'character');
assert.equal(view.id, v2.id);
assert.equal(view.parts.length, v2.joints.length, 'cada joint v2 se convierte en una pieza');
pass('adaptador-convierte-joints-en-piezas', { accepted: true, parts: view.parts.length });

// La raíz es la única con píxeles: en v2 todo el cuerpo es una capa plana.
const withLayer = view.parts.filter((part) => part.layer !== undefined);
assert.equal(withLayer.length, 1);
assert.equal(withLayer[0].parentId, null);
assert.equal(withLayer[0].layer, v2.layers.body);
pass('adaptador-pone-el-cuerpo-en-la-raiz', { accepted: true });

// Un recurso v2 no articula, y el adaptador no finge que sí.
assert.deepEqual(view.parameters, []);
assert.deepEqual(view.bindings, []);
pass('recurso-v2-no-declara-parametros', { accepted: true });

// La traducción no pierde información: pivotes, poses y estados sobreviven.
for (const joint of v2.joints) {
  const part = view.parts.find((candidate) => candidate.id === joint.id);
  assert.deepEqual(part.pivot, { x: joint.pivotX, y: joint.pivotY });
  assert.equal(part.parentId, joint.parentId);
}
assert.deepEqual(view.poses.map((pose) => pose.id), v2.poses.map((pose) => pose.id));
assert.deepEqual(
  view.poses[1].parts,
  v2.poses[1].joints.map((item) => ({ partId: item.jointId, rotationDegrees: item.rotationDegrees })),
);
assert.deepEqual(Object.keys(view.states.mouth), Object.keys(v2.layers.mouth));
assert.deepEqual(view.states.eyes, v2.layers.eyes);
pass('adaptador-no-pierde-informacion', { accepted: true });

// Un v3 pasa por el adaptador sin cambiar.
assert.equal(readResourceManifest(character), character);
pass('adaptador-devuelve-el-v3-tal-cual', { accepted: true });

assert.throws(() => readResourceManifest({ version: 1 }), (error) => error.code === 'RESOURCE_MANIFEST_VERSION_UNSUPPORTED');
pass('version-no-soportada-rechazada', { accepted: false, expectedCode: 'RESOURCE_MANIFEST_VERSION_UNSUPPORTED' });

// 7. Especificación del binding: mapeo lineal, determinista y acotado.
const armRaise = character.parameters[0];
const binding = character.bindings[0];
assert.equal(resolveBindingChannel(armRaise, binding, 0), 0);
assert.equal(resolveBindingChannel(armRaise, binding, 1), -95);
assert.equal(resolveBindingChannel(armRaise, binding, 0.5), -47.5);
// Fuera de rango se sujeta a los extremos; no extrapola.
assert.equal(resolveBindingChannel(armRaise, binding, 2), -95);
assert.equal(resolveBindingChannel(armRaise, binding, -1), 0);
pass('binding-lineal-y-acotado', { accepted: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'resource-manifest-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
