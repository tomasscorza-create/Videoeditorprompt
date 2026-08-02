// Núcleo profesional de clips V2 (Fase 1).
//
// JavaScript puro y sin dependencias de Node, DOM o Ajv porque debe poder ser
// compartido por editor, preview y compilador. La validación JSON Schema vive
// en los consumidores de borde; este módulo repite las invariantes semánticas
// porque la UI despacha comandos directamente.

export const TIMELINE_V2_TIMEBASE = Object.freeze({
  ticksPerSecond: 48_000,
  fps: 30,
  audioSampleRate: 48_000,
  frameTicks: 1_600,
});

export const TIMELINE_CLIP_LIMITS = Object.freeze({
  sources: 512,
  tracks: 64,
  clips: 2_048,
  automationTracksPerClip: 16,
  keyframesPerTrack: 128,
  history: 200,
  maximumTick: 1_728_000_000,
});

export const TIMELINE_CLIP_ERROR_CATALOG = Object.freeze({
  TIMELINE_DOCUMENT_INVALID: 'El documento de clips no cumple el contrato V2.',
  TIMELINE_COMMAND_INVALID: 'El comando de clips está incompleto o contiene campos no permitidos.',
  TIMELINE_COMMAND_UNSUPPORTED: 'La operación todavía no pertenece al núcleo profesional V2.',
  TIMELINE_SOURCE_NOT_FOUND: 'La fuente del clip no existe.',
  TIMELINE_TRACK_NOT_FOUND: 'La pista indicada no existe.',
  TIMELINE_CLIP_NOT_FOUND: 'El clip indicado no existe.',
  TIMELINE_ID_CONFLICT: 'El identificador ya está en uso.',
  TIMELINE_KIND_MISMATCH: 'La fuente, el clip y la pista no son compatibles.',
  TIMELINE_RANGE_INVALID: 'El rango temporal está vacío, desalineado o fuera de la fuente.',
  TIMELINE_COLLISION: 'La operación produciría un solapamiento dentro de la misma pista.',
  TIMELINE_HISTORY_EMPTY: 'No hay otro estado disponible en esa dirección del historial.',
});

const PORTABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u;
const CONTENT_HASH = /^[a-f0-9]{64}$/u;
const PARAMETER_ID = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/u;
const SOURCE_KINDS = new Set(['visual', 'dialogue-audio', 'audio', 'video']);
const TRACK_KINDS = new Set(['visual', 'audio']);
const CLIP_KINDS = new Set(['visual', 'audio']);
const INTERPOLATIONS = new Set(['linear', 'ease', 'hold']);
const COMMAND_SHAPES = Object.freeze({
  'add-source': { required: ['type', 'source'], allowed: ['type', 'source'] },
  'add-track': { required: ['type', 'track'], allowed: ['type', 'track'] },
  'add-clip': { required: ['type', 'clip'], allowed: ['type', 'clip'] },
  'split-clip': { required: ['type', 'clipId', 'atTimelineTick', 'newClipId'], allowed: ['type', 'clipId', 'atTimelineTick', 'newClipId'] },
  'trim-clip': { required: ['type', 'clipId', 'edge', 'toTimelineTick'], allowed: ['type', 'clipId', 'edge', 'toTimelineTick'] },
  'move-clip': { required: ['type', 'clipId', 'trackId', 'timelineStartTick'], allowed: ['type', 'clipId', 'trackId', 'timelineStartTick'] },
  'duplicate-clip': { required: ['type', 'clipId', 'newClipId', 'trackId', 'timelineStartTick'], allowed: ['type', 'clipId', 'newClipId', 'trackId', 'timelineStartTick'] },
  'delete-clip': { required: ['type', 'clipId'], allowed: ['type', 'clipId', 'ripple'] },
  'set-clip-enabled': { required: ['type', 'clipId', 'enabled'], allowed: ['type', 'clipId', 'enabled'] },
  'split-linked': { required: ['type', 'linkGroupId', 'atTimelineTick', 'newClips'], allowed: ['type', 'linkGroupId', 'atTimelineTick', 'newClips'] },
  'move-linked': { required: ['type', 'linkGroupId', 'deltaTicks'], allowed: ['type', 'linkGroupId', 'deltaTicks'] },
  'trim-linked': { required: ['type', 'linkGroupId', 'edge', 'toTimelineTick'], allowed: ['type', 'linkGroupId', 'edge', 'toTimelineTick'] },
  'delete-linked': { required: ['type', 'linkGroupId'], allowed: ['type', 'linkGroupId', 'ripple'] },
});

export class TimelineClipError extends Error {
  constructor(code, message, path = '/') {
    super(message);
    this.name = 'TimelineClipError';
    this.code = code;
    this.path = path;
  }
}

