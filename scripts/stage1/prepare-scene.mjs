import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildBlinkSchedule } from '../../shared/scene-evaluator.js';
import { analyzeWav } from './audio-analysis.mjs';
import { ensureDirectory, ffprobe, isMain, readJson, requireFile, run, sha256, writeJson } from './common.mjs';
import { createJobContext } from './job-context.mjs';
import { createProgressReporter, serializeError } from './progress.mjs';
import { loadAndValidateJobConfig, validateMeasuredDuration } from './validate-scene-config.mjs';
import { PipelineError } from './errors.mjs';

export function prepareJob(context, report = createProgressReporter(context)) {
  const config = loadAndValidateJobConfig(context);
  report('preparing', { stage: 'prepare', config: 'input/scene.config.json' });
  if (!existsSync(context.ttsRoot)) {
    throw new PipelineError({
      code: 'TTS_RUNTIME_NOT_FOUND',
      stage: 'generating_voice',
      message: 'No existe el runtime TTS configurado.',
      suggestedAction: 'Defina una ruta válida con --tts-root o LOCAL_VIDEO_TTS_ROOT.',
    });
  }
  const modelPath = requireFile(path.join(context.ttsRoot, 'models', `${config.voice.model}.onnx`), 'modelo Piper');
  const modelConfigPath = requireFile(`${modelPath}.json`, 'configuración del modelo Piper');
  const pythonPath = requireFile(path.join(context.ttsRoot, 'venv', 'Scripts', 'python.exe'), 'ejecutable Python de Piper');
  const fontPath = requireFile(path.join(context.ttsRoot, 'fonts', 'arial.ttf'), 'fuente del runtime TTS');
  const modelConfig = readJson(modelConfigPath);
  const voiceKey = sha256(JSON.stringify({
    model: config.voice.model,
    text: config.voice.text,
    lengthScale: config.voice.lengthScale,
    volume: config.voice.volume,
  }));
  const cacheRoot = ensureDirectory(path.join(context.ttsRoot, 'cache'));
  const cacheWav = path.join(cacheRoot, `${voiceKey}.wav`);
  const voiceTempRoot = ensureDirectory(path.join(context.tempRoot, 'voice'));
  const inputText = path.join(voiceTempRoot, 'input.txt');
  const generatedVoice = path.join(voiceTempRoot, 'generated.wav');
  const audioRelative = path.posix.join('audio', `${voiceKey}.wav`);
  const jobWav = path.join(context.generatedRoot, ...audioRelative.split('/'));
  ensureDirectory(path.dirname(jobWav));

  const cacheHit = existsSync(cacheWav);
  let ttsSeconds = 0;
  report('generating_voice', { stage: 'generating_voice', cacheKey: voiceKey, cacheHit });
  if (!cacheHit) {
    writeFileSync(inputText, `${config.voice.text}\n`, 'utf8');
    const started = performance.now();
    run(pythonPath, [
      '-m', 'piper', '-m', modelPath, '-f', generatedVoice,
      '--length-scale', String(config.voice.lengthScale),
      '--volume', String(config.voice.volume),
      '--input-file', inputText,
    ], { stage: 'generating_voice', errorCode: 'PIPER_EXIT_NONZERO' });
    ttsSeconds = (performance.now() - started) / 1000;
    copyFileSync(generatedVoice, cacheWav);
  }
  copyFileSync(cacheWav, jobWav);

  const audioProbe = ffprobe(jobWav);
  const durationSeconds = Number(audioProbe.format.duration);
  validateMeasuredDuration(config, durationSeconds);
  report('analyzing_audio', { stage: 'analyzing_audio', durationSeconds });
  const analysisStarted = performance.now();
  const analysis = analyzeWav(jobWav, config.mouth);
  const analysisSeconds = (performance.now() - analysisStarted) / 1000;
  const mouthRelative = path.posix.join('mouth', `${voiceKey}.json`);
  writeJson(path.join(context.generatedRoot, ...mouthRelative.split('/')), { version: 1, jobId: context.jobId, cues: analysis.cues, analysis });

  const subtitleKey = sha256(JSON.stringify({ text: config.subtitle.text, fontSize: config.subtitle.fontSize }));
  const subtitleRelative = path.posix.join('subtitle', `${subtitleKey}.png`);
  const subtitlePng = path.join(context.generatedRoot, ...subtitleRelative.split('/'));
  ensureDirectory(path.dirname(subtitlePng));
  const subtitleTempRoot = ensureDirectory(path.join(context.tempRoot, 'subtitle'));
  const subtitleText = path.join(subtitleTempRoot, 'subtitle.txt');
  writeFileSync(subtitleText, config.subtitle.text, 'utf8');
  const ffmpegPath = (value) => value.replaceAll('\\', '/').replace(':', '\\:');
  const boxHeight = 250;
  const y = config.video.height - config.subtitle.bottomMargin - boxHeight;
  const filter = [
    'format=rgba',
    `drawbox=x=70:y=${y}:w=940:h=${boxHeight}:color=black@0.72:t=fill:replace=1`,
    `drawtext=fontfile='${ffmpegPath(fontPath)}':textfile='${ffmpegPath(subtitleText)}':fontcolor=white:fontsize=${config.subtitle.fontSize}:line_spacing=16:x=(w-text_w)/2:y=${y + 52}`,
  ].join(',');
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', `color=c=black@0.0:s=${config.video.width}x${config.video.height}:r=1:d=1,format=rgba`,
    '-vf', filter, '-frames:v', '1', subtitlePng,
  ], { stage: 'preparing', errorCode: 'FFMPEG_SUBTITLE_EXIT_NONZERO' });

  const runtime = {
    version: 1,
    jobId: context.jobId,
    configVersion: config.version,
    cacheKey: voiceKey,
    assets: context.resolvedAssets,
    characterRig: context.characterRig,
    audio: {
      path: audioRelative,
      durationSeconds,
      sampleRate: Number(audioProbe.streams.find((item) => item.codec_type === 'audio').sample_rate),
      channels: audioProbe.streams.find((item) => item.codec_type === 'audio').channels,
    },
    mouthCuesPath: mouthRelative,
    subtitlePath: subtitleRelative,
    blinks: buildBlinkSchedule(durationSeconds, config.blink),
    preparation: { cacheHit, ttsSeconds, analysisSeconds },
    voice: {
      model: config.voice.model,
      locale: 'es_AR',
      modelSampleRate: modelConfig.audio.sample_rate,
      quality: 'high',
      source: 'https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_AR/daniela/high',
      dataset: 'OpenSLR 61',
      datasetLicense: 'CC BY-SA 4.0',
      engine: 'piper-tts 1.5.0',
      engineLicense: 'GPL-3.0-or-later',
    },
  };
  const runtimePath = path.join(context.runtimeRoot, 'scene-runtime.json');
  writeJson(runtimePath, runtime);
  writeJson(path.join(context.runtimeRoot, 'preparation-metrics.json'), {
    version: 1, jobId: context.jobId, cacheKey: voiceKey, cacheHit, ttsSeconds, analysisSeconds, audio: audioProbe,
    analysisSummary: {
      cueCount: analysis.cues.length,
      stateCounts: Object.fromEntries(['closed', 'medium', 'open'].map((state) => [state, analysis.cues.filter((cue) => cue.state === state).length])),
      thresholds: analysis.thresholds,
    },
  });
  return { runtime, runtimePath };
}

if (isMain(import.meta.url)) {
  let context;
  let report;
  try {
    context = createJobContext();
    report = createProgressReporter(context);
    const result = prepareJob(context, report);
    process.stdout.write(`${JSON.stringify({ jobId: context.jobId, runtime: path.relative(context.jobRoot, result.runtimePath) })}\n`);
  } catch (error) {
    if (context) (report || createProgressReporter(context))('failed', serializeError(error, 'prepare'));
    else process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'prepare') })}\n`);
    process.exitCode = 1;
  }
}
