import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { applyProjectEditorCommand, createProjectEditor } from '../../shared/project-editor.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { DEFAULT_DIRECTOR_MODEL, DEFAULT_OLLAMA_URL } from './providers/ollama.mjs';
import { resolveDirectorProvider } from './providers/index.mjs';
import { DIRECTOR_PIPELINE_VERSION } from './version.mjs';
import { buildDirectorContext } from './director-context.mjs';

const MAX_REQUEST_LENGTH = 1200;
// Unificado con la propuesta (ai-video-plan): el texto de diálogo se limita a 300
// caracteres en ambos caminos de IA (B2). El editor y el proyecto admiten hasta 500.
const DIRECTOR_TEXT_MAX_LENGTH = 300;

export async function editProjectWithDirector(options) {
  const startedAt = Date.now();
  const instruction = validateInstruction(options.instruction);
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
  const model = String(options.model || DEFAULT_DIRECTOR_MODEL);
  const modelIdentity = normalizeModelIdentity(options.modelIdentity, model);
  // El proveedor concentra la especificidad de la IA (D1/D2); su nombre entra en
  // la clave de caché.
  const provider = resolveDirectorProvider(options.provider, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl || DEFAULT_OLLAMA_URL,
  });
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
    commands = readJson(cachePath).commands;
    cacheHit = true;
  } else {
    const result = await provider.generateCommands({
      schema,
      signal: options.signal,
      messages: [
        {
          role: 'system',
          content: [
            'Sos el editor semántico de un video local.',
            'Convertí la petición en la menor cantidad de comandos del esquema.',
            'Podés editar textos, voces, gestos, pausas, posición, escala y profundidad,',
            'cambiar fondo o cámara y transición, y modificar la estructura:',
            'agregar/duplicar/borrar escenas, agregar/borrar turnos, reordenar escenas y reasignar el hablante.',
            'Para una escena nueva con personajes, duplicá una existente (duplicate-scene) y ajustá sus textos.',
            'Usá IDs nuevos y portables (letras, números, guiones) para escenas y turnos que crees.',
            'No inventes IDs de recursos ni propiedades. No escribas explicaciones.',
            'Si la petición no se puede representar, devolvé commands vacío.',
            selection ? `Selección y alcance actuales: ${JSON.stringify(selection)}` : 'No hay una selección puntual activa.',
            `Proyecto actual: ${JSON.stringify(summarizeProject(state.project))}`,
          ].join('\n'),
        },
        { role: 'user', content: instruction },
      ],
      options: { model, temperature: 0.1, seed: 17, maxOutputTokens: 1600, think: false, timeoutMs: 240_000 },
    });
    let parsed;
    try {
      parsed = JSON.parse(result.content || '');
    } catch {
      throw directorEditError('DIRECTOR_EDIT_JSON_INVALID', 'La IA no devolvió comandos JSON válidos.');
    }
    commands = parsed.commands;
    usage = result.usage || null;
  }
  if (!Array.isArray(commands) || commands.length > 12) throw directorEditError('DIRECTOR_EDIT_COMMANDS_INVALID', 'La IA devolvió una lista de cambios inválida.');
  let next = state;
  for (const command of commands) next = applyProjectEditorCommand(next, command);
  if (!cacheHit) writeJson(cachePath, { version: 2, commands });
  return {
    version: 2,
    model,
    modelIdentity,
    cacheHit,
    commands,
    status: commands.length ? 'applied' : 'no-change',
    project: next.project,
    baseProjectRevision,
    projectRevision: hashJson(next.project),
    context: directorContext.summary,
    usage: {
      promptEvalCount: usage?.promptEvalCount ?? null,
      evalCount: usage?.evalCount ?? null,
      totalDurationNanoseconds: usage?.totalDurationNanoseconds ?? null,
      elapsedMilliseconds: Date.now() - startedAt,
    },
  };
}