/** Crea un estado inmutable con historial independiente del editor vigente. */
export function createTimelineClipEditor(document, options = {}) {
  const historyLimit = options.historyLimit ?? 50;
  integerInRange(historyLimit, 1, TIMELINE_CLIP_LIMITS.history, '/historyLimit');
  const documentCopy = cloneJson(document);
  validateTimelineDocument(documentCopy);
  return freezeState({
    version: 1,
    document: documentCopy,
    revision: 0,
    historyLimit,
    past: [],
    future: [],
  });
}

/** Aplica una operación como un único paso de historial. */
export function applyTimelineClipCommand(state, command) {
  assertEditorState(state);
  const document = cloneJson(state.document);
  applyMutation(document, command);
  validateTimelineDocument(document);
  return publishDocument(state, document);
}

/**
 * Aplica un lote de forma atómica y lo guarda como un solo undo.
 * La validación global ocurre al final para permitir movimientos coordinados
 * —por ejemplo intercambiar dos clips— sin publicar el estado intermedio.
 */
export function applyTimelineClipCommandBatch(state, commands) {
  assertEditorState(state);
  if (!Array.isArray(commands) || commands.length < 1 || commands.length > 100) {
    fail('TIMELINE_COMMAND_INVALID', 'El lote debe contener entre 1 y 100 comandos.', '/commands');
  }
  const document = cloneJson(state.document);
  for (const command of commands) applyMutation(document, command);
  validateTimelineDocument(document);
  return publishDocument(state, document);
}

export function undoTimelineClip(state) {
  assertEditorState(state);
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return freezeState({
    ...state,
    document: previous,
    revision: state.revision + 1,
    past: state.past.slice(0, -1),
    future: [state.document, ...state.future].slice(0, state.historyLimit),
  });
}

export function redoTimelineClip(state) {
  assertEditorState(state);
  if (state.future.length === 0) return state;
  const [next, ...future] = state.future;
  return freezeState({
    ...state,
    document: next,
    revision: state.revision + 1,
    past: [...state.past, state.document].slice(-state.historyLimit),
    future,
  });
}

/** Serialización canónica para evidencia, hashes y roundtrips deterministas. */
export function exportTimelineDocument(stateOrDocument) {
  const document = stateOrDocument?.document ?? stateOrDocument;
  validateTimelineDocument(document);
  return `${JSON.stringify(canonicalize(document), null, 2)}\n`;
}

/** Valida estructura cerrada, referencias, rangos, alineación y colisiones. */
export function validateTimelineDocument(document) {
  if (!isRecord(document)) failDocument('El documento debe ser un objeto.', '/');
  assertObjectKeys(document, ['version', 'id', 'timebase', 'sources', 'tracks', 'clips'], '/');
  if (document.version !== 2) failDocument('La versión debe ser 2.', '/version');
  portableId(document.id, '/id');
  validateTimebase(document.timebase);

  if (!Array.isArray(document.sources) || document.sources.length > TIMELINE_CLIP_LIMITS.sources) {
    failDocument(`sources admite hasta ${TIMELINE_CLIP_LIMITS.sources} entradas.`, '/sources');
  }
  if (!Array.isArray(document.tracks) || document.tracks.length < 1 || document.tracks.length > TIMELINE_CLIP_LIMITS.tracks) {
    failDocument(`tracks necesita entre 1 y ${TIMELINE_CLIP_LIMITS.tracks} entradas.`, '/tracks');
  }
  if (!Array.isArray(document.clips) || document.clips.length > TIMELINE_CLIP_LIMITS.clips) {
    failDocument(`clips admite hasta ${TIMELINE_CLIP_LIMITS.clips} entradas.`, '/clips');
  }

  const sources = new Map();
  document.sources.forEach((source, index) => {
    const path = `/sources/${index}`;
    validateSource(source, path);
    if (sources.has(source.id)) fail('TIMELINE_ID_CONFLICT', 'Hay dos fuentes con el mismo ID.', `${path}/id`);
    sources.set(source.id, source);
  });

  const tracks = new Map();
  const trackOrders = new Set();
  document.tracks.forEach((track, index) => {
    const path = `/tracks/${index}`;
    validateTrack(track, path);
    if (tracks.has(track.id)) fail('TIMELINE_ID_CONFLICT', 'Hay dos pistas con el mismo ID.', `${path}/id`);
    if (trackOrders.has(track.order)) failDocument('Dos pistas comparten el mismo orden.', `${path}/order`);
    tracks.set(track.id, track);
    trackOrders.add(track.order);
  });

  const clips = new Map();
  document.clips.forEach((clip, index) => {
    const path = `/clips/${index}`;
    validateClip(clip, path, sources, tracks, document.timebase);
    if (clips.has(clip.id)) fail('TIMELINE_ID_CONFLICT', 'Hay dos clips con el mismo ID.', `${path}/id`);
    clips.set(clip.id, clip);
  });
  validateCollisions(document.clips);
  return true;
}

