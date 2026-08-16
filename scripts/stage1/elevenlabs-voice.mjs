import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ensureDirectory, ffprobe, projectRoot, requireFile, run, sha256 } from './common.mjs';
import { PipelineError } from './errors.mjs';

export function generateElevenLabsVoice(context, { text, model, voiceId, lengthScale, volume }, report, detail = {}) {
  if (!voiceId) throw new PipelineError({ code: 'ELEVENLABS_VOICE_INVALID', stage: 'generating_voice', message: 'La voz de ElevenLabs no tiene un identificador remoto.', suggestedAction: 'Volvé a importar la voz desde la biblioteca.' });
  const voiceKey = sha256(JSON.stringify({ provider: 'elevenlabs', model, voiceId, text, lengthScale, volume, output: 'pcm_s16le-22050-mono-v1' }));
  const cacheRoot = ensureDirectory(path.join(context.ttsRoot, 'cache'));
  const cacheWav = path.join(cacheRoot, `${voiceKey}.wav`);
  const voiceTempRoot = ensureDirectory(path.join(context.tempRoot, 'voice', detail.turnId || 'scene'));
  const requestPath = path.join(voiceTempRoot, 'elevenlabs-request.json');
  const downloadedAudio = path.join(voiceTempRoot, 'elevenlabs.mp3');
  const generatedVoice = path.join(voiceTempRoot, 'generated.wav');
  const audioRelative = path.posix.join('audio', `${voiceKey}.wav`);
  const jobWav = path.join(context.generatedRoot, ...audioRelative.split('/'));
  const fontPath = requireFile(process.env.LOCAL_VIDEO_FONT_FILE || path.join(context.ttsRoot, 'fonts', 'arial.ttf'), 'fuente del runtime TTS');
  ensureDirectory(path.dirname(jobWav));

  const cacheHit = existsSync(cacheWav);
  let ttsSeconds = 0;
  report('generating_voice', { stage: 'generating_voice', provider: 'elevenlabs', cacheKey: voiceKey, cacheHit, ...detail });
  if (!cacheHit) {
    if (!process.env.ELEVENLABS_API_KEY && !process.env.ELEVENLABS_API_KEY_FILE) {
      throw new PipelineError({ code: 'ELEVENLABS_API_KEY_MISSING', stage: 'generating_voice', message: 'ElevenLabs no está configurado en este equipo.', suggestedAction: 'Ejecutá npm run elevenlabs:configure y reiniciá la aplicación.' });
    }
    writeFileSync(requestPath, `${JSON.stringify({ text, voiceId, model, seed: Number.parseInt(voiceKey.slice(0, 8), 16) })}\n`, 'utf8');
    const started = performance.now();
    run(process.execPath, [path.join(projectRoot, 'scripts', 'stage1', 'elevenlabs-voice-worker.mjs'), requestPath, downloadedAudio], {
      capture: true,
      timeoutMs: 180_000,
      stage: 'generating_voice',
      errorCode: 'ELEVENLABS_GENERATION_FAILED',
      suggestedAction: 'Revisá la clave, sus permisos de Text to Speech y los créditos disponibles.',
    });
    run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', downloadedAudio,
      '-af', [...atempoChain(1 / lengthScale), `volume=${volume}`].join(','),
      '-c:a', 'pcm_s16le', '-ar', '22050', '-ac', '1', generatedVoice,
    ], { stage: 'generating_voice', errorCode: 'ELEVENLABS_AUDIO_CONVERSION_FAILED' });
    ttsSeconds = (performance.now() - started) / 1000;
    copyFileSync(generatedVoice, cacheWav);
  }
  copyFileSync(cacheWav, jobWav);
  return { voiceKey, audioRelative, jobWav, cacheHit, ttsSeconds, probe: ffprobe(jobWav), support: { fontPath, provider: 'elevenlabs' } };
}

function atempoChain(input) {
  const factors = [];
  let value = input;
  while (value < 0.5) { factors.push(0.5); value /= 0.5; }
  while (value > 2) { factors.push(2); value /= 2; }
  factors.push(value);
  return factors.map((factor) => `atempo=${factor.toFixed(6)}`);
}
