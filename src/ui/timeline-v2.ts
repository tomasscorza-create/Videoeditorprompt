import {
  TIMELINE_V2_TIMEBASE,
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
import { currentPreviewAudioUrl, editorWorkspace, EDITOR_WORKSPACE_EVENT } from './editor-workspace.js';
import { optional } from './dom.js';
import {
  exportTimelineProject,
  directTimelineProject,
  importTimelineMedia,
  importTimelineMeasurement,
  importTimelineRender,
  listTimelineMedia,
  saveTimelineProject,
  type TimelineMediaEntry,
} from './timeline-v2-api.js';

const STORAGE_KEY = 'local-video.timeline-v2.project';
const MODE_KEY = 'local-video.timeline-v2.active';
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
let active = false;
let state: TimelineClipEditorState = createTimelineClipEditor(blankDocument());
let media = new Map<string, TimelineMediaEntry>();
let selection = new Set<string>();
let playheadTick = 0;
let pixelsPerSecond = 72;
let snapEnabled = true;
let rippleEnabled = false;
let cutEnabled = false;
let muted = false;
let playing = false;
let playbackStartedAt = 0;
let playbackStartTick = 0;
let animationFrame = 0;
let saveTimer = 0;
let revision: string | null = null;
let exporting = false;
const previewElements = new Map<string, HTMLMediaElement>();
const handledEvents = new WeakSet<Event>();

export function initTimelineV2(): void {
  if (initialized) return;
  initialized = true;
  document.body.dataset.timelineEngine = 'clips-v2';
  restoreLocal();
  active = localStorage.getItem(MODE_KEY) !== 'false';
  createPreviewSurface();
  bindOwnButton('#timeline-v2-toggle', (event) => runOnce(event, () => setActive(!active)));
  bindOwnButton('#timeline-v2-import', (event) => runOnce(event, () => optional<HTMLInputElement>('#timeline-v2-file')?.click()));
  bindOwnButton('#timeline-v2-add-render', (event) => runOnce(event, () => void addCurrentRender()));
  bindOwnButton('#timeline-v2-ripple', (event) => runOnce(event, () => { rippleEnabled = !rippleEnabled; render(); }));
  bindOwnButton('#timeline-v2-director', (event) => runOnce(event, () => void runTimelineDirector()));
  bindOwnButton('#timeline-v2-export', (event) => runOnce(event, () => void exportProject()));
  optional<HTMLInputElement>('#timeline-v2-file')?.addEventListener('change', (event) => void importFiles((event.currentTarget as HTMLInputElement).files));
  document.addEventListener('click', captureToolbarClick, true);
  window.addEventListener('keydown', captureKeyboard, true);
  window.addEventListener(EDITOR_WORKSPACE_EVENT, () => { if (active) renderToolbar(); });
  void listTimelineMedia().then((entries) => {
    media = new Map(entries.map((entry) => [entry.id, entry]));
    render();
  }).catch((error) => setStatus(messageOf(error), true));
  setActive(active);
}

function blankDocument(): TimelineDocumentV2 {
  return {
    version: 2,
    id: `montaje-${Date.now().toString(36)}`,
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

function restoreLocal(): void {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as TimelineDocumentV2 | null;
    if (value?.version === 2) state = createTimelineClipEditor(value);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function setActive(value: boolean): void {
  active = value;
  localStorage.setItem(MODE_KEY, String(active));
  document.body.classList.toggle('timeline-v2-active', active);
  const toggle = optional<HTMLButtonElement>('#timeline-v2-toggle');
  if (toggle) {
    toggle.classList.toggle('is-active', active);
    toggle.setAttribute('aria-pressed', String(active));
    toggle.textContent = active ? 'Volver a autoría' : 'Montaje profesional';
  }
  const preview = optional<HTMLElement>('#timeline-v2-preview');
  if (preview) preview.hidden = !active;
  if (!active) {
    pause();
    window.dispatchEvent(new CustomEvent('local-video:editor-workspace'));
    return;
  }
  render();
}

function captureToolbarClick(event: Event): void {
  const target = event.composedPath().find((candidate): candidate is HTMLButtonElement => candidate instanceof HTMLButtonElement) ?? null;
  if (target?.id === 'timeline-v2-toggle') {
    runOnce(event, () => setActive(!active));
    return;
  }
  if (!active) return;
  if (!target || target.id === 'timeline-collapse' || target.id === 'timeline-shortcuts') return;
  const actions: Record<string, () => void> = {
    'timeline-v2-import': () => optional<HTMLInputElement>('#timeline-v2-file')?.click(),
    'timeline-v2-add-render': () => void addCurrentRender(),
    'timeline-v2-ripple': () => { rippleEnabled = !rippleEnabled; render(); },
    'timeline-v2-director': () => void runTimelineDirector(),
    'timeline-v2-export': () => void exportProject(),
    'timeline-undo': undo,
    'timeline-redo': redo,
    'timeline-play': togglePlay,
    'timeline-previous': () => jumpBoundary(-1),
    'timeline-next': () => jumpBoundary(1),
    'timeline-mute': () => { muted = !muted; syncPreview(); renderToolbar(); },
    'timeline-snap': () => { snapEnabled = !snapEnabled; renderToolbar(); },
    'timeline-cut': () => { cutEnabled = !cutEnabled; renderToolbar(); },
    'timeline-duplicate': duplicateSelection,
    'timeline-split': splitSelection,
    'timeline-delete': deleteSelection,
    'timeline-zoom-out': () => zoom(0.8),
    'timeline-zoom-in': () => zoom(1.25),
    'timeline-fit': fit,
  };
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
  if (!active || event.defaultPrevented || isTyping(event.target)) return;
  const key = event.key.toLowerCase();
  const action = event.ctrlKey || event.metaKey
    ? key === 'z' ? (event.shiftKey ? redo : undo) : key === 'y' ? redo : null
    : key === ' ' ? togglePlay
      : key === 'b' ? () => { cutEnabled = !cutEnabled; renderToolbar(); }
        : key === 's' ? () => { snapEnabled = !snapEnabled; renderToolbar(); }
          : key === 'delete' || key === 'backspace' ? deleteSelection
            : key === 'f' ? fit : null;
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  action();
}

function render(): void {
  if (!active) return;
  const root = optional<HTMLElement>('#timeline-layer-stack');
  if (!root) return;
  const document = state.document;
  const duration = Math.max(TICKS_PER_SECOND * 5, timelineDurationTicks(document));
  const width = Math.max(720, duration / TICKS_PER_SECOND * pixelsPerSecond + 180);
  root.hidden = false;
  root.style.setProperty('--timeline-grid-size', `${pixelsPerSecond}px`);
  root.replaceChildren(ruler(width, duration), ...document.tracks
    .slice().sort((left, right) => left.order - right.order)
    .map((track) => trackRow(track, width)));
  root.append(playhead(width, duration));
  renderToolbar();
  renderInspector();
  rebuildPreview();
  const summary = optional<HTMLElement>('#timeline-summary');
  if (summary) summary.textContent = document.clips.length
    ? `${document.clips.length} clip(s) · ${(timelineDurationTicks(document) / TICKS_PER_SECOND).toFixed(2)} s · cortes no destructivos; mover o recortar no vuelve a renderizar.`
    : 'Montaje V2 vacío: importá un MP4, WAV/MP3 o agregá la última exportación del Director.';
}

function ruler(width: number, duration: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'timeline-v2-ruler';
  row.style.width = `${width}px`;
  row.addEventListener('pointerdown', (event) => seekFromPointer(event, row));
  for (let tick = 0; tick <= duration; tick += TICKS_PER_SECOND) {
    const mark = document.createElement('span');
    mark.style.left = `${180 + tick / TICKS_PER_SECOND * pixelsPerSecond}px`;
    mark.textContent = formatTime(tick);
    row.append(mark);
  }
  return row;
}

function trackRow(track: TimelineTrackV2, width: number): HTMLElement {
  const row = document.createElement('div');
  row.className = `timeline-v2-track is-${track.kind}`;
  row.dataset.trackId = track.id;
  row.style.width = `${width}px`;
  const label = document.createElement('div');
  label.className = 'timeline-v2-track-label';
  label.textContent = TRACK_LABELS[track.id] || track.id;
  const lane = document.createElement('div');
  lane.className = 'timeline-v2-lane';
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
    if (!(event.ctrlKey || event.metaKey)) selection.clear();
    if (selection.has(clip.id) && (event.ctrlKey || event.metaKey)) selection.delete(clip.id);
    else selection.add(clip.id);
    render();
  });
  node.addEventListener('dblclick', () => { playheadTick = clip.timelineStartTick; syncPreview(true); renderPlayheadOnly(); });
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
  node.setPointerCapture(event.pointerId);
  node.classList.add('is-dragging');
  const move = (current: PointerEvent) => {
    lastDelta = ticksFromPixels(current.clientX - originX, clip.kind === 'visual' || linkedHasVisual(clip));
    node.style.transform = `translateX(${lastDelta / TICKS_PER_SECOND * pixelsPerSecond}px)`;
  };
  const up = () => {
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerup', up);
    node.removeEventListener('pointercancel', up);
    node.classList.remove('is-dragging');
    node.style.transform = '';
    if (lastDelta === 0) return;
    try {
      if (edge) trimClip(clip, edge, lastDelta);
      else moveClip(clip, lastDelta);
    } catch (error) {
      setStatus(messageOf(error), true);
      render();
    }
  };
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}

function moveClip(clip: TimelineClipV2, delta: number): void {
  const next = snapTick(Math.max(0, clip.timelineStartTick + delta), clip.kind === 'visual' || linkedHasVisual(clip), clip);
  if (clip.linkGroupId) dispatch({ type: 'move-linked', linkGroupId: clip.linkGroupId, deltaTicks: next - clip.timelineStartTick });
  else dispatch({ type: 'move-clip', clipId: clip.id, trackId: clip.trackId, timelineStartTick: next });
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
  if (state.document.clips.length === 0) { setStatus('Importá o agregá medios antes de pedir un montaje.', true); return; }
  const instruction = window.prompt('¿Qué cambio querés hacer en el montaje?');
  if (!instruction?.trim()) return;
  setStatus('El Director está preparando una propuesta de montaje…');
  try {
    const result = await directTimelineProject(instruction.trim(), state.document);
    if (result.commands.length === 0) { setStatus('El Director no encontró cambios representables.'); return; }
    if (!window.confirm(`${result.explanation}\n\n¿Aplicar ${result.commands.length} cambios como un solo paso de undo?`)) { setStatus('Propuesta de montaje cancelada.'); return; }
    dispatchBatch(result.commands as TimelineClipCommandV2[]);
    setStatus(`Director de montaje: ${result.explanation}`);
  } catch (error) {
    setStatus(messageOf(error), true);
  }
}

function changed(renderNow = true): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.document));
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveTimelineProject(state.document, revision)
    .then((next) => { revision = next; if (!exporting) setStatus('Montaje guardado.'); })
    .catch((error) => { revision = null; setStatus(`Guardado local: ${messageOf(error)}`, true); }), 400);
  if (renderNow) render();
}

