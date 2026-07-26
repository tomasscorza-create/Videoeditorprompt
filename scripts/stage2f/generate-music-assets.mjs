import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';

const SAMPLE_RATE = 22_050;
const DURATION_SECONDS = 8;
const profiles = [
  { file: 'calm-loop-v1.wav', frequencies: [110, 164.81, 220], pulse: 0.25 },
  { file: 'bright-loop-v1.wav', frequencies: [130.81, 196, 261.63], pulse: 0.5 },
  { file: 'focused-loop-v1.wav', frequencies: [98, 146.83, 196], pulse: 0.125 },
];
const outputRoot = path.join(projectRoot, 'public', 'assets', 'audio', 'music');
mkdirSync(outputRoot, { recursive: true });

for (const profile of profiles) {
  const sampleCount = SAMPLE_RATE * DURATION_SECONDS;
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / SAMPLE_RATE;
    const loopPhase = time / DURATION_SECONDS;
    const loopEnvelope = 0.78 + 0.22 * Math.cos(loopPhase * Math.PI * 2);
    const pulse = 0.78 + 0.22 * Math.sin(time * Math.PI * 2 * profile.pulse);
    const value = profile.frequencies.reduce(
      (total, frequency, harmonic) => total + Math.sin(time * Math.PI * 2 * frequency) / (harmonic + 2),
      0,
    ) * 0.16 * loopEnvelope * pulse;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), index * 2);
  }
  writeFileSync(path.join(outputRoot, profile.file), wavBuffer(pcm, SAMPLE_RATE));
}

process.stdout.write(`${JSON.stringify({ version: 1, files: profiles.map((profile) => profile.file) })}\n`);

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
