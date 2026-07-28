// Fase 1 — pruebas del compilador de recursos v3 y de los dos pilotos.
//
// Nivel 3: rasteriza de verdad con Chrome headless, porque lo que hay que probar
// es justamente que la composición por piezas produce la misma imagen que el
// recurso v2 cuando el brazo está sin rotar.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ffprobe, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { compileParametricResource, loadResourceDefinition } from './parametric-resource.mjs';
import { readResourceManifest } from './resource-manifest.mjs';

const definitionsRelative = path.join('assets', 'resource-definitions');
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'parametric-resource');
const results = [];
let passed = false;

process.on('exit', () => {
  if (passed) rmSync(testRoot, { recursive: true, force: true });
});

function pass(name, detail = {}) {
  results.push({ name, ...detail });
}

function hashOf(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function assetsRootWith(name, definitions) {
  const root = path.join(testRoot, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(path.join(root, definitionsRelative), { recursive: true });
  for (const definition of definitions) {
    copyFileSync(
      path.join(projectRoot, 'public', definitionsRelative, `${definition}.json`),
      path.join(root, definitionsRelative, `${definition}.json`),
    );
  }
  return root;
}

function compile(root, definition, options = {}) {
  return compileParametricResource({
    assetsRoot: root,
    definitionPath: path.join(root, definitionsRelative, `${definition}.json`),
    outputBase: 'assets/resources',
    catalogRelative: 'assets/catalog/index.json',
    ...options,
  });
}

// 1. Las dos definiciones piloto son válidas.
const monkeyDefinition = loadResourceDefinition(path.join(projectRoot, 'public', definitionsRelative, 'mono-articulado-v1.json'));
const modernDefinition = loadResourceDefinition(path.join(projectRoot, 'public', definitionsRelative, 'el-peque-v1.json'));
const propDefinition = loadResourceDefinition(path.join(projectRoot, 'public', definitionsRelative, 'cartel-dato-v1.json'));
assert.equal(monkeyDefinition.kind, 'character');
assert.equal(propDefinition.kind, 'prop');
assert.equal(monkeyDefinition.parts.length, 2);
assert.deepEqual(monkeyDefinition.parameters.map((parameter) => parameter.id), ['armRaise']);
assert.equal(modernDefinition.stateParentPartId, 'head');
assert.deepEqual(modernDefinition.parameters.map((parameter) => parameter.id), [
  'armRaise', 'leftArmRaise', 'headTilt', 'headNod', 'bodyLean', 'bodyBounce',
]);
pass('definiciones-piloto-validas', { accepted: true });

// 2. El personaje articulado compila y su manifest es v3 válido.
const monkeyRoot = assetsRootWith('mono', ['mono-articulado-v1']);
const monkey = compile(monkeyRoot, 'mono-articulado-v1');
const [monkeyArtifact] = monkey.artifacts;
const monkeyManifest = readJson(monkeyArtifact.manifestPath);
assert.equal(monkeyManifest.version, 3);
assert.equal(monkeyManifest.kind, 'character');
readResourceManifest(monkeyManifest);
pass('personaje-articulado-compila', { accepted: true, files: Object.keys(monkeyArtifact.hashes).length });

// Cada pieza tiene su propia capa rasterizada: eso es lo que v2 no podía dar.
assert.deepEqual(monkeyManifest.parts.map((part) => part.layer), ['part_torso.png', 'part_arm_right.png']);
for (const part of monkeyManifest.parts) {
  const stream = ffprobe(path.join(monkeyArtifact.root, part.layer)).streams[0];
  assert.equal(stream.width, 1080);
  assert.equal(stream.height, 1920);
  assert.equal(stream.pix_fmt, 'rgba');
}
pass('cada-pieza-tiene-su-capa', { accepted: true, parts: monkeyManifest.parts.length });

// El pivote del brazo está en el hombro, no en el centro de la pieza.
const arm = monkeyManifest.parts.find((part) => part.id === 'arm_right');
assert.deepEqual(arm.pivot, { x: 690, y: 1010 });
assert.equal(arm.parentId, 'torso');
pass('pivote-del-brazo-en-el-hombro', { accepted: true });

// El binding declara el recorrido continuo del parámetro.
assert.deepEqual(monkeyManifest.bindings, [
  { parameterId: 'armRaise', partId: 'arm_right', channel: 'rotationDegrees', from: 0, to: -95 },
]);
pass('binding-de-armraise-declarado', { accepted: true });

const modernRoot = assetsRootWith('modern', ['el-peque-v1']);
const modern = compile(modernRoot, 'el-peque-v1');
const [modernArtifact] = modern.artifacts;
const modernManifest = readJson(modernArtifact.manifestPath);
readResourceManifest(modernManifest);
assert.equal(modernManifest.stateParentPartId, 'head');
assert.deepEqual(modernManifest.parameters.map((parameter) => parameter.id), [
  'armRaise', 'leftArmRaise', 'headTilt', 'headNod', 'bodyLean', 'bodyBounce',
]);
assert.equal(modernManifest.bindings.length, 6);
pass('personaje-moderno-compila-con-vocabulario-ampliado', {
  accepted: true,
  parameters: modernManifest.parameters.length,
});

// 3. La prueba que importa: con el brazo sin rotar, la composición por piezas
//    produce exactamente la misma imagen que el recurso v2 publicado.
const committedNeutral = path.join(projectRoot, 'public', 'assets', 'characters', 'mono-parametrico-azul-v1', 'pose_neutral.png');
assert.equal(
  hashOf(path.join(monkeyArtifact.root, 'pose_neutral.png')),
  hashOf(committedNeutral),
  'la pose neutral articulada debe coincidir byte a byte con la del recurso v2',
);
pass('pose-neutral-identica-al-recurso-v2', { accepted: true });

// Y con el brazo rotado, cambia. Si no cambiara, la rotación no se estaría aplicando.
assert.notEqual(
  hashOf(path.join(monkeyArtifact.root, 'pose_celebrate.png')),
  hashOf(path.join(monkeyArtifact.root, 'pose_neutral.png')),
);
pass('la-rotacion-de-pose-cambia-la-imagen', { accepted: true });

// 4. El prop compila sin poses ni estados, y con vista compuesta.
const propRoot = assetsRootWith('prop', ['cartel-dato-v1']);
const prop = compile(propRoot, 'cartel-dato-v1');
const [propArtifact] = prop.artifacts;
const propManifest = readJson(propArtifact.manifestPath);
assert.equal(propManifest.kind, 'prop');
assert.equal(propManifest.states, undefined);
assert.equal(propManifest.poses, undefined);
assert.deepEqual(propManifest.parameters, []);
assert.ok(existsSync(path.join(propArtifact.root, 'preview.png')), 'el prop necesita una vista compuesta para la biblioteca');
readResourceManifest(propManifest);
pass('prop-compila-sin-poses', { accepted: true, files: Object.keys(propArtifact.hashes).length });

const propEntry = prop.catalog.entries.find((entry) => entry.id === 'cartel-dato-v1');
assert.equal(propEntry.type, 'prop');
assert.equal(propEntry.thumbnail, 'assets/resources/cartel-dato-v1/preview.png');
pass('prop-entra-al-catalogo-como-prop', { accepted: true });

// 5. Determinismo: dos compilaciones del mismo prop dan los mismos hashes.
const propRootB = assetsRootWith('prop-b', ['cartel-dato-v1']);
const propB = compile(propRootB, 'cartel-dato-v1');
assert.deepEqual(propArtifact.hashes, propB.artifacts[0].hashes);
pass('compilacion-determinista', { accepted: true });

// 6. El catálogo se fusiona: un recurso ajeno sobrevive a la compilación.
//    El compilador v2 lo sobrescribe, y por eso regenerarlo borra recursos ajenos.
const mergeRoot = assetsRootWith('merge', ['cartel-dato-v1']);
const foreignCatalog = {
  version: 1,
  generatedFrom: 'assets/character-definitions/mono-parametrico-v1.json',
  entries: [{
    id: 'recurso-ajeno-v1',
    type: 'character',
    label: 'Recurso de otro compilador',
    manifest: 'assets/characters/recurso-ajeno-v1/character.manifest.json',
    thumbnail: 'assets/characters/recurso-ajeno-v1/pose_neutral.png',
    tags: ['ajeno'],
    capabilities: { poses: ['neutral', 'point'], mouthStates: ['closed'], joints: ['root'] },
    provenance: { source: 'Otro compilador.', license: 'Interna.' },
  }],
};
writeJson(path.join(mergeRoot, 'assets', 'catalog', 'index.json'), foreignCatalog);
const merged = compile(mergeRoot, 'cartel-dato-v1');
assert.deepEqual(merged.catalog.entries.map((entry) => entry.id).sort(), ['cartel-dato-v1', 'recurso-ajeno-v1']);
pass('el-catalogo-se-fusiona', { accepted: true });

// Recompilar dos veces no duplica la entrada propia.
const twice = compile(mergeRoot, 'cartel-dato-v1');
assert.equal(twice.catalog.entries.filter((entry) => entry.id === 'cartel-dato-v1').length, 1);
pass('recompilar-no-duplica-entradas', { accepted: true });

// 7. Definiciones inválidas.
function invalidDefinition(name, expectedCode, change, source = 'cartel-dato-v1') {
  const root = path.join(testRoot, `invalid-${name}`);
  const file = path.join(root, definitionsRelative, `${source}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  const definition = readJson(path.join(projectRoot, 'public', definitionsRelative, `${source}.json`));
  change(definition);
  writeJson(file, definition);
  assert.throws(() => loadResourceDefinition(file), (error) => {
    assert.equal(error.code, expectedCode, `${name} esperaba ${expectedCode} y devolvió ${error.code}`);
    return true;
  });
  pass(`invalida-${name}`, { accepted: false, expectedCode });
}

invalidDefinition('color-sin-paleta', 'RESOURCE_DEFINITION_SEMANTIC_INVALID', (definition) => {
  delete definition.variants[0].palette.board;
});

invalidDefinition('outputid-repetido', 'RESOURCE_DEFINITION_SEMANTIC_INVALID', (definition) => {
  definition.variants.push({ ...definition.variants[0], id: 'otra' });
});

invalidDefinition('prop-con-poses', 'RESOURCE_DEFINITION_SCHEMA_INVALID', (definition) => {
  definition.poses = [
    { id: 'neutral', parts: [{ partId: 'board', rotationDegrees: 0 }] },
    { id: 'point', parts: [{ partId: 'board', rotationDegrees: 10 }] },
  ];
});

invalidDefinition('pieza-sin-primitivas', 'RESOURCE_DEFINITION_SCHEMA_INVALID', (definition) => {
  definition.parts[0].shapes = [];
});

invalidDefinition('primitiva-con-svg-inyectado', 'RESOURCE_DEFINITION_SCHEMA_INVALID', (definition) => {
  definition.parts[1].shapes[0].fill = '#fff"><script>alert(1)</script>';
});

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'parametric-resource-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
passed = true;
