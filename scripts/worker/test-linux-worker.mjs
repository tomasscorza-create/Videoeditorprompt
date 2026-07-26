import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';
import { createS3BlobStorage } from '../storage/s3-blob-storage.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'local-video-p8-linux-host-'));
const sourceFile = path.join(projectRoot, 'public', 'assets', 'stage1', 'background.png');
const sourceBytes = await readFile(sourceFile);
const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
const id = randomBytes(8).toString('hex');
const sourceKey = `p8-probes/${id}/source.png`;
const outputKey = `p8-probes/${id}/render.mp4`;
const blobs = createS3BlobStorage({ materializationRoot: path.join(root, 'materialized') });
let uploaded = false;

try {
  await blobs.put({
    key: sourceKey,
    stream: createReadStream(sourceFile),
    expectedSha256: sourceSha256,
    mimeType: 'image/png',
  });
  uploaded = true;
  runDocker([
    'build',
    '--file', 'deploy/worker/Dockerfile',
    '--tag', 'local-video-worker:p8',
    '.',
  ], 15 * 60_000);
  const environmentNames = [
    'LOCAL_VIDEO_POSTGRES_DB',
    'LOCAL_VIDEO_POSTGRES_USER',
    'LOCAL_VIDEO_POSTGRES_PASSWORD',
    'LOCAL_VIDEO_S3_ACCESS_KEY',
    'LOCAL_VIDEO_S3_SECRET_KEY',
    'LOCAL_VIDEO_S3_BUCKET',
    'LOCAL_VIDEO_S3_REGION',
  ];
  const inherited = environmentNames.flatMap((name) => (
    process.env[name] === undefined ? [] : ['--env', name]
  ));
  const result = runDocker([
    'run', '--rm',
    '--add-host', 'host.docker.internal:host-gateway',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--memory', '1g',
    '--cpus', '2',
    '--pids-limit', '256',
    '--env', 'LOCAL_VIDEO_DEPLOYMENT=local',
    '--env', 'LOCAL_VIDEO_POSTGRES_HOST=host.docker.internal',
    '--env', `LOCAL_VIDEO_POSTGRES_PORT=${process.env.LOCAL_VIDEO_POSTGRES_PORT || 54329}`,
    '--env', 'LOCAL_VIDEO_S3_PROVIDER=seaweedfs',
    '--env', `LOCAL_VIDEO_S3_ENDPOINT=http://host.docker.internal:${process.env.LOCAL_VIDEO_S3_PORT || 8333}`,
    ...inherited,
    'local-video-worker:p8',
    `--source-key=${sourceKey}`,
    `--source-sha256=${sourceSha256}`,
    `--output-key=${outputKey}`,
  ], 5 * 60_000);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1));
  assert.equal(report.state, 'completed');
  assert.equal(report.runtime.platform, 'linux');
  assert.equal(report.hydration.sha256, sourceSha256);
  assert.equal(report.render.deterministic, true);
  assert.deepEqual(report.render.codecs, ['aac', 'h264']);
  await assert.rejects(() => blobs.stat(outputKey), (error) => error.code === 'BLOB_NOT_FOUND');
  const ttsRoot = path.resolve(
    process.env.LOCAL_VIDEO_TTS_ROOT
      || (process.platform === 'win32' ? 'C:\\LocalVideoTTS' : path.join(process.env.HOME, '.local-video-tts')),
  );
  const modelsRoot = path.join(ttsRoot, 'models');
  const fontsRoot = path.join(ttsRoot, 'fonts');
  assert.equal(existsSync(modelsRoot), true, 'Falta la carpeta de modelos Piper.');
  assert.equal(existsSync(fontsRoot), true, 'Falta la carpeta de fuentes Piper.');
  const full = runDocker([
    'run', '--rm',
    '--read-only',
    '--tmpfs', '/tmp:rw,exec,nosuid,size=8g',
    '--tmpfs', '/runtime/tts/cache:rw,noexec,nosuid,size=1g,uid=1000,gid=1000',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--memory', '8g',
    '--cpus', '4',
    '--pids-limit', '2048',
    '--mount', `type=bind,source=${modelsRoot},target=/runtime/tts/models,readonly`,
    '--mount', `type=bind,source=${fontsRoot},target=/runtime/tts/fonts,readonly`,
    '--env', 'LOCAL_VIDEO_TTS_ROOT=/runtime/tts',
    '--env', 'LOCAL_VIDEO_PIPER_PYTHON=/opt/piper/bin/python',
    '--env', 'LOCAL_VIDEO_FONT_FILE=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '--entrypoint', 'node',
    'local-video-worker:p8',
    'scripts/worker/full-render-probe.mjs',
    `--job-id=p8-linux-${id}`,
  ], 35 * 60_000);
  const fullReport = JSON.parse(full.stdout.trim().split(/\r?\n/u).at(-1));
  assert.equal(fullReport.state, 'completed');
  assert.equal(fullReport.runtime.platform, 'linux');
  assert.equal(fullReport.render.deterministic, true);
  assert.equal(fullReport.render.scenes, 2);
  assert.deepEqual(fullReport.render.codecs, ['aac', 'h264']);
  process.stdout.write(`${JSON.stringify({
    version: 1,
    passed: 13,
    failed: 0,
    linux: report,
    fullRender: fullReport,
  })}\n`);
} finally {
  if (uploaded) await blobs.delete(sourceKey).catch(() => {});
  await blobs.delete(outputKey).catch(() => {});
  blobs.close();
  await rm(root, { recursive: true, force: true });
}

function runDocker(args, timeout) {
  const result = spawnSync('docker', args, {
    cwd: projectRoot,
    shell: false,
    encoding: 'utf8',
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    const error = result.error || new Error(result.stderr || 'Docker terminó con error.');
    error.code = result.error?.code || 'DOCKER_EXIT_NONZERO';
    throw error;
  }
  return result;
}
