import assert from 'node:assert/strict';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { applyProjectEditorCommand, applyProjectEditorCommandBatch, createProjectEditor, undoProjectEditor, validateEditableProject } from '../../shared/project-editor.js';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { loadCreativeRecipeCatalog } from './creative-contract.mjs';
import { canonicalizeDirectorPlanV2, normalizeDirectorPlanV2, validateDirectorPlanV2 } from './director-plan-v2.mjs';
import { buildOllamaPlanSchema, createDirectorProposal, inferDirectorConstraints } from './ollama-director.mjs';
import { expandEffectSequenceCommands } from './recipe-expander.mjs';
import { analyzeCreativeRichness, resolveRichnessPolicy } from './richness-policy.mjs';
import { buildTimelineDirectorSchema, editTimelineWithDirector } from './timeline-director.mjs';

const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const recipes = loadCreativeRecipeCatalog();
const results = [];

async function test(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, detail: error instanceof Error ? error.stack || error.message : String(error) });
  }
}

function basePlan() {
  return {
    version: 2,
    title: 'Tres formas de contar una idea',
    tone: 'educational',
    targetDurationSeconds: 45,
    richnessProfile: 'dynamic',
    musicResourceId: 'musica-brillante-v1',
    scenes: [
      {
        title: 'El dato', purpose: 'Abrir con una narración visual.', mode: 'voiceover', durationWeight: 0.7, sceneRecipeId: 'voiceover-feature-v1', effectSequenceIds: ['visual-reveal-v1'],
        backgroundResourceId: 'fondo-estudio-parallax-v1', cameraPreset: 'slow-zoom', layoutPreset: 'wide', transitionPreset: 'fade', transitionDurationSeconds: 0.3,
        participants: [], visualElements: [{ roleId: 'dato', type: 'prop', resourceId: 'cartel-dato-v1' }],
        speech: [{ kind: 'voiceover', voiceId: 'voz-ald-mx-v1', text: 'Primero vemos el dato que cambia la pregunta y abre una forma concreta de entender el problema antes de buscar respuestas apresuradas.', gapAfterSeconds: 0 }],
      },
      {
        title: 'La explicación', purpose: 'Explicar con una persona.', mode: 'solo', durationWeight: 1.3, sceneRecipeId: 'solo-explainer-v1', effectSequenceIds: ['entrance-emphasis-exit-v1'],
        backgroundResourceId: 'fondo-estudio-parallax-v1', cameraPreset: 'static', layoutPreset: 'focus-a', transitionPreset: 'cut', transitionDurationSeconds: 0,
        participants: [{ roleId: 'guia', characterResourceId: 'mono-azul-v1', voiceId: 'voz-claude-mx-v1', animationPresetId: 'talk-calm' }], visualElements: [],
        speech: [{ kind: 'character', speakerRoleId: 'guia', text: 'Una sola voz puede desarrollar la idea con claridad, presentar un ejemplo útil y llegar a una conclusión sin forzar un diálogo innecesario.', gestureId: 'point', gestureAtWord: 2, gapAfterSeconds: 0 }],
      },
      {
        title: 'El contraste', purpose: 'Cerrar comparando dos miradas.', mode: 'dialogue', durationWeight: 1, sceneRecipeId: 'dialogue-contrast-v1', effectSequenceIds: ['speaker-focus-reaction-v1'],
        backgroundResourceId: 'fondo-estudio-parallax-v1', cameraPreset: 'slow-pan', layoutPreset: 'balanced', transitionPreset: 'cut', transitionDurationSeconds: 0,
        participants: [
          { roleId: 'rol-a', characterResourceId: 'mono-ciruela-v1', voiceId: 'voz-sharvard-es-v1', animationPresetId: 'talk-calm' },
          { roleId: 'rol-b', characterResourceId: 'el-peque-v1', voiceId: 'voz-davefx-es-v1', animationPresetId: 'talk-calm' },
        ], visualElements: [],
        speech: [
          { kind: 'character', speakerRoleId: 'rol-a', text: 'La variedad mejora el ritmo y ayuda a sostener la atención.', gestureId: 'celebrate', gapAfterSeconds: 0.15 },
          { kind: 'character', speakerRoleId: 'rol-b', text: 'Siempre que cada recurso tenga una función clara, haga avanzar el mensaje y cierre con una consecuencia que el público pueda recordar.', gestureId: 'neutral', gapAfterSeconds: 0 },
        ],
      },
    ],
  };
}

