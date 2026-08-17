import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ANIMATION_PARAMETERS } from '../../shared/animation-contract.js';
import { ANIMATION_PRESETS, listApplicablePresets } from '../../shared/animation-presets.js';
import { applyProjectEditorCommand, createProjectEditor } from '../../shared/project-editor.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { DEFAULT_DIRECTOR_MODEL, DEFAULT_OLLAMA_URL } from './providers/ollama.mjs';
import { resolveDirectorProvider } from './providers/index.mjs';
import { DIRECTOR_PIPELINE_VERSION } from './version.mjs';
import { buildDirectorContext } from './director-context.mjs';

const MAX_REQUEST_LENGTH = 1200;
const MAX_EDIT_COMMANDS = 24;
const MAX_EDIT_ATTEMPTS = 2;
// Unificado con la propuesta (ai-video-plan): el texto de diálogo se limita a 300
// caracteres en ambos caminos de IA (B2). El editor y el proyecto admiten hasta 500.
const DIRECTOR_TEXT_MAX_LENGTH = 300;

export async function editProjectWithDirector(options) {
  const startedAt = Date.now();
  const instruction = validateInstruction(options.instruction);
  emitProgress(options, 'preparing_context');
  const state = createProjectEditor(options.project, options.catalog);
  const selection = normalizeEditSelection(options.selection, state.project);
  const baseProjectRevision = hashJson(state.project);
  const directorContext = buildDirectorContext({
    prompt: instruction,
    catalog: state.catalog,
    requiredResourceIds: collectProjectResourceIds(state.project),
    resourceLimits: options.resourceLimits,
  });
  const schema = commandBatchSchema(state.project, directorContext.catalog);
  // El proveedor concentra la especificidad de la IA (D1/D2); su nombre entra en
  // la clave de caché.
  const provider = resolveDirectorProvider(options.provider, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });
  const model = String(options.model || provider.defaultModel || DEFAULT_DIRECTOR_MODEL);
  const modelIdentity = normalizeModelIdentity(options.modelIdentity, model);
  const cacheKey = hashJson({
    version: DIRECTOR_PIPELINE_VERSION,
    provider: provider.name,
    instruction,
    project: state.project,
    catalog: hashJson(state.catalog),
    context: hashJson(directorContext.summary),
    model,
    modelIdentity,
    selection,
  });
  const cacheRoot = ensureDirectory(path.resolve(options.cacheRoot || path.join(projectRoot, '.local-video', 'director-edit-cache')));
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  let commands;
  let usage = null;
  let cacheHit = false;
  if (options.useCache !== false && existsSync(cachePath)) {
    emitProgress(options, 'cache');
    commands = readJson(cachePath).commands;
    cacheHit = true;
  } else {
    let feedback = null;
    for (let attempt = 1; attempt <= MAX_EDIT_ATTEMPTS; attempt += 1) {
      emitProgress(options, 'generating', { candidateIndex: 1, candidateCount: 1, attempt });
      const result = await provider.generateCommands({
        schema,
        signal: options.signal,
        messages: [
          {
            role: 'system',
            content: [
            'Sos el editor semántico de un video local.',
            'Convertí la petición en la menor cantidad de comandos del esquema.',
            'Podés editar textos, voces, gestos, pausas, transformaciones y profundidad;',
            'cambiar fondo, cámara, transición y música; agregar o quitar personajes, props y plantillas;',
            'agregar/duplicar/borrar escenas, agregar narración o diálogo, borrar turnos, reordenar escenas y reasignar el hablante.',
            'También podés aplicar presets de keyframes compatibles y quitar animaciones existentes.',
            'Ante una petición breve o amplia, elegí por cuenta propia una combinación completa y compatible de estas capacidades.',
            `Guía para esta petición breve: ${editIntentGuidance(instruction)}`,
            'Si removableByDirector es false, proponé quitarla solo cuando la petición lo pida explícitamente: la UI solicitará confirmación humana especial.',
            'Las capacidades de animación están resumidas por elemento; nunca inventes parámetros, presets ni pistas.',
            'Para una escena nueva podés crearla vacía y agregar solo los recursos necesarios, o duplicar una compatible.',
            'Usá IDs nuevos y portables (letras, números, guiones) para escenas y turnos que crees.',
            'No inventes IDs de recursos ni propiedades. No escribas explicaciones.',
            'Si la petición no se puede representar, devolvé commands vacío.',
            selection ? `Selección y alcance actuales: ${JSON.stringify(selection)}` : 'No hay una selección puntual activa.',
            `Proyecto actual: ${JSON.stringify(summarizeEditableProject(state.project, state.catalog))}`,
            ].join('\n'),
          },
          { role: 'user', content: feedback ? `${instruction}\nCorrección obligatoria: ${feedback}` : instruction },
        ],
        options: { model, temperature: 0.1, seed: 16 + attempt, maxOutputTokens: 2200, think: false, timeoutMs: 240_000 },
      });
      emitProgress(options, 'validating', { candidateIndex: 1, candidateCount: 1, attempt });
      try {
        const parsed = JSON.parse(result.content || '');
        if (!Array.isArray(parsed.commands) || parsed.commands.length > MAX_EDIT_COMMANDS) throw new Error('cantidad de comandos inválida');
        previewDirectorCommands(parsed.commands, state);
        commands = parsed.commands;
        usage = result.usage || null;
        break;
      } catch (error) {
        if (attempt === MAX_EDIT_ATTEMPTS) {
          if (error?.code) throw error;
          throw directorEditError('DIRECTOR_EDIT_COMMANDS_INVALID', 'La IA no devolvió un lote de cambios válido y aplicable.', error instanceof Error ? error.message : String(error));
        }
        feedback = `devolvé solamente el objeto JSON del esquema, no superes ${MAX_EDIT_COMMANDS} comandos y asegurate de que cada cambio pueda aplicarse en orden al proyecto actual.`;
      }
    }
  }
  if (!Array.isArray(commands) || commands.length > MAX_EDIT_COMMANDS) throw directorEditError('DIRECTOR_EDIT_COMMANDS_INVALID', 'La IA devolvió una lista de cambios inválida.');
  if (commands.some((command) => Object.hasOwn(command, 'confirmCustomized'))) {
    throw directorEditError('DIRECTOR_EDIT_COMMANDS_INVALID', 'La IA no puede confirmar por sí misma la eliminación de trabajo personalizado.');
  }
  const customizedTrackRemovalIndexes = findCustomizedTrackRemovalIndexes(commands, state.project);
  emitProgress(options, 'applying');
  let next = state;
  for (const [index, command] of commands.entries()) {
    const executable = customizedTrackRemovalIndexes.includes(index)
      ? { ...command, confirmCustomized: true }
      : command;
    next = applyProjectEditorCommand(next, executable);
  }
  const explanation = explainDirectorEdit(commands, state.project, customizedTrackRemovalIndexes);
  if (!cacheHit) writeJson(cachePath, { version: 3, commands });
  return {
    version: 3,
    model,
    modelIdentity,
    cacheHit,
    commands,
    status: commands.length ? 'proposed' : 'no-change',
    explanation,
    project: next.project,
    baseProjectRevision,
    projectRevision: hashJson(next.project),
    context: directorContext.summary,
    usage: {
      ...(usage || {}),
      promptEvalCount: usage?.promptEvalCount ?? null,
      evalCount: usage?.evalCount ?? null,
      totalDurationNanoseconds: usage?.totalDurationNanoseconds ?? null,
      elapsedMilliseconds: Date.now() - startedAt,
    },
  };
}

