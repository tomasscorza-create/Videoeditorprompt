const VISEME_STATES = new Set(['medium', 'open', 'round', 'labiodental', 'bilabial']);

export function buildHybridVisemeCues(text, analysis) {
  const visemes = tokenizeSpanishVisemes(text);
  if (visemes.length === 0 || !Array.isArray(analysis?.levels) || analysis.levels.length === 0) {
    return { source: 'rms-fallback', cues: analysis.cues };
  }
  const voiced = analysis.levels.filter((level) => level.normalized >= analysis.thresholds.silenceNormalized);
  if (voiced.length === 0) return { source: 'rms-fallback', cues: analysis.cues };
  const voicedIndex = new Map(voiced.map((level, index) => [level, index]));
  const classified = analysis.levels.map((level) => {
    if (!voicedIndex.has(level)) return { start: level.start, end: level.end, state: 'closed' };
    const progress = voiced.length === 1 ? 0 : voicedIndex.get(level) / voiced.length;
    const tokenIndex = Math.min(visemes.length - 1, Math.floor(progress * visemes.length));
    return { start: level.start, end: level.end, state: visemes[tokenIndex] };
  });
  const cues = mergeCues(classified);
  return {
    source: 'hybrid-grapheme-rms-v1',
    cues,
    visemes,
  };
}

export function tokenizeSpanishVisemes(text) {
  const normalized = String(text)
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '');
  const states = [];
  for (const character of normalized) {
    let state = null;
    if ('mbp'.includes(character)) state = 'bilabial';
    else if ('fv'.includes(character)) state = 'labiodental';
    else if ('ouw'.includes(character)) state = 'round';
    else if (character === 'a') state = 'open';
    else if (/[a-zñ]/u.test(character)) state = 'medium';
    if (state && VISEME_STATES.has(state) && states.at(-1) !== state) states.push(state);
  }
  return states;
}

function mergeCues(items) {
  const cues = [];
  for (const item of items) {
    const last = cues.at(-1);
    if (last?.state === item.state) last.end = item.end;
    else cues.push({ ...item });
  }
  return cues;
}
