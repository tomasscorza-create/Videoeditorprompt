import {
  applyTimelineClipCommand,
  applyTimelineClipCommandBatch,
  createTimelineClipEditor,
  evaluateTimelineAutomation,
  redoTimelineClip,
  timelineDurationTicks,
  undoTimelineClip,
  type TimelineClipCommandV2,
  type TimelineClipEditorState,
  type TimelineClipV2,
  type TimelineDocumentV2,
  type TimelineTrackV2,
} from '../../shared/timeline-clip-core.js';
import {
  editorPlayhead,
  editorWorkspace,
  invalidateEditorOutput,
  seekEditorPlayback,
  setEditorPlayhead,
  setExternalEditorMediaDuration,
  EDITOR_WORKSPACE_EVENT,
} from './editor-workspace.js';
import { optional } from './dom.js';
import { clearProjectSelection, PROJECT_SELECTION_EVENT } from './project/selection.js';
import { projectFingerprint } from '../../shared/project-fingerprint.js';
import {
  directTimelineProject,
  getTimelineProject,
  listTimelineMedia,
  saveTimelineProject,
  uploadTimelineMedia,
  type TimelineMediaEntry,
} from './timeline-v2-api.js';
import { planTimelineMediaInsertion } from './timeline-media-placement.js';

const LEGACY_STORAGE_KEY = 'local-video.timeline-v2.project';
const STORAGE_PREFIX = 'local-video.timeline-v2.project.';
const MIGRATION_KEY = 'local-video.timeline-v2.migrated-project';
export const UNIFIED_MEDIA_TIMELINE_EVENT = 'local-video:unified-media-timeline';
export const TIMELINE_MEDIA_LIBRARY_EVENT = 'local-video:timeline-media-library';
const TICKS_PER_SECOND = 48_000;
const FRAME_TICKS = 1_600;
const MIN_PPS = 20;
const MAX_PPS = 260;
const TRACK_LABELS: Record<string, string> = {
  'video-track-01': 'V1 · Video',
  'video-track-02': 'V2 · Superposición',
  'audio-track-01': 'A1 · Audio principal',
  'audio-track-02': 'A2 · Música / efectos',
};

let initialized = false;
let state: TimelineClipEditorState = createTimelineClipEditor(blankDocument('timeline-unattached'));
let media = new Map<string, TimelineMediaEntry>();
let selection = new Set<string>();
let playheadTick = 0;
let pixelsPerSecond = 72;
let snapEnabled = true;
let rippleEnabled = false;
let cutEnabled = false;
let muted = false;
let playing = false;
let saveTimer = 0;
let saveQueue: Promise<void> = Promise.resolve();
let revision: string | null = null;
let activeProjectId: string | null = null;
let readyPromise: Promise<void> = Promise.resolve();
const previewElements = new Map<string, HTMLMediaElement>();
const activePreviewIds = new Set<string>();
const previewPlayRequests = new Set<string>();
const handledEvents = new WeakSet<Event>();

export function initTimelineV2(): void {
  if (initialized) return;
  initialized = true;
  document.body.dataset.timelineEngine = 'unified';
  document.body.classList.remove('timeline-v2-active');
  bindOwnButton('#timeline-v2-ripple', (event) => runOnce(event, () => { rippleEnabled = !rippleEnabled; render(); }));
  bindOwnButton('#timeline-v2-unlink', (event) => runOnce(event, unlinkSelection));
  bindOwnButton('#timeline-v2-director', (event) => runOnce(event, () => void runTimelineDirector()));
  document.addEventListener('click', captureToolbarClick, true);
  window.addEventListener('keydown', captureKeyboard, true);
  window.addEventListener(EDITOR_WORKSPACE_EVENT, () => syncPreviewFromEditor());
  window.addEventListener(PROJECT_SELECTION_EVENT, (event) => {
    if (!(event as CustomEvent).detail || selection.size === 0) return;
    selection.clear();
    cutEnabled = false;
    render();
  });
  void listTimelineMedia().then((entries) => {
    media = new Map(entries.map((entry) => [entry.id, entry]));
    migrateLegacyMeasurementClips(entries);
    window.dispatchEvent(new CustomEvent(TIMELINE_MEDIA_LIBRARY_EVENT));
    render();
  }).catch((error) => setStatus(messageOf(error), true));
  render();
}

