import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ffprobe, run } from '../stage1/common.mjs';

const INDEX_VERSION = 1;
const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_DURATION_SECONDS = 10 * 60 * 60;
const MIME_EXTENSIONS = Object.freeze({
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
});

export async function createTimelineMediaLibrary(options = {}) {
  const storageRoot = path.resolve(options.storageRoot || path.join(process.cwd(), '.local-video', 'timeline-v2', 'media'));
  const objectRoot = path.join(storageRoot, 'objects');
  const incomingRoot = path.join(storageRoot, '.incoming');
  const indexFile = path.join(storageRoot, 'index.json');
  await mkdir(objectRoot, { recursive: true });
  await mkdir(incomingRoot, { recursive: true });
  let index = readIndex(indexFile);
  let writeQueue = Promise.resolve();

  const persist = () => {
    const snapshot = canonicalIndex(index);
    writeQueue = writeQueue.then(async () => {
      const temporary = `${indexFile}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      renameSync(temporary, indexFile);
    });
    return writeQueue;
  };

  async function importStream(readable, input = {}) {
    const mimeType = normalizeMime(input.mimeType);
    const extension = MIME_EXTENSIONS[mimeType];
    if (!extension) throw mediaError('TIMELINE_MEDIA_FORMAT_INVALID', 'Usá MP4, MOV, WebM, WAV, MP3, OGG o M4A.');
    const incoming = path.join(incomingRoot, `${process.pid}-${randomBytes(12).toString('hex')}${extension}`);
    const hash = createHash('sha256');
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > (input.maximumBytes || MAX_MEDIA_BYTES)) {
          callback(mediaError('TIMELINE_MEDIA_TOO_LARGE', 'El medio supera el límite local de 2 GB.'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(readable, limiter, createWriteStream(incoming, { flags: 'wx' }));
      if (bytes < 1) throw mediaError('TIMELINE_MEDIA_EMPTY', 'El archivo de medios está vacío.');
      const contentHash = hash.digest('hex');
      const existing = index.entries.find((entry) => entry.contentHash === contentHash);
      if (existing) {
        if (!existing.previewRelativePath) {
          const probe = (options.probe || ffprobe)(incoming);
          const source = resolveRelative(storageRoot, existing.relativePath);
          const updated = createPreviewIfNeeded(existing, probe, source, path.dirname(source), options.run || run);
          if (updated !== existing) {
            index = {
              version: INDEX_VERSION,
              entries: index.entries.map((entry) => entry.id === existing.id ? updated : entry),
            };
            await persist();
            rmSync(incoming, { force: true });
            return { created: false, entry: updated };
          }
        }
        rmSync(incoming, { force: true });
        return { created: false, entry: existing };
      }
      const probe = (options.probe || ffprobe)(incoming);
      let entry = buildEntry({ probe, contentHash, bytes, mimeType, extension, fileName: input.fileName });
      const directory = path.join(objectRoot, contentHash);
      await mkdir(directory, { recursive: true });
      const destination = path.join(directory, `source${extension}`);
      entry = createPreviewIfNeeded(entry, probe, incoming, directory, options.run || run);
      if (!existsSync(destination)) renameSync(incoming, destination);
      else rmSync(incoming, { force: true });
      index = { version: INDEX_VERSION, entries: [...index.entries, entry] };
      await persist();
      return { created: true, entry };
    } catch (error) {
      rmSync(incoming, { force: true });
      throw error;
    }
  }

  async function importFile(file, input = {}) {
    const absolute = path.resolve(file);
    return importStream(createReadStream(absolute), {
      ...input,
      fileName: input.fileName || path.basename(absolute),
      maximumBytes: input.maximumBytes || MAX_MEDIA_BYTES,
    });
  }

  function list() {
    return canonicalIndex(index).entries;
  }

  function get(id) {
    return index.entries.find((entry) => entry.id === id) || null;
  }

  function open(id) {
    const entry = get(id);
    if (!entry) return null;
    const file = resolveRelative(storageRoot, entry.relativePath);
    if (!existsSync(file)) return null;
    return { file, size: statSync(file).size, name: safeName(entry.name), mimeType: entry.mimeType, entry };
  }

  function openPreview(id) {
    const entry = get(id);
    if (!entry) return null;
    const relativePath = entry.previewRelativePath || entry.relativePath;
    const file = resolveRelative(storageRoot, relativePath);
    if (!existsSync(file)) return null;
    return {
      file,
      size: statSync(file).size,
      name: safeName(entry.name),
      mimeType: entry.previewMimeType || entry.mimeType,
      entry,
    };
  }

  return { storageRoot, list, get, open, openPreview, importStream, importFile };
}

function createPreviewIfNeeded(entry, probe, source, directory, runImpl) {
  if (browserCompatible(entry, probe)) return entry;
  const video = entry.hasVideo;
  const extension = video ? '.mp4' : '.wav';
  const destination = path.join(directory, `preview${extension}`);
  const temporary = path.join(directory, `preview.${process.pid}.${randomBytes(4).toString('hex')}.tmp${extension}`);
  try {
    const args = video
      ? [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-movflags', '+faststart', temporary,
      ]
      : [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', temporary,
      ];
    runImpl('ffmpeg', args, { stage: 'timeline_media_preview', errorCode: 'TIMELINE_MEDIA_PREVIEW_FAILED' });
    renameSync(temporary, destination);
    return Object.freeze({
      ...entry,
      previewRelativePath: `objects/${entry.contentHash}/preview${extension}`,
      previewMimeType: video ? 'video/mp4' : 'audio/wav',
    });
  } finally {
    rmSync(temporary, { force: true });
  }
}

function browserCompatible(entry, probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const videoCodec = streams.find((stream) => stream.codec_type === 'video')?.codec_name;
  const audioCodec = streams.find((stream) => stream.codec_type === 'audio')?.codec_name;
  if (entry.hasVideo) {
    const videoOk = entry.mimeType === 'video/mp4'
      ? videoCodec === 'h264'
      : entry.mimeType === 'video/webm' && ['vp8', 'vp9', 'av1'].includes(videoCodec);
    const audioOk = !entry.hasAudio || (
      entry.mimeType === 'video/mp4'
        ? ['aac', 'mp3'].includes(audioCodec)
        : ['opus', 'vorbis'].includes(audioCodec)
    );
    return videoOk && audioOk;
  }
  if (entry.mimeType === 'audio/wav' || entry.mimeType === 'audio/x-wav') return String(audioCodec || '').startsWith('pcm_');
  if (entry.mimeType === 'audio/mpeg') return audioCodec === 'mp3';
  if (entry.mimeType === 'audio/ogg') return ['opus', 'vorbis'].includes(audioCodec);
  if (entry.mimeType === 'audio/mp4') return audioCodec === 'aac';
  return false;
}

function buildEntry({ probe, contentHash, bytes, mimeType, extension, fileName }) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!video && !audio) throw mediaError('TIMELINE_MEDIA_STREAM_INVALID', 'FFprobe no encontró video ni audio utilizable.');
  const durationSeconds = Number(probe?.format?.duration || Math.max(...streams.map((stream) => Number(stream.duration) || 0)));
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
    throw mediaError('TIMELINE_MEDIA_DURATION_INVALID', 'La duración medida no es válida o supera 10 horas.');
  }
  const durationTicks = video
    ? Math.max(1, Math.floor(durationSeconds * 30)) * 1_600
    : Math.max(1, Math.round(durationSeconds * 48_000));
  return Object.freeze({
    id: `media-${contentHash.slice(0, 16)}`,
    contentHash,
    kind: video ? 'video' : 'audio',
    name: safeName(fileName || `medio${extension}`),
    mimeType,
    bytes,
    durationTicks,
    durationSeconds: durationTicks / 48_000,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    ...(video ? { width: Number(video.width), height: Number(video.height), frameRate: String(video.r_frame_rate || '') } : {}),
    ...(audio ? { sampleRate: Number(audio.sample_rate), channels: Number(audio.channels) } : {}),
    relativePath: `objects/${contentHash}/source${extension}`,
  });
}

function readIndex(file) {
  if (!existsSync(file)) return { version: INDEX_VERSION, entries: [] };
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value?.version !== INDEX_VERSION || !Array.isArray(value.entries)) throw new Error('version');
    return value;
  } catch {
    throw mediaError('TIMELINE_MEDIA_INDEX_INVALID', 'El índice de medios V2 está dañado.');
  }
}

function canonicalIndex(index) {
  return { version: INDEX_VERSION, entries: [...index.entries].sort((left, right) => left.id.localeCompare(right.id)) };
}

function normalizeMime(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function safeName(value) {
  const clean = String(value || 'medio').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/gu, '_').trim().slice(0, 180);
  return clean || 'medio';
}

function resolveRelative(root, relative) {
  const absolute = path.resolve(root, ...String(relative).split('/'));
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!absolute.startsWith(prefix)) throw mediaError('TIMELINE_MEDIA_PATH_INVALID', 'La ruta del medio no pertenece a la biblioteca.');
  return absolute;
}

function mediaError(code, message) {
  return Object.assign(new Error(message), { code, stage: 'timeline_media' });
}
