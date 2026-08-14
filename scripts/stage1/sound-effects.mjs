import { resolveAsset } from './job-context.mjs';

export function resolveSoundEffects(soundEffects = [], timelineTurns = [], durationSeconds = 0, context = null) {
  const turns = new Map(timelineTurns.map((turn) => [turn.id, turn]));
  return soundEffects.map((effect, index) => {
    let anchorSeconds;
    if (effect.anchor.kind === 'scene') {
      anchorSeconds = effect.anchor.edge === 'start' ? 0 : durationSeconds;
    } else {
      const turn = turns.get(effect.anchor.turnId);
      if (!turn) throw soundEffectError('SFX_ANCHOR_TURN_MISSING', `El efecto ${effect.id} referencia un turno inexistente.`, `/soundEffects/${index}/anchor/turnId`);
      anchorSeconds = effect.anchor.edge === 'start' ? turn.startSeconds : turn.endSeconds;
    }
    const startSeconds = anchorSeconds + effect.offsetSeconds;
    if (startSeconds < 0 || startSeconds > durationSeconds) {
      throw soundEffectError('SFX_EVENT_OUTSIDE_SCENE', `El efecto ${effect.id} queda fuera de la escena medida.`, `/soundEffects/${index}/offsetSeconds`);
    }
    return {
      id: effect.id,
      asset: effect.asset,
      file: context ? resolveAsset(context, effect.asset, `soundEffect/${effect.id}`) : effect.asset,
      startSeconds: Number(startSeconds.toFixed(6)),
      gainDb: effect.gainDb,
    };
  });
}

export function appendSoundEffectMix({ inputArgs, filters, mixLabels, soundEffects, firstInputIndex, durationSeconds }) {
  for (const [index, effect] of soundEffects.entries()) {
    const inputIndex = firstInputIndex + index;
    const label = `sfx${index}`;
    const delaySamples = Math.round(effect.startSeconds * 22_050);
    const quantizedStartSeconds = delaySamples / 22_050;
    const gain = 10 ** (effect.gainDb / 20);
    inputArgs.push('-itsoffset', quantizedStartSeconds.toFixed(9), '-i', effect.file);
    filters.push(
      `[${inputIndex}:a]aresample=22050:async=1:first_pts=0,aformat=sample_fmts=s16:channel_layouts=mono,volume=${gain.toFixed(8)},atrim=0:${durationSeconds.toFixed(6)}[${label}]`,
    );
    mixLabels.push(`[${label}]`);
  }
}

function soundEffectError(code, message, path) {
  const error = new Error(message);
  error.name = 'SoundEffectError';
  error.code = code;
  error.path = path;
  return error;
}
