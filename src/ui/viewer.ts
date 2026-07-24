import { optional } from './dom.js';
import { setTimelineSource } from './timeline.js';

export type ViewerSource = 'composition' | 'preview' | 'final' | 'character';

const context: Record<ViewerSource, string> = {
  composition: 'Seleccioná y arrastrá personajes. Flechas ajustan posición; Ctrl + rueda cambia escala. Voz, boca y tiempos se miden al renderizar.',
  preview: 'Preview medido de una escena publicada; usa el mismo evaluador temporal que la exportación.',
  final: 'MP4 final producido y verificado por el pipeline local.',
  character: 'Vista de autoría. El guardado compila estas capas al rig animable local.',
};

export function initViewerSources(): void {
  for (const source of ['composition', 'preview', 'final', 'character'] as ViewerSource[]) {
    optional<HTMLButtonElement>(`#source-${source}`)?.addEventListener('click', () => showViewerSource(source));
  }
}

export function setViewerSourceAvailable(source: ViewerSource, available = true): void {
  const button = optional<HTMLButtonElement>(`#source-${source}`);
  if (button) button.disabled = !available;
}

export function showViewerSource(source: ViewerSource): void {
  const requested = optional<HTMLButtonElement>(`#source-${source}`);
  if (requested?.disabled) return;
  for (const candidate of ['composition', 'preview', 'final', 'character'] as ViewerSource[]) {
    const active = candidate === source;
    const button = optional<HTMLButtonElement>(`#source-${candidate}`);
    const view = optional<HTMLElement>(`#${candidate}-view`);
    button?.classList.toggle('is-active', active);
    button?.setAttribute('aria-selected', String(active));
    if (view) view.hidden = !active;
  }
  const controls = optional<HTMLElement>('#preview-controls');
  if (controls) controls.hidden = source !== 'preview';
  const title = optional<HTMLElement>('#viewer-title');
  if (title) {
    title.textContent = source === 'composition'
      ? 'Composición editable'
      : source === 'preview'
        ? 'Preview medido'
        : source === 'final'
          ? 'Video final'
          : 'Diseñador de personaje';
  }
  const description = optional<HTMLElement>('#viewer-context');
  if (description) description.textContent = context[source];
  const download = optional<HTMLAnchorElement>('#director-result-download');
  if (download) download.hidden = source !== 'final' || !download.href;
  if (source !== 'character') setTimelineSource(source);
}

export function showFinalVideo(url: string, downloadName: string): void {
  const video = optional<HTMLVideoElement>('#director-result-video');
  const download = optional<HTMLAnchorElement>('#director-result-download');
  if (!video || !download) return;
  video.src = url;
  download.href = url;
  download.download = downloadName;
  download.hidden = false;
  setViewerSourceAvailable('final');
  showViewerSource('final');
}
