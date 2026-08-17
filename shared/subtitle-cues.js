const SHORT_SUBTITLE_MIN_WORDS = 2;
const SHORT_SUBTITLE_MAX_WORDS = 3;

function wordsOf(text) {
  return String(text ?? '').trim().split(/\s+/u).filter(Boolean);
}

function endsPhrase(word) {
  return /[.!?;:…][»”"')\]]*$/u.test(word);
}

/**
 * Divide un texto en bloques de dos o tres palabras sin introducir saltos de
 * línea. Solo un texto que contenga una única palabra produce un bloque de una.
 */
export function segmentSubtitleText(text) {
  const words = wordsOf(text);
  const segments = [];
  let cursor = 0;
  while (cursor < words.length) {
    const remaining = words.length - cursor;
    let size;
    if (remaining <= SHORT_SUBTITLE_MAX_WORDS) {
      size = remaining;
    } else if (remaining === 4) {
      size = SHORT_SUBTITLE_MIN_WORDS;
    } else if (endsPhrase(words[cursor + 1])) {
      size = SHORT_SUBTITLE_MIN_WORDS;
    } else {
      size = SHORT_SUBTITLE_MAX_WORDS;
    }
    segments.push(words.slice(cursor, cursor + size).join(' '));
    cursor += size;
  }
  return segments;
}

/**
 * Reparte la duración medida del turno según la cantidad de palabras de cada
 * bloque. No estima la duración del audio: solo subdivide el WAV ya medido.
 */
export function buildSubtitleCues(text, durationSeconds) {
  const segments = segmentSubtitleText(text);
  if (segments.length === 0) return [];
  const totalWords = segments.reduce((total, segment) => total + wordsOf(segment).length, 0);
  let elapsedWords = 0;
  return segments.map((segment, index) => {
    const wordCount = wordsOf(segment).length;
    const startSeconds = durationSeconds * elapsedWords / totalWords;
    elapsedWords += wordCount;
    const endSeconds = index === segments.length - 1
      ? durationSeconds
      : durationSeconds * elapsedWords / totalWords;
    return { text: segment, wordCount, startSeconds, endSeconds };
  });
}

export function subtitleCueAt(cues, timeSeconds) {
  return cues.find((cue) => timeSeconds >= cue.startSeconds && timeSeconds < cue.endSeconds) ?? null;
}
