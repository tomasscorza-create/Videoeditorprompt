import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run } from './process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const video = path.join(root, 'output', 'stage0-final.mp4');
const frames = path.join(root, 'temp', 'frames');
const reportFile = path.join(root, 'output', 'stage0-final-ffprobe.json');

const result = run('ffprobe', [
  '-v', 'error',
  '-count_frames',
  '-show_entries',
  'format=filename,duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,pix_fmt,r_frame_rate,sample_rate,channels,nb_read_frames',
  '-of', 'json',
  video,
], { cwd: root, capture: true });

const probe = JSON.parse(result.stdout);
const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
const frameFiles = readdirSync(frames).filter((file) => /^frame_\d{3}\.png$/.test(file));

const checks = {
  frameSequenceHas90Pngs: frameFiles.length === 90,
  videoCodecIsH264: videoStream?.codec_name === 'h264',
  dimensionsAre1080x1920: videoStream?.width === 1080 && videoStream?.height === 1920,
  pixelFormatIsYuv420p: videoStream?.pix_fmt === 'yuv420p',
  frameRateIs30: videoStream?.r_frame_rate === '30/1',
  decodedFrameCountIs90: videoStream?.nb_read_frames === '90',
  audioCodecIsAac: audioStream?.codec_name === 'aac',
  audioSampleRateIs48000: audioStream?.sample_rate === '48000',
  durationIsThreeSeconds: Math.abs(Number(probe.format.duration) - 3) < 0.05,
};

const report = {
  verifiedAt: new Date().toISOString(),
  checks,
  frameFileCount: frameFiles.length,
  ffprobe: probe,
};

writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

if (Object.values(checks).some((passed) => !passed)) {
  process.exitCode = 1;
}