export function timelineFrameTicks(document) {
  validateTimebase(document?.timebase);
  return document.timebase.ticksPerSecond / document.timebase.fps;
}

export function timelineDurationTicks(document) {
  validateTimelineDocument(document);
  return document.clips.reduce((maximum, clip) => Math.max(maximum, clip.timelineStartTick + clip.durationTicks), 0);
}

export function timelineClipSourceTickAt(clip, timelineTick) {
  if (!isRecord(clip)) failDocument('El clip debe ser un objeto.', '/clip');
  tick(timelineTick, '/timelineTick');
  if (timelineTick < clip.timelineStartTick || timelineTick > clip.timelineStartTick + clip.durationTicks) return null;
  return clip.sourceInTick + timelineTick - clip.timelineStartTick;
}

/** Evalúa automatización en tiempo de fuente; cortar o mover no reescribe puntos. */
export function evaluateTimelineAutomation(clip, parameterId, timelineTick, fallback = null) {
  const sourceTick = timelineClipSourceTickAt(clip, timelineTick);
  if (sourceTick === null) return fallback;
  const track = clip.automation?.find((item) => item.parameterId === parameterId);
  if (!track?.keyframes?.length) return fallback;
  const points = track.keyframes;
  if (sourceTick <= points[0].sourceTick) return points[0].value;
  if (sourceTick >= points.at(-1).sourceTick) return points.at(-1).value;
  const rightIndex = points.findIndex((point) => point.sourceTick > sourceTick);
  const left = points[rightIndex - 1];
  const right = points[rightIndex];
  if (left.interpolation === 'hold') return left.value;
  const raw = (sourceTick - left.sourceTick) / (right.sourceTick - left.sourceTick);
  const amount = left.interpolation === 'ease' ? (1 - Math.cos(Math.PI * raw)) / 2 : raw;
  return left.value + (right.value - left.value) * amount;
}