async function importFiles(files: FileList | null): Promise<void> {
  if (!files?.length) return;
  setStatus('Importando y midiendo con FFprobe…');
  try {
    for (const file of [...files]) addMedia(await importTimelineMedia(file));
    setStatus(`${files.length} medio(s) listos; no se renderizó ningún cuadro.`);
  } catch (error) {
    setStatus(messageOf(error), true);
  } finally {
    const input = optional<HTMLInputElement>('#timeline-v2-file');
    if (input) input.value = '';
  }
}

async function addCurrentRender(): Promise<void> {
  const output = editorWorkspace().output;
  const match = output && /\/api\/render-jobs\/([a-zA-Z0-9_-]{2,64})\/video/u.exec(output.url);
  const measurementMatch = /\/api\/measurement-audio\/(measure-[a-zA-Z0-9_-]{1,56})/u.exec(currentPreviewAudioUrl() || '');
  if (!match && !measurementMatch) return setStatus('Todavía no hay una exportación ni voces medidas para agregar.', true);
  setStatus(match ? 'Separando la exportación en escenas editables…' : 'Vinculando las voces medidas sin sintetizarlas otra vez…');
  try {
    if (match) {
      const ranges = output?.timeline?.scenes.map((scene) => ({ id: scene.id, startSeconds: scene.startSeconds, endSeconds: scene.endSeconds }));
      addMedia(await importTimelineRender(match[1]), ranges);
      setStatus(ranges?.length ? `${ranges.length} escenas agregadas como clips A/V separados y enlazados.` : 'Exportación agregada como video y audio enlazados.');
    } else {
      addMedia(await importTimelineMeasurement(measurementMatch![1]));
      setStatus('Voces agregadas como una fuente WAV inmutable; los cortes no vuelven a llamar a ElevenLabs.');
    }
  } catch (error) {
    setStatus(messageOf(error), true);
  }
}