await test('plan-v2-normaliza-cero-uno-dos-personajes-y-musica', () => {
  const plan = basePlan();
  const budget = validateDirectorPlanV2(plan, catalog, recipes);
  assert.equal(budget.globalCharacterCount, 3);
  assert.notEqual(budget.sceneBudgets[0].targetSeconds, budget.sceneBudgets[1].targetSeconds);
  const { project } = normalizeDirectorPlanV2(plan, catalog, { recipes, projectId: 'gate-flexible-v2' });
  assert.deepEqual(project.scenes.map((scene) => scene.elements.filter((element) => element.type === 'character').length), [0, 1, 2]);
  assert.equal(project.scenes[0].dialogue[0].speakerType, 'voiceover');
  assert.equal(project.musicResourceId, 'musica-brillante-v1');
  assert.ok(project.scenes[0].elements[0].tracks?.some((track) => track.source.presetId === 'fade-in'));
  assert.ok(project.scenes[1].elements[0].tracks?.some((track) => track.source.presetId === 'enter-left'));
  assert.ok(project.scenes[2].elements[0].tracks?.some((track) => track.source.presetId === 'emphasis-pulse'));
  assert.ok(project.scenes[2].elements[1].tracks?.some((track) => track.source.presetId === 'head-nod'));
  assert.equal(validateEditableProject(project, catalog), true);
});

await test('schema-ollama-v2-ofrece-ocho-escenas-y-recetas-cerradas', () => {
  const schema = buildOllamaPlanSchema(catalog, { planVersion: 2, sceneCount: 8, richnessProfile: 'varied', structure: 'automatic' });
  assert.equal(schema.properties.version.const, 2);
  assert.equal(schema.properties.scenes.minItems, 8);
  assert.equal(schema.properties.scenes.maxItems, 8);
  assert.ok(JSON.stringify(schema).includes('voiceover-feature-v1'));
  assert.ok(JSON.stringify(schema).includes('participants'));
  const threeSceneSchema = buildOllamaPlanSchema(catalog, { planVersion: 2, sceneCount: 3, richnessProfile: 'dynamic', structure: 'automatic' });
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(threeSceneSchema);
  const validPlan = basePlan();
  validPlan.narrativeTemplateId = 'explain-stepwise-v1';
  assert.equal(validate(validPlan), true, JSON.stringify(validate.errors));
});

await test('prompt-simple-infiere-parametros-editoriales-explicitos', () => {
  const inferred = inferDirectorConstraints(
    'Creá un video dinámico e inspirador de cinco escenas y 60 segundos, con diálogo entre dos personajes.',
    { planVersion: 2, tone: 'educational', targetDurationSeconds: 30, sceneCount: 2, richnessProfile: 'automatic', structure: 'automatic' },
  );
  assert.deepEqual(inferred, {
    planVersion: 2, tone: 'inspirational', targetDurationSeconds: 60, sceneCount: 5,
    richnessProfile: 'dynamic', structure: 'dialogue',
  });
});

