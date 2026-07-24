import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { applyProjectEditorCommand, createProjectEditor } from '../../shared/project-editor.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { DEFAULT_DIRECTOR_MODEL, DEFAULT_OLLAMA_URL } from './ollama-director.mjs';

const MAX_REQUEST_LENGTH = 1200;

export async function editProjectWithDirector(options) {
  const instruction = validateInstruction(options.instruction);
  const state = createProjectEditor(options.project, options.catalog);
  const schema = commandBatchSchema(state.project, state.catalog);
  const model = String(options.model || DEFAULT_DIRECTOR_MODEL);
  const cacheKey = hashJson({ version: 1, instruction, project: state.project, catalog: hashJson(state.catalog), model });
  const cacheRoot = ensureDirectory(path.resolve(options.cacheRoot || path.join(projectRoot, '.local-video', 'director-edit-cache')));
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`);
  let commands;
  let cacheHit = false;
  if (options.useCache !== false && existsSync(cachePath)) {
    commands = readJson(cachePath).commands;
    cacheHit = true;
  } else {
    const response = await requestOllama({
      baseUrl: normalizeLoopbackUrl(options.baseUrl || DEFAULT_OLLAMA_URL),
      model,
      schema,
      signal: options.signal,
      fetchImpl: options.fetchImpl || globalThis.fetch,
      messages: [
        {
          role: 'system',
          content: [
            'Sos el editor semántico de un video local.',
            'Convertí la petición en la menor cantidad de comandos del esquema.',
            'No inventes IDs ni propiedades. No escribas explicaciones.',
            'Si la petición no se puede representar, devolvé commands vacío.',
            `Proyecto actual: ${JSON.stringify(summarizeProject(state.project))}`,
          ].join('\n'),
        },
        { role: 'user', content: instruction },
      ],
    });
    let parsed;
    try {
      parsed = JSON.parse(response?.message?.content || '');
    } catch {
      throw directorEditError('DIRECTOR_EDIT_JSON_INVALID', 'La IA no devolvió comandos JSON válidos.');
    }
    commands = parsed.commands;
    writeJson(cachePath, { version: 1, commands });
  }
  if (!Array.isArray(commands) || commands.length > 12) throw directorEditError('DIRECTOR_EDIT_COMMANDS_INVALID', 'La IA devolvió una lista de cambios inválida.');
  let next = state;
  for (const command of commands) next = applyProjectEditorCommand(next, command);
  return { version: 1, model, cacheHit, commands, project: next.project };
}

function commandBatchSchema(project, catalog) {
  const sceneIds = project.scenes.map((scene) => scene.id);
  const turnIds = project.scenes.flatMap((scene) => scene.dialogue.map((turn) => turn.id));
  const elementIds = project.scenes.flatMap((scene) => scene.elements.filter((element) => element.type === 'character').map((element) => element.id));
  const backgrounds = catalog.entries.filter((entry) => entry.type === 'background').map((entry) => entry.id);
  const characters = catalog.entries.filter((entry) => entry.type === 'character').map((entry) => entry.id);
  const voices = catalog.entries.filter((entry) => entry.type === 'voice').map((entry) => entry.id);
  const id = (values) => ({ type: 'string', enum: values.length ? values : ['none'] });
  const command = {
    oneOf: [
      object(['type', 'title'], { type: { const: 'set-project-title' }, title: text(120) }),
      object(['type', 'sceneId', 'title'], { type: { const: 'set-scene-title' }, sceneId: id(sceneIds), title: text(120) }),
      object(['type', 'sceneId', 'turnId', 'text'], { type: { const: 'set-dialogue-turn' }, sceneId: id(sceneIds), turnId: id(turnIds), text: text(500) }),
      object(['type', 'sceneId', 'turnId', 'voiceId'], { type: { const: 'set-dialogue-turn' }, sceneId: id(sceneIds), turnId: id(turnIds), voiceId: id(voices) }),
      object(['type', 'sceneId', 'elementId', 'resourceId'], { type: { const: 'set-character-resource' }, sceneId: id(sceneIds), elementId: id(elementIds), resourceId: id(characters) }),
      object(['type', 'sceneId', 'elementId', 'animationPreset'], {
        type: { const: 'set-character-animation' }, sceneId: id(sceneIds), elementId: id(elementIds),
        animationPreset: { type: 'string', enum: ['idle-calm', 'talk-calm'] },
      }),
      object(['type', 'sceneId', 'resourceId', 'cameraPreset'], {
        type: { const: 'set-scene-background' }, sceneId: id(sceneIds), resourceId: id(backgrounds),
        cameraPreset: { type: 'string', enum: ['static', 'slow-pan-left', 'slow-pan-right', 'slow-zoom'] },
      }),
      object(['type', 'sceneId', 'elementId', 'x', 'y'], {
        type: { const: 'set-character-transform' }, sceneId: id(sceneIds), elementId: id(elementIds),
        x: { type: 'number', minimum: -1080, maximum: 2160 }, y: { type: 'number', minimum: -1920, maximum: 3840 },
      }),
      object(['type', 'sceneId', 'preset', 'durationSeconds'], {
        type: { const: 'set-transition' }, sceneId: id(sceneIds), preset: { enum: ['cut', 'fade'] },
        durationSeconds: { type: 'number', minimum: 0, maximum: 2 },
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
      characters: scene.elements.filter((element) => element.type === 'character').map((element) => ({
        id: element.id, resourceId: element.resourceId, x: element.transform.x, y: element.transform.y,
      })),
      dialogue: scene.dialogue.map((turn, turnIndex) => ({
        number: turnIndex + 1, id: turn.id, speakerElementId: turn.speakerElementId, text: turn.text, voiceId: turn.voiceId,
      })),
    })),
  };
}

function object(required, properties) {
  return { type: 'object', additionalProperties: false, required, properties };
}

function text(maxLength) {
  return { type: 'string', minLength: 1, maxLength };
}

async function requestOllama({ baseUrl, model, schema, signal, fetchImpl, messages }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model, stream: false, think: false, keep_alive: 0, format: schema, messages,
        options: { temperature: 0.1, seed: 17, num_predict: 1600 },
      }),
    });
    const textValue = await response.text();
    if (!response.ok) throw directorEditError('OLLAMA_DIRECTOR_EDIT_FAILED', `Ollama rechazó la edición (HTTP ${response.status}).`);
    return JSON.parse(textValue);
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw directorEditError(error?.name === 'AbortError' ? 'OLLAMA_TIMEOUT' : 'OLLAMA_DIRECTOR_EDIT_FAILED', 'No se pudo completar la edición con IA.');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function validateInstruction(value) {
  if (typeof value !== 'string') throw directorEditError('DIRECTOR_EDIT_PROMPT_INVALID', 'La petición debe ser texto.');
  const instruction = value.trim();
  if (instruction.length < 3 || instruction.length > MAX_REQUEST_LENGTH) throw directorEditError('DIRECTOR_EDIT_PROMPT_INVALID', 'La petición debe tener entre 3 y 1200 caracteres.');
  return instruction;
}

function normalizeLoopbackUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw directorEditError('OLLAMA_URL_INVALID', 'Ollama debe ejecutarse en loopback.');
  }
  return url.origin;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function directorEditError(code, message) {
  return new PipelineError({ code, stage: 'directing', message, suggestedAction: 'Revisá la petición y volvé a intentar.' });
}