function addMedia(entry: TimelineMediaEntry, ranges?: Array<{ id: string; startSeconds: number; endSeconds: number }>): void {
  media.set(entry.id, entry);
  const commands: TimelineClipCommandV2[] = [];
  if (!state.document.sources.some((source) => source.id === entry.id)) commands.push({
    type: 'add-source',
    source: { id: entry.id, kind: entry.kind, durationTicks: entry.durationTicks, contentHash: entry.contentHash },
  });
  let start = timelineDurationTicks(state.document);
  if (entry.hasVideo) {
    const sourceRanges = ranges?.length ? ranges : [{ id: 'medio', startSeconds: 0, endSeconds: entry.durationTicks / TICKS_PER_SECOND }];
    for (const range of sourceRanges) {
      const sourceInTick = Math.max(0, Math.round(range.startSeconds * 30) * FRAME_TICKS);
      const sourceEndTick = Math.min(entry.durationTicks, Math.max(sourceInTick + FRAME_TICKS, Math.round(range.endSeconds * 30) * FRAME_TICKS));
      const durationTicks = sourceEndTick - sourceInTick;
      const label = range.id.replace(/[^a-zA-Z0-9_-]+/gu, '-');
      const group = entry.hasAudio ? nextId(`link-${label}`) : undefined;
      commands.push({ type: 'add-clip', clip: {
        id: nextId(`video-${label}`), kind: 'visual', sourceId: entry.id, trackId: 'video-track-01',
        timelineStartTick: start, sourceInTick, durationTicks, enabled: true,
        ...(group ? { linkGroupId: group } : {}),
      } });
      if (entry.hasAudio) commands.push({ type: 'add-clip', clip: {
        id: nextId(`audio-${label}`), kind: 'audio', sourceId: entry.id, trackId: 'audio-track-01',
        timelineStartTick: start, sourceInTick, durationTicks, enabled: true, linkGroupId: group!,
      } });
      start += durationTicks;
    }
  } else commands.push({ type: 'add-clip', clip: {
    id: nextId('audio-clip'), kind: 'audio', sourceId: entry.id, trackId: 'audio-track-01',
    timelineStartTick: start, sourceInTick: 0, durationTicks: entry.durationTicks, enabled: true,
  } });
  dispatchBatch(commands);
}

