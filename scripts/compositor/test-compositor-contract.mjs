// Fase 3 — pruebas del contrato de compositor.
//
// Nivel 2 (lógica de módulo). No dibuja: prueba que la jerarquía de piezas, los
// bindings y el orden de dibujo se traduzcan a la lista plana de sprites que
// cualquier backend puede consumir sin reinterpretar nada.

import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  buildFrame,
  buildResourceSprites,
  partRotationDegrees,
  resolveBindingChannel,
} from '../../shared/compositor-contract.js';

const results = [];
const video = { width: 1080, height: 1920, fps: 30 };
// El recurso realmente compilado, no un fixture de laboratorio.
const manifest = readJson(path.join(projectRoot, 'public', 'assets', 'resources', 'mono-articulado-azul-v1', 'resource.manifest.json'));
const modern = readJson(path.join(projectRoot, 'public', 'assets', 'resources', 'el-peque-v1', 'resource.manifest.json'));
const prop = readJson(path.join(projectRoot, 'public', 'assets', 'resources', 'cartel-dato-v1', 'resource.manifest.json'));

function pass(name, detail = {}) {
  results.push({ name, ...detail });
}

// 1. Mapeo lineal del binding, acotado en los extremos.
const armRaise = manifest.parameters[0];
const binding = manifest.bindings[0];
assert.equal(resolveBindingChannel(armRaise, binding, 0), 0);
assert.equal(resolveBindingChannel(armRaise, binding, 1), -95);
assert.equal(resolveBindingChannel(armRaise, binding, 0.5), -47.5);
assert.equal(resolveBindingChannel(armRaise, binding, 3), -95, 'fuera de rango se sujeta, no extrapola');
pass('binding-lineal-y-acotado', { accepted: true });

// 2. El parámetro con binding REEMPLAZA la rotación de la pose, con la misma
//    regla que la Fase 0 fijó para las pistas.
assert.equal(partRotationDegrees(manifest, 'arm_right', {}, 'celebrate'), -72, 'sin parámetro manda la pose');
assert.equal(partRotationDegrees(manifest, 'arm_right', { armRaise: 1 }, 'celebrate'), -95, 'con parámetro manda el binding');
assert.equal(partRotationDegrees(manifest, 'torso', { armRaise: 1 }, 'celebrate'), 0, 'una pieza sin pose ni binding no rota');
pass('el-parametro-reemplaza-la-pose', { accepted: true });

// 3. Sprites de un personaje: orden de dibujo y capas de estado arriba.
const sprites = buildResourceSprites(manifest, { params: { armRaise: 0 }, poseId: 'neutral', states: { eyes: 'open', mouth: 'closed' } });
assert.deepEqual(sprites.map((sprite) => sprite.id), ['torso', 'arm_right', 'eyes:open', 'mouth:closed']);
assert.ok(sprites.every((sprite, index) => index === 0 || sprite.zIndex >= sprites[index - 1].zIndex), 'el orden de dibujo es creciente');
pass('orden-de-dibujo-y-capas-de-estado', { accepted: true, sprites: sprites.length });

// El estado de boca cambia la capa, no la geometría.
const talking = buildResourceSprites(manifest, { params: {}, poseId: 'neutral', states: { eyes: 'closed', mouth: 'open' } });
assert.equal(talking.find((sprite) => sprite.id.startsWith('eyes:')).src, manifest.states.eyes.closed);
assert.equal(talking.find((sprite) => sprite.id.startsWith('mouth:')).src, manifest.states.mouth.open);
pass('los-estados-cambian-de-capa', { accepted: true });

// 4. El brazo rota en su pivote y solo cuando corresponde.
const raised = buildResourceSprites(manifest, { params: { armRaise: 0.5 }, poseId: 'neutral' });
const arm = raised.find((sprite) => sprite.id === 'arm_right');
assert.deepEqual(arm.transforms, [{ kind: 'rotate', degrees: -47.5, x: 690, y: 1010 }]);
assert.deepEqual(raised.find((sprite) => sprite.id === 'torso').transforms, [], 'el torso no rota');
pass('el-brazo-rota-en-su-pivote', { accepted: true });

// Con armRaise en cero no hay transformación: no se emite una rotación de 0.
assert.deepEqual(buildResourceSprites(manifest, { params: { armRaise: 0 } }).find((sprite) => sprite.id === 'arm_right').transforms, []);
pass('rotacion-cero-no-emite-transformacion', { accepted: true });

// 5. Herencia: una pieza hija arrastra la rotación de su padre.
//    `shoulder_right` es un grupo sin capa; su rotación tiene que aparecer en la
//    cadena del brazo, que es su hijo.
const jointed = structuredClone(manifest);
jointed.parts.push({ id: 'shoulder_right', parentId: 'torso', pivot: { x: 690, y: 1010 }, zIndex: 5 });
jointed.parts = jointed.parts.map((part) => (part.id === 'arm_right' ? { ...part, parentId: 'shoulder_right' } : part));
jointed.poses = jointed.poses.map((pose) => (pose.id === 'neutral'
  ? { ...pose, parts: [{ partId: 'shoulder_right', rotationDegrees: 20 }] }
  : pose));
