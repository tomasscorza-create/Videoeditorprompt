// Evaluador temporal puro compartido por preview y un futuro exportador headless.
// Cada corte se resuelve desde frameIndex / fps: nunca acumula deltas.

/**
 * @param {{ durationSeconds: number, fps: number, cutFrames: number, sequence: number[] }} definition
 * @param {number} seconds
 */
export function evaluateWordMatchCut(definition, seconds) {
  const durationSeconds = positive(definition?.durationSeconds, 2.4);
  const fps = positive(definition?.fps, 30);
  const cutFrames = Math.max(1, Math.floor(positive(definition?.cutFrames, 5)));
  const sequence = Array.isArray(definition?.sequence) && definition.sequence.length
    ? definition.sequence
    : [0];
  const loopFrameCount = Math.max(1, Math.round(durationSeconds * fps));
  const frameIndex = Math.max(0, Math.floor(Math.max(0, seconds) * fps));
  const loopFrame = frameIndex % loopFrameCount;
  const cutIndex = Math.min(sequence.length - 1, Math.floor(loopFrame / cutFrames));
  const frameWithinCut = loopFrame - cutIndex * cutFrames;
  const cutProgress = frameWithinCut / cutFrames;
  const settle = 1 - Math.min(1, cutProgress / 0.34);
  const direction = cutIndex % 2 === 0 ? 1 : -1;
  return Object.freeze({
    frameIndex,
    loopFrame,
    cutIndex,
    sourceIndex: sequence[cutIndex],
    frameWithinCut,
    cutProgress,
    scale: 1.045 + cutProgress * 0.018,
    offsetX: direction * settle * 4.2,
    offsetY: -settle * 3.2,
    rotationDegrees: direction * settle * 0.32,
    flashOpacity: Math.max(0, 1 - cutProgress / 0.16) * 0.12,
    // El fibrón se traza una sola vez a lo largo del efecto: si dependiera del
    // corte se redibujaría en cada página y leería como parpadeo.
    underlineProgress: Math.min(1, (loopFrame / loopFrameCount) / 0.34),
  });
}

/** Evalúa tarjetas procedurales siempre desde frameIndex / fps. */
export function evaluateMotionCard(definition, seconds) {
  const durationSeconds = positive(definition?.durationSeconds, 3.2);
  const fps = positive(definition?.fps, 30);
  const loopFrameCount = Math.max(1, Math.round(durationSeconds * fps));
  const frameIndex = Math.max(0, Math.floor(Math.max(0, seconds) * fps));
  const loopFrame = frameIndex % loopFrameCount;
  const progress = loopFrame / loopFrameCount;
  const enter = smoothstep(0, 0.18, progress);
  const exit = 1 - smoothstep(0.82, 1, progress);
  const visibility = Math.min(enter, exit);
  const itemProgress = [0, 1, 2].map((index) => smoothstep(0.12 + index * 0.1, 0.31 + index * 0.1, progress) * exit);
  return Object.freeze({
    frameIndex,
    loopFrame,
    progress,
    opacity: visibility,
    scale: 0.92 + enter * 0.08 - (1 - exit) * 0.035,
    offsetY: (1 - enter) * 90 - (1 - exit) * 65,
    accentProgress: smoothstep(0.18, 0.66, progress) * exit,
    pulse: 0.5 + Math.sin(progress * Math.PI * 4) * 0.5,
    comparisonBalance: 0.5 + Math.sin(progress * Math.PI * 2) * 0.08,
    itemProgress: Object.freeze(itemProgress),
  });
}

export function normalizeTemplateWord(value, fallback = 'IDEA', maxLength = 24) {
  const limit = Math.max(1, Math.floor(maxLength));
  const normalized = String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  const fallbackValue = String(fallback ?? 'IDEA').replace(/\s+/gu, ' ').trim() || 'IDEA';
  const source = normalized || fallbackValue;
  if (source.length <= limit) return source;
  const clipped = source.slice(0, limit).trimEnd();
  if (/\s/u.test(source.charAt(limit))) return clipped;
  const boundary = clipped.lastIndexOf(' ');
  return boundary >= Math.ceil(limit * 0.4) ? clipped.slice(0, boundary) : clipped;
}

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function smoothstep(from, to, value) {
  const normalized = Math.max(0, Math.min(1, (value - from) / Math.max(0.000001, to - from)));
  return normalized * normalized * (3 - 2 * normalized);
}