function previewDirectorCommands(commands, state) {
  if (commands.some((command) => Object.hasOwn(command, 'confirmCustomized'))) {
    throw directorEditError('DIRECTOR_EDIT_COMMANDS_INVALID', 'La IA no puede confirmar por sí misma la eliminación de trabajo personalizado.');
  }
  const customized = findCustomizedTrackRemovalIndexes(commands, state.project);
  let preview = state;
  for (const [index, command] of commands.entries()) {
    preview = applyProjectEditorCommand(preview, customized.includes(index) ? { ...command, confirmCustomized: true } : command);
  }
  return preview;
}

function emitProgress(options, stage, detail = {}) {
  options.onProgress?.({ stage, ...detail });
}

function collectProjectResourceIds(project) {
  const ids = new Set(project.musicResourceId ? [project.musicResourceId] : []);
  for (const scene of project.scenes) {
    ids.add(scene.background.resourceId);
    for (const element of scene.elements) {
      if (element.resourceId) ids.add(element.resourceId);
      if (element.templateId) ids.add(element.templateId);
    }
    for (const turn of scene.dialogue) ids.add(turn.voiceId);
  }
  return [...ids];
}

function commandBatchSchema(project, catalog) {
  const sceneIds = project.scenes.map((scene) => scene.id);
  const turnIds = project.scenes.flatMap((scene) => scene.dialogue.map((turn) => turn.id));
  const allElementIds = project.scenes.flatMap((scene) => scene.elements.map((element) => element.id));
  const elementIds = project.scenes.flatMap((scene) => scene.elements.filter((element) => element.type === 'character').map((element) => element.id));
  const backgrounds = catalog.entries.filter((entry) => entry.type === 'background').map((entry) => entry.id);
  const characters = catalog.entries.filter((entry) => entry.type === 'character').map((entry) => entry.id);
  const voices = catalog.entries.filter((entry) => entry.type === 'voice').map((entry) => entry.id);
  const props = catalog.entries.filter((entry) => entry.type === 'prop').map((entry) => entry.id);
  const templates = catalog.entries.filter((entry) => entry.type === 'template').map((entry) => entry.id);
  const music = catalog.entries.filter((entry) => entry.type === 'music').map((entry) => entry.id);
  const cameraPresets = [...new Set(catalog.entries
    .filter((entry) => entry.type === 'background')
    .flatMap((entry) => entry.capabilities.cameraPresets))];
  const animationPresets = [...new Set(catalog.entries
    .filter((entry) => entry.type === 'character')
    .flatMap((entry) => entry.capabilities.animationPresets))];
  const gestures = [...new Set(catalog.entries
    .filter((entry) => entry.type === 'character')
    .flatMap((entry) => entry.capabilities.poses))];
  const layoutPresets = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'layout-presets.json')).presets.map((preset) => preset.id);
  const id = (values) => ({ type: 'string', enum: values.length ? values : ['none'] });
  const command = {
    oneOf: [
      object(['type', 'title'], { type: { const: 'set-project-title' }, title: text(120) }),
      object(['type', 'resourceId'], { type: { const: 'set-project-music' }, resourceId: id(music) }),
      object(['type'], { type: { const: 'clear-project-music' } }),
      object(['type', 'sceneId', 'title'], { type: { const: 'set-scene-title' }, sceneId: id(sceneIds), title: text(120) }),
      // set-dialogue-turn: cualquier combinación de texto, voz, gesto o pausa (B2).
      object(['type', 'sceneId', 'turnId'], {
        type: { const: 'set-dialogue-turn' }, sceneId: id(sceneIds), turnId: id(turnIds),
        text: text(DIRECTOR_TEXT_MAX_LENGTH), voiceId: id(voices), gestureId: enumOf(gestures),
        gestureAtWord: { type: 'integer', minimum: 0, maximum: 99 },
        pace: { enum: ['slow', 'normal', 'fast'] },
        layoutPreset: enumOf(layoutPresets),
        gapAfterSeconds: { type: 'number', minimum: 0, maximum: 2 },
      }),
      object(['type', 'sceneId', 'elementId', 'resourceId'], { type: { const: 'set-character-resource' }, sceneId: id(sceneIds), elementId: id(elementIds), resourceId: id(characters) }),
      object(['type', 'sceneId', 'elementId', 'resourceId'], { type: { const: 'set-prop-resource' }, sceneId: id(sceneIds), elementId: id(allElementIds), resourceId: id(props) }),
      object(['type', 'sceneId', 'elementId', 'word'], { type: { const: 'set-template-word' }, sceneId: id(sceneIds), elementId: id(allElementIds), word: text(40) }),
      object(['type', 'sceneId', 'elementId', 'animationPreset'], {
        type: { const: 'set-character-animation' }, sceneId: id(sceneIds), elementId: id(elementIds),
        animationPreset: enumOf(animationPresets),
      }),
      object(['type', 'sceneId', 'elementId', 'resourceId', 'x', 'y', 'scale', 'zIndex'], {
        type: { const: 'add-character' }, sceneId: id(sceneIds), elementId: newId(), resourceId: id(characters),
        x: { type: 'number', minimum: -1080, maximum: 2160 }, y: { type: 'number', minimum: -1920, maximum: 3840 },
        scale: { type: 'number', exclusiveMinimum: 0, maximum: 10 }, zIndex: { type: 'integer', minimum: -1000, maximum: 1000 },
      }),
      object(['type', 'sceneId', 'elementId', 'resourceId', 'x', 'y', 'scale', 'zIndex'], {
        type: { const: 'add-prop' }, sceneId: id(sceneIds), elementId: newId(), resourceId: id(props),
        x: { type: 'number', minimum: -1080, maximum: 2160 }, y: { type: 'number', minimum: -1920, maximum: 3840 },
        scale: { type: 'number', exclusiveMinimum: 0, maximum: 10 }, zIndex: { type: 'integer', minimum: -1000, maximum: 1000 },
      }),
      object(['type', 'sceneId', 'elementId', 'templateId', 'word', 'zIndex'], {
        type: { const: 'add-template' }, sceneId: id(sceneIds), elementId: newId(), templateId: id(templates), word: text(40),
        zIndex: { type: 'integer', minimum: -1000, maximum: 1000 },
      }),
      object(['type', 'sceneId', 'elementId'], { type: { const: 'delete-element' }, sceneId: id(sceneIds), elementId: id(allElementIds) }),
      object(['type', 'sceneId', 'resourceId', 'cameraPreset'], {
        type: { const: 'set-scene-background' }, sceneId: id(sceneIds), resourceId: id(backgrounds),
        cameraPreset: enumOf(cameraPresets),
      }),
      // set-character-transform: posición, escala y/o profundidad (B2).
      object(['type', 'sceneId', 'elementId'], {
        type: { const: 'set-character-transform' }, sceneId: id(sceneIds), elementId: id(elementIds),
        x: { type: 'number', minimum: -1080, maximum: 2160 }, y: { type: 'number', minimum: -1920, maximum: 3840 },
        scale: { type: 'number', exclusiveMinimum: 0, maximum: 10 }, zIndex: { type: 'integer', minimum: -1000, maximum: 1000 },
      }),
      object(['type', 'sceneId', 'elementId'], {
        type: { const: 'set-element-transform' }, sceneId: id(sceneIds), elementId: id(allElementIds),
        x: { type: 'number', minimum: -1080, maximum: 2160 }, y: { type: 'number', minimum: -1920, maximum: 3840 },
        scale: { type: 'number', exclusiveMinimum: 0, maximum: 10 }, rotationDegrees: { type: 'number', minimum: -360, maximum: 360 },
        opacity: { type: 'number', minimum: 0, maximum: 1 }, zIndex: { type: 'integer', minimum: -1000, maximum: 1000 },
      }),
      object(['type', 'sceneId', 'preset', 'durationSeconds'], {
        type: { const: 'set-transition' }, sceneId: id(sceneIds), preset: { enum: ['cut', 'fade'] },
        durationSeconds: { type: 'number', minimum: 0, maximum: 2 },
      }),
      // Comandos estructurales (B1).
      object(['type', 'scene'], {
        type: { const: 'add-scene' },
        scene: {
          type: 'object', additionalProperties: false,
          required: ['id', 'title', 'background', 'elements', 'dialogue'],
          properties: {
            id: newId(), title: text(120),
            background: {
              type: 'object', additionalProperties: false, required: ['resourceId', 'cameraPreset'],
              properties: { resourceId: id(backgrounds), cameraPreset: enumOf(cameraPresets) },
            },
            elements: { type: 'array', maxItems: 0 },
            dialogue: { type: 'array', maxItems: 0 },
          },
        },
      }),
      object(['type', 'sceneId', 'newSceneId', 'title'], {
        type: { const: 'duplicate-scene' }, sceneId: id(sceneIds), newSceneId: newId(), title: text(120),
      }),
      object(['type', 'sceneId'], { type: { const: 'delete-scene' }, sceneId: id(sceneIds) }),
      object(['type', 'sceneId', 'turnId', 'speakerElementId', 'text', 'voiceId', 'gestureId', 'gapAfterSeconds'], {
        type: { const: 'add-dialogue-turn' }, sceneId: id(sceneIds), turnId: newId(), speakerElementId: id(elementIds),
        text: text(DIRECTOR_TEXT_MAX_LENGTH), voiceId: id(voices), gestureId: enumOf(gestures),
        gestureAtWord: { type: 'integer', minimum: 0, maximum: 99 },
        pace: { enum: ['slow', 'normal', 'fast'] },
        layoutPreset: enumOf(layoutPresets),
        gapAfterSeconds: { type: 'number', minimum: 0, maximum: 2 }, afterTurnId: id(turnIds),
      }),
      object(['type', 'sceneId', 'turnId', 'text', 'voiceId', 'gapAfterSeconds'], {
        type: { const: 'add-voiceover-turn' }, sceneId: id(sceneIds), turnId: newId(), text: text(DIRECTOR_TEXT_MAX_LENGTH),
        voiceId: id(voices), pace: { enum: ['slow', 'normal', 'fast'] }, gapAfterSeconds: { type: 'number', minimum: 0, maximum: 2 }, afterTurnId: id(turnIds),
      }),
      object(['type', 'sceneId', 'turnId'], { type: { const: 'delete-dialogue-turn' }, sceneId: id(sceneIds), turnId: id(turnIds) }),
      object(['type', 'sceneId', 'turnId', 'speakerElementId'], {
        type: { const: 'set-dialogue-speaker' }, sceneId: id(sceneIds), turnId: id(turnIds), speakerElementId: id(elementIds),
      }),
      object(['type', 'sceneId', 'turnId'], { type: { const: 'set-dialogue-voiceover' }, sceneId: id(sceneIds), turnId: id(turnIds) }),
      object(['type', 'sceneIds'], {
        type: { const: 'reorder-scenes' },
        sceneIds: { type: 'array', items: id(sceneIds), minItems: sceneIds.length || 1, maxItems: sceneIds.length || 1 },
      }),
      ...animationCommandSchemas(project, catalog),
    ],
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['commands'],
    properties: { commands: { type: 'array', maxItems: MAX_EDIT_COMMANDS, items: command } },
  };
}

