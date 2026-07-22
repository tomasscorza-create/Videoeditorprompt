import { readFileSync } from 'node:fs';

function parsePcm16Wav(file) {
  const buffer = readFileSync(file);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('El archivo no es WAV RIFF válido.');
  }
  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ') {
      format = {
        codec: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bits: buffer.readUInt16LE(start + 14),
      };
    }
    if (id === 'data') data = buffer.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!format || !data || format.codec !== 1 || format.bits !== 16) {
    throw new Error('Se esperaba WAV PCM de 16 bits.');
  }
  return { ...format, data };
}

export function analyzeWav(file, options) {
  const wav = parsePcm16Wav(file);
  const framesPerWindow = Math.max(1, Math.round(wav.sampleRate * options.windowMs / 1000));
  const frameCount = Math.floor(wav.data.length / (2 * wav.channels));
  const levels = [];
  let previous = 0;

  for (let start = 0; start < frameCount; start += framesPerWindow) {
    const end = Math.min(frameCount, start + framesPerWindow);
    let sumSquares = 0;
    let samples = 0;
    for (let frame = start; frame < end; frame += 1) {
      for (let channel = 0; channel < wav.channels; channel += 1) {
        const sample = wav.data.readInt16LE((frame * wav.channels + channel) * 2) / 32768;
        sumSquares += sample * sample;
        samples += 1;
      }
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, samples));
    const smoothed = options.smoothing * previous + (1 - options.smoothing) * rms;
    previous = smoothed;
    levels.push({ start: start / wav.sampleRate, end: end / wav.sampleRate, rms, smoothed });
  }

  const sorted = levels.map((item) => item.smoothed).sort((a, b) => a - b);
  const reference = sorted[Math.floor((sorted.length - 1) * 0.95)] || 1;
  const classified = levels.map((item) => {
    const normalized = Math.min(1, item.smoothed / reference);
    const state = normalized < options.silenceThresholdNormalized
      ? 'closed'
      : normalized < options.openThresholdNormalized ? 'medium' : 'open';
    return { ...item, normalized, state };
  });

  const requiredWindows = Math.max(1, Math.ceil(options.minStateDurationMs / options.windowMs));
  let current = 'closed';
  let candidate = current;
  let candidateCount = 0;
  const stable = [];
  for (const item of classified) {
    if (item.state === current) {
      candidate = current;
      candidateCount = 0;
    } else if (item.state === candidate) {
      candidateCount += 1;
      if (candidateCount >= requiredWindows) current = candidate;
    } else {
      candidate = item.state;
      candidateCount = 1;
    }
    stable.push({ ...item, state: current });
  }

  const cues = [];
  for (const item of stable) {
    const last = cues.at(-1);
    if (last?.state === item.state) last.end = item.end;
    else cues.push({ start: item.start, end: item.end, state: item.state });
  }
  if (cues.length) cues[cues.length - 1].end = frameCount / wav.sampleRate;

  return {
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    durationSeconds: frameCount / wav.sampleRate,
    referenceRms: reference,
    thresholds: {
      silenceNormalized: options.silenceThresholdNormalized,
      openNormalized: options.openThresholdNormalized,
      silenceRms: reference * options.silenceThresholdNormalized,
      openRms: reference * options.openThresholdNormalized,
    },
    windowMs: options.windowMs,
    minStateDurationMs: options.minStateDurationMs,
    levels: classified,
    cues,
  };
}
