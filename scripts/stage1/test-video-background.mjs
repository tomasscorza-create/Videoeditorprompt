import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildDialogueEncodingArguments } from './export-dialogue.mjs';
import { ensureDirectory, ffprobe, run } from './common.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'video-background-export-'));
let passed = false;

process.on('exit', () => {
  if (passed) rmSync(root, { recursive: true, force: true });
});

const frames = ensureDirectory(path.join(root, 'frames'));
const framePattern = path.join(frames, 'frame_%04d.png');
const background = path.join(root, 'background.mp4');
const audio = path.join(root, 'audio.wav');
const output = path.join(root, 'result.mp4');
const freeBackground = path.join(root, 'free-background.mp4');
const unifiedOutput = path.join(root, 'unified-result.mp4');

run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=black@0.0:s=108x192:r=30:d=0.5',
  '-vf', 'format=rgba,drawbox=x=10:y=10:w=28:h=28:color=blue@1:t=fill',
  '-frames:v', '15', framePattern,
], { capture: true, stage: 'test_video_background_frames' });
run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc=size=108x192:rate=15', '-t', '0.2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', background,
], { capture: true, stage: 'test_video_background_source' });
run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=green:s=108x192:r=30:d=0.2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', freeBackground,
], { capture: true, stage: 'test_unified_background_source' });
run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5', audio,
], { capture: true, stage: 'test_video_background_audio' });

const args = buildDialogueEncodingArguments({
  fps: 30,
  framePattern,
  audioFile: audio,
  renderDuration: 0.5,
  videoFile: output,
  backgroundVideoFile: background,
});
assert.ok(args.includes('-stream_loop'));
assert.ok(args.includes('[outv]'));
run('ffmpeg', args, { capture: true, stage: 'test_video_background_export' });

const probe = ffprobe(output);
const video = probe.streams.find((stream) => stream.codec_type === 'video');
const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
assert.equal(video.width, 108);
assert.equal(video.height, 192);
assert.equal(video.r_frame_rate, '30/1');
assert.ok(audioStream);
assert.ok(Number(probe.format.duration) >= 0.49);

const unifiedArgs = buildDialogueEncodingArguments({
  fps: 30,
  width: 108,
  height: 192,
  framePattern,
  foregroundFramePattern: framePattern,
  audioFile: audio,
  renderDuration: 0.5,
  videoFile: unifiedOutput,
  backgroundVideoFile: background,
  backgroundTimeline: [{
    id: 'free-background', file: freeBackground, localStartSeconds: 0.2,
    sourceInSeconds: 0, durationSeconds: 0.2,
  }],
});
assert.ok(unifiedArgs.some((argument) => String(argument).includes('timelinebase0')));
run('ffmpeg', unifiedArgs, { capture: true, stage: 'test_unified_background_export' });
const unifiedProbe = ffprobe(unifiedOutput);
assert.equal(unifiedProbe.streams.find((stream) => stream.codec_type === 'video')?.r_frame_rate, '30/1');
assert.ok(unifiedProbe.streams.some((stream) => stream.codec_type === 'audio'));

passed = true;
process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: 6,
  failed: 0,
  checks: ['loop', 'overlay', 'audio', '30fps', 'timeline-offset', 'timeline-foreground'],
})}\n`);