function animationCommandSchemas(project, catalog) {
  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const schemas = [];
  for (const scene of project.scenes) {
    const sceneTurnIds = scene.dialogue.map((turn) => turn.id);
    for (const element of scene.elements) {
      if (!['character', 'prop'].includes(element.type)) continue;
      const capability = summarizeElementAnimation(element, resources.get(element.resourceId));
      if (capability.applicablePresetIds.length > 0) {
        schemas.push(object(['type', 'sceneId', 'elementId', 'presetId'], {
          type: { const: 'apply-animation-preset' },
          sceneId: { const: scene.id },
          elementId: { const: element.id },
          presetId: enumOf(capability.applicablePresetIds),
          anchor: animationAnchorSchema(sceneTurnIds),
          intensity: { enum: ['soft', 'medium', 'strong'] },
        }));
      }
      for (const track of capability.activeTracks) {
        schemas.push(object(['type', 'sceneId', 'elementId', 'parameterId'], {
          type: { const: 'remove-animation' },
          sceneId: { const: scene.id },
          elementId: { const: element.id },
          parameterId: { const: track.parameterId },
        }));
      }
    }
  }
  return schemas;
}

function animationAnchorSchema(turnIds) {
  const variants = [
    object(['kind', 'edge'], { kind: { const: 'scene' }, edge: { enum: ['start', 'end'] } }),
  ];
  if (turnIds.length > 0) {
    variants.push(object(['kind', 'turnId', 'edge'], {
      kind: { const: 'turn' }, turnId: enumOf(turnIds), edge: { enum: ['start', 'end'] },
    }));
    variants.push(object(['kind', 'turnId', 'wordIndex'], {
      kind: { const: 'word' }, turnId: enumOf(turnIds), wordIndex: { type: 'integer', minimum: 0, maximum: 99 },
    }));
  }
  return { oneOf: variants };
}

