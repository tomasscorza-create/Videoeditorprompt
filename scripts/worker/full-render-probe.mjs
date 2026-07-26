import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArguments, projectRoot } from '../stage1/common.mjs';

if (process.platform !== 'linux') {
  throw workerError('WORKER_PLATFORM_INVALID', 'Este probe debe ejecutarse dentro de Linux.');
}

const args = parseArguments();
const jobId = String(args['job-id'] || 'p8-linux-full-render');
const project = path.resolve(
  args.project || path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'),
);
const workRoot = '/tmp/local-video-work';
const outputRoot = '/tmp/local-video-output';
const pipeline = path.join(projectRoot, 'scripts', 'stage3a', 'project-pipeline.mjs');
const started = performance.now();
const result = spawnSync(process.execPath, [
  pipeline,
  `--job-id=${jobId}`,
  `--project=${project}`,
  `--assets-dir=${path.join(projectRoot, 'public')}`,
  `--tts-root=${process.env.LOCAL_VIDEO_TTS_ROOT || '/runtime/tts'}`,
  `--work-dir=${workRoot}`,
  `--output-dir=${outputRoot}`,
], {
  cwd: projectRoot,
  shell: false,
  encoding: 'utf8',
  timeout: 30 * 60_000,
  maxBuffer: 20 * 1024 * 1024,
  env: process.env,
});
if (result.error || result.status !== 0) {
  const error = workerError(
    result.error?.code === 'ETIMEDOUT' ? 'WORKER_RENDER_TIMEOUT' : 'WORKER_RENDER_FAILED',
    'El pipeline multiescena Linux no terminó correctamente.',
  );
  error.technicalDetail = String(
    result.stderr || result.stdout || result.error?.code || `exit=${result.status}`,
  )
    .slice(-2000);
  throw error;
}
const resultRoot = path.join(outputRoot, jobId);
const video = path.join(resultRoot, 'render-1.mp4');
const manifest = JSON.parse(await readFile(
  path.join(resultRoot, 'project-manifest.json'),
  'utf8',
));
const videoBytes = await readFile(video);
const probe = spawnSync('ffprobe', [
  '-v', 'error',
  '-show_entries', 'format=duration:stream=codec_name,width,height,pix_fmt',
  '-of', 'json',
  video,
], { shell: false, encoding: 'utf8', timeout: 10_000 });
if (probe.status !== 0) {
  throw workerError('WORKER_FFPROBE_FAILED', 'FFprobe no pudo verificar el MP4 multiescena.');
}
const media = JSON.parse(probe.stdout);
const codecs = media.streams.map((stream) => stream.codec_name).sort();
const videoStream = media.streams.find((stream) => stream.codec_name === 'h264');
if (!codecs.includes('h264') || !codecs.includes('aac')) {
  throw workerError('WORKER_CODEC_INVALID', 'El MP4 multiescena Linux no contiene H.264/AAC.');
}
process.stdout.write(`${JSON.stringify({
  version: 1,
  state: 'completed',
  runtime: {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    piperPython: process.env.LOCAL_VIDEO_PIPER_PYTHON,
  },
  render: {
    jobId,
    projectId: manifest.projectId,
    scenes: manifest.timeline.scenes.length,
    durationSeconds: Number(media.format.duration),
    deterministic: manifest.deterministic,
    sha256: createHash('sha256').update(videoBytes).digest('hex'),
    bytes: videoBytes.length,
    codecs,
    width: videoStream.width,
    height: videoStream.height,
    pixelFormat: videoStream.pix_fmt,
    milliseconds: Math.round(performance.now() - started),
  },
})}\n`);

function workerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
