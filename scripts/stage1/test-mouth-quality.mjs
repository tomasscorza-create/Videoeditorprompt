import assert from 'node:assert/strict';
import path from 'node:path';
import { stabilizeMouthStates } from './audio-analysis.mjs';
import { projectRoot, writeJson } from './common.mjs';
import { normalizeSpanishTtsText } from './tts-text.mjs';
import { buildHybridVisemeCues, tokenizeSpanishVisemes } from './viseme-analysis.mjs';

function windows(states, windowSeconds = 0.03) {
  return states.map((state, index) => ({
    start: index * windowSeconds,
    end: (index + 1) * windowSeconds,
    state,
  }));
}

const results = [];
const confirmed = stabilizeMouthStates(windows(['medium', 'medium', 'medium']), 90);
assert.deepEqual(confirmed.map((item) => item.state), ['medium', 'medium', 'medium']);
results.push({ name: 'confirmed-transition-is-backdated', passed: true });

const pulse = stabilizeMouthStates(windows(['medium', 'medium', 'medium', 'open', 'medium', 'medium']), 90);
assert.ok(pulse.every((item) => item.state === 'medium'));
results.push({ name: 'short-open-pulse-is-removed', passed: true });

const trailingSilence = stabilizeMouthStates(windows(['medium', 'medium', 'medium', 'closed']), 90);
assert.equal(trailingSilence.at(-1).state, 'closed');
results.push({ name: 'trailing-silence-closes-mouth', passed: true });

assert.equal(
  normalizeSpanishTtsText('  La voz usa 20% & termina sin punto  '),
  'La voz usa 20 por ciento y termina sin punto.',
);
results.push({ name: 'spanish-tts-text-normalized', passed: true });

assert.deepEqual(
  tokenizeSpanishVisemes('Mamá fue poco útil.'),
  ['bilabial', 'open', 'bilabial', 'open', 'labiodental', 'round', 'medium', 'bilabial', 'round', 'medium', 'round', 'medium'],
);
results.push({ name: 'spanish-graphemes-map-to-six-visemes', passed: true });

const levels = Array.from({ length: 16 }, (_, index) => ({
  start: index * 0.03,
  end: (index + 1) * 0.03,
  normalized: index < 2 || index > 13 ? 0 : 0.8,
}));
const hybrid = buildHybridVisemeCues('Mamá fue.', {
  levels,
  cues: [{ start: 0, end: 0.48, state: 'medium' }],
  thresholds: { silenceNormalized: 0.12 },
});
assert.equal(hybrid.source, 'hybrid-grapheme-rms-v1');
assert.equal(hybrid.cues[0].state, 'closed');
assert.ok(hybrid.cues.some((cue) => cue.state === 'bilabial'));
assert.ok(hybrid.cues.some((cue) => cue.state === 'labiodental'));
assert.equal(hybrid.cues.at(-1).state, 'closed');
results.push({ name: 'hybrid-visemes-follow-rms-voice-boundaries', passed: true });

const summary = { version: 1, executedAt: new Date().toISOString(), passed: results.length, failed: 0, results };
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'mouth-quality-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
