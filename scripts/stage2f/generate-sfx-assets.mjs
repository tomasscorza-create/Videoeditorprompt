import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, parseArguments, projectRoot } from '../stage1/common.mjs';

export const SFX_SAMPLE_RATE = 48_000;

export const SFX_PROFILES = Object.freeze([
  { id: 'sfx-click-suave-v1', file: 'click-soft-v1.wav', label: 'Click suave', category: 'interface', durationSeconds: 0.12, gainDb: -8, synth: 'click', seed: 1101 },
  { id: 'sfx-pop-positivo-v1', file: 'pop-positive-v1.wav', label: 'Pop positivo', category: 'accent', durationSeconds: 0.28, gainDb: -6, synth: 'pop', seed: 1201 },
  { id: 'sfx-whoosh-corto-v1', file: 'whoosh-short-v1.wav', label: 'Whoosh corto', category: 'transition', durationSeconds: 0.46, gainDb: -7, synth: 'whoosh-short', seed: 1301 },
  { id: 'sfx-whoosh-ascendente-v1', file: 'whoosh-rise-v1.wav', label: 'Whoosh ascendente', category: 'transition', durationSeconds: 0.78, gainDb: -8, synth: 'whoosh-rise', seed: 1401 },
  { id: 'sfx-impacto-suave-v1', file: 'impact-soft-v1.wav', label: 'Impacto suave', category: 'impact', durationSeconds: 0.38, gainDb: -8, synth: 'impact-soft', seed: 1501 },
  { id: 'sfx-impacto-profundo-v1', file: 'impact-deep-v1.wav', label: 'Impacto profundo', category: 'impact', durationSeconds: 0.62, gainDb: -10, synth: 'impact-deep', seed: 1601 },
  { id: 'sfx-destello-v1', file: 'sparkle-v1.wav', label: 'Destello', category: 'accent', durationSeconds: 0.92, gainDb: -9, synth: 'sparkle', seed: 1701 },
  { id: 'sfx-alerta-limpia-v1', file: 'alert-clean-v1.wav', label: 'Alerta limpia', category: 'interface', durationSeconds: 0.68, gainDb: -9, synth: 'alert', seed: 1801 },
]);

export function generateSfxAssets({ outputRoot = path.join(projectRoot, 'public', 'assets', 'audio', 'sfx') } = {}) {
  mkdirSync(outputRoot, { recursive: true });
  return SFX_PROFILES.map((profile) => {
    const samples = synthesize(profile);
    const file = path.join(outputRoot, profile.file);
    writeFileSync(file, wavBuffer(samples, SFX_SAMPLE_RATE));
    return { ...profile, file };
  });
}

function synthesize(profile) {
  const count = Math.round(profile.durationSeconds * SFX_SAMPLE_RATE);
  const values = new Float64Array(count);
  const random = seededRandom(profile.seed);
  let filteredNoise = 0;
  for (let index = 0; index < count; index += 1) {
    const time = index / SFX_SAMPLE_RATE;
    const progress = index / Math.max(1, count - 1);
    const noise = random() * 2 - 1;
    filteredNoise += (noise - filteredNoise) * (0.035 + progress * 0.18);
    let value = 0;
    if (profile.synth === 'click') {
      value = Math.sin(Math.PI * 2 * (1350 * time + 1200 * time * time)) * Math.exp(-time * 42)
        + noise * 0.16 * Math.exp(-time * 70);
    } else if (profile.synth === 'pop') {
      const frequency = 330 + 720 * progress;
      value = Math.sin(Math.PI * 2 * frequency * time) * Math.sin(Math.PI * progress) ** 1.4;
    } else if (profile.synth === 'whoosh-short' || profile.synth === 'whoosh-rise') {
      const envelope = Math.sin(Math.PI * progress) ** (profile.synth === 'whoosh-rise' ? 1.2 : 0.75);
      const tone = Math.sin(Math.PI * 2 * (180 + progress * (profile.synth === 'whoosh-rise' ? 760 : 320)) * time);
      value = (filteredNoise * 1.2 + tone * 0.18) * envelope;
    } else if (profile.synth === 'impact-soft' || profile.synth === 'impact-deep') {
      const start = profile.synth === 'impact-deep' ? 92 : 145;
      const end = profile.synth === 'impact-deep' ? 42 : 75;
      const frequency = start + (end - start) * progress;
      const decay = Math.exp(-time * (profile.synth === 'impact-deep' ? 7 : 12));
      value = Math.sin(Math.PI * 2 * frequency * time) * decay
        + filteredNoise * 0.34 * Math.exp(-time * 28);
    } else if (profile.synth === 'sparkle') {
      const chimes = [
        { at: 0, frequency: 1320 },
        { at: 0.13, frequency: 1760 },
        { at: 0.27, frequency: 2200 },
        { at: 0.42, frequency: 2640 },
      ];
      value = chimes.reduce((sum, chime) => {
        const local = time - chime.at;
        return local < 0 ? sum : sum + Math.sin(Math.PI * 2 * chime.frequency * local) * Math.exp(-local * 10);
      }, 0) * 0.42;
    } else if (profile.synth === 'alert') {
      const first = toneBurst(time, 0, 0.22, 740);
      const second = toneBurst(time, 0.28, 0.3, 988);
      value = first + second;
    }
    values[index] = value;
  }
  const peak = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0) || 1;
  const pcm = Buffer.alloc(count * 2);
  for (let index = 0; index < count; index += 1) {
    const normalized = Math.max(-1, Math.min(1, values[index] / peak * 0.86));
    pcm.writeInt16LE(Math.round(normalized * 32767), index * 2);
  }
  return pcm;
}

function toneBurst(time, start, duration, frequency) {
  const local = time - start;
  if (local < 0 || local >= duration) return 0;
  const envelope = Math.sin(Math.PI * local / duration) ** 1.5;
  return Math.sin(Math.PI * 2 * frequency * local) * envelope * 0.7;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function wavBuffer(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

if (isMain(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const outputRoot = path.resolve(projectRoot, String(args['output-dir'] || 'public/assets/audio/sfx'));
  const generated = generateSfxAssets({ outputRoot });
  process.stdout.write(`${JSON.stringify({
    version: 1,
    sampleRate: SFX_SAMPLE_RATE,
    effects: generated.map(({ id, file, category, durationSeconds }) => ({ id, file: path.basename(file), category, durationSeconds })),
  }, null, 2)}\n`);
}