function applyMutation(document, command) {
  assertCommandShape(command);
  if (command.type === 'add-source') {
    if (document.sources.length >= TIMELINE_CLIP_LIMITS.sources) failDocument('Se alcanzó el máximo de fuentes.', '/sources');
    const source = cloneJson(command.source);
    validateSource(source, '/command/source');
    if (document.sources.some((item) => item.id === source.id)) fail('TIMELINE_ID_CONFLICT', 'El ID de fuente ya existe.', '/command/source/id');
    document.sources.push(source);
    return;
  }
  if (command.type === 'add-track') {
    if (document.tracks.length >= TIMELINE_CLIP_LIMITS.tracks) failDocument('Se alcanzó el máximo de pistas.', '/tracks');
    const track = cloneJson(command.track);
    validateTrack(track, '/command/track');
    if (document.tracks.some((item) => item.id === track.id)) fail('TIMELINE_ID_CONFLICT', 'El ID de pista ya existe.', '/command/track/id');
    if (document.tracks.some((item) => item.order === track.order)) fail('TIMELINE_ID_CONFLICT', 'El orden de pista ya está ocupado.', '/command/track/order');
    document.tracks.push(track);
    return;
  }
  if (command.type === 'add-clip') {
    if (document.clips.length >= TIMELINE_CLIP_LIMITS.clips) failDocument('Se alcanzó el máximo de clips.', '/clips');
    const clip = cloneJson(command.clip);
    if (document.clips.some((item) => item.id === clip.id)) fail('TIMELINE_ID_CONFLICT', 'El ID del clip ya existe.', '/command/clip/id');
    const sources = new Map(document.sources.map((item) => [item.id, item]));
    const tracks = new Map(document.tracks.map((item) => [item.id, item]));
    validateClip(clip, '/command/clip', sources, tracks, document.timebase);
    document.clips.push(clip);
    return;
  }
  if (['split-linked', 'move-linked', 'trim-linked', 'delete-linked'].includes(command.type)) {
    applyLinkedMutation(document, command);
    return;
  }
  const index = document.clips.findIndex((clip) => clip.id === command.clipId);
  if (index < 0) fail('TIMELINE_CLIP_NOT_FOUND', `No existe el clip ${command.clipId}.`, '/command/clipId');
  const clip = document.clips[index];
  requireUnlinked(clip);

  switch (command.type) {
    case 'split-clip': {
      portableId(command.newClipId, '/command/newClipId', 'TIMELINE_COMMAND_INVALID');
      requireUnusedClipId(document, command.newClipId, '/command/newClipId');
      tick(command.atTimelineTick, '/command/atTimelineTick');
      assertAlignedForClip(document, clip, command.atTimelineTick, '/command/atTimelineTick');
      const offset = command.atTimelineTick - clip.timelineStartTick;
      const minimum = minimumDuration(document, clip);
      if (offset < minimum || clip.durationTicks - offset < minimum) {
        fail('TIMELINE_RANGE_INVALID', 'El corte debe dejar contenido válido a ambos lados.', '/command/atTimelineTick');
      }
      const right = cloneJson(clip);
      right.id = command.newClipId;
      right.timelineStartTick = command.atTimelineTick;
      right.sourceInTick += offset;
      right.durationTicks -= offset;
      clip.durationTicks = offset;
      document.clips.splice(index + 1, 0, right);
      return;
    }
    case 'trim-clip': {
      if (!['start', 'end'].includes(command.edge)) {
        fail('TIMELINE_COMMAND_INVALID', 'edge debe ser start o end.', '/command/edge');
      }
      tick(command.toTimelineTick, '/command/toTimelineTick');
      assertAlignedForClip(document, clip, command.toTimelineTick, '/command/toTimelineTick');
      const minimum = minimumDuration(document, clip);
      if (command.edge === 'start') {
        const oldEnd = clip.timelineStartTick + clip.durationTicks;
        const delta = command.toTimelineTick - clip.timelineStartTick;
        const nextSourceIn = clip.sourceInTick + delta;
        const nextDuration = oldEnd - command.toTimelineTick;
        if (nextDuration < minimum || nextSourceIn < 0) {
          fail('TIMELINE_RANGE_INVALID', 'El borde inicial deja un rango inválido o sale de la fuente.', '/command/toTimelineTick');
        }
        clip.timelineStartTick = command.toTimelineTick;
        clip.sourceInTick = nextSourceIn;
        clip.durationTicks = nextDuration;
      } else {
        const nextDuration = command.toTimelineTick - clip.timelineStartTick;
        if (nextDuration < minimum) {
          fail('TIMELINE_RANGE_INVALID', 'El borde final debe dejar una duración válida.', '/command/toTimelineTick');
        }
        clip.durationTicks = nextDuration;
      }
      return;
    }
    case 'move-clip': {
      portableId(command.trackId, '/command/trackId', 'TIMELINE_COMMAND_INVALID');
      tick(command.timelineStartTick, '/command/timelineStartTick');
      assertAlignedForClip(document, clip, command.timelineStartTick, '/command/timelineStartTick');
      clip.trackId = command.trackId;
      clip.timelineStartTick = command.timelineStartTick;
      return;
    }
    case 'duplicate-clip': {
      portableId(command.newClipId, '/command/newClipId', 'TIMELINE_COMMAND_INVALID');
      portableId(command.trackId, '/command/trackId', 'TIMELINE_COMMAND_INVALID');
      requireUnusedClipId(document, command.newClipId, '/command/newClipId');
      tick(command.timelineStartTick, '/command/timelineStartTick');
      assertAlignedForClip(document, clip, command.timelineStartTick, '/command/timelineStartTick');
      const duplicate = cloneJson(clip);
      duplicate.id = command.newClipId;
      duplicate.trackId = command.trackId;
      duplicate.timelineStartTick = command.timelineStartTick;
      document.clips.splice(index + 1, 0, duplicate);
      return;
    }
    case 'delete-clip': {
      if (command.ripple !== undefined && typeof command.ripple !== 'boolean') {
        fail('TIMELINE_COMMAND_INVALID', 'ripple debe ser booleano.', '/command/ripple');
      }
      document.clips.splice(index, 1);
      if (command.ripple) rippleTrackAfter(document, clip.trackId, clip.timelineStartTick + clip.durationTicks, -clip.durationTicks);
      return;
    }
    case 'set-clip-enabled':
      if (typeof command.enabled !== 'boolean') fail('TIMELINE_COMMAND_INVALID', 'enabled debe ser booleano.', '/command/enabled');
      clip.enabled = command.enabled;
      return;
    default:
      fail('TIMELINE_COMMAND_UNSUPPORTED', `Comando no soportado: ${String(command.type)}.`, '/command/type');
  }
}

