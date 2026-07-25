import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { analyzeWav } from './audio-analysis.mjs';
import { buildBlinkSchedule } from '../../shared/scene-evaluator.js';
import { ensureDirectory, ffprobe, run, sha256, writeJson } from './common.mjs';
import { generatePiperVoice } from './piper-voice.mjs';
import { renderSubtitle, wrapSubtitleText } from './subtitle-renderer.mjs';
import { normalizeSpanishTtsText } from './tts-text.mjs';
import { validateMeasuredDuration } from './validate-scene-config.mjs';

export function prepareDialogueJob(context, config, report) {
  report('preparing', { stage: 'prepare', config: 'input/scene.config.json', contractVersion: 2 });
  const timelineTurns = [];
  const audioSequence = [];
  let cursor = 0;
  let totalTtsSeconds = 0;
  let totalAnalysisSeconds = 0;
  let fontPath = null;

  for (const turn of config.dialogue) {
    const ttsText = normalizeSpanishTtsText(turn.text);
    const generated = generatePiperVoice(context, { text: ttsText, ...turn.voice }, report, {
      turnId: turn.id,
      speakerId: turn.speakerId,
    });
    fontPath ||= generated.support.fontPath;
    totalTtsSeconds += generated.ttsSeconds;
    const durationSeconds = Number(generated.probe.format.duration);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      validateMeasuredDuration(config, durationSeconds);
    }
    report('analyzing_audio', { stage: 'analyzing_audio', turnId: turn.id, speakerId: turn.speakerId, durationSeconds });
    const analysisStarted = performance.now();
    const analysis = analyzeWav(generated.jobWav, config.mouth);
    totalAnalysisSeconds += (performance.now() - analysisStarted) / 1000;
    const subtitleText = wrapSubtitleText(turn.text);
    const subtitle = renderSubtitle(context, config.video, subtitleText, config.subtitleStyle, fontPath);
    const startSeconds = cursor;
    const endSeconds = startSeconds + durationSeconds;
    timelineTurns.push({
      id: turn.id,
      speakerId: turn.speakerId,
      startSeconds,
      endSeconds,
      durationSeconds,
      gapAfterSeconds: turn.gapAfterSeconds,
      audioPath: generated.audioRelative,
      subtitlePath: subtitle.subtitleRelative,
      subtitleText,
      ttsText,
      mouthCues: analysis.cues,
      gesture: turn.gesture ?? 'neutral',
      voice: { model: turn.voice.model, ...(turn.voice.speaker !== undefined ? { speaker: turn.voice.speaker } : {}), lengthScale: turn.voice.lengthScale, volume: turn.voice.volume },
      cacheKey: generated.voiceKey,
      cacheHit: generated.cacheHit,
    });
    audioSequence.push({ type: 'voice', file: generated.jobWav });
    if (turn.gapAfterSeconds > 0) audioSequence.push({ type: 'silence', durationSeconds: turn.gapAfterSeconds });
    cursor = endSeconds + turn.gapAfterSeconds;
  }

  const timelineKey = sha256(JSON.stringify({
    configVersion: config.version,
    turns: timelineTurns.map(({ id, speakerId, durationSeconds, gapAfterSeconds, cacheKey, gesture }) => ({ id, speakerId, durationSeconds, gapAfterSeconds, cacheKey, gesture })),
  }));
  const masterRelative = path.posix.join('audio', `dialogue-${timelineKey}.wav`);
  const masterPath = path.join(context.generatedRoot, ...masterRelative.split('/'));
  ensureDirectory(path.dirname(masterPath));
  composeDialogueAudio(audioSequence, masterPath);
  const masterProbe = ffprobe(masterPath);
  const durationSeconds = Number(masterProbe.format.duration);
  validateMeasuredDuration(config, durationSeconds);
  const dialogueRelative = path.posix.join('dialogue', `${timelineKey}.json`);
  writeJson(path.join(context.generatedRoot, ...dialogueRelative.split('/')), {
    version: 1,
    jobId: context.jobId,
    timelineKey,
    turns: timelineTurns,
  });

  const characters = context.resolvedCharacters.map((character) => ({
    id: character.id,
    assets: character.assets,
    characterRig: character.characterRig,
    ...(character.catalogEntry ? { catalogEntry: character.catalogEntry } : {}),
    transform: character.transform,
    blinks: buildBlinkSchedule(durationSeconds, character.blink),
  }));
  const runtime = {
    version: 2,
    jobId: context.jobId,
    configVersion: config.version,
    cacheKey: timelineKey,
    assets: context.resolvedAssets,
    backgroundAnimation: context.resolvedBackgroundAnimation,
    characters,
    dialoguePath: dialogueRelative,
    audio: {
      path: masterRelative,
      durationSeconds,
      sampleRate: Number(masterProbe.streams.find((item) => item.codec_type === 'audio').sample_rate),
      channels: masterProbe.streams.find((item) => item.codec_type === 'audio').channels,
    },
    preparation: {
      turnCount: timelineTurns.length,
      cacheHits: timelineTurns.filter((turn) => turn.cacheHit).length,
      ttsSeconds: totalTtsSeconds,
      analysisSeconds: totalAnalysisSeconds,
    },
  };
  const runtimePath = path.join(context.runtimeRoot, 'scene-runtime.json');
  writeJson(runtimePath, runtime);
  writeJson(path.join(context.runtimeRoot, 'preparation-metrics.json'), {
    version: 2,
    jobId: context.jobId,
    cacheKey: timelineKey,
    audio: masterProbe,
    turns: timelineTurns.map((turn) => ({
      id: turn.id,
      speakerId: turn.speakerId,
      startSeconds: turn.startSeconds,
      endSeconds: turn.endSeconds,
      durationSeconds: turn.durationSeconds,
      cacheHit: turn.cacheHit,
      cueCount: turn.mouthCues.length,
    })),
    ttsSeconds: totalTtsSeconds,
    analysisSeconds: totalAnalysisSeconds,
  });
  return { runtime, runtimePath };
}

function composeDialogueAudio(sequence, outputPath) {
  const inputArgs = [];
  const labels = [];
  const filters = [];
  for (const [index, item] of sequence.entries()) {
    if (item.type === 'voice') inputArgs.push('-i', item.file);
    else inputArgs.push('-f', 'lavfi', '-t', String(item.durationSeconds), '-i', 'anullsrc=r=22050:cl=mono');
    filters.push(`[${index}:a]aresample=22050,aformat=sample_fmts=s16:channel_layouts=mono[s${index}]`);
    labels.push(`[s${index}]`);
  }
  filters.push(`${labels.join('')}concat=n=${sequence.length}:v=0:a=1[out]`);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputArgs,
    '-filter_complex', filters.join(';'), '-map', '[out]',
    '-c:a', 'pcm_s16le', '-ar', '22050', '-ac', '1', outputPath,
  ], { stage: 'generating_voice', errorCode: 'FFMPEG_DIALOGUE_AUDIO_EXIT_NONZERO' });
}