async function exportProject(): Promise<void> {
  const button = optional<HTMLButtonElement>('#timeline-v2-export');
  exporting = true;
  if (button) button.disabled = true;
  setStatus('Exportando solo los tramos que cambiaron…');
  try {
    const result = await exportTimelineProject(state.document);
    const link = optional<HTMLAnchorElement>('#director-result-download');
    if (link) {
      link.hidden = false;
      link.href = result.videoUrl;
      link.download = result.downloadName;
      link.textContent = 'Descargar montaje MP4';
    }
    setStatus(result.cacheHit
      ? `Exportación lista desde caché (${result.durationSeconds.toFixed(2)} s).`
      : `Exportación lista; ${result.reusedSegments} tramo(s) reutilizados.`);
  } catch (error) {
    setStatus(messageOf(error), true);
  } finally {
    exporting = false;
    if (button) button.disabled = false;
    renderToolbar();
  }
}

function createPreviewSurface(): void {
  const workspace = optional<HTMLElement>('#editor-workspace');
  if (!workspace || optional('#timeline-v2-preview')) return;
  const preview = document.createElement('div');
  preview.id = 'timeline-v2-preview';
  preview.className = 'vertical-stage timeline-v2-preview';
  preview.hidden = true;
  const empty = document.createElement('p');
  empty.className = 'viewer-empty';
  empty.textContent = 'Importá medios para previsualizar el montaje sin renderizar.';
  preview.append(empty);
  workspace.append(preview);
}