export function summarizeEditableProject(project, catalog) {
  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  return {
    id: project.id,
    title: project.title,
    scenes: project.scenes.map((scene, index) => ({
      number: index + 1,
      id: scene.id,
      title: scene.title,
      background: scene.background,
      transitionToNext: scene.transitionToNext || null,
      elements: scene.elements.map((element) => ({
        id: element.id,
        type: element.type,
        resourceId: element.resourceId ?? element.templateId,
        resourceLabel: resources.get(element.resourceId ?? element.templateId)?.label ?? null,
        poseId: element.poseId,
        animationPreset: element.animationPreset,
        x: element.transform.x,
        y: element.transform.y,
        scale: element.transform.scale,
        rotationDegrees: element.transform.rotationDegrees,
        opacity: element.transform.opacity,
        zIndex: element.transform.zIndex,
        ...(['character', 'prop'].includes(element.type)
          ? { animation: summarizeElementAnimation(element, resources.get(element.resourceId)) }
          : {}),
      })),
      dialogue: scene.dialogue.map((turn, turnIndex) => ({
        number: turnIndex + 1,
        id: turn.id,
        speakerElementId: turn.speakerElementId,
        speakerType: turn.speakerType ?? 'character',
        text: turn.text,
        voiceId: turn.voiceId,
        gestureId: turn.gestureId,
        gestureAtWord: turn.gestureAtWord,
        pace: turn.pace,
        layoutPreset: turn.layoutPreset,
        gapAfterSeconds: turn.gapAfterSeconds,
      })),
    })),
  };
}

