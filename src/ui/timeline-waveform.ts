// Capa DOM/audio de la onda de la timeline (A1). Decodifica el audio del MP4 vigente
// una sola vez por `output.url`, lo reduce a picos y los cachea; el dibujo se hace
// desde los picos cacheados en cada render (sobreviven a que renderLayerStack
// reconstruya el DOM). Sin dependencias nuevas: Web Audio + canvas nativos.

import { computePeaks } from './timeline-geometry.js';

export interface WaveformPeaks {
  peaks: Float32Array;
  peaksPerSecond: number;
  durationSeconds: number;
}

const PEAKS_PER_SECOND = 120;

const cache = new Map<string, WaveformPeaks>();
const pending = new Set<string>();
let audioContext: AudioContext | null = null;
let notifyReady: (() => void) | null = null;

function contextClass(): typeof AudioContext | null {
  const scope = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

// Devuelve los picos cacheados para `url`, o null mientras se decodifican. La primera
// llamada por url dispara la decodificación async; al terminar invoca `onReady` para
// que la timeline vuelva a dibujar. Un fallo (sin pista de audio, etc.) se cachea como
// picos vacíos para no reintentar en bucle.
export function requestWaveform(url: string, onReady: () => void): WaveformPeaks | null {
  notifyReady = onReady;
  const cached = cache.get(url);
  if (cached) return cached;
  if (pending.has(url)) return null;
  const Context = contextClass();
  if (!Context) return null;
  pending.add(url);
  void decode(url, Context);
  return null;
}

async function decode(url: string, Context: typeof AudioContext): Promise<void> {
  try {
    audioContext ??= new Context();
    const response = await fetch(url);
    const encoded = await response.arrayBuffer();
    const buffer = await audioContext.decodeAudioData(encoded);
    const buckets = Math.max(1, Math.round(buffer.duration * PEAKS_PER_SECOND));
    cache.set(url, {
      peaks: computePeaks(mixChannels(buffer), buckets),
      peaksPerSecond: PEAKS_PER_SECOND,
      durationSeconds: buffer.duration,
    });
  } catch {
    // Sin audio decodificable: cachear vacío para no reintentar y no romper la UI.
    cache.set(url, { peaks: new Float32Array(0), peaksPerSecond: PEAKS_PER_SECOND, durationSeconds: 0 });
  } finally {
    pending.delete(url);
    notifyReady?.();
  }
}

// Mezcla todos los canales a mono (promedio) para una onda representativa del audio real.
function mixChannels(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels <= 1) return buffer.getChannelData(0);
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) mono[index] += data[index] / channels;
  }
  return mono;
}

// Dibuja la porción de onda del rango [startSeconds, endSeconds] dentro de un canvas del
// tamaño del clip. Solo lee picos cacheados: nunca re-decodifica.
export function drawWaveformSlice(
  canvas: HTMLCanvasElement,
  waveform: WaveformPeaks,
  startSeconds: number,
  endSeconds: number,
  color: string,
): void {
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  if (!context || waveform.peaks.length === 0) return;
  context.scale(ratio, ratio);
  context.fillStyle = color;
  const startBucket = startSeconds * waveform.peaksPerSecond;
  const endBucket = endSeconds * waveform.peaksPerSecond;
  const span = Math.max(1, endBucket - startBucket);
  const middle = height / 2;
  for (let x = 0; x < width; x += 1) {
    const bucket = Math.floor(startBucket + (x / width) * span);
    const peak = waveform.peaks[Math.min(waveform.peaks.length - 1, Math.max(0, bucket))] ?? 0;
    const barHeight = Math.max(0.5, peak * (height - 1));
    context.fillRect(x, middle - barHeight / 2, 1, barHeight);
  }
}