const inherited = buildResourceSprites(jointed, { params: { armRaise: 0.5 }, poseId: 'neutral' });
const inheritedArm = inherited.find((sprite) => sprite.id === 'arm_right');
assert.deepEqual(inheritedArm.transforms, [
  { kind: 'rotate', degrees: 20, x: 690, y: 1010 },
  { kind: 'rotate', degrees: -47.5, x: 690, y: 1010 },
], 'la cadena va de la raíz hacia la pieza');
// El grupo sin capa no produce sprite propio.
assert.ok(!inherited.some((sprite) => sprite.id === 'shoulder_right'));
pass('la-pieza-hija-hereda-la-rotacion-del-padre', { accepted: true });

// 6. Un prop no tiene capas de estado.
const propSprites = buildResourceSprites(prop, {});
assert.deepEqual(propSprites.map((sprite) => sprite.id), ['handle', 'board']);
assert.ok(!propSprites.some((sprite) => sprite.id.includes(':')));
pass('el-prop-no-tiene-capas-de-estado', { accepted: true, sprites: propSprites.length });

// 7. Frame completo: el transform de la instancia envuelve la jerarquía.
const frame = buildFrame(video, [
  {
    manifest,
    basePath: 'assets/resources/mono-articulado-azul-v1',
    transform: { x: 40, y: -10, scale: 0.9, opacity: 0.8, zIndex: 1 },
    params: { armRaise: 1 },
    poseId: 'neutral',
    states: { eyes: 'open', mouth: 'closed' },
  },
  {
    manifest: prop,
    basePath: 'assets/resources/cartel-dato-v1',
    transform: { x: -60, zIndex: 0 },
  },
]);
assert.equal(frame.width, 1080);
assert.equal(frame.height, 1920);

// El prop tiene zIndex de instancia menor, así que va entero por debajo.
const ids = frame.sprites.map((sprite) => sprite.id);
assert.deepEqual(ids.slice(0, 2), ['cartel-dato-v1:handle', 'cartel-dato-v1:board']);
assert.ok(ids.slice(2).every((id) => id.startsWith('mono-articulado-azul-v1:')));
pass('el-orden-de-instancia-manda-sobre-el-de-pieza', { accepted: true, sprites: frame.sprites.length });

// Las rutas quedan relativas a la raíz de assets, listas para el backend.
assert.equal(
  frame.sprites.find((sprite) => sprite.id.endsWith(':torso')).src,
  'assets/resources/mono-articulado-azul-v1/part_torso.png',
);
pass('las-rutas-son-relativas-a-la-raiz-de-assets', { accepted: true });

// La opacidad de la instancia multiplica a la de la pieza.
assert.equal(frame.sprites.find((sprite) => sprite.id.endsWith(':torso')).opacity, 0.8);
pass('la-opacidad-de-instancia-multiplica', { accepted: true });

// Traslación, escala y después las rotaciones de la jerarquía, en ese orden.
assert.deepEqual(frame.sprites.find((sprite) => sprite.id.endsWith(':arm_right')).transforms, [
  { kind: 'translate', x: 40, y: -10 },
  { kind: 'scale', factor: 0.9, x: 540, y: 960 },
  { kind: 'rotate', degrees: -95, x: 690, y: 1010 },
]);
pass('la-instancia-envuelve-a-la-jerarquia', { accepted: true });

// Un transform neutro no agrega transformaciones: el frame no lleva ruido.
const plain = buildFrame(video, [{ manifest: prop, basePath: 'p' }]);
assert.deepEqual(plain.sprites.map((sprite) => sprite.transforms), [[], []]);
pass('el-transform-neutro-no-agrega-nada', { accepted: true });

const articulated = buildResourceSprites(modern, {
  params: { leftArmRaise: 1, headTilt: 1, headNod: 1, bodyLean: 1, bodyBounce: 1 },
  poseId: 'neutral',
  states: { eyes: 'open', mouth: 'medium' },
});
assert.deepEqual(articulated.find((sprite) => sprite.id === 'torso').transforms, [
  { kind: 'translate', x: 0, y: -34 },
  { kind: 'rotate', degrees: 8, x: 540, y: 960 },
]);
assert.deepEqual(articulated.find((sprite) => sprite.id === 'arm_left').transforms, [
  { kind: 'translate', x: 0, y: -34 },
  { kind: 'rotate', degrees: 8, x: 540, y: 960 },
  { kind: 'rotate', degrees: 95, x: 420, y: 780 },
]);
const expectedFaceTransforms = [
  { kind: 'translate', x: 0, y: -34 },
  { kind: 'rotate', degrees: 8, x: 540, y: 960 },
  { kind: 'translate', x: 0, y: 24 },
  { kind: 'rotate', degrees: 12, x: 540, y: 700 },
];
assert.deepEqual(articulated.find((sprite) => sprite.id === 'head').transforms, expectedFaceTransforms);
assert.deepEqual(articulated.find((sprite) => sprite.id === 'eyes:open').transforms, expectedFaceTransforms);
assert.deepEqual(articulated.find((sprite) => sprite.id === 'mouth:medium').transforms, expectedFaceTransforms);
pass('bindings-multiples-y-estados-faciales-heredados', { accepted: true });

// 8. Determinismo: el mismo pedido produce el mismo frame.
assert.deepEqual(buildFrame(video, [{ manifest, basePath: 'b', params: { armRaise: 0.3 }, poseId: 'point' }]),
  buildFrame(video, [{ manifest, basePath: 'b', params: { armRaise: 0.3 }, poseId: 'point' }]));
pass('frame-determinista', { accepted: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'compositor-contract-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