function migrateLegacyMeasurementClips(entries: TimelineMediaEntry[]): void {
  const generatedMeasurements = new Set(entries
    .filter((entry) => /^measure-.+-preview\.wav$/iu.test(entry.name))
    .map((entry) => entry.id));
  if (!state.document.clips.some((clip) => generatedMeasurements.has(clip.sourceId))) return;
  const document = structuredClone(state.document);
  document.clips = document.clips.filter((clip) => !generatedMeasurements.has(clip.sourceId));
  const referenced = new Set(document.clips.map((clip) => clip.sourceId));
  document.sources = document.sources.filter((source) => referenced.has(source.id));
  state = createTimelineClipEditor(document);
  if (activeProjectId) persistLocal(document);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveTimelineProject(document, revision)
    .then((next) => { revision = next; setStatus('Timeline anterior migrada: las voces generadas ya no están duplicadas.'); })
    .catch((error) => setStatus(`La migración quedó guardada localmente: ${messageOf(error)}`, true)), 0);
}

function blankDocument(id: string): TimelineDocumentV2 {
  return {
    version: 2,
    id,
    timebase: { ticksPerSecond: 48_000, fps: 30, audioSampleRate: 48_000 },
    sources: [],
    tracks: [
      { id: 'video-track-01', kind: 'visual', order: 0 },
      { id: 'video-track-02', kind: 'visual', order: 1 },
      { id: 'audio-track-01', kind: 'audio', order: 2 },
      { id: 'audio-track-02', kind: 'audio', order: 3 },
    ],
    clips: [],
  };
}

export function attachTimelineProject(projectId: string): Promise<void> {
  activeProjectId = projectId;
  setExternalEditorMediaDuration(0);
  selection.clear();
  revision = null;
  window.clearTimeout(saveTimer);
  readyPromise = loadTimelineProject(projectId);
  return readyPromise;
}

export function timelineProjectReady(): Promise<void> {
  return readyPromise;
}

async function loadTimelineProject(projectId: string): Promise<void> {
  setStatus('Abriendo los archivos del proyecto…');
  try {
    const stored = await getTimelineProject(projectId);
    if (activeProjectId !== projectId) return;
    if (stored) {
      state = createTimelineClipEditor(stored.project);
      revision = stored.revision;
    } else {
      const local = readLocalDocument(projectId) ?? readLegacyDocument(projectId) ?? blankDocument(projectId);
      state = createTimelineClipEditor({ ...local, id: projectId });
      revision = await saveTimelineProject(state.document);
    }
    persistLocal(state.document);
    setStatus(state.document.clips.length ? 'Archivos del proyecto listos.' : 'Podés importar videos o audios desde Archivos.');
  } catch (error) {
    if (activeProjectId !== projectId) return;
    const local = readLocalDocument(projectId);
    state = createTimelineClipEditor(local ?? blankDocument(projectId));
    revision = null;
    setStatus(`Se abrió la copia local: ${messageOf(error)}`, true);
  }
  migrateLegacyMeasurementClips([...media.values()]);
  publishMediaDuration();
  render();
  window.dispatchEvent(new CustomEvent(TIMELINE_MEDIA_LIBRARY_EVENT));
}

function readLocalDocument(projectId: string): TimelineDocumentV2 | null {
  try {
    const value = JSON.parse(localStorage.getItem(localStorageKey(projectId)) || 'null') as TimelineDocumentV2 | null;
    return value?.version === 2 ? value : null;
  } catch {
    return null;
  }
}

function readLegacyDocument(projectId: string): TimelineDocumentV2 | null {
  try {
    if (localStorage.getItem(MIGRATION_KEY)) return null;
    const value = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null') as TimelineDocumentV2 | null;
    if (value?.version !== 2 || value.clips.length === 0) return null;
    localStorage.setItem(MIGRATION_KEY, projectId);
    return { ...value, id: projectId };
  } catch {
    return null;
  }
}

function localStorageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function persistLocal(document: TimelineDocumentV2): void {
  if (!activeProjectId || document.id !== activeProjectId) return;
  localStorage.setItem(localStorageKey(activeProjectId), JSON.stringify(document));
}

function captureToolbarClick(event: Event): void {
  const target = event.composedPath().find((candidate): candidate is HTMLButtonElement => candidate instanceof HTMLButtonElement) ?? null;
  if (!target || target.id === 'timeline-collapse' || target.id === 'timeline-shortcuts') return;
  const actions: Record<string, () => void> = {
    'timeline-v2-ripple': () => { rippleEnabled = !rippleEnabled; render(); },
    'timeline-v2-unlink': unlinkSelection,
    'timeline-v2-director': () => void runTimelineDirector(),
  };
  if (selection.size > 0) Object.assign(actions, {
    'timeline-undo': undo,
    'timeline-redo': redo,
    'timeline-cut': () => { cutEnabled = !cutEnabled; renderToolbar(); },
    'timeline-duplicate': duplicateSelection,
    'timeline-split': splitSelection,
    'timeline-delete': deleteSelection,
  });
  const action = actions[target.id];
  if (!action) return;
  runOnce(event, action);
}

