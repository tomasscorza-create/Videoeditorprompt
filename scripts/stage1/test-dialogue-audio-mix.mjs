import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, ffprobe, projectRoot } from './common.mjs';
import { composeDialogueAudio } from './prepare-dialogue.mjs';

const testRoot = ensureDirectory(path.join(projectRoot, '.local-video', 'tests', 'dialogue-audio-mix'));
const outputPath = path.join(testRoot, 'ducking.wav');
const musicPath = path.join(projectRoot, 'public', 'assets', 'audio', 'music', 'calm-loop-v1.wav');

try {
  composeDialogueAudio(
    [{ type: 'silence', durationSeconds: 2 }],
    outputPath,
    musicPath,
    2,
    [{ startSeconds: 0, endSeconds: 1 }],
  );
  const probe = ffprobe(outputPath);
  assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.03);
  const quietRms = segmentRms(outputPath, 0.2, 0.8);
  const gapRms = segmentRms(outputPath, 1.2, 1.8);
  assert.ok(quietRms > 0);
  assert.ok(gapRms > quietRms * 2, `Se esperaba ducking medible: voz=${quietRms}, gap=${gapRms}`);
  process.stdout.write(`${JSON.stringify({
    version: 1,
    passed: 3,
    failed: 0,
    durationSeconds: Number(probe.format.duration),
    spokenRangeRms: quietRms,
    gapRangeRms: gapRms,
  })}\n`);
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}

function segmentRms(file, startSeconds, endSeconds) {
  const buffer = readFileSync(file);
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const dataOffset = findDataOffset(buffer);
  const firstFrame = Math.floor(startSeconds * sampleRate);
  const lastFrame = Math.floor(endSeconds * sampleRate);
  let sumSquares = 0;
  let count = 0;
  for (let frame = firstFrame; frame < lastFrame; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = dataOffset + (frame * channels + channel) * 2;
      const sample = buffer.readInt16LE(offset) / 32768;
      sumSquares += sample * sample;
      count += 1;
    }
  }
  return Math.sqrt(sumSquares / count);
}

function findDataOffset(buffer) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32LE(offset + 4);
    if (buffer.toString('ascii', offset, offset + 4) === 'data') return offset + 8;
    offset += 8 + size + (size % 2);
  }
  throw new Error('WAV sin bloque data.');
}
