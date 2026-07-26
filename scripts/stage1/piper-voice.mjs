import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ensureDirectory, ffprobe, readJson, requireFile, run, sha256 } from './common.mjs';
import { PipelineError } from './errors.mjs';

export function resolvePiperSupport(context, modelName) {
  if (!existsSync(context.ttsRoot)) {
    throw new PipelineError({
      code: 'TTS_RUNTIME_NOT_FOUND',
      stage: 'generating_voice',
      message: 'No existe el runtime TTS configurado.',
      suggestedAction: 'Defina una ruta válida con --tts-root o LOCAL_VIDEO_TTS_ROOT.',
    });
  }
  const modelPath = requireFile(path.join(context.ttsRoot, 'models', `${modelName}.onnx`), 'modelo Piper');
  return {
    modelPath,
    modelConfig: readJson(requireFile(`${modelPath}.json`, 'configuración del modelo Piper')),
    pythonPath: requireFile(resolvePiperPython(context.ttsRoot), 'ejecutable Python de Piper'),
    fontPath: requireFile(
      process.env.LOCAL_VIDEO_FONT_FILE || path.join(context.ttsRoot, 'fonts', 'arial.ttf'),
      'fuente del runtime TTS',
    ),
  };
}

export function resolvePiperPython(ttsRoot, environment = process.env, platform = process.platform) {
  if (environment.LOCAL_VIDEO_PIPER_PYTHON) {
    return path.resolve(environment.LOCAL_VIDEO_PIPER_PYTHON);
  }
  return path.join(
    ttsRoot,
    'venv',
    ...(platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']),
  );
}

export function generatePiperVoice(context, { text, model, lengthScale, volume, speaker }, report, detail = {}) {
  const support = resolvePiperSupport(context, model);
  const voiceKey = sha256(JSON.stringify({ model, text, lengthScale, volume, speaker }));
  const cacheRoot = ensureDirectory(path.join(context.ttsRoot, 'cache'));
  const cacheWav = path.join(cacheRoot, `${voiceKey}.wav`);
  const voiceTempRoot = ensureDirectory(path.join(context.tempRoot, 'voice', detail.turnId || 'scene'));
  const inputText = path.join(voiceTempRoot, 'input.txt');
  const generatedVoice = path.join(voiceTempRoot, 'generated.wav');
  const audioRelative = path.posix.join('audio', `${voiceKey}.wav`);
  const jobWav = path.join(context.generatedRoot, ...audioRelative.split('/'));
  ensureDirectory(path.dirname(jobWav));

  const cacheHit = existsSync(cacheWav);
  let ttsSeconds = 0;
  report('generating_voice', { stage: 'generating_voice', cacheKey: voiceKey, cacheHit, ...detail });
  if (!cacheHit) {
    writeFileSync(inputText, `${text}\n`, 'utf8');
    const started = performance.now();
    const piperArgs = [
      '-m', 'piper', '-m', support.modelPath, '-f', generatedVoice,
      '--length-scale', String(lengthScale), '--volume', String(volume),
    ];
    if (speaker !== undefined && speaker !== null) piperArgs.push('--speaker', String(speaker));
    piperArgs.push('--input-file', inputText);
    run(support.pythonPath, piperArgs, { stage: 'generating_voice', errorCode: 'PIPER_EXIT_NONZERO' });
    ttsSeconds = (performance.now() - started) / 1000;
    copyFileSync(generatedVoice, cacheWav);
  }
  copyFileSync(cacheWav, jobWav);
  return { voiceKey, audioRelative, jobWav, cacheHit, ttsSeconds, probe: ffprobe(jobWav), support };
}