function rebuildPreview(): void {
  const preview = optional<HTMLElement>('#timeline-v2-preview');
  if (!preview) return;
  const currentIds = new Set(state.document.clips.filter((clip) => clip.enabled).map((clip) => clip.id));
  for (const [id, element] of previewElements) {
    if (currentIds.has(id)) continue;
    element.pause();
    element.remove();
    previewElements.delete(id);
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
      element.style.zIndex = String((state.document.tracks.find((track) => track.id === clip.trackId)?.order || 0) + 1);
    }
    previewElements.set(clip.id, element);
    preview.append(element);
  }
  preview.querySelector<HTMLElement>('.viewer-empty')?.toggleAttribute('hidden', previewElements.size > 0);
  syncPreview(true);
}

function syncPreview(forceSeek = false): void {
  for (const [clipId, element] of previewElements) {
    const clip = state.document.clips.find((item) => item.id === clipId);
    if (!clip) continue;
    const activeNow = playheadTick >= clip.timelineStartTick && playheadTick < clip.timelineStartTick + clip.durationTicks;
    const target = (clip.sourceInTick + playheadTick - clip.timelineStartTick) / TICKS_PER_SECOND;
    if (element instanceof HTMLVideoElement) {
      element.hidden = !activeNow;
      element.style.opacity = String(evaluateTimelineAutomation(clip, 'opacity', playheadTick, 1) ?? 1);
    } else element.volume = muted ? 0 : Math.max(0, Math.min(1, evaluateTimelineAutomation(clip, 'volume', playheadTick, 1) ?? 1));
    if (!activeNow) {
      element.pause();
      continue;
    }
    if (forceSeek || Math.abs(element.currentTime - target) > 0.08) {
      try { element.currentTime = Math.max(0, target); } catch { /* metadata todavía no disponible */ }
    }
    if (playing && element.paused) void element.play().catch(() => {});
    if (!playing && !element.paused) element.pause();
  }
}

function togglePlay(): void { if (playing) pause(); else play(); }

function play(): void {
  const duration = timelineDurationTicks(state.document);
  if (!duration) return;
  if (playheadTick >= duration) playheadTick = 0;
  playing = true;
  playbackStartTick = playheadTick;
  playbackStartedAt = performance.now();
  syncPreview(true);
  const frame = (now: number) => {
    if (!playing) return;
    playheadTick = Math.min(duration, playbackStartTick + Math.round((now - playbackStartedAt) * 48));
    syncPreview();
    renderPlayheadOnly();
    if (playheadTick >= duration) pause();
    else animationFrame = requestAnimationFrame(frame);
  };
  animationFrame = requestAnimationFrame(frame);
  renderToolbar();
}

function pause(): void {
  playing = false;
  cancelAnimationFrame(animationFrame);
  for (const element of previewElements.values()) element.pause();
  renderToolbar();
}