function applyLinkedMutation(document, command) {
  portableId(command.linkGroupId, '/command/linkGroupId', 'TIMELINE_COMMAND_INVALID');
  const linked = document.clips.filter((clip) => clip.linkGroupId === command.linkGroupId);
  if (linked.length < 2) fail('TIMELINE_CLIP_NOT_FOUND', 'El grupo enlazado no existe o está incompleto.', '/command/linkGroupId');
  const start = linked[0].timelineStartTick;
  const duration = linked[0].durationTicks;
  if (!linked.every((clip) => clip.timelineStartTick === start && clip.durationTicks === duration)) {
    fail('TIMELINE_RANGE_INVALID', 'Los clips enlazados deben compartir inicio y duración.', '/command/linkGroupId');
  }
  if (command.type === 'move-linked') {
    if (!Number.isSafeInteger(command.deltaTicks)) fail('TIMELINE_COMMAND_INVALID', 'deltaTicks debe ser un entero.', '/command/deltaTicks');
    for (const clip of linked) {
      const next = clip.timelineStartTick + command.deltaTicks;
      tick(next, '/command/deltaTicks');
      assertAlignedForClip(document, clip, next, '/command/deltaTicks');
      clip.timelineStartTick = next;
    }
    return;
  }
  if (command.type === 'delete-linked') {
    if (command.ripple !== undefined && typeof command.ripple !== 'boolean') fail('TIMELINE_COMMAND_INVALID', 'ripple debe ser booleano.', '/command/ripple');
    document.clips = document.clips.filter((clip) => clip.linkGroupId !== command.linkGroupId);
    if (command.ripple) {
      for (const trackId of new Set(linked.map((clip) => clip.trackId))) rippleTrackAfter(document, trackId, start + duration, -duration);
    }
    return;
  }
  if (command.type === 'trim-linked') {
    if (!['start', 'end'].includes(command.edge)) fail('TIMELINE_COMMAND_INVALID', 'edge debe ser start o end.', '/command/edge');
    tick(command.toTimelineTick, '/command/toTimelineTick');
    for (const clip of linked) {
      assertAlignedForClip(document, clip, command.toTimelineTick, '/command/toTimelineTick');
      const minimum = minimumDuration(document, clip);
      if (command.edge === 'start') {
        const delta = command.toTimelineTick - clip.timelineStartTick;
        const nextDuration = clip.durationTicks - delta;
        if (nextDuration < minimum || clip.sourceInTick + delta < 0) fail('TIMELINE_RANGE_INVALID', 'El trim enlazado deja un rango inválido.', '/command/toTimelineTick');
        clip.timelineStartTick = command.toTimelineTick;
        clip.sourceInTick += delta;
        clip.durationTicks = nextDuration;
      } else {
        const nextDuration = command.toTimelineTick - clip.timelineStartTick;
        if (nextDuration < minimum) fail('TIMELINE_RANGE_INVALID', 'El trim enlazado deja un rango inválido.', '/command/toTimelineTick');
        clip.durationTicks = nextDuration;
      }
    }
    return;
  }
  if (!Array.isArray(command.newClips) || command.newClips.length !== linked.length) {
    fail('TIMELINE_COMMAND_INVALID', 'newClips debe asignar un ID nuevo a cada clip enlazado.', '/command/newClips');
  }
  tick(command.atTimelineTick, '/command/atTimelineTick');
  const assignments = new Map();
  for (const [entryIndex, entry] of command.newClips.entries()) {
    if (!isRecord(entry)) fail('TIMELINE_COMMAND_INVALID', 'La asignación de corte debe ser un objeto.', `/command/newClips/${entryIndex}`);
    assertObjectKeys(entry, ['clipId', 'newClipId'], `/command/newClips/${entryIndex}`, 'TIMELINE_COMMAND_INVALID');
    portableId(entry.clipId, `/command/newClips/${entryIndex}/clipId`, 'TIMELINE_COMMAND_INVALID');
    portableId(entry.newClipId, `/command/newClips/${entryIndex}/newClipId`, 'TIMELINE_COMMAND_INVALID');
    if (assignments.has(entry.clipId)) fail('TIMELINE_COMMAND_INVALID', 'Un clip aparece dos veces en newClips.', `/command/newClips/${entryIndex}/clipId`);
    requireUnusedClipId(document, entry.newClipId, `/command/newClips/${entryIndex}/newClipId`);
    assignments.set(entry.clipId, entry.newClipId);
  }
  if (!linked.every((clip) => assignments.has(clip.id))) fail('TIMELINE_COMMAND_INVALID', 'newClips no coincide con el grupo enlazado.', '/command/newClips');
  const nextGroupId = uniqueDerivedId(document.clips.map((clip) => clip.linkGroupId).filter(Boolean), `${command.linkGroupId}-b`);
  const additions = [];
  for (const clip of linked) {
    assertAlignedForClip(document, clip, command.atTimelineTick, '/command/atTimelineTick');
    const offset = command.atTimelineTick - clip.timelineStartTick;
    if (offset < minimumDuration(document, clip) || clip.durationTicks - offset < minimumDuration(document, clip)) {
      fail('TIMELINE_RANGE_INVALID', 'El corte enlazado debe dejar contenido válido a ambos lados.', '/command/atTimelineTick');
    }
    const right = cloneJson(clip);
    right.id = assignments.get(clip.id);
    right.linkGroupId = nextGroupId;
    right.timelineStartTick = command.atTimelineTick;
    right.sourceInTick += offset;
    right.durationTicks -= offset;
    clip.durationTicks = offset;
    additions.push(right);
  }
  document.clips.push(...additions);
}