function summarizeElementAnimation(element, resource) {
  const declaredParameters = Array.isArray(resource?.capabilities?.parameters)
    ? resource.capabilities.parameters.filter((value) => typeof value === 'string')
    : [];
  const supportedParameterIds = Object.entries(ANIMATION_PARAMETERS)
    .filter(([parameterId, parameter]) => parameter.elementTypes.includes(element.type)
      && (!parameter.requiresResourceSupport || declaredParameters.includes(parameterId)))
    .map(([parameterId]) => parameterId);
  const activeTracks = (element.tracks ?? []).map((track) => ({
    parameterId: track.parameterId,
    source: track.source.kind,
    ...(track.source.kind === 'preset' ? {
      presetId: track.source.presetId,
      customized: track.source.customized,
    } : { customized: true }),
    removableByDirector: track.source.kind === 'preset' && track.source.customized === false,
  }));
  const protectedParameters = new Set(
    activeTracks.filter((track) => !track.removableByDirector).map((track) => track.parameterId),
  );
  const supportedPresetIds = listApplicablePresets(declaredParameters)
    .filter((preset) => supportedParameterIds.includes(preset.parameterId))
    .map((preset) => preset.id);
  const applicablePresetIds = supportedPresetIds
    .filter((presetId) => !protectedParameters.has(ANIMATION_PRESETS[presetId].parameterId));
  return {
    supportedParameterIds,
    supportedPresetIds,
    applicablePresetIds,
    activeTracks,
  };
}