await test('planes-extensos-se-generan-en-segmentos-acotados', async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    const request = JSON.parse(options.body);
    assert.equal(request.format.properties.scenes.maxItems, 1);
    assert.equal(request.think, false);
    const chunk = basePlan();
    chunk.richnessProfile = 'simple';
    chunk.narrativeTemplateId = 'explain-stepwise-v1';
    const source = chunk.scenes[(calls - 1) % 3];
    chunk.scenes = [{ ...structuredClone(source), ...(calls === 4 ? { title: 'Cierre visual', purpose: 'Cerrar con una consecuencia aplicable.' } : {}) }];
    return new Response(JSON.stringify({ message: { content: JSON.stringify(chunk) } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await createDirectorProposal({
    prompt: 'Explicá una idea útil en cuatro escenas.', catalog, fetchImpl, useCache: false,
    constraints: { planVersion: 2, tone: 'educational', targetDurationSeconds: 45, sceneCount: 4, richnessProfile: 'simple', structure: 'automatic' },
  });
  assert.equal(calls, 4);
  assert.equal(result.plan.scenes.length, 4);
  assert.equal(result.project.scenes.length, 4);
  assert.equal(result.context.resolvedConstraints.sceneCount, 4);
  assert.equal(result.usage.generationCount, 1);
});

await test('orquestador-ollama-crea-y-rehidrata-un-plan-v2', async () => {
  const plan = basePlan();
  plan.narrativeTemplateId = 'explain-stepwise-v1';
  const fetchImpl = async () => new Response(JSON.stringify({
    message: { content: JSON.stringify(plan) },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const options = {
    prompt: 'Explicá una idea de tres maneras.', catalog, fetchImpl,
    cacheRoot: path.join(projectRoot, '.local-video', 'tests', 'director-flexible-v2-cache'),
    constraints: { planVersion: 2, sceneCount: 3, targetDurationSeconds: 45, richnessProfile: 'dynamic', structure: 'automatic' },
  };
  const generated = await createDirectorProposal({ ...options, useCache: false });
  assert.equal(generated.plan.version, 2);
  assert.deepEqual(generated.project.scenes.map((scene) => scene.elements.filter((element) => element.type === 'character').length), [0, 1, 2]);
  const cached = await createDirectorProposal(options);
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.plan.version, 2);
});

await test('plan-v2-rechaza-reparto-receta-y-hablante-incompatibles', () => {
  const wrongCast = basePlan();
  wrongCast.scenes[0].participants.push({ roleId: 'extra', characterResourceId: 'mono-azul-v1', voiceId: 'voz-ald-mx-v1', animationPresetId: 'talk-calm' });
  wrongCast.scenes[0].sceneRecipeId = 'keyword-pages-v1';
  assert.throws(() => validateDirectorPlanV2(wrongCast, catalog, recipes), (error) => error.code === 'DIRECTOR_RECIPE_INVALID');
  const wrongSpeaker = basePlan();
  wrongSpeaker.scenes[0].speech = [{ kind: 'character', speakerRoleId: 'nadie', text: 'Esto no corresponde.', gestureId: 'neutral', gapAfterSeconds: 0 }];
  assert.throws(() => validateDirectorPlanV2(wrongSpeaker, catalog, recipes), (error) => error.code === 'DIRECTOR_SCENE_DIALOGUE_INVALID');
  const wrongSequence = basePlan();
  wrongSequence.scenes[0].effectSequenceIds = ['secuencia-inventada'];
  assert.throws(() => validateDirectorPlanV2(wrongSequence, catalog, recipes), (error) => error.code === 'DIRECTOR_RECIPE_INVALID');
});

await test('plan-v2-admite-omitir-secuencias-opcionales', () => {
  const plan = basePlan();
  delete plan.scenes[0].effectSequenceIds;
  assert.doesNotThrow(() => validateDirectorPlanV2(plan, catalog, recipes));
  const { project } = normalizeDirectorPlanV2(plan, catalog, { recipes, projectId: 'gate-sin-secuencia-v2' });
  assert.equal(project.scenes.length, 3);
});

await test('plan-v2-corrige-contradicciones-del-modelo-sin-reescribir-el-texto', () => {
  const plan = basePlan();
  const originalText = plan.scenes[0].speech[0].text;
  plan.scenes[0].participants = [{ roleId: 'guia', characterResourceId: 'mono-azul-v1', voiceId: 'voz-claude-mx-v1', animationPresetId: 'talk-calm' }];
  plan.scenes[0].speech = [{ kind: 'character', speakerRoleId: 'guia', text: originalText, gestureId: 'point', gapAfterSeconds: 0 }];
  plan.scenes[0].sceneRecipeId = 'dialogue-contrast-v1';
  const repaired = canonicalizeDirectorPlanV2(plan, catalog, recipes);
  assert.equal(repaired.scenes[0].participants.length, 0);
  assert.equal(repaired.scenes[0].speech[0].kind, 'voiceover');
  assert.equal(repaired.scenes[0].speech[0].text, originalText);
  assert.equal(repaired.scenes[0].sceneRecipeId, 'voiceover-feature-v1');
  assert.doesNotThrow(() => validateDirectorPlanV2(repaired, catalog, recipes));
});

await test('politica-de-riqueza-es-determinista-y-auditable', () => {
  assert.equal(resolveRichnessPolicy('automatic', { prompt: 'Quiero algo dinámico', sceneCount: 3 }).resolved, 'dynamic');
  const report = analyzeCreativeRichness(basePlan());
  assert.equal(report.passed, true);
  assert.equal(report.metrics.modes.length, 3);
  const flat = basePlan();
  flat.richnessProfile = 'varied';
  flat.scenes = [flat.scenes[1], structuredClone(flat.scenes[1])];
  assert.equal(analyzeCreativeRichness(flat).passed, false);
});

await test('secuencia-coordinada-se-expande-sin-sobrescribir-pistas', () => {
  const plan = basePlan();
  plan.scenes.forEach((scene) => { scene.effectSequenceIds = []; });
  const { project } = normalizeDirectorPlanV2(plan, catalog, { recipes, projectId: 'gate-receta-v2' });
  const request = { sequenceId: 'visual-reveal-v1', anchor: { kind: 'scene', edge: 'start' }, intensity: 'medium', bindings: [{ slotId: 'subject', sceneId: 'escena-01', elementId: 'escena-01-prop-1' }] };
  const commands = expandEffectSequenceCommands(request, project, catalog, { recipeCatalog: recipes });
  assert.deepEqual(commands.map((command) => command.presetId), ['fade-in', 'emphasis-pulse']);
  let state = createProjectEditor(project, catalog);
  for (const command of commands) state = applyProjectEditorCommand(state, command);
  assert.ok(state.project.scenes[0].elements[0].tracks.length >= 2);
  assert.throws(() => expandEffectSequenceCommands(request, state.project, catalog, { recipeCatalog: recipes }), (error) => error.code === 'DIRECTOR_TRACK_CUSTOMIZED');
});

await test('comandos-creativos-nuevos-se-aplican-en-un-solo-undo', () => {
  const { project } = normalizeDirectorPlanV2(basePlan(), catalog, { recipes, projectId: 'gate-comandos-v2' });
  const initial = createProjectEditor(project, catalog);
  const next = applyProjectEditorCommandBatch(initial, [
    { type: 'clear-project-music' },
    { type: 'set-project-music', resourceId: 'musica-enfoque-v1' },
    { type: 'add-character', sceneId: 'escena-01', elementId: 'guia-visual', resourceId: 'mono-teal-v1', x: 260, y: 1180, scale: 0.65, zIndex: 41 },
    { type: 'add-template', sceneId: 'escena-01', elementId: 'palabra-clave', templateId: 'procedural-word-match-cut-v1', word: 'VARIEDAD', zIndex: 42 },
    { type: 'set-element-transform', sceneId: 'escena-01', elementId: 'escena-01-prop-1', rotationDegrees: 8, opacity: 0.9, scale: 0.8 },
    { type: 'set-dialogue-voiceover', sceneId: 'escena-02', turnId: 'escena-02-turno-1' },
  ]);
  assert.equal(next.project.musicResourceId, 'musica-enfoque-v1');
  assert.equal(next.project.scenes[0].elements.length, 3);
  assert.equal(next.project.scenes[0].elements[0].transform.rotationDegrees, 8);
  assert.equal(next.project.scenes[1].dialogue[0].speakerType, 'voiceover');
  assert.equal(next.past.length, 1);
  assert.deepEqual(undoProjectEditor(next).project, initial.project);
  const invalidMusic = structuredClone(project);
  invalidMusic.musicResourceId = 'cartel-dato-v1';
  assert.throws(() => validateEditableProject(invalidMusic, catalog), (error) => error.code === 'EDITOR_RESOURCE_INVALID');
});

await test('director-de-montaje-propone-lote-cerrado-en-ticks', async () => {
  const timeline = timelineFixture();
  const schema = buildTimelineDirectorSchema(timeline);
  assert.equal(new Ajv2020({ allErrors: true, strict: true }).compile(schema)({ commands: [{ type: 'split-clip', clipId: 'clip-visual', atTimelineTick: 48_000, newClipId: 'clip-visual-b' }] }), true);
  const result = await editTimelineWithDirector({
    instruction: 'Cortá el clip visual al segundo uno.', project: timeline,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.think, false);
      assert.equal(body.format.properties.commands.maxItems, 24);
      return new Response(JSON.stringify({ message: { content: JSON.stringify({ commands: [{ type: 'split-clip', clipId: 'clip-visual', atTimelineTick: 48_000, newClipId: 'clip-visual-b' }] }) } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.commands.length, 1);
  assert.equal(result.project.clips.length, 2);
  assert.equal(timeline.clips.length, 1, 'la previsualización no muta el documento de entrada');
});

function timelineFixture() {
  return {
    version: 2, id: 'timeline-director-gate', timebase: { ticksPerSecond: 48_000, fps: 30, audioSampleRate: 48_000 },
    sources: [{ id: 'source-visual', kind: 'visual', durationTicks: 240_000, contentHash: 'a'.repeat(64) }],
    tracks: [{ id: 'track-visual', kind: 'visual', order: 0 }],
    clips: [{ id: 'clip-visual', kind: 'visual', sourceId: 'source-visual', trackId: 'track-visual', timelineStartTick: 0, sourceInTick: 0, durationTicks: 240_000, enabled: true }],
  };
}

const failed = results.filter((entry) => !entry.passed);
process.stdout.write(`${JSON.stringify({ version: 1, passed: results.length - failed.length, failed: failed.length, results }, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
