import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testRoot, '..');
const verification = JSON.parse(
  readFileSync(path.join(testRoot, 'output', 'wav-verification.json'), 'utf8'),
);
const audioDuration = Number(verification.runs[0].duration_seconds);
const framePattern = path.join(projectRoot, 'temp', 'frames', 'frame_%03d.png');
const audioFile = path.join(testRoot, 'output', 'piper-test.wav');
const outputFile = path.join(testRoot, 'output', 'stage0-piper-voice.mp4');
const probeFile = path.join(testRoot, 'output', 'piper-video-ffprobe.json');
const metricsFile = path.join(testRoot, 'output', 'piper-video-export-metrics.json');

function run(executable, args, capture = false) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    shell: false,
    stdio: capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw new Error(`No se pudo ejecutar ${executable}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${executable} terminó con código ${result.status}: ${result.stderr ?? ''}`,
    );
  }
  return result;
}

const ffmpegArgs = [
  '-hide_banner', '-loglevel', 'warning', '-y',
  '-stream_loop', '-1',
  '-framerate', '30',
  '-start_number', '1',
  '-i', framePattern,
  '-i', audioFile,
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-shortest',
  '-movflags', '+faststart',
  outputFile,
];

const startedAt = performance.now();
run('ffmpeg', ffmpegArgs);
const elapsedSeconds = (performance.now() - startedAt) / 1000;

const ffprobeArgs = [
  '-v', 'error',
  '-count_frames',
  '-show_entries',
  'format=filename,duration,size,bit_rate:stream=index,codec_name,codec_type,width,height,pix_fmt,r_frame_rate,sample_rate,channels,nb_read_frames,duration',
  '-of', 'json',
  outputFile,
];
const probe = JSON.parse(run('ffprobe', ffprobeArgs, true).stdout);
const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
const audioStream = probe.streams.find((stream) => stream.codec_type === 'audio');
const checks = {
  videoCodecIsH264: videoStream?.codec_name === 'h264',
  dimensionsAre1080x1920: videoStream?.width === 1080 && videoStream?.height === 1920,
  pixelFormatIsYuv420p: videoStream?.pix_fmt === 'yuv420p',
  frameRateIs30: videoStream?.r_frame_rate === '30/1',
  audioCodecIsAac: audioStream?.codec_name === 'aac',
  audioSampleRateIs22050: audioStream?.sample_rate === '22050',
  durationIncludesFullPiperWav:
    Number(audioStream?.duration) >= audioDuration - 0.02,
};

const report = {
  verifiedAt: new Date().toISOString(),
  sourceWav: path.relative(projectRoot, audioFile),
  sourceWavDurationSeconds: audioDuration,
  exportElapsedSeconds: Number(elapsedSeconds.toFixed(3)),
  checks,
  ffmpeg: {
    executable: 'ffmpeg',
    args: ffmpegArgs,
    shell: false,
  },
  ffprobe: probe,
};

writeFileSync(probeFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(
  metricsFile,
  `${JSON.stringify({
    exportElapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    sourceWavDurationSeconds: audioDuration,
    output: path.relative(projectRoot, outputFile),
  }, null, 2)}\n`,
  'utf8',
);

console.log(JSON.stringify(report, null, 2));

if (Object.values(checks).some((passed) => !passed)) {
  process.exitCode = 1;
}