export function explainDirectorEdit(commands, project, customizedTrackRemovalIndexes = []) {
  const sceneNumbers = new Map(project.scenes.map((scene, index) => [scene.id, index + 1]));
  const changes = commands.map((command) => explainDirectorCommand(command, sceneNumbers));
  return {
    summary: commands.length === 0
      ? 'El Director no encontró cambios representables.'
      : `El Director propone ${commands.length} cambio${commands.length === 1 ? '' : 's'}.`,
    changes,
    customizedTrackRemovalIndexes: [...customizedTrackRemovalIndexes],
  };
}

function findCustomizedTrackRemovalIndexes(commands, project) {
  return commands.flatMap((command, index) => {
    if (command.type !== 'remove-animation') return [];
    const scene = project.scenes.find((entry) => entry.id === command.sceneId);
    const element = scene?.elements.find((entry) => entry.id === command.elementId);
    const track = element?.tracks?.find((entry) => entry.parameterId === command.parameterId);
    const customized = track?.source?.kind === 'manual'
      || (track?.source?.kind === 'preset' && track.source.customized === true);
    return customized ? [index] : [];
  });
}

function explainDirectorCommand(command, sceneNumbers) {
  const sceneNumber = sceneNumbers.get(command.sceneId);
  const scene = sceneNumber ? ` en la escena ${sceneNumber}` : '';
  if (command.type === 'apply-animation-preset') {
    const label = ANIMATION_PRESETS[command.presetId]?.label ?? command.presetId;
    return `Aplicar «${label}» al elemento ${command.elementId}${scene}.`;
  }
  if (command.type === 'remove-animation') {
    return `Quitar la animación de ${humanParameter(command.parameterId)} del elemento ${command.elementId}${scene}.`;
  }
  const labels = {
    'set-project-title': 'Cambiar el título del proyecto.',
    'set-scene-title': `Cambiar el título${scene}.`,
    'set-dialogue-turn': `Editar un diálogo${scene}.`,
    'set-character-resource': `Cambiar un personaje${scene}.`,
    'set-character-animation': `Cambiar el movimiento base de un personaje${scene}.`,
    'set-scene-background': `Cambiar el fondo${scene}.`,
    'set-character-transform': `Ajustar la posición o escala de un personaje${scene}.`,
    'set-transition': `Ajustar la transición${scene}.`,
    'add-scene': 'Agregar una escena.',
    'duplicate-scene': `Duplicar una escena${scene}.`,
    'delete-scene': `Eliminar una escena${scene}.`,
    'add-dialogue-turn': `Agregar un diálogo${scene}.`,
    'delete-dialogue-turn': `Eliminar un diálogo${scene}.`,
    'set-dialogue-speaker': `Cambiar quién habla${scene}.`,
    'reorder-scenes': 'Reordenar las escenas.',
  };
  return labels[command.type] ?? `Aplicar ${String(command.type).replaceAll('-', ' ')}${scene}.`;
}

