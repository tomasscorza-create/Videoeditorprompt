import type { PreviewHandle } from '../preview/types.js';
import { optional } from './dom.js';

// Escala temporal configurable: los anchos derivan de datos medidos por el motor,
// nunca de un ancho fijo tomado como estado definitivo.
export const DEFAULT_PIXELS_PER_SECOND = 100;

// Ancho de la columna de etiquetas (V1/A1) desde donde arranca el tiempo cero.
const TRACK_LABEL_OFFSET_PX = 80;
const MIN_CLIP_WIDTH_PX = 2;

export interface TimelineOptions {
  pixelsPerSecond?: number;
}

export interface TimelineHandle {
  setPlayhead(timeSeconds: number): void;
}

export function initTimeline(handle: PreviewHandle, options: TimelineOptions = {}): TimelineHandle {
  const pixelsPerSecond = options.pixelsPerSecond ?? DEFAULT_PIXELS_PER_SECOND;
  const playhead = optional<HTMLElement>('#playhead');

  renderSceneClip(handle, pixelsPerSecond);
  renderDialogueClips(handle, pixelsPerSecond);
  renderRuler(handle.durationSeconds, pixelsPerSecond);

  return {
    setPlayhead(timeSeconds: number): void {
      if (!playhead) return;
      playhead.style.transform = `translateX(${timeSeconds * pixelsPerSecond + TRACK_LABEL_OFFSET_PX}px)`;
    },
  };
}

function clipWidth(seconds: number, pixelsPerSecond: number): string {
  return `${Math.max(MIN_CLIP_WIDTH_PX, seconds * pixelsPerSecond)}px`;
}

// Una escena por ahora: el contrato v2 representa exactamente una escena.
// La lista multiescena llega con project.scenes en el Hito 3.
function renderSceneClip(handle: PreviewHandle, pixelsPerSecond: number): void {
  const track = optional<HTMLElement>('.timeline-track-v .track-content');
  if (!track) return;
  track.style.position = 'relative';
  const clip = document.createElement('div');
  clip.className = 'clip-dummy video-clip';
  clip.style.position = 'absolute';
  clip.style.left = '0px';
  clip.style.width = clipWidth(handle.durationSeconds, pixelsPerSecond);
  clip.textContent = 'Escena actual';
  clip.title = `Escena actual · ${handle.durationSeconds.toFixed(2)} s medidos`;
  track.replaceChildren(clip);
}

// Turnos de diálogo con tiempos medidos por el motor (FFprobe), no estimados.
function renderDialogueClips(handle: PreviewHandle, pixelsPerSecond: number): void {
  const track = optional<HTMLElement>('.timeline-track-a .track-content');
  if (!track) return;
  track.style.position = 'relative';

  if (!handle.turns?.length) {
    const clip = document.createElement('div');
    clip.className = 'clip-dummy audio-clip';
    clip.style.position = 'absolute';
    clip.style.left = '0px';
    clip.style.width = clipWidth(handle.durationSeconds, pixelsPerSecond);
    clip.textContent = 'Voz (audio generado)';
    track.replaceChildren(clip);
    return;
  }

  track.replaceChildren(...handle.turns.map((turn) => {
    const clip = document.createElement('div');
    clip.className = 'clip-dummy audio-clip';
    clip.style.position = 'absolute';
    clip.style.left = `${turn.startSeconds * pixelsPerSecond}px`;
    clip.style.width = clipWidth(turn.durationSeconds, pixelsPerSecond);
    clip.textContent = turn.speakerId;
    clip.title = `${turn.speakerId} · ${turn.startSeconds.toFixed(2)}–${turn.endSeconds.toFixed(2)} s`;
    return clip;
  }));
}

function renderRuler(durationSeconds: number, pixelsPerSecond: number): void {
  const marks = optional<HTMLElement>('.ruler-marks');
  if (!marks) return;
  const step = durationSeconds > 60 ? 10 : durationSeconds > 20 ? 5 : 1;
  const nodes: HTMLElement[] = [];
  for (let second = 0; second <= Math.ceil(durationSeconds); second += step) {
    const mark = document.createElement('span');
    mark.className = 'ruler-mark';
    mark.style.position = 'absolute';
    mark.style.left = `${second * pixelsPerSecond + TRACK_LABEL_OFFSET_PX}px`;
    mark.textContent = `${second}s`;
    nodes.push(mark);
  }
  marks.style.position = 'relative';
  marks.replaceChildren(...nodes);
}
