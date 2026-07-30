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

export function normalizeTemplateWord(value, fallback = 'IDEA', maxLength = 24) {
  const normalized = String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, Math.max(1, maxLength));
  return normalized || fallback;
}

function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
