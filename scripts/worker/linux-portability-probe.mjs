import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArguments } from '../stage1/common.mjs';
import { createBlobMaterializer } from '../storage/artifact-storage.mjs';
import { createPostgresPool } from '../storage/postgres-client.mjs';
import { createS3BlobStorage } from '../storage/s3-blob-storage.mjs';

if (process.platform !== 'linux') {
  throw workerError('WORKER_PLATFORM_INVALID', 'Este probe debe ejecutarse dentro de Linux.');
}

const args = parseArguments();
const sourceKey = required(args['source-key'], '--source-key');
const sourceSha256 = required(args['source-sha256'], '--source-sha256');
const outputKey = required(args['output-key'], '--output-key');
const root = await mkdtemp(path.join(tmpdir(), 'local-video-linux-worker-'));
const blobs = createS3BlobStorage({ materializationRoot: path.join(root, 'materialized') });
const pool = createPostgresPool();
let uploaded = false;

try {
  const databaseStarted = performance.now();
  const database = await pool.query(`
    SELECT current_setting('server_version') AS version,
      (SELECT count(*)::int FROM public.local_video_schema_migrations) AS migrations
  `);
  const databaseMs = performance.now() - databaseStarted;
  const hydrationStarted = performance.now();
  const sandbox = await createBlobMaterializer({ blobStorage: blobs }).materialize(
    `worker-${process.pid}`,
    [{ key: sourceKey, sha256: sourceSha256, relativePath: 'assets/source.png' }],
  );
  const hydrationMs = performance.now() - hydrationStarted;
  const source = path.join(sandbox.root, 'assets', 'source.png');
  const first = path.join(root, 'render-a.mp4');
  const second = path.join(root, 'render-b.mp4');
  const firstProbe = renderDeterministicVideo(source, first);
  const secondProbe = renderDeterministicVideo(source, second);
  const firstBytes = await readFile(first);
  const secondBytes = await readFile(second);
  const firstHash = sha256(firstBytes);
  const secondHash = sha256(secondBytes);
  if (firstHash !== secondHash || !firstBytes.equals(secondBytes)) {
    throw workerError('WORKER_RENDER_NONDETERMINISTIC', 'Las dos salidas Linux no son idénticas.');
  }
  const uploadStarted = performance.now();
  const stored = await blobs.put({
    key: outputKey,
    bytes: firstBytes,
    expectedSha256: firstHash,
    mimeType: 'video/mp4',
  });
  uploaded = true;
  const uploadMs = performance.now() - uploadStarted;
  const downloaded = path.join(blobs.materializationRoot, 'verified.mp4');
  await blobs.getToFile(outputKey, downloaded, firstHash);
  if (sha256(await readFile(downloaded)) !== firstHash) {
    throw workerError('WORKER_OUTPUT_HASH_MISMATCH', 'El output rehidratado no conserva su SHA-256.');
  }
  process.stdout.write(`${JSON.stringify({
    version: 1,
    state: 'completed',
    runtime: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
      ffmpeg: firstProbe.ffmpeg,
    },
    postgres: {
      version: database.rows[0].version,
      migrations: Number(database.rows[0].migrations),
      latencyMs: rounded(databaseMs),
    },
    hydration: {
      sourceKey,
      bytes: (await blobs.stat(sourceKey)).bytes,
      sha256: sourceSha256,
      milliseconds: rounded(hydrationMs),
    },
    render: {
      deterministic: true,
      sha256: firstHash,
      bytes: stored.bytes,
      codecs: firstProbe.codecs,
      durationSeconds: firstProbe.durationSeconds,
      uploadMs: rounded(uploadMs),
    },
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    version: 1,
    state: 'failed',
    stage: 'linux_worker_probe',
    code: error.code || 'UNEXPECTED_ERROR',
    message: error.message,
    technicalDetail: error.technicalDetail,
  })}\n`);
  process.exitCode = 1;
} finally {
  if (uploaded) await blobs.delete(outputKey).catch(() => {});
  blobs.close();
  await pool.end().catch(() => {});
  await rm(root, { recursive: true, force: true });
}

function renderDeterministicVideo(source, output) {
  const common = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-framerate', '30', '-i', source,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', '1',
    '-vf', 'scale=160:284:force_original_aspect_ratio=decrease,pad=160:284:(ow-iw)/2:(oh-ih)/2:color=black',
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-threads', '1',
    '-x264-params', 'threads=1:lookahead_threads=1:sliced_threads=0',
    '-flags:v', '+bitexact',
    '-c:a', 'aac', '-b:a', '128k', '-flags:a', '+bitexact',
    '-movflags', '+faststart',
    output,
  ];
  const result = spawnSync('ffmpeg', common, {
    shell: false,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw workerError('WORKER_FFMPEG_FAILED', 'FFmpeg no produjo el video Linux.');
  }
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_name',
    '-of', 'json',
    output,
  ], { shell: false, encoding: 'utf8', timeout: 10_000 });
  if (probe.status !== 0) {
    throw workerError('WORKER_FFPROBE_FAILED', 'FFprobe no pudo verificar el video Linux.');
  }
  const document = JSON.parse(probe.stdout);
  const codecs = document.streams.map((stream) => stream.codec_name).sort();
  if (!codecs.includes('h264') || !codecs.includes('aac')) {
    throw workerError('WORKER_CODEC_INVALID', 'El video Linux no contiene H.264/AAC.');
  }
  return {
    ffmpeg: firstLine(spawnSync('ffmpeg', ['-version'], {
      shell: false,
      encoding: 'utf8',
      timeout: 10_000,
    }).stdout),
    codecs,
    durationSeconds: Number(document.format.duration),
  };
}

function required(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw workerError('WORKER_ARGUMENT_REQUIRED', `Falta ${name}.`);
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/u)[0].slice(0, 160);
}

function workerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
