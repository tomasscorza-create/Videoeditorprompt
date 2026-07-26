import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ffprobe, readJson, writeJson } from './common.mjs';
import { resolveAsset } from './job-context.mjs';

export function verifyDialogueJob(context, config) {
  const runtime = readJson(path.join(context.runtimeRoot, 'scene-runtime.json'));
  const generatedPath = (relativePath) => path.join(context.generatedRoot, ...relativePath.split('/'));
  const dialogue = readJson(generatedPath(runtime.dialoguePath));
  const plan1 = readJson(path.join(context.resultRoot, 'frame-plan-1.json'));
  const plan2 = readJson(path.join(context.resultRoot, 'frame-plan-2.json'));
  const metrics1 = readJson(path.join(context.resultRoot, 'export-metrics-1.json'));
  const metrics2 = readJson(path.join(context.resultRoot, 'export-metrics-2.json'));
  const checks = [];
  const check = (name, condition, evidence) => {
    assert.ok(condition, name);
    checks.push({ name, passed: true, evidence });
  };

  check('Contrato y runtime versión 2', config.version === 2 && runtime.version === 2, { config: config.version, runtime: runtime.version });
  check('Dos personajes aislados', runtime.characters.length === 2 && new Set(runtime.characters.map((item) => item.id)).size === 2, runtime.characters.map((item) => item.id));
  check('Cantidad de turnos compilada', dialogue.turns.length === config.dialogue.length, dialogue.turns.map((turn) => turn.id));
  check('Turnos ordenados y sin solapamiento', dialogue.turns.every((turn, index) => turn.endSeconds > turn.startSeconds && (index === 0 || turn.startSeconds >= dialogue.turns[index - 1].endSeconds)), true);
  check('Hablantes referencian personajes', dialogue.turns.every((turn) => runtime.characters.some((character) => character.id === turn.speakerId)), true);
  check('Audio maestro portable', !path.isAbsolute(runtime.audio.path) && !path.isAbsolute(runtime.dialoguePath), [runtime.audio.path, runtime.dialoguePath]);
  check('Assets y manifests portables', runtime.characters.every((character) => !path.isAbsolute(character.characterRig.manifestPath) && Object.values(character.assets).every((value) => !path.isAbsolute(value))), true);
  if (runtime.characters.every((character) => character.characterRig.version === 2)) {
    check('Rigs paramétricos versión 2', runtime.characters.every((character) => character.characterRig.sourceDefinition && !path.isAbsolute(character.characterRig.sourceDefinition)), runtime.characters.map((character) => character.characterRig.id));
    check('Joints y poses compilados', runtime.characters.every((character) => character.characterRig.joints.length >= 4 && ['neutral', 'point'].every((pose) => character.characterRig.poses.some((item) => item.id === pose))), runtime.characters.map((character) => ({ id: character.id, joints: character.characterRig.joints.length, poses: character.characterRig.poses.map((pose) => pose.id) })));
    check('IDs de catálogo conservados', runtime.characters.every((character) => character.catalogEntry?.id), runtime.characters.map((character) => character.catalogEntry?.id));
  }
  if (new Set(config.characters.map((character) => character.characterManifest)).size === config.characters.length) {
    check('Rigs de personajes distinguibles', new Set(runtime.characters.map((character) => character.characterRig.id)).size === runtime.characters.length, runtime.characters.map((character) => character.characterRig.id));
  }
  check('Duración compilada coincide', Math.abs(runtime.audio.durationSeconds - dialogue.turns.at(-1).endSeconds) < 0.03, { audio: runtime.audio.durationSeconds, timeline: dialogue.turns.at(-1).endSeconds });
  check('Pausas medidas presentes', dialogue.turns.slice(0, -1).every((turn, index) => Math.abs(dialogue.turns[index + 1].startSeconds - turn.endSeconds - turn.gapAfterSeconds) < 1e-6), true);
  const mouthStates = new Set(['closed', 'medium', 'open', 'round', 'labiodental', 'bilabial']);
  check('Cues de boca hÃ­bridos o fallback RMS', dialogue.turns.every((turn) => (
    turn.mouthCues.length > 0
    && ['hybrid-grapheme-rms-v1', 'rms-fallback'].includes(turn.mouthCueSource)
    && turn.mouthCues.every((cue) => mouthStates.has(cue.state))
  )), dialogue.turns.map((turn) => ({ source: turn.mouthCueSource, cues: turn.mouthCues.length })));
  check('Subtítulos por turno y portables', dialogue.turns.every((turn) => turn.subtitlePath && !path.isAbsolute(turn.subtitlePath)), dialogue.turns.map((turn) => turn.subtitlePath));
  check('Parpadeos independientes', runtime.characters.every((character) => character.blinks.length >= 2), runtime.characters.map((character) => character.blinks.length));

  for (const character of runtime.characters) {
    for (const [name, asset] of Object.entries(character.assets)) {
      const stream = ffprobe(resolveAsset(context, asset, `${character.id}/${name}`)).streams[0];
      check(`${character.id}/${name} 1080x1920 RGBA`, stream.width === 1080 && stream.height === 1920 && stream.pix_fmt === 'rgba', { width: stream.width, height: stream.height, pixFmt: stream.pix_fmt });
    }
  }
  const background = ffprobe(resolveAsset(context, runtime.assets.background, 'background')).streams[0];
  check('Fondo 1080x1920', background.width === 1080 && background.height === 1920, { width: background.width, height: background.height });
  if (runtime.backgroundAnimation) {
    check('Fondo animado con 2-3 capas', runtime.backgroundAnimation.layers.length >= 2 && runtime.backgroundAnimation.layers.length <= 3, runtime.backgroundAnimation.layers.map((layer) => layer.id));
    for (const layer of runtime.backgroundAnimation.layers) {
      const stream = ffprobe(resolveAsset(context, layer.asset, `background/${layer.id}`)).streams[0];
      check(`Capa ${layer.id} 1080x1920`, stream.width === 1080 && stream.height === 1920, { width: stream.width, height: stream.height, pixFmt: stream.pix_fmt });
    }
  }

  check('Planes temporales idénticos', plan1.temporalHash === plan2.temporalHash, plan1.temporalHash);
  check('Frames PNG idénticos', metrics1.frameContentHash === metrics2.frameContentHash, metrics1.frameContentHash);
  check('Cantidad de frames consistente', metrics1.frameCount === metrics2.frameCount && metrics1.frameCount === Math.ceil(runtime.audio.durationSeconds * config.video.fps), metrics1.frameCount);
  check('Cada turno aparece en frames', dialogue.turns.every((turn) => plan1.frames.some((frame) => frame.activeTurnId === turn.id)), true);
  check('Solo habla un personaje', plan1.frames.every((frame) => frame.characters.filter((character) => character.speaking).length <= 1), true);
  check('Boca inactiva siempre cerrada', plan1.frames.every((frame) => frame.characters.filter((character) => !character.speaking).every((character) => character.mouth === 'closed')), true);
  check('Hablante activo coincide', plan1.frames.every((frame) => frame.characters.find((character) => character.speaking)?.id === frame.activeSpeakerId || frame.activeSpeakerId === null), true);
  check('Gestos solo en el hablante', plan1.frames.every((frame) => frame.characters.filter((character) => character.gesture !== 'neutral').every((character) => character.speaking)), true);
  if (dialogue.turns.some((turn) => turn.gesture === 'point')) {
    check('Gesto point compilado', plan1.frames.some((frame) => frame.characters.some((character) => character.gesture === 'point')), true);
  }
  check('Pausas sin hablante ni subtítulo', plan1.frames.some((frame) => frame.activeSpeakerId === null && frame.subtitlePath === null), true);
  check('Dos posiciones visibles', plan1.frames.some((frame) => frame.characters[0].character.x < 0 && frame.characters[1].character.x > 0), true);
  if (runtime.backgroundAnimation) {
    check('Cámara cambia durante la escena', plan1.frames[0].background.camera.x !== plan1.frames.at(-1).background.camera.x || plan1.frames[0].background.camera.zoom !== plan1.frames.at(-1).background.camera.zoom, { first: plan1.frames[0].background.camera, last: plan1.frames.at(-1).background.camera });
    check('Parallax diferencia planos', plan1.frames.at(-1).background.layers[0].x !== plan1.frames.at(-1).background.layers.at(-1).x, plan1.frames.at(-1).background.layers);
  }

  const videos = [];
  for (const runNumber of [1, 2]) {
    const file = path.join(context.resultRoot, `render-${runNumber}.mp4`);
    const probe = ffprobe(file);
    const video = probe.streams.find((stream) => stream.codec_type === 'video');
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
    check(`MP4 ${runNumber} H.264/AAC/yuv420p`, video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && audio.codec_name === 'aac', { video: video.codec_name, audio: audio.codec_name, pixFmt: video.pix_fmt });
    check(`MP4 ${runNumber} vertical completo`, video.width === 1080 && video.height === 1920 && video.r_frame_rate === '30/1' && Number(probe.format.duration) >= runtime.audio.durationSeconds, probe.format.duration);
    videos.push({ runNumber, file: `render-${runNumber}.mp4`, sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), probe });
  }
  check('MP4 binariamente idénticos', videos[0].sha256 === videos[1].sha256, videos[0].sha256);
  const result = { version: 2, jobId: context.jobId, verifiedAt: new Date().toISOString(), passed: checks.length, failed: 0, checks, videos };
  writeJson(path.join(context.resultRoot, 'verification.json'), result);
  return result;
}
