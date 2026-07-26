import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { editProjectWithDirector } from './project-editor-director.mjs';

const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const cacheRoot = mkdtempSync(path.join(tmpdir(), 'director-edit-'));
let calls = 0;
const fetchImpl = async (_url, options) => {
  calls += 1;
  const request = JSON.parse(options.body);
  assert.equal(request.think, false);
  assert.equal(request.stream, false);
  return new Response(JSON.stringify({
    message: {
      content: JSON.stringify({
        commands: [{
          type: 'set-dialogue-turn',
          sceneId: project.scenes[1].id,
          turnId: project.scenes[1].dialogue[0].id,
          text: 'Texto actualizado por el Director.',
        }],
      }),
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

try {
  const first = await editProjectWithDirector({
    instruction: 'Cambiá el primer texto de la escena 2.',
    project, catalog, cacheRoot, fetchImpl,
  });
  assert.equal(first.cacheHit, false);
  assert.equal(first.commands.length, 1);
  assert.equal(first.project.scenes[1].dialogue[0].text, 'Texto actualizado por el Director.');
  const second = await editProjectWithDirector({
    instruction: 'Cambiá el primer texto de la escena 2.',
    project, catalog, cacheRoot, fetchImpl,
  });
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
  await assert.rejects(() => editProjectWithDirector({ instruction: 'x', project, catalog, cacheRoot, fetchImpl }));

  // Helper: corre un lote de comandos fijos sin caché (aisla cada caso).
  const runEdit = (commands) => editProjectWithDirector({
    instruction: 'Instrucción de prueba estructural.',
    project, catalog, cacheRoot, useCache: false,
    fetchImpl: async () => new Response(
      JSON.stringify({ message: { content: JSON.stringify({ commands }) } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  });

  // B1: duplicar una escena crea una copia con sus personajes y normaliza transiciones.
  const duplicated = await runEdit([
    { type: 'duplicate-scene', sceneId: 'escena-cierre', newSceneId: 'escena-cierre-b', title: 'Cierre alternativo' },
  ]);
  assert.equal(duplicated.project.scenes.length, 3);
  assert.equal(duplicated.project.scenes[2].id, 'escena-cierre-b');
  assert.equal(duplicated.project.scenes[2].title, 'Cierre alternativo');
  assert.ok(duplicated.project.scenes[1].transitionToNext, 'la escena intermedia recupera transición de salida');
  assert.equal(Object.hasOwn(duplicated.project.scenes[2], 'transitionToNext'), false);

  // B1: agregar un turno de diálogo a una escena existente.
  const added = await runEdit([{
    type: 'add-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-03',
    speakerElementId: 'analista', text: 'Y este turno lo agregó el copiloto.', voiceId: 'voz-davefx-es-v1',
    gestureId: 'point', gapAfterSeconds: 0.2, afterTurnId: 'turno-presentacion-02',
  }]);
  assert.equal(added.project.scenes[0].dialogue.length, 3);
  assert.equal(added.project.scenes[0].dialogue[2].id, 'turno-presentacion-03');

  // B1: borrar un turno de diálogo.
  const removed = await runEdit([{ type: 'delete-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-01' }]);
  assert.equal(removed.project.scenes[0].dialogue.length, 1);
  assert.equal(removed.project.scenes[0].dialogue[0].id, 'turno-presentacion-02');

  // B1: reordenar escenas invierte el orden y mantiene las transiciones coherentes.
  const reordered = await runEdit([{ type: 'reorder-scenes', sceneIds: ['escena-cierre', 'escena-presentacion'] }]);
  assert.deepEqual(reordered.project.scenes.map((scene) => scene.id), ['escena-cierre', 'escena-presentacion']);
  assert.equal(Object.hasOwn(reordered.project.scenes[1], 'transitionToNext'), false);

  // B2: escala y profundidad en set-character-transform.
  const scaled = await runEdit([{ type: 'set-character-transform', sceneId: 'escena-presentacion', elementId: 'presentadora', scale: 0.9, zIndex: 25 }]);
  assert.equal(scaled.project.scenes[0].elements[0].transform.scale, 0.9);
  assert.equal(scaled.project.scenes[0].elements[0].transform.zIndex, 25);

  // B2: gesto y pausa en set-dialogue-turn.
  const gestured = await runEdit([{ type: 'set-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-01', gestureId: 'neutral', gapAfterSeconds: 1.5 }]);
  assert.equal(gestured.project.scenes[0].dialogue[0].gestureId, 'neutral');
  assert.equal(gestured.project.scenes[0].dialogue[0].gapAfterSeconds, 1.5);

  const phase2Turn = await runEdit([{
    type: 'set-dialogue-turn',
    sceneId: 'escena-presentacion',
    turnId: 'turno-presentacion-01',
    gestureId: 'celebrate',
    gestureAtWord: 2,
    pace: 'fast',
    layoutPreset: 'focus-a',
  }]);
  assert.equal(phase2Turn.project.scenes[0].dialogue[0].gestureId, 'celebrate');
  assert.equal(phase2Turn.project.scenes[0].dialogue[0].gestureAtWord, 2);
  assert.equal(phase2Turn.project.scenes[0].dialogue[0].pace, 'fast');
  assert.equal(phase2Turn.project.scenes[0].dialogue[0].layoutPreset, 'focus-a');

  // B1: una instrucción que referencia un turno inexistente devuelve error claro, sin proyecto roto.
  await assert.rejects(
    () => runEdit([{ type: 'delete-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-inexistente' }]),
    (error) => error.code === 'EDITOR_TURN_NOT_FOUND',
  );

  process.stdout.write(`${JSON.stringify({ version: 1, passed: 28, failed: 0 })}\n`);
} finally {
  rmSync(cacheRoot, { recursive: true, force: true });
}