function runOnce(event: Event, action: () => void): void {
  if (handledEvents.has(event)) return;
  handledEvents.add(event);
  const button = event.composedPath().find((candidate): candidate is HTMLButtonElement => candidate instanceof HTMLButtonElement);
  const now = Date.now();
  if (button) {
    const previous = Number(button.dataset.timelineV2HandledAt || 0);
    if (now - previous < 250) return;
    button.dataset.timelineV2HandledAt = String(now);
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  action();
}

function bindOwnButton(selector: string, listener: (event: MouseEvent) => void): void {
  optional<HTMLButtonElement>(selector)?.addEventListener('click', listener);
}

function captureKeyboard(event: KeyboardEvent): void {
  if (selection.size === 0 || event.defaultPrevented || isTyping(event.target)) return;
  const key = event.key.toLowerCase();
  const action = event.ctrlKey || event.metaKey
    ? key === 'z' ? (event.shiftKey ? redo : undo) : key === 'y' ? redo : null
    : key === 'b' ? () => { cutEnabled = !cutEnabled; renderToolbar(); }
        : key === 's' ? () => { snapEnabled = !snapEnabled; renderToolbar(); }
          : key === 'delete' || key === 'backspace' ? deleteSelection
            : null;
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  action();
}

function render(): void {
  renderToolbar();
  renderInspector();
  rebuildPreview();
  window.dispatchEvent(new CustomEvent(UNIFIED_MEDIA_TIMELINE_EVENT));
}

/**
 * Adaptador visual único: el documento de clips conserva su contrato durable,
 * pero sus pistas se pintan dentro de la misma superficie que la autoría.
 */
export function renderUnifiedMediaRows(width: number, pps: number): HTMLElement[] {
  pixelsPerSecond = Math.max(MIN_PPS, Math.min(MAX_PPS, pps));
  const divider = document.createElement('div');
  divider.className = 'authoring-track-divider is-visual unified-media-divider';
  const title = document.createElement('strong');
  title.textContent = 'MEDIOS LIBRES';
  const detail = document.createElement('span');
  detail.textContent = 'Videos y audios independientes · mover, cortar, recortar o borrar dentro de la secuencia';
  divider.append(title, detail);
  return [
    divider,
    ...state.document.tracks
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((track) => trackRow(track, width)),
  ];
}

export function unifiedMediaDurationSeconds(): number {
  return timelineDurationTicks(state.document) / TICKS_PER_SECOND;
}

export function unifiedMediaClipCount(): number {
  return state.document.clips.length;
}

export function unifiedMediaDocument(): TimelineDocumentV2 {
  return structuredClone(state.document);
}

export function unifiedMediaRevision(): string | null {
  return state.document.clips.length ? projectFingerprint(state.document) : null;
}

export function applyUnifiedMediaToolbarState(): void {
  renderToolbar();
}

function trackRow(track: TimelineTrackV2, width: number): HTMLElement {
  const row = document.createElement('div');
  row.className = `timeline-v2-track is-${track.kind}`;
  row.dataset.trackId = track.id;
  row.style.width = `${Math.ceil(width)}px`;
  const label = document.createElement('div');
  label.className = 'timeline-v2-track-label';
  label.textContent = TRACK_LABELS[track.id] || track.id;
  const lane = document.createElement('div');
  lane.className = 'timeline-v2-lane';
  lane.style.width = `${Math.ceil(width)}px`;
  lane.addEventListener('pointerdown', (event) => { if (event.target === lane) seekFromPointer(event, lane); });
  for (const clip of state.document.clips.filter((item) => item.trackId === track.id)) lane.append(clipNode(clip));
  row.append(label, lane);
  return row;
}

function clipNode(clip: TimelineClipV2): HTMLElement {
  const entry = media.get(clip.sourceId);
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `timeline-v2-clip is-${clip.kind}`;
  node.classList.toggle('is-selected', selection.has(clip.id));
  node.classList.toggle('is-disabled', !clip.enabled);
  node.dataset.clipId = clip.id;
  node.style.left = `${clip.timelineStartTick / TICKS_PER_SECOND * pixelsPerSecond}px`;
  node.style.width = `${Math.max(8, clip.durationTicks / TICKS_PER_SECOND * pixelsPerSecond)}px`;
  node.title = `${entry?.name || clip.sourceId}\n${formatTime(clip.timelineStartTick)} – ${formatTime(clip.timelineStartTick + clip.durationTicks)}`;
  const name = document.createElement('strong');
  name.textContent = entry?.name || clip.sourceId;
  const detail = document.createElement('span');
  detail.textContent = `${(clip.durationTicks / TICKS_PER_SECOND).toFixed(2)} s`;
  const left = trimHandle('start');
  const right = trimHandle('end');
  node.append(left, name, detail, right);
  node.addEventListener('click', (event) => {
    if (cutEnabled) {
      const lane = node.parentElement!;
      const tick = pointerTick(event as PointerEvent, lane);
      cutClip(clip, tick);
      return;
    }
    clearProjectSelection();
    if (!(event.ctrlKey || event.metaKey)) selection.clear();
    if (selection.has(clip.id) && (event.ctrlKey || event.metaKey)) selection.delete(clip.id);
    else selection.add(clip.id);
    render();
  });
  node.addEventListener('dblclick', () => {
    playheadTick = clip.timelineStartTick;
    const seconds = playheadTick / TICKS_PER_SECOND;
    setEditorPlayhead(seconds);
    seekEditorPlayback(seconds);
    syncPreview(true);
  });
  node.addEventListener('pointerdown', (event) => startClipDrag(event, clip, node));
  return node;
}

function trimHandle(edge: 'start' | 'end'): HTMLElement {
  const handle = document.createElement('span');
  handle.className = `timeline-v2-trim is-${edge}`;
  handle.dataset.trimEdge = edge;
  handle.setAttribute('aria-hidden', 'true');
  return handle;
}

function startClipDrag(event: PointerEvent, clip: TimelineClipV2, node: HTMLElement): void {
  if (event.button !== 0 || cutEnabled) return;
  const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-trim-edge]')?.dataset.trimEdge as 'start' | 'end' | undefined;
  event.preventDefault();
  event.stopPropagation();
  const originX = event.clientX;
  let lastDelta = 0;
  let targetTrackId = clip.trackId;
  node.setPointerCapture(event.pointerId);
  node.classList.add('is-dragging');
  const move = (current: PointerEvent) => {
    lastDelta = ticksFromPixels(current.clientX - originX, clip.kind === 'visual' || linkedHasVisual(clip));
    const candidate = document.elementFromPoint(current.clientX, current.clientY)?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId;
    const track = state.document.tracks.find((item) => item.id === candidate);
    if (!clip.linkGroupId && track?.kind === clip.kind) targetTrackId = track.id;
    node.style.transform = `translateX(${lastDelta / TICKS_PER_SECOND * pixelsPerSecond}px)`;
  };
  const up = () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    node.classList.remove('is-dragging');
    node.style.transform = '';
    if (lastDelta === 0 && targetTrackId === clip.trackId) return;
    try {
      if (edge) trimClip(clip, edge, lastDelta);
      else moveClip(clip, lastDelta, targetTrackId);
    } catch (error) {
      setStatus(messageOf(error), true);
      render();
    }
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}