function humanParameter(parameterId) {
  return {
    'position.x': 'posición horizontal',
    'position.y': 'posición vertical',
    scale: 'escala',
    rotationDegrees: 'rotación',
    opacity: 'opacidad',
    armRaise: 'elevación del brazo derecho',
    leftArmRaise: 'elevación del brazo izquierdo',
    rightElbowBend: 'flexión del codo derecho',
    leftElbowBend: 'flexión del codo izquierdo',
    headTilt: 'inclinación de la cabeza',
    headNod: 'asentimiento',
    bodyLean: 'inclinación del cuerpo',
    bodyBounce: 'rebote del cuerpo',
  }[parameterId] ?? parameterId;
}

function object(required, properties) {
  return { type: 'object', additionalProperties: false, required, properties };
}

function enumOf(values) {
  return { type: 'string', enum: values.length ? values : ['none'] };
}

function newId() {
  return { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$' };
}

function text(maxLength) {
  return { type: 'string', minLength: 1, maxLength };
}

export function editIntentGuidance(value) {
  const text = String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/\b(?:dinamico|ritmo|energia|impacto)\b/u.test(text)) {
    return 'priorizá de uno a tres presets compatibles en elementos de escenas distintas, variá cámara o transición cuando aporte ritmo y no reescribas el guion salvo que sea necesario.';
  }
  if (/\b(?:visual|vistoso|atractivo|apoyo)\b/u.test(text)) {
    return 'elegí un prop o una plantilla disponible, ubicá el recurso con una transformación legible y aplicá un preset compatible si existe.';
  }
  if (/\b(?:corto|breve|resumi)\b/u.test(text)) {
    return 'recortá texto redundante conservando el gancho, la idea central y el cierre; no borres escenas útiles sin necesidad.';
  }
  if (/\b(?:claro|explica|entender|educativo)\b/u.test(text)) {
    return 'mejorá primero el texto y el orden de las intervenciones; después ajustá gesto, pausa o composición para reforzar la explicación.';
  }
  return 'interpretá el objetivo, elegí por cuenta propia los cambios mínimos suficientes y usá solamente capacidades compatibles del esquema.';
}

