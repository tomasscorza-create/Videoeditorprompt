import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PipelineError } from './errors.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function parseArguments(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const equal = token.indexOf('=');
    if (equal >= 0) result[token.slice(2, equal)] = token.slice(equal + 1);
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[token.slice(2)] = argv[++index];
    else result[token.slice(2)] = true;
  }
  return result;
}

export function resolvePath(value, base = projectRoot) {
  return path.resolve(base, value);
}

export function resolveTtsRoot(args = {}, options = {}) {
  const configured = args['tts-root'] || process.env.LOCAL_VIDEO_TTS_ROOT;
  const fallback = process.platform === 'win32'
    ? path.join(path.parse(projectRoot).root, 'LocalVideoTTS')
    : path.join(os.homedir(), '.local-video-tts');
  const directory = path.resolve(configured || fallback);
  if (options.validate !== false && !existsSync(directory)) {
    throw new PipelineError({
      code: 'TTS_RUNTIME_NOT_FOUND',
      stage: 'generating_voice',
      message: 'No existe el runtime TTS configurado.',
      suggestedAction: 'Defina --tts-root o LOCAL_VIDEO_TTS_ROOT con una carpeta válida.',
    });
  }
  return directory;
}

export function ensureDirectory(directory) {
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function requireFile(file, label = 'archivo') {
  if (!existsSync(file)) {
    throw new PipelineError({
      code: 'FILE_NOT_FOUND',
      stage: 'preparing',
      message: `No existe ${label}.`,
      suggestedAction: `Prepare ${label} y vuelva a ejecutar el trabajo.`,
    });
  }
  return file;
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  ensureDirectory(path.dirname(file));
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? projectRoot,
    encoding: 'utf8',
    shell: false,
    stdio: options.capture ? 'pipe' : 'inherit',
    maxBuffer: 20 * 1024 * 1024,
    timeout: options.timeoutMs ?? 15 * 60 * 1000,
    killSignal: 'SIGKILL',
  });
  const executableName = path.basename(executable).replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_') || 'PROCESS';
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    throw new PipelineError({
      code: timedOut ? `${executableName}_TIMEOUT` : `${executableName}_START_FAILED`,
      stage: options.stage || 'external_process',
      message: timedOut
        ? `${path.basename(executable)} superó el tiempo máximo permitido.`
        : `No se pudo iniciar ${path.basename(executable)}.`,
      cause: result.error,
      suggestedAction: `Verifique que ${path.basename(executable)} exista y sea ejecutable.`,
    });
  }
  if (result.status !== 0) {
    throw new PipelineError({
      code: options.errorCode || `${executableName}_EXIT_NONZERO`,
      stage: options.stage || 'external_process',
      message: `${path.basename(executable)} terminó con código ${result.status}.`,
      technicalDetail: (result.stderr || result.stdout || '').trim() || undefined,
      suggestedAction: options.suggestedAction || `Revise la entrada y la instalación de ${path.basename(executable)}.`,
    });
  }
  return result;
}

export function ffprobe(file) {
  const result = run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration,size:stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels,duration',
    '-of', 'json', file,
  ], { capture: true, stage: 'probing_media', errorCode: 'FFPROBE_EXIT_NONZERO' });
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new PipelineError({
      code: 'FFPROBE_OUTPUT_INVALID',
      stage: 'probing_media',
      message: 'FFprobe devolvió una respuesta que no es JSON válido.',
      cause: error,
      suggestedAction: 'Verifique la instalación de FFprobe y el archivo analizado.',
    });
  }
}

export function isMain(importMetaUrl) {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(importMetaUrl));
}