function collectProjectResourceIds(project) {
  const ids = new Set(project.musicResourceId ? [project.musicResourceId] : []);
  for (const scene of project.scenes) {
    ids.add(scene.background.resourceId);
    for (const element of scene.elements) {
      if (element.resourceId) ids.add(element.resourceId);
    }
    for (const turn of scene.dialogue) ids.add(turn.voiceId);
  }
  return [...ids];
}

function commandBatchSchema(project, catalog) {
  const sceneIds = project.scenes.map((scene) => scene.id);
  const turnIds = project.scenes.flatMap((scene) => scene.dialogue.map((turn) => turn.id));
  const elementIds = project.scenes.flatMap((scene) => scene.elements.filter((element) => element.type === 'character').map((element) => element.id));
  const backgrounds = catalog.entries.filter((entry) => entry.type === 'background').map((entry) => entry.id);
  const characters = catalog.entries.filter((entry) => entry.type === 'character').map((entry) => entry.id);
  const voices = catalog.entries.filter((entry) => entry.type === 'voice').map((entry) => entry.id);
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
      object(['type', 'sceneId', 'elementId', 'animationPreset'], {
        type: { const: 'set-character-animation' }, sceneId: id(sceneIds), elementId: id(elementIds),
        animationPreset: enumOf(animationPresets),
      }),
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
      object(['type', 'sceneId', 'turnId'], { type: { const: 'delete-dialogue-turn' }, sceneId: id(sceneIds), turnId: id(turnIds) }),
      object(['type', 'sceneId', 'turnId', 'speakerElementId'], {
        type: { const: 'set-dialogue-speaker' }, sceneId: id(sceneIds), turnId: id(turnIds), speakerElementId: id(elementIds),
      }),
      object(['type', 'sceneIds'], {
        type: { const: 'reorder-scenes' },
        sceneIds: { type: 'array', items: id(sceneIds), minItems: sceneIds.length || 1, maxItems: sceneIds.length || 1 },
      }),
    ],
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['commands'],
    properties: { commands: { type: 'array', maxItems: 12, items: command } },
  };
}

function summarizeProject(project) {
  return {
    id: project.id,
    title: project.title,
    scenes: project.scenes.map((scene, index) => ({
      number: index + 1,
      id: scene.id,
      title: scene.title,
      background: scene.background,
      transitionToNext: scene.transitionToNext || null,
      characters: scene.elements.filter((element) => element.type === 'character').map((element) => ({
        id: element.id,
        resourceId: element.resourceId,
        poseId: element.poseId,
        animationPreset: element.animationPreset,
        x: element.transform.x,
        y: element.transform.y,
        scale: element.transform.scale,
        zIndex: element.transform.zIndex,
      })),
      dialogue: scene.dialogue.map((turn, turnIndex) => ({
        number: turnIndex + 1,
        id: turn.id,
        speakerElementId: turn.speakerElementId,
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
  const kind = ['scene', 'element', 'dialogue'].includes(value.kind) ? value.kind : null;
  const scene = project.scenes.find((entry) => entry.id === value.sceneId);
  if (!kind || !scene) {
    throw directorEditError('DIRECTOR_EDIT_SELECTION_INVALID', 'La selección ya no existe en el proyecto.');
  }
  if (kind === 'element' && !scene.elements.some((entry) => entry.id === value.elementId)) {
    throw directorEditError('DIRECTOR_EDIT_SELECTION_INVALID', 'El elemento seleccionado ya no existe.');
  }
  if (kind === 'dialogue' && !scene.dialogue.some((entry) => entry.id === value.turnId)) {
    throw directorEditError('DIRECTOR_EDIT_SELECTION_INVALID', 'El diálogo seleccionado ya no existe.');
  }
  return {
    kind,
    sceneId: scene.id,
    ...(kind === 'element' ? { elementId: value.elementId } : {}),
    ...(kind === 'dialogue' ? { turnId: value.turnId } : {}),
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

function directorEditError(code, message) {
  return new PipelineError({ code, stage: 'directing', message, suggestedAction: 'Revisá la petición y volvé a intentar.' });
}