function jumpBoundary(direction: -1 | 1): void {
  const boundaries = [...new Set(state.document.clips.flatMap((clip) => [clip.timelineStartTick, clip.timelineStartTick + clip.durationTicks]))].sort((a, b) => a - b);
  const next = direction > 0 ? boundaries.find((tick) => tick > playheadTick) : [...boundaries].reverse().find((tick) => tick < playheadTick);
  playheadTick = next ?? (direction > 0 ? timelineDurationTicks(state.document) : 0);
  syncPreview(true);
  renderPlayheadOnly();
}

function seekFromPointer(event: PointerEvent, element: HTMLElement): void {
  pause();
  playheadTick = Math.max(0, pointerTick(event, element));
  syncPreview(true);
  renderPlayheadOnly();
}

function pointerTick(event: PointerEvent, element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const labelOffset = element.classList.contains('timeline-v2-ruler') ? 180 : 0;
  return Math.round(Math.max(0, event.clientX - rect.left - labelOffset) / pixelsPerSecond * TICKS_PER_SECOND);
}

function playhead(width: number, duration: number): HTMLElement {
  const line = document.createElement('span');
  line.id = 'timeline-v2-playhead';
  line.className = 'timeline-v2-playhead';
  line.style.left = `${180 + Math.min(playheadTick, duration) / TICKS_PER_SECOND * pixelsPerSecond}px`;
  line.style.height = `${Math.max(1, state.document.tracks.length) * 44 + 28}px`;
  line.style.maxWidth = `${width}px`;
  return line;
}

function renderPlayheadOnly(): void {
  const line = optional<HTMLElement>('#timeline-v2-playhead');
  if (line) line.style.left = `${180 + playheadTick / TICKS_PER_SECOND * pixelsPerSecond}px`;
  const output = optional<HTMLOutputElement>('#timeline-timecode');
  if (output) output.textContent = `${formatTime(playheadTick)} / ${formatTime(timelineDurationTicks(state.document))}`;
}

function renderToolbar(): void {
  const clips = state.document.clips.length > 0;
  setDisabled('#timeline-undo', state.past.length === 0);
  setDisabled('#timeline-redo', state.future.length === 0);
  setDisabled('#timeline-play', !clips);
  setDisabled('#timeline-previous', !clips);
  setDisabled('#timeline-next', !clips);
  setDisabled('#timeline-mute', !clips);
  setDisabled('#timeline-cut', !clips);
  setDisabled('#timeline-snap', false);
  setDisabled('#timeline-fit', !clips);
  setDisabled('#timeline-zoom-out', false);
  setDisabled('#timeline-zoom-in', false);
  setDisabled('#timeline-duplicate', selection.size === 0);
  setDisabled('#timeline-split', selection.size === 0);
  setDisabled('#timeline-delete', selection.size === 0);
  setDisabled('#timeline-v2-add-render', !editorWorkspace().output && !currentPreviewAudioUrl());
  setDisabled('#timeline-v2-export', !clips || exporting);
  togglePressed('#timeline-snap', snapEnabled);
  togglePressed('#timeline-cut', cutEnabled);
  togglePressed('#timeline-mute', muted);
  togglePressed('#timeline-v2-ripple', rippleEnabled);
  const play = optional<HTMLButtonElement>('#timeline-play');
  if (play) play.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
  const mode = optional<HTMLButtonElement>('#timeline-mode');
  if (mode) { mode.textContent = 'Clips V2'; mode.disabled = true; }
  const measure = optional<HTMLElement>('#timeline-measure');
  if (measure) measure.hidden = true;
  renderPlayheadOnly();
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

function zoom(factor: number): void { pixelsPerSecond = Math.max(MIN_PPS, Math.min(MAX_PPS, pixelsPerSecond * factor)); render(); }

function fit(): void {
  const root = optional<HTMLElement>('#timeline-layer-stack');
  const duration = timelineDurationTicks(state.document) / TICKS_PER_SECOND;
  if (root && duration > 0) pixelsPerSecond = Math.max(MIN_PPS, Math.min(MAX_PPS, (root.clientWidth - 200) / duration));
  render();
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
