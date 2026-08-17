import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { applyTimelineClipCommandBatch, createTimelineClipEditor } from '../../shared/timeline-clip-core.js';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { DEFAULT_DIRECTOR_MODEL, DEFAULT_OLLAMA_URL } from './providers/ollama.mjs';
import { resolveDirectorProvider } from './providers/index.mjs';

const commandDocument = readJson(path.join(projectRoot, 'schema', 'timeline-command-v2.schema.json'));
const allowedRefs = ['splitClip', 'trimClip', 'moveClip', 'duplicateClip', 'deleteClip', 'setClipEnabled', 'splitLinked', 'moveLinked', 'trimLinked', 'deleteLinked'];

export async function editTimelineWithDirector(options) {
  const instruction = String(options.instruction || '').trim();
  if (instruction.length < 3 || instruction.length > 1200) fail('TIMELINE_DIRECTOR_PROMPT_INVALID', 'La indicación debe tener entre 3 y 1200 caracteres.');
  const initial = createTimelineClipEditor(options.project);
  const schema = buildTimelineDirectorSchema(options.project);
  const provider = resolveDirectorProvider(options.provider, {
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });
  const result = await provider.generateCommands({
    schema, signal: options.signal,
    messages: [{
      role: 'system',
      content: [
        'Sos el Director de Montaje de un editor local no destructivo.',
        'Convertí la indicación en la menor cantidad de comandos cerrados.',
        'Trabajá en ticks enteros a 48000 por segundo y respetá clips A/V enlazados.',
        'Podés cortar, recortar, mover, duplicar, activar y borrar con ripple.',
        'No agregues fuentes, no exportes y no inventes IDs existentes. Respondé solo JSON.',
        `Montaje actual: ${JSON.stringify(summarizeTimeline(options.project))}`,
      ].join('\n'),
    }, { role: 'user', content: instruction }],
    options: { model: options.model || provider.defaultModel || DEFAULT_DIRECTOR_MODEL, temperature: 0.05, think: false, seed: 29, maxOutputTokens: 1400, timeoutMs: 240_000 },
  });
  let parsed;
  try { parsed = JSON.parse(result.content || ''); } catch { fail('TIMELINE_DIRECTOR_JSON_INVALID', 'El Director de Montaje no devolvió JSON válido.'); }
  const validateOutput = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validateOutput(parsed)) fail('TIMELINE_DIRECTOR_COMMANDS_INVALID', formatErrors(validateOutput.errors));
  const preview = applyTimelineClipCommandBatch(initial, parsed.commands);
  return {
    version: 1, commands: parsed.commands, project: preview.document,
    explanation: explain(parsed.commands), usage: result.usage || null,
  };
}

export function buildTimelineDirectorSchema(project) {
  const clipIds = project.clips.map((clip) => clip.id);
  const trackIds = project.tracks.map((track) => track.id);
  const linkIds = [...new Set(project.clips.map((clip) => clip.linkGroupId).filter(Boolean))];
  const defs = structuredClone(commandDocument.$defs);
  const restrict = (definition, key, values) => {
    if (definition?.properties?.[key] && values.length) definition.properties[key] = { type: 'string', enum: values };
  };
  for (const key of ['splitClip', 'trimClip', 'moveClip', 'duplicateClip', 'deleteClip', 'setClipEnabled']) restrict(defs[key], 'clipId', clipIds);
  for (const key of ['moveClip', 'duplicateClip']) restrict(defs[key], 'trackId', trackIds);
  for (const key of ['splitLinked', 'moveLinked', 'trimLinked', 'deleteLinked']) restrict(defs[key], 'linkGroupId', linkIds);
  return {
    type: 'object', additionalProperties: false, required: ['commands'],
    properties: { commands: { type: 'array', maxItems: 24, items: { oneOf: allowedRefs.map((key) => ({ $ref: `#/$defs/${key}` })) } } },
    $defs: defs,
  };
}

export function summarizeTimeline(project) {
  return {
    id: project.id, timebase: project.timebase,
    tracks: project.tracks.map(({ id, kind, order }) => ({ id, kind, order })),
    clips: project.clips.map(({ id, kind, sourceId, trackId, timelineStartTick, sourceInTick, durationTicks, enabled, linkGroupId }) => ({ id, kind, sourceId, trackId, timelineStartTick, sourceInTick, durationTicks, enabled, linkGroupId: linkGroupId || null })),
  };
}

function formatErrors(errors) { return (errors || []).slice(0, 12).map((entry) => `${entry.instancePath || '/'} ${entry.message}`).join('; '); }
function explain(commands) { const counts = new Map(); for (const command of commands) counts.set(command.type, (counts.get(command.type) || 0) + 1); return [...counts].map(([type, count]) => `${type}: ${count}`).join(' · ') || 'Sin cambios'; }
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
