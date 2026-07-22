import {
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { run } from './process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const frames = path.join(root, 'temp', 'frames');
const output = path.join(root, 'output');
const finalVideo = path.join(output, 'stage0-final.mp4');

mkdirSync(frames, { recursive: true });
mkdirSync(output, { recursive: true });

for (const file of readdirSync(frames)) {
  if (/^frame_\d{3}\.png$/.test(file)) {
    unlinkSync(path.join(frames, file));
  }
}

const framePattern = path.join(frames, 'frame_%03d.png');
const frameFilter = [
  '[0:v]format=rgba[bg]',
  '[1:v][2:v]overlay=0:0:format=auto[character]',
  "[character]scale=w='360*(1+0.08*sin(PI*t/3))':h='900*(1+0.08*sin(PI*t/3))':eval=frame[scaled]",
  "[bg][scaled]overlay=x='180+100*t':y='850-80*sin(PI*t/3)':eval=frame:format=auto,format=rgba[out]",
].join(';');

const startedAt = performance.now();
const framesStartedAt = performance.now();

run('ffmpeg', [
  '-hide_banner', '-loglevel', 'warning', '-y',
  '-loop', '1', '-framerate', '30', '-t', '3', '-i', path.join(assets, 'background.png'),
  '-loop', '1', '-framerate', '30', '-t', '3', '-i', path.join(assets, 'character_body.png'),
  '-loop', '1', '-framerate', '30', '-t', '3', '-i', path.join(assets, 'character_overlay.png'),
  '-filter_complex', frameFilter,
  '-map', '[out]',
  '-frames:v', '90',
  '-start_number', '1',
  framePattern,
], { cwd: root });

const frameGenerationSeconds = (performance.now() - framesStartedAt) / 1000;
const encodingStartedAt = performance.now();

run('ffmpeg', [
  '-hide_banner', '-loglevel', 'warning', '-y',
  '-framerate', '30',
  '-start_number', '1',
  '-i', framePattern,
  '-i', path.join(assets, 'test.wav'),
  '-t', '3',
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-shortest',
  '-movflags', '+faststart',
  finalVideo,
], { cwd: root });

const encodingSeconds = (performance.now() - encodingStartedAt) / 1000;
const totalSeconds = (performance.now() - startedAt) / 1000;
const frameCount = readdirSync(frames).filter((file) => /^frame_\d{3}\.png$/.test(file)).length;
const metrics = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationSeconds: 3,
  frameCount,
  frameGenerationSeconds: Number(frameGenerationSeconds.toFixed(3)),
  encodingSeconds: Number(encodingSeconds.toFixed(3)),
  totalSeconds: Number(totalSeconds.toFixed(3)),
  output: path.relative(root, finalVideo),
};

writeFileSync(
  path.join(output, 'stage0-export-metrics.json'),
  `${JSON.stringify(metrics, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify(metrics, null, 2));
