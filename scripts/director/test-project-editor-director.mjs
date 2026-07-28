import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot, readJson } from '../stage1/common.mjs';
import {
  editProjectWithDirector,
  explainDirectorEdit,
  summarizeEditableProject,
} from './project-editor-director.mjs';

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
  assert.equal(first.status, 'proposed');
  assert.equal(first.explanation.summary, 'El Director propone 1 cambio.');
  assert.deepEqual(first.explanation.changes, ['Editar un diálogo en la escena 2.']);
  assert.equal(first.project.scenes[1].dialogue[0].text, 'Texto actualizado por el Director.');
  assert.ok(first.context.shortlistedEntries <= first.context.totalCatalogEntries);
  assert.ok(first.context.resourceIds.includes('mono-azul-v1'));
  assert.ok(first.context.resourceIds.includes('voz-claude-mx-v1'));
  const second = await editProjectWithDirector({
    instruction: 'Cambiá el primer texto de la escena 2.',
    project, catalog, cacheRoot, fetchImpl,
  });
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
  await assert.rejects(() => editProjectWithDirector({ instruction: 'x', project, catalog, cacheRoot, fetchImpl }));

  let selectedPrompt = '';
  const selected = await editProjectWithDirector({
    instruction: 'Cambiá solamente el diálogo seleccionado.',
    project,
    catalog,
    cacheRoot,
    useCache: false,
    selection: { kind: 'dialogue', sceneId: 'escena-presentacion', turnId: 'turno-presentacion-01' },
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      selectedPrompt = request.messages[0].content;
      return new Response(JSON.stringify({
        message: { content: JSON.stringify({ commands: [] }) },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(selected.status, 'no-change');
  assert.ok(selectedPrompt.includes('turno-presentacion-01'));
  assert.equal(selected.baseProjectRevision, selected.projectRevision);

  let invalidCacheCalls = 0;
  const invalidThenValidFetch = async () => {
    invalidCacheCalls += 1;
    const commands = invalidCacheCalls === 1
      ? [{ type: 'delete-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-inexistente' }]
      : [{ type: 'set-project-title', title: 'Título validado antes de cachear' }];
    return new Response(
      JSON.stringify({ message: { content: JSON.stringify({ commands }) } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  await assert.rejects(() => editProjectWithDirector({
    instruction: 'Probá la validación previa a la caché.',
    project,
    catalog,
    cacheRoot,
    fetchImpl: invalidThenValidFetch,
  }));
  const recoveredCache = await editProjectWithDirector({
    instruction: 'Probá la validación previa a la caché.',
    project,
    catalog,
    cacheRoot,
    fetchImpl: invalidThenValidFetch,
  });
  assert.equal(invalidCacheCalls, 2);
  assert.equal(recoveredCache.project.title, 'Título validado antes de cachear');

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

  // Fase 6: el contexto enumera capacidades por elemento, pero una pista se
  // resume por parámetro/procedencia y nunca envía sus keyframes.
  const animatedProject = structuredClone(project);
  const animatedElement = animatedProject.scenes[0].elements[0];
  animatedElement.resourceId = 'mono-articulado-azul-v1';
  animatedElement.tracks = [
    {
      parameterId: 'opacity',
      source: { kind: 'preset', presetId: 'fade-in', version: 1, customized: false },
      keyframes: [
        { id: 'kf-private-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0, interpolation: 'linear' },
        { id: 'kf-private-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0.4, value: 1, interpolation: 'hold' },
      ],
    },
    {
      parameterId: 'scale',
      source: { kind: 'preset', presetId: 'emphasis-pulse', version: 1, customized: true },
      keyframes: [
        { id: 'kf-custom-1', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0, value: 0.82, interpolation: 'ease' },
        { id: 'kf-custom-2', anchor: { kind: 'scene', edge: 'start' }, offsetSeconds: 0.4, value: 0.9, interpolation: 'hold' },
      ],
    },
  ];
  const compact = summarizeEditableProject(animatedProject, catalog);
  const compactAnimation = compact.scenes[0].elements[0].animation;
  assert.ok(compactAnimation.supportedParameterIds.includes('armRaise'));
  assert.ok(compactAnimation.supportedPresetIds.includes('emphasis-pulse'));
  assert.ok(compactAnimation.applicablePresetIds.includes('arm-raise'));
  assert.equal(compactAnimation.applicablePresetIds.includes('emphasis-pulse'), false);
  assert.deepEqual(compactAnimation.activeTracks, [
    { parameterId: 'opacity', source: 'preset', presetId: 'fade-in', customized: false, removableByDirector: true },
    { parameterId: 'scale', source: 'preset', presetId: 'emphasis-pulse', customized: true, removableByDirector: false },
  ]);
  assert.equal(JSON.stringify(compact).includes('kf-private-1'), false);
  assert.equal(JSON.stringify(compact).includes('keyframes'), false);

  let animationPrompt = '';
  let animationSchema = null;
  const animationProposal = await editProjectWithDirector({
    instruction: 'Hacé que la presentadora levante el brazo y quitá su aparición.',
    project: animatedProject,
    catalog,
    cacheRoot,
    useCache: false,
    selection: { kind: 'element', sceneId: 'escena-presentacion', elementId: animatedElement.id },
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      animationPrompt = request.messages[0].content;
      animationSchema = request.format;
      return new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            commands: [
              {
                type: 'apply-animation-preset',
                sceneId: 'escena-presentacion',
                elementId: animatedElement.id,
                presetId: 'arm-raise',
                anchor: { kind: 'turn', turnId: 'turno-presentacion-01', edge: 'start' },
                intensity: 'medium',
              },
              {
                type: 'remove-animation',
                sceneId: 'escena-presentacion',
                elementId: animatedElement.id,
                parameterId: 'opacity',
              },
            ],
          }),
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(animationPrompt.includes('kf-private-1'), false);
  assert.ok(animationPrompt.includes('"removableByDirector":true'));
  assert.ok(animationPrompt.includes('"removableByDirector":false'));
  assert.ok(JSON.stringify(animationSchema).includes('apply-animation-preset'));
  assert.ok(JSON.stringify(animationSchema).includes('remove-animation'));
  const selectedApplySchema = animationSchema.properties.commands.items.oneOf.find((candidate) =>
    candidate.properties?.type?.const === 'apply-animation-preset'
      && candidate.properties?.elementId?.const === animatedElement.id);
  assert.ok(selectedApplySchema.properties.presetId.enum.includes('arm-raise'));
  assert.equal(selectedApplySchema.properties.presetId.enum.includes('emphasis-pulse'), false,
    'un preset no puede reemplazar mediante IA una pista personalizada');
  assert.equal(
    animationProposal.project.scenes[0].elements[0].tracks.some((track) => track.parameterId === 'armRaise'),
    true,
  );
  assert.equal(
    animationProposal.project.scenes[0].elements[0].tracks.some((track) => track.parameterId === 'opacity'),
    false,
  );
  assert.deepEqual(animationProposal.explanation.changes, [
    `Aplicar «Levantar el brazo» al elemento ${animatedElement.id} en la escena 1.`,
    `Quitar la animación de opacidad del elemento ${animatedElement.id} en la escena 1.`,
  ]);

  // La explicación es derivada del lote validado, no texto libre del modelo.
  assert.deepEqual(explainDirectorEdit([], project), {
    summary: 'El Director no encontró cambios representables.',
    changes: [],
    customizedTrackRemovalIndexes: [],
  });

  const customizedRemoval = await editProjectWithDirector({
    instruction: 'Quitá el énfasis personalizado de la presentadora.',
    project: animatedProject,
    catalog,
    cacheRoot,
    useCache: false,
    fetchImpl: async () => new Response(JSON.stringify({
      message: {
        content: JSON.stringify({
          commands: [{
            type: 'remove-animation',
            sceneId: 'escena-presentacion',
            elementId: animatedElement.id,
            parameterId: 'scale',
          }],
        }),
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.deepEqual(customizedRemoval.explanation.customizedTrackRemovalIndexes, [0]);
  assert.equal(Object.hasOwn(customizedRemoval.commands[0], 'confirmCustomized'), false);
  assert.equal(
    customizedRemoval.project.scenes[0].elements[0].tracks.some((track) => track.parameterId === 'scale'),
    false,
  );

  await assert.rejects(() => editProjectWithDirector({
    instruction: 'Intentá confirmar sin permiso humano.',
    project: animatedProject,
    catalog,
    cacheRoot,
    useCache: false,
    fetchImpl: async () => new Response(JSON.stringify({
      message: {
        content: JSON.stringify({
          commands: [{
            type: 'remove-animation',
            sceneId: 'escena-presentacion',
            elementId: animatedElement.id,
            parameterId: 'scale',
            confirmCustomized: true,
          }],
        }),
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  }), (error) => error.code === 'DIRECTOR_EDIT_COMMANDS_INVALID');

  // B1: una instrucción que referencia un turno inexistente devuelve error claro, sin proyecto roto.
  await assert.rejects(
    () => runEdit([{ type: 'delete-dialogue-turn', sceneId: 'escena-presentacion', turnId: 'turno-inexistente' }]),
    (error) => error.code === 'EDITOR_TURN_NOT_FOUND',
  );

  process.stdout.write(`${JSON.stringify({ version: 1, passed: 63, failed: 0 })}\n`);
} finally {
  rmSync(cacheRoot, { recursive: true, force: true });
}