function rippleTrackAfter(document, trackId, boundaryTick, deltaTicks) {
  for (const clip of document.clips) {
    if (clip.trackId !== trackId || clip.timelineStartTick < boundaryTick) continue;
    clip.timelineStartTick += deltaTicks;
    if (clip.timelineStartTick < 0) fail('TIMELINE_RANGE_INVALID', 'Ripple produjo una posición negativa.', '/clips');
  }
}

function uniqueDerivedId(existingValues, preferred) {
  const existing = new Set(existingValues);
  const base = preferred.slice(0, 60).replace(/-+$/u, '') || 'linked';
  if (!existing.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, 63 - String(suffix).length)}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  fail('TIMELINE_ID_CONFLICT', 'No se pudo crear un ID portable para el grupo enlazado.', '/command/linkGroupId');
}

function validateTimebase(value) {
  if (!isRecord(value)) failDocument('timebase debe ser un objeto.', '/timebase');
  assertObjectKeys(value, ['ticksPerSecond', 'fps', 'audioSampleRate'], '/timebase');
  if (value.ticksPerSecond !== TIMELINE_V2_TIMEBASE.ticksPerSecond
    || value.fps !== TIMELINE_V2_TIMEBASE.fps
    || value.audioSampleRate !== TIMELINE_V2_TIMEBASE.audioSampleRate) {
    failDocument('La Fase 1 congela 48 kHz y 30 fps.', '/timebase');
  }
}

function validateSource(source, path) {
  if (!isRecord(source)) failDocument('La fuente debe ser un objeto.', path);
  assertObjectKeys(source, ['id', 'kind', 'durationTicks', 'contentHash'], path);
  portableId(source.id, `${path}/id`);
  if (!SOURCE_KINDS.has(source.kind)) failDocument('kind de fuente no admitido.', `${path}/kind`);
  integerInRange(source.durationTicks, 1, TIMELINE_CLIP_LIMITS.maximumTick, `${path}/durationTicks`);
  if (typeof source.contentHash !== 'string' || !CONTENT_HASH.test(source.contentHash)) {
    failDocument('contentHash debe ser SHA-256 en minúsculas.', `${path}/contentHash`);
  }
  if (['visual', 'video'].includes(source.kind) && source.durationTicks % TIMELINE_V2_TIMEBASE.frameTicks !== 0) {
    fail('TIMELINE_RANGE_INVALID', 'Una fuente visual debe terminar en una frontera de frame.', `${path}/durationTicks`);
  }
}

function validateTrack(track, path) {
  if (!isRecord(track)) failDocument('La pista debe ser un objeto.', path);
  assertObjectKeys(track, ['id', 'kind', 'order'], path);
  portableId(track.id, `${path}/id`);
  if (!TRACK_KINDS.has(track.kind)) failDocument('kind de pista no admitido.', `${path}/kind`);
  integerInRange(track.order, 0, TIMELINE_CLIP_LIMITS.tracks - 1, `${path}/order`);
}

