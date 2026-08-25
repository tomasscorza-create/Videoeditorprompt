import { optional } from '../dom.js';
import { notify } from '../notifications.js';
import { showRightPanelPage } from '../right-panel.js';
import {
  addExistingTimelineMedia,
  importMediaFiles,
  TIMELINE_MEDIA_LIBRARY_EVENT,
  timelineMediaEntries,
  timelineMediaUsage,
  type TimelineMediaImportOutcome,
} from '../timeline-v2.js';
import type { TimelineMediaEntry } from '../timeline-v2-api.js';

let initialized = false;

export function initMediaFilesPanel(): void {
  if (initialized) return;
  initialized = true;
  const dropzone = optional<HTMLButtonElement>('#media-files-dropzone');
  const importButton = optional<HTMLButtonElement>('#media-files-import');
  const input = optional<HTMLInputElement>('#timeline-v2-file');
  const list = optional<HTMLElement>('#media-files-list');
  if (!dropzone || !importButton || !input || !list) return;
  let filter: 'all' | 'video' | 'audio' = 'all';
  let busy = false;
  let dragDepth = 0;

  const render = (): void => {
    const entries = timelineMediaEntries()
      .filter((entry) => !/^measure-.+-preview\.wav$/iu.test(entry.name))
      .filter((entry) => filter === 'all' || entry.kind === filter);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'media-files-empty';
      const title = document.createElement('strong');
      title.textContent = filter === 'all' ? 'Todavía no hay archivos' : `No hay archivos de ${filter === 'video' ? 'video' : 'audio'}`;
      const copy = document.createElement('span');
      copy.textContent = filter === 'all'
        ? 'Arrastrá videos o audios para sumarlos a este proyecto.'
        : 'Cambiá el filtro o importá otro archivo.';
      empty.append(title, copy);
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...entries.map(mediaCard));
  };

  const mediaCard = (entry: TimelineMediaEntry): HTMLElement => {
    const card = document.createElement('article');
    card.className = `media-file-card is-${entry.kind}`;
    card.dataset.mediaId = entry.id;
    const kind = document.createElement('span');
    kind.className = 'media-file-kind';
    kind.textContent = entry.kind === 'video' ? 'VIDEO' : 'AUDIO';
    const copy = document.createElement('div');
    copy.className = 'media-file-copy';
    const name = document.createElement('strong');
    name.textContent = entry.name;
    name.title = entry.name;
    const meta = document.createElement('span');
    meta.textContent = mediaMeta(entry);
    copy.append(name, meta);
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'media-file-add';
    action.textContent = 'Agregar';
    action.title = 'Agregar otra instancia al final de la timeline';
    action.addEventListener('click', async () => {
      action.disabled = true;
      try {
        await addExistingTimelineMedia(entry.id);
        setStatus(`«${entry.name}» se agregó a la timeline.`);
        render();
      } catch (error) {
        reportError(error);
      } finally {
        action.disabled = false;
      }
    });
    const usage = timelineMediaUsage(entry.id);
    if (usage > 0) {
      const count = document.createElement('span');
      count.className = 'media-file-usage';
      count.textContent = `${usage} clip${usage === 1 ? '' : 's'}`;
      copy.append(count);
    }
    card.append(kind, copy, action);
    return card;
  };

  async function handleFiles(files: FileList | readonly File[] | null): Promise<void> {
    if (!files?.length || busy) return;
    busy = true;
    importButton!.disabled = true;
    dropzone!.disabled = true;
    setStatus(`Importando ${files.length} archivo${files.length === 1 ? '' : 's'} y midiendo su duración…`);
    try {
      const outcomes = await importMediaFiles(files);
      reportOutcomes(outcomes);
      render();
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
      importButton!.disabled = false;
      dropzone!.disabled = false;
      input!.value = '';
    }
  }

  importButton.addEventListener('click', () => input.click());
  dropzone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => void handleFiles(input.files));
  dropzone.addEventListener('dragenter', (event) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth += 1;
    dropzone.classList.add('is-drag-over');
  });
  dropzone.addEventListener('dragover', (event) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  dropzone.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('is-drag-over');
  });
  dropzone.addEventListener('drop', (event) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('is-drag-over');
    void handleFiles(event.dataTransfer?.files ?? null);
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-media-filter]')) {
    button.addEventListener('click', () => {
      filter = button.dataset.mediaFilter as typeof filter;
      for (const candidate of document.querySelectorAll<HTMLButtonElement>('[data-media-filter]')) {
        const selected = candidate === button;
        candidate.classList.toggle('is-active', selected);
        candidate.setAttribute('aria-pressed', String(selected));
      }
      render();
    });
  }
  window.addEventListener(TIMELINE_MEDIA_LIBRARY_EVENT, render);
  render();
}

export function openMediaFilesPanel(): void {
  showRightPanelPage('files');
}

function hasFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && Array.from(transfer.types).includes('Files'));
}

function reportOutcomes(outcomes: TimelineMediaImportOutcome[]): void {
  const failed = outcomes.filter((outcome) => outcome.error);
  const imported = outcomes.length - failed.length;
  if (failed.length === 0) {
    setStatus(`${imported} archivo${imported === 1 ? '' : 's'} listo${imported === 1 ? '' : 's'} y agregado${imported === 1 ? '' : 's'} a la timeline.`);
    return;
  }
  const detail = failed.map((outcome) => `${outcome.fileName}: ${outcome.error}`).join(' ');
  setStatus(`${imported} listo${imported === 1 ? '' : 's'}; ${failed.length} no se pudo importar. ${detail}`, true);
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(message, true);
  notify({ message, level: 'error' });
}

function setStatus(message: string, error = false): void {
  const status = optional<HTMLElement>('#media-files-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function mediaMeta(entry: TimelineMediaEntry): string {
  const duration = formatDuration(entry.durationSeconds);
  const size = formatBytes(entry.bytes);
  if (entry.kind === 'video') return `${duration} · ${entry.width ?? '?'} × ${entry.height ?? '?'} · ${size}`;
  return `${duration} · ${entry.sampleRate ? `${Math.round(entry.sampleRate / 1000)} kHz` : 'audio'} · ${size}`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const rest = Math.round(safe % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