function validateInstruction(value) {
  if (typeof value !== 'string') throw directorEditError('DIRECTOR_EDIT_PROMPT_INVALID', 'La petición debe ser texto.');
  const instruction = value.trim();
  if (instruction.length < 3 || instruction.length > MAX_REQUEST_LENGTH) throw directorEditError('DIRECTOR_EDIT_PROMPT_INVALID', 'La petición debe tener entre 3 y 1200 caracteres.');
  return instruction;
}

function normalizeEditSelection(value, project) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw directorEditError('DIRECTOR_EDIT_SELECTION_INVALID', 'La selección de edición no es válida.');
  }
  const kind = ['scene', 'element', 'dialogue', 'keyframe'].includes(value.kind) ? value.kind : null;
  const scene = project.scenes.find((entry) => entry.id === value.sceneId);
  if (!kind || !scene) {
    throw directorEditError('DIRECTOR_EDIT_SELECTION_INVALID', 'La selección ya no existe en el proyecto.');
  }
  if (['element', 'keyframe'].includes(kind) && !scene.elements.some((entry) => entry.id === value.elementId)) {
    throw directorEditError('DIRECTOR_EDIT_SELECTION_INVALID', 'El elemento seleccionado ya no existe.');
  }
  if (kind === 'keyframe') {
    const element = scene.elements.find((entry) => entry.id === value.elementId);
    const track = element?.tracks?.find((entry) => entry.parameterId === value.parameterId);
    if (!track?.keyframes.some((entry) => entry.id === value.keyframeId)) {
      throw directorEditError('DIRECTOR_EDIT_SELECTION_INVALID', 'El keyframe seleccionado ya no existe.');
    }
  }
  if (kind === 'dialogue' && !scene.dialogue.some((entry) => entry.id === value.turnId)) {
    throw directorEditError('DIRECTOR_EDIT_SELECTION_INVALID', 'El diálogo seleccionado ya no existe.');
  }
  return {
    kind,
    sceneId: scene.id,
    ...(['element', 'keyframe'].includes(kind) ? { elementId: value.elementId } : {}),
    ...(kind === 'dialogue' ? { turnId: value.turnId } : {}),
    ...(kind === 'keyframe' ? { parameterId: value.parameterId, keyframeId: value.keyframeId } : {}),
  };
}

function normalizeModelIdentity(value, model) {
  if (!value || typeof value !== 'object') return { model, digest: null, runtimeVersion: null };
  return {
    model,
    digest: typeof value.digest === 'string' ? value.digest : null,
    runtimeVersion: typeof value.runtimeVersion === 'string' ? value.runtimeVersion : null,
  };
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function directorEditError(code, message, technicalDetail) {
  return new PipelineError({ code, stage: 'directing', message, technicalDetail, suggestedAction: 'Revisá la petición y volvé a intentar.' });
}