function validateClip(clip, path, sources, tracks, timebase) {
  if (!isRecord(clip)) failDocument('El clip debe ser un objeto.', path);
  assertObjectKeys(clip, [
    'id', 'kind', 'sourceId', 'trackId', 'timelineStartTick', 'sourceInTick',
    'durationTicks', 'enabled', 'linkGroupId', 'automation',
  ], path);
  portableId(clip.id, `${path}/id`);
  if (!CLIP_KINDS.has(clip.kind)) failDocument('kind de clip no admitido.', `${path}/kind`);
  portableId(clip.sourceId, `${path}/sourceId`);
  portableId(clip.trackId, `${path}/trackId`);
  if (clip.linkGroupId !== undefined) portableId(clip.linkGroupId, `${path}/linkGroupId`);
  integerInRange(clip.timelineStartTick, 0, TIMELINE_CLIP_LIMITS.maximumTick, `${path}/timelineStartTick`);
  integerInRange(clip.sourceInTick, 0, TIMELINE_CLIP_LIMITS.maximumTick, `${path}/sourceInTick`);
  integerInRange(clip.durationTicks, 1, TIMELINE_CLIP_LIMITS.maximumTick, `${path}/durationTicks`);
  if (typeof clip.enabled !== 'boolean') failDocument('enabled debe ser booleano.', `${path}/enabled`);

  const source = sources.get(clip.sourceId);
  if (!source) fail('TIMELINE_SOURCE_NOT_FOUND', `No existe la fuente ${clip.sourceId}.`, `${path}/sourceId`);
  const track = tracks.get(clip.trackId);
  if (!track) fail('TIMELINE_TRACK_NOT_FOUND', `No existe la pista ${clip.trackId}.`, `${path}/trackId`);
  if (track.kind !== clip.kind || !sourceSupportsClip(source.kind, clip.kind)) {
    fail('TIMELINE_KIND_MISMATCH', 'La fuente, el clip y la pista no comparten un tipo compatible.', path);
  }
  if (clip.sourceInTick + clip.durationTicks > source.durationTicks) {
    fail('TIMELINE_RANGE_INVALID', 'El clip sobrepasa el final de su fuente.', path);
  }
  if (clip.timelineStartTick + clip.durationTicks > TIMELINE_CLIP_LIMITS.maximumTick) {
    fail('TIMELINE_RANGE_INVALID', 'El clip sobrepasa la duración máxima de timeline.', path);
  }
  if (clip.kind === 'visual') {
    const frameTicks = timebase.ticksPerSecond / timebase.fps;
    for (const [field, value] of [
      ['timelineStartTick', clip.timelineStartTick],
      ['sourceInTick', clip.sourceInTick],
      ['durationTicks', clip.durationTicks],
    ]) {
      if (value % frameTicks !== 0) fail('TIMELINE_RANGE_INVALID', 'Un clip visual debe alinearse a frames.', `${path}/${field}`);
    }
  }
  validateAutomation(clip.automation, `${path}/automation`, source.durationTicks);
}

function validateAutomation(automation, path, sourceDurationTicks) {
  if (automation === undefined) return;
  if (!Array.isArray(automation) || automation.length > TIMELINE_CLIP_LIMITS.automationTracksPerClip) {
    failDocument(`automation admite hasta ${TIMELINE_CLIP_LIMITS.automationTracksPerClip} pistas.`, path);
  }
  const parameters = new Set();
  automation.forEach((track, trackIndex) => {
    const trackPath = `${path}/${trackIndex}`;
    if (!isRecord(track)) failDocument('La automatización debe ser un objeto.', trackPath);
    assertObjectKeys(track, ['parameterId', 'keyframes'], trackPath);
    if (typeof track.parameterId !== 'string' || !PARAMETER_ID.test(track.parameterId)) {
      failDocument('parameterId no es portable.', `${trackPath}/parameterId`);
    }
    if (parameters.has(track.parameterId)) failDocument('El clip repite un parámetro de automatización.', `${trackPath}/parameterId`);
    parameters.add(track.parameterId);
    if (!Array.isArray(track.keyframes) || track.keyframes.length < 1
      || track.keyframes.length > TIMELINE_CLIP_LIMITS.keyframesPerTrack) {
      failDocument(`keyframes necesita entre 1 y ${TIMELINE_CLIP_LIMITS.keyframesPerTrack} puntos.`, `${trackPath}/keyframes`);
    }
    const ids = new Set();
    let previousTick = -1;
    track.keyframes.forEach((keyframe, keyframeIndex) => {
      const keyframePath = `${trackPath}/keyframes/${keyframeIndex}`;
      if (!isRecord(keyframe)) failDocument('El keyframe debe ser un objeto.', keyframePath);
      assertObjectKeys(keyframe, ['id', 'sourceTick', 'value', 'interpolation'], keyframePath);
      portableId(keyframe.id, `${keyframePath}/id`);
      if (ids.has(keyframe.id)) fail('TIMELINE_ID_CONFLICT', 'Dos keyframes del parámetro comparten ID.', `${keyframePath}/id`);
      ids.add(keyframe.id);
      integerInRange(keyframe.sourceTick, 0, sourceDurationTicks, `${keyframePath}/sourceTick`);
      if (keyframe.sourceTick <= previousTick) failDocument('Los keyframes deben estar ordenados y no colisionar.', `${keyframePath}/sourceTick`);
      previousTick = keyframe.sourceTick;
      if (typeof keyframe.value !== 'number' || !Number.isFinite(keyframe.value)) failDocument('value debe ser un número finito.', `${keyframePath}/value`);
      if (!INTERPOLATIONS.has(keyframe.interpolation)) failDocument('Interpolación no admitida.', `${keyframePath}/interpolation`);
    });
  });
}