function moveClip(clip: TimelineClipV2, delta: number, trackId = clip.trackId): void {
  const next = snapTick(Math.max(0, clip.timelineStartTick + delta), clip.kind === 'visual' || linkedHasVisual(clip), clip);
  if (clip.linkGroupId) dispatch({ type: 'move-linked', linkGroupId: clip.linkGroupId, deltaTicks: next - clip.timelineStartTick });
  else dispatch({ type: 'move-clip', clipId: clip.id, trackId, timelineStartTick: next });
}

function trimClip(clip: TimelineClipV2, edge: 'start' | 'end', delta: number): void {
  const original = edge === 'start' ? clip.timelineStartTick : clip.timelineStartTick + clip.durationTicks;
  const next = snapTick(Math.max(0, original + delta), clip.kind === 'visual' || linkedHasVisual(clip), clip);
  if (clip.linkGroupId) dispatch({ type: 'trim-linked', linkGroupId: clip.linkGroupId, edge, toTimelineTick: next });
  else dispatch({ type: 'trim-clip', clipId: clip.id, edge, toTimelineTick: next });
}

function cutClip(clip: TimelineClipV2, requestedTick: number): void {
  const tick = snapTick(requestedTick, clip.kind === 'visual' || linkedHasVisual(clip), clip);
  try {
    if (clip.linkGroupId) {
      const linked = state.document.clips.filter((item) => item.linkGroupId === clip.linkGroupId);
      const ids = linked.map((item) => ({ clipId: item.id, newClipId: nextId(`${item.id}-b`) }));
      dispatch({ type: 'split-linked', linkGroupId: clip.linkGroupId, atTimelineTick: tick, newClips: ids });
      selection = new Set(ids.map((item) => item.newClipId));
    } else {
      const newClipId = nextId(`${clip.id}-b`);
      dispatch({ type: 'split-clip', clipId: clip.id, atTimelineTick: tick, newClipId });
      selection = new Set([newClipId]);
    }
    render();
  } catch (error) {
    setStatus(messageOf(error), true);
  }
}

