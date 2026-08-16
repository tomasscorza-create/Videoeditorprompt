import { generateElevenLabsVoice } from './elevenlabs-voice.mjs';
import { PipelineError } from './errors.mjs';

export function generateVoice(context, voice, report, detail = {}) {
  if (voice.provider === 'elevenlabs') return generateElevenLabsVoice(context, voice, report, detail);
  throw new PipelineError({
    code: 'TTS_PROVIDER_UNSUPPORTED',
    stage: 'generating_voice',
    message: 'La voz seleccionada no pertenece a ElevenLabs.',
    suggestedAction: 'Elegí o importá una voz desde ElevenLabs.',
  });
}