function validateCollisions(clips) {
  const byTrack = new Map();
  clips.forEach((clip) => {
    const list = byTrack.get(clip.trackId) ?? [];
    list.push(clip);
    byTrack.set(clip.trackId, list);
  });
  for (const list of byTrack.values()) {
    list.sort((left, right) => left.timelineStartTick - right.timelineStartTick || left.id.localeCompare(right.id));
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1];
      const current = list[index];
      if (current.timelineStartTick < previous.timelineStartTick + previous.durationTicks) {
        fail('TIMELINE_COLLISION', `Los clips ${previous.id} y ${current.id} se solapan.`, '/clips');
      }
    }
  }
}

function assertCommandShape(command) {
  if (!isRecord(command) || typeof command.type !== 'string') {
    fail('TIMELINE_COMMAND_INVALID', 'El comando debe ser un objeto con type.', '/command');
  }
  const shape = COMMAND_SHAPES[command.type];
  if (!shape) fail('TIMELINE_COMMAND_UNSUPPORTED', `Comando no soportado: ${String(command.type)}.`, '/command/type');
  assertObjectKeys(command, shape.allowed, '/command', 'TIMELINE_COMMAND_INVALID');
  const missing = shape.required.find((key) => !Object.hasOwn(command, key));
  if (missing) fail('TIMELINE_COMMAND_INVALID', `Falta el campo ${missing}.`, `/command/${missing}`);
  if (Object.hasOwn(command, 'clipId')) portableId(command.clipId, '/command/clipId', 'TIMELINE_COMMAND_INVALID');
}

function requireUnlinked(clip) {
  if (clip.linkGroupId !== undefined) {
    fail(
      'TIMELINE_COMMAND_UNSUPPORTED',
      'Los clips enlazados se editarán como grupo cuando se incorpore el contrato A/V; la Fase 1 no los modifica parcialmente.',
      '/command/clipId',
    );
  }
}

function requireUnusedClipId(document, id, path) {
  if (document.clips.some((clip) => clip.id === id)) fail('TIMELINE_ID_CONFLICT', 'El ID del clip ya existe.', path);
  if (document.clips.length >= TIMELINE_CLIP_LIMITS.clips) failDocument('Se alcanzó el máximo de clips.', '/clips');
}

function assertAlignedForClip(document, clip, value, path) {
  if (clip.kind === 'visual' && value % timelineFrameTicks(document) !== 0) {
    fail('TIMELINE_RANGE_INVALID', 'La operación visual debe caer en una frontera de frame.', path);
  }
}

function minimumDuration(document, clip) {
  return clip.kind === 'visual' ? timelineFrameTicks(document) : 1;
}

function sourceSupportsClip(sourceKind, clipKind) {
  if (clipKind === 'visual') return ['visual', 'video'].includes(sourceKind);
  return ['dialogue-audio', 'audio', 'video'].includes(sourceKind);
}

function publishDocument(state, document) {
  return freezeState({
    ...state,
    document,
    revision: state.revision + 1,
    past: [...state.past, state.document].slice(-state.historyLimit),
    future: [],
  });
}

function assertEditorState(state) {
  if (!isRecord(state) || state.version !== 1 || !Array.isArray(state.past) || !Array.isArray(state.future)) {
    failDocument('El estado del editor de clips no es compatible.', '/state');
  }
  validateTimelineDocument(state.document);
}

function portableId(value, path, code = 'TIMELINE_DOCUMENT_INVALID') {
  if (typeof value !== 'string' || !PORTABLE_ID.test(value)) fail(code, 'El ID no es portable.', path);
}

function tick(value, path) {
  integerInRange(value, 0, TIMELINE_CLIP_LIMITS.maximumTick, path, 'TIMELINE_COMMAND_INVALID');
}

function integerInRange(value, minimum, maximum, path, code = 'TIMELINE_DOCUMENT_INVALID') {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(code, `Se esperaba un entero entre ${minimum} y ${maximum}.`, path);
  }
}

function assertObjectKeys(value, allowedKeys, path, code = 'TIMELINE_DOCUMENT_INVALID') {
  if (!isRecord(value)) fail(code, 'Se esperaba un objeto.', path);
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail(code, `El campo ${unknown} no está permitido.`, `${path === '/' ? '' : path}/${unknown}`);
}

function failDocument(message, path) {
  fail('TIMELINE_DOCUMENT_INVALID', message, path);
}

function fail(code, message, path) {
  throw new TimelineClipError(code, message, path);
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function freezeState(state) {
  return deepFreeze(state);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