function splitSelection(): void {
  const clip = selectedClips()[0];
  if (clip) cutClip(clip, playheadTick);
}

function duplicateSelection(): void {
  const clips = selectedOperationClips();
  if (!clips.length) return;
  const groupId = clips.some((clip) => clip.linkGroupId) ? nextId('link-av-copy') : undefined;
  const duration = Math.max(...clips.map((clip) => clip.durationTicks));
  const start = findAvailableStart(clips.map((clip) => clip.trackId), Math.max(...clips.map((clip) => clip.timelineStartTick + clip.durationTicks)), duration);
  const baseStart = Math.min(...clips.map((clip) => clip.timelineStartTick));
  const commands: TimelineClipCommandV2[] = clips.map((clip) => ({
    type: 'add-clip',
    clip: {
      ...structuredClone(clip),
      id: nextId(`${clip.id}-copy`),
      timelineStartTick: start + clip.timelineStartTick - baseStart,
      ...(groupId ? { linkGroupId: groupId } : {}),
    },
  }));
  dispatchBatch(commands);
  selection = new Set(commands.map((command) => command.type === 'add-clip' ? command.clip.id : '').filter(Boolean));
  render();
}

function deleteSelection(): void {
  const clips = selectedOperationClips().sort((left, right) => right.timelineStartTick - left.timelineStartTick);
  if (!clips.length) return;
  const seenGroups = new Set<string>();
  const commands: TimelineClipCommandV2[] = [];
  for (const clip of clips) {
    if (clip.linkGroupId) {
      if (seenGroups.has(clip.linkGroupId)) continue;
      seenGroups.add(clip.linkGroupId);
      commands.push({ type: 'delete-linked', linkGroupId: clip.linkGroupId, ripple: rippleEnabled });
    } else commands.push({ type: 'delete-clip', clipId: clip.id, ripple: rippleEnabled });
  }
  dispatchBatch(commands);
  selection.clear();
  render();
}

function unlinkSelection(): void {
  const groups = new Set(selectedClips().map((clip) => clip.linkGroupId).filter((value): value is string => Boolean(value)));
  if (groups.size === 0) return;
  dispatchBatch([...groups].map((linkGroupId) => ({ type: 'unlink-group', linkGroupId })));
  setStatus(`${groups.size} grupo(s) desvinculado(s). Cada clip ahora se mueve y recorta por separado.`);
}

function undo(): void { state = undoTimelineClip(state); selection.clear(); changed(); }
function redo(): void { state = redoTimelineClip(state); selection.clear(); changed(); }

function dispatch(command: TimelineClipCommandV2): void {
  state = applyTimelineClipCommand(state, command);
  changed();
}

function dispatchBatch(commands: TimelineClipCommandV2[]): void {
  state = applyTimelineClipCommandBatch(state, commands);
  changed();
}

async function runTimelineDirector(): Promise<void> {
  if (state.document.clips.length === 0) { setStatus('Importá o agregá medios libres antes de pedir cambios.', true); return; }
  const instruction = window.prompt('¿Qué cambio querés hacer en la timeline?');
  if (!instruction?.trim()) return;
  setStatus('El Director está preparando una propuesta para la timeline…');
  try {
    const result = await directTimelineProject(instruction.trim(), state.document);
    if (result.commands.length === 0) { setStatus('El Director no encontró cambios representables.'); return; }
    if (!window.confirm(`${result.explanation}\n\n¿Aplicar ${result.commands.length} cambios como un solo paso de undo?`)) { setStatus('Propuesta de timeline cancelada.'); return; }
    dispatchBatch(result.commands as TimelineClipCommandV2[]);
    setStatus(`Director de timeline: ${result.explanation}`);
  } catch (error) {
    setStatus(messageOf(error), true);
  }
}

function changed(renderNow = true): void {
  invalidateEditorOutput();
  publishMediaDuration();
  let localFailed = false;
  try {
    persistLocal(state.document);
  } catch {
    localFailed = true;
  }
  window.clearTimeout(saveTimer);
  const document = structuredClone(state.document);
  const baseRevision = revision;
  saveTimer = window.setTimeout(() => {
    saveQueue = saveQueue.then(async () => {
      const expectedRevision = state.document.id === document.id ? revision : baseRevision;
      const next = await saveTimelineProject(document, expectedRevision);
      if (state.document.id === document.id) revision = next;
      setStatus(localFailed ? 'Timeline guardada en el servicio local.' : 'Timeline guardada.');
    }).catch((error) => {
      setStatus(`${localFailed ? 'No se pudo guardar' : 'Guardado local'}: ${messageOf(error)}`, true);
    });
  }, 400);
  if (renderNow) render();
}

function publishMediaDuration(): void {
  setExternalEditorMediaDuration(unifiedMediaDurationSeconds());
}

export interface TimelineMediaImportOutcome {
  fileName: string;
  entry?: TimelineMediaEntry;
  created?: boolean;
  error?: string;
}

export async function importMediaFiles(files: FileList | readonly File[] | null): Promise<TimelineMediaImportOutcome[]> {
  if (!files?.length) return [];
  if (!activeProjectId) throw new Error('Abrí un proyecto antes de importar archivos.');
  await timelineProjectReady();
  setStatus('Importando y midiendo con FFprobe…');
  const outcomes: TimelineMediaImportOutcome[] = [];
  const imported: TimelineMediaEntry[] = [];
  for (const file of [...files]) {
    try {
      const result = await uploadTimelineMedia(file);
      media.set(result.entry.id, result.entry);
      imported.push(result.entry);
      outcomes.push({ fileName: file.name, entry: result.entry, created: result.created });
    } catch (error) {
      outcomes.push({ fileName: file.name, error: messageOf(error) });
    }
  }
  if (imported.length) insertMediaEntries(imported);
  window.dispatchEvent(new CustomEvent(TIMELINE_MEDIA_LIBRARY_EVENT, { detail: { outcomes } }));
  const failed = outcomes.filter((outcome) => outcome.error).length;
  setStatus(
    failed
      ? `${imported.length} archivo(s) listos y ${failed} con error. Revisá Archivos.`
      : `${imported.length} archivo(s) listos en la timeline; no se renderizó ningún cuadro.`,
    failed > 0,
  );
  const input = optional<HTMLInputElement>('#timeline-v2-file');
  if (input) input.value = '';
  return outcomes;
}

export async function addExistingTimelineMedia(mediaId: string): Promise<void> {
  await timelineProjectReady();
  const entry = media.get(mediaId);
  if (!entry) throw new Error('El archivo ya no está disponible en la biblioteca local.');
  insertMediaEntries([entry]);
  setStatus(`«${entry.name}» se agregó al final de la timeline.`);
}

export function timelineMediaEntries(): TimelineMediaEntry[] {
  return [...media.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function timelineMediaUsage(mediaId: string): number {
  return state.document.clips.filter((clip) => clip.sourceId === mediaId).length;
}

function insertMediaEntries(entries: TimelineMediaEntry[]): void {
  const plan = planTimelineMediaInsertion(state.document, entries);
  if (!plan.commands.length) return;
  dispatchBatch(plan.commands);
  selection = new Set(plan.clipIds);
  render();
}

function rebuildPreview(): void {
  const currentIds = new Set(state.document.clips.filter((clip) => clip.enabled).map((clip) => clip.id));
  let changed = false;
  for (const [id, element] of previewElements) {
    if (currentIds.has(id)) continue;
    element.pause();
    element.remove();
    previewElements.delete(id);
    activePreviewIds.delete(id);
    previewPlayRequests.delete(id);
    changed = true;
  }
  for (const clip of state.document.clips.filter((item) => item.enabled)) {
    if (previewElements.has(clip.id)) continue;
    const element = document.createElement(clip.kind === 'visual' ? 'video' : 'audio');
    element.preload = 'auto';
    element.src = `/api/timeline/media/${encodeURIComponent(clip.sourceId)}/content`;
    element.dataset.clipId = clip.id;
    if (element instanceof HTMLVideoElement) {
      element.muted = true;
      element.playsInline = true;
      element.className = 'unified-media-video';
      element.style.zIndex = clip.trackId === 'video-track-02' ? '1800' : '0';
    } else {
      element.className = 'unified-media-audio';
    }
    previewElements.set(clip.id, element);
    changed = true;
  }
  if (changed) syncPreview(true);
}

export interface UnifiedMediaPreviewNodes {
  background: HTMLVideoElement[];
  overlays: HTMLVideoElement[];
  audio: HTMLAudioElement[];
}

/** Proyecta los clips libres activos sobre el mismo lienzo semántico. */
export function unifiedMediaPreviewNodes(
  seconds: number,
  isPlaying: boolean,
  isMuted: boolean,
): UnifiedMediaPreviewNodes {
  rebuildPreview();
  playheadTick = Math.max(0, Math.round(seconds * TICKS_PER_SECOND));
  playing = isPlaying;
  muted = isMuted;
  syncPreview();
  const result: UnifiedMediaPreviewNodes = { background: [], overlays: [], audio: [] };
  for (const clip of state.document.clips) {
    const element = previewElements.get(clip.id);
    if (!element || !clip.enabled) continue;
    const activeNow = playheadTick >= clip.timelineStartTick && playheadTick < clip.timelineStartTick + clip.durationTicks;
    if (!activeNow) continue;
    if (element instanceof HTMLVideoElement) {
      (clip.trackId === 'video-track-01' ? result.background : result.overlays).push(element);
    } else result.audio.push(element as HTMLAudioElement);
  }
  return result;
}

function syncPreviewFromEditor(): void {
  const workspace = editorWorkspace();
  playheadTick = Math.max(0, Math.round(editorPlayhead() * TICKS_PER_SECOND));
  playing = workspace.playing;
  muted = workspace.muted;
  syncPreview();
  renderToolbar();
}

function syncPreview(forceSeek = false): void {
  const nextActiveIds = new Set<string>();
  for (const [clipId, element] of previewElements) {
    const clip = state.document.clips.find((item) => item.id === clipId);
    if (!clip) continue;
    const activeNow = playheadTick >= clip.timelineStartTick && playheadTick < clip.timelineStartTick + clip.durationTicks;
    const becameActive = activeNow && !activePreviewIds.has(clipId);
    if (activeNow) nextActiveIds.add(clipId);
    const target = (clip.sourceInTick + playheadTick - clip.timelineStartTick) / TICKS_PER_SECOND;
    if (element instanceof HTMLVideoElement) {
      element.hidden = !activeNow;
      element.style.opacity = String(evaluateTimelineAutomation(clip, 'opacity', playheadTick, 1) ?? 1);
    } else element.volume = muted ? 0 : Math.max(0, Math.min(1, evaluateTimelineAutomation(clip, 'volume', playheadTick, 1) ?? 1));
    if (!activeNow) {
      element.pause();
      continue;
    }
    const drift = Math.abs(element.currentTime - target);
    const driftLimit = playing ? 0.35 : 0.04;
    if (forceSeek || becameActive || drift > driftLimit) {
      try { element.currentTime = Math.max(0, target); } catch { /* metadata todavía no disponible */ }
    }
    if (playing && element.paused && !previewPlayRequests.has(clipId)) {
      previewPlayRequests.add(clipId);
      void element.play().catch(() => {}).finally(() => previewPlayRequests.delete(clipId));
    }
    if (!playing && !element.paused) element.pause();
  }
  activePreviewIds.clear();
  for (const id of nextActiveIds) activePreviewIds.add(id);
}

function seekFromPointer(event: PointerEvent, element: HTMLElement): void {
  playheadTick = Math.max(0, pointerTick(event, element));
  const seconds = playheadTick / TICKS_PER_SECOND;
  setEditorPlayhead(seconds);
  seekEditorPlayback(seconds);
  syncPreview(true);
}

function pointerTick(event: PointerEvent, element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const labelOffset = element.classList.contains('timeline-v2-ruler') ? 180 : 0;
  return Math.round(Math.max(0, event.clientX - rect.left - labelOffset) / pixelsPerSecond * TICKS_PER_SECOND);
}

function renderToolbar(): void {
  const clips = state.document.clips.length > 0;
  setDisabled('#timeline-v2-unlink', !selectedClips().some((clip) => clip.linkGroupId));
  togglePressed('#timeline-v2-ripple', rippleEnabled);
  if (selection.size > 0) {
    setDisabled('#timeline-undo', state.past.length === 0);
    setDisabled('#timeline-redo', state.future.length === 0);
    setDisabled('#timeline-cut', !clips);
    setDisabled('#timeline-duplicate', false);
    setDisabled('#timeline-split', false);
    setDisabled('#timeline-delete', false);
    togglePressed('#timeline-snap', snapEnabled);
    togglePressed('#timeline-cut', cutEnabled);
    const duplicate = optional<HTMLButtonElement>('#timeline-duplicate');
    if (duplicate) duplicate.textContent = 'Duplicar clip';
    const split = optional<HTMLButtonElement>('#timeline-split');
    if (split) split.textContent = 'Cortar clip';
  }
}

function renderInspector(): void {
  const host = optional<HTMLElement>('#editing-tool-host');
  const clip = selectedClips()[0];
  if (!host || !clip) return;
  const entry = media.get(clip.sourceId);
  const card = document.createElement('section');
  card.className = 'editing-card timeline-v2-inspector';
  const title = document.createElement('h3');
  title.textContent = entry?.name || clip.sourceId;
  const meta = document.createElement('p');
  meta.className = 'muted';
  meta.textContent = `${clip.kind === 'visual' ? 'Video' : 'Audio'} · ${formatTime(clip.timelineStartTick)} → ${formatTime(clip.timelineStartTick + clip.durationTicks)} · entrada ${formatTime(clip.sourceInTick)}`;
  const enabled = document.createElement('label');
  enabled.className = 'field-inline';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = clip.enabled;
  checkbox.addEventListener('change', () => dispatch({ type: 'set-clip-enabled', clipId: clip.id, enabled: checkbox.checked }));
  enabled.append(checkbox, document.createTextNode(' Clip habilitado'));
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = clip.linkGroupId ? 'Video y audio enlazados: mover, cortar y recortar conserva su sincronía.' : 'Clip independiente y no destructivo.';
  card.append(title, meta, enabled, note);
  host.replaceChildren(card);
}

function snapTick(value: number, visual: boolean, movingClip?: TimelineClipV2): number {
  let result = visual ? Math.round(value / FRAME_TICKS) * FRAME_TICKS : Math.round(value);
  if (!snapEnabled) return result;
  const excluded = movingClip?.linkGroupId
    ? new Set(state.document.clips.filter((clip) => clip.linkGroupId === movingClip.linkGroupId).map((clip) => clip.id))
    : new Set(movingClip ? [movingClip.id] : []);
  const boundaries = [0, playheadTick, ...state.document.clips.filter((clip) => !excluded.has(clip.id)).flatMap((clip) => [clip.timelineStartTick, clip.timelineStartTick + clip.durationTicks])];
  const nearest = boundaries.reduce((best, tick) => Math.abs(tick - result) < Math.abs(best - result) ? tick : best, boundaries[0]);
  if (Math.abs(nearest - result) <= 8 / pixelsPerSecond * TICKS_PER_SECOND) result = visual ? Math.round(nearest / FRAME_TICKS) * FRAME_TICKS : nearest;
  return Math.max(0, result);
}

function linkedHasVisual(clip: TimelineClipV2): boolean {
  return Boolean(clip.linkGroupId && state.document.clips.some((item) => item.linkGroupId === clip.linkGroupId && item.kind === 'visual'));
}

function selectedClips(): TimelineClipV2[] { return state.document.clips.filter((clip) => selection.has(clip.id)); }

function selectedOperationClips(): TimelineClipV2[] {
  const selected = selectedClips();
  const linkedGroups = new Set(selected.map((clip) => clip.linkGroupId).filter((value): value is string => Boolean(value)));
  return state.document.clips.filter((clip) => selection.has(clip.id) || Boolean(clip.linkGroupId && linkedGroups.has(clip.linkGroupId)));
}

function findAvailableStart(trackIds: string[], requested: number, duration: number): number {
  let start = requested;
  while (true) {
    const collision = state.document.clips.find((clip) => trackIds.includes(clip.trackId)
      && start < clip.timelineStartTick + clip.durationTicks && start + duration > clip.timelineStartTick);
    if (!collision) return start;
    start = collision.timelineStartTick + collision.durationTicks;
  }
}

function nextId(prefix: string): string {
  const clean = prefix.replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+/u, '').slice(0, 52) || 'clip';
  const used = new Set([
    ...state.document.clips.map((clip) => clip.id),
    ...state.document.clips.map((clip) => clip.linkGroupId).filter(Boolean),
  ]);
  for (let counter = 1; counter < 100_000; counter += 1) {
    const candidate = `${clean}-${counter}`.slice(0, 64);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('No se pudo crear un identificador de clip.');
}

function ticksFromPixels(pixels: number, visual: boolean): number {
  const raw = pixels / pixelsPerSecond * TICKS_PER_SECOND;
  return visual ? Math.round(raw / FRAME_TICKS) * FRAME_TICKS : Math.round(raw);
}

function setStatus(message: string, error = false): void {
  const status = optional<HTMLElement>('#timeline-v2-status');
  if (status) { status.textContent = message; status.classList.toggle('is-error', error); }
}

function setDisabled(selector: string, disabled: boolean): void { const button = optional<HTMLButtonElement>(selector); if (button) button.disabled = disabled; }
function togglePressed(selector: string, pressed: boolean): void { const button = optional<HTMLButtonElement>(selector); if (button) { button.classList.toggle('is-active', pressed); button.setAttribute('aria-pressed', String(pressed)); } }
function formatTime(ticks: number): string { const seconds = Math.max(0, ticks) / TICKS_PER_SECOND; return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isTyping(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable); }
