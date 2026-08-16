import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElevenLabsSpeech, listElevenLabsVoices, resolveElevenLabsApiKey } from './elevenlabs-client.mjs';
import { generateVoice } from '../stage1/tts-voice.mjs';
import { run, sha256 } from '../stage1/common.mjs';

let listRequest;
const voices = await listElevenLabsVoices({
  apiKey: 'test-secret-key',
  fetchImpl: async (url, options) => {
    listRequest = { url, options };
    return new Response(JSON.stringify({ voices: [{
      voice_id: 'VoiceTest1234567890', name: 'Luna Latina', category: 'premade',
      labels: { accent: 'latin american', gender: 'female' }, description: 'Cálida', preview_url: 'https://example.com/preview.mp3',
    }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});
assert.equal(voices.length, 1);
assert.equal(voices[0].voiceId, 'VoiceTest1234567890');
assert.equal(listRequest.options.headers['xi-api-key'], 'test-secret-key');
assert.match(listRequest.url, /^https:\/\/api\.elevenlabs\.io\/v2\/voices/u);

let speechRequest;
const speech = await createElevenLabsSpeech({
  text: 'Una prueba de voz natural.', voiceId: 'VoiceTest1234567890', model: 'eleven_multilingual_v2', seed: 42,
}, {
  apiKey: 'test-secret-key',
  fetchImpl: async (url, options) => {
    speechRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(Uint8Array.from([73, 68, 51, 4]), { status: 200, headers: { 'request-id': 'request-test', 'character-cost': '27' } });
  },
});
assert.match(speechRequest.url, /output_format=mp3_44100_128/u);
assert.equal(speechRequest.body.model_id, 'eleven_multilingual_v2');
assert.equal(speechRequest.body.seed, 42);
assert.deepEqual([...speech.audio], [73, 68, 51, 4]);
assert.equal(speech.characterCost, 27);
assert.equal(resolveElevenLabsApiKey({ ELEVENLABS_API_KEY: '  secret-value  ' }), 'secret-value');
assert.throws(() => resolveElevenLabsApiKey({}), (error) => error.code === 'ELEVENLABS_API_KEY_MISSING');

const tempRoot = mkdtempSync(path.join(tmpdir(), 'elevenlabs-voice-cache-'));
try {
  const context = {
    ttsRoot: path.join(tempRoot, 'tts'), tempRoot: path.join(tempRoot, 'temp'), generatedRoot: path.join(tempRoot, 'generated'),
  };
  for (const directory of [path.join(context.ttsRoot, 'cache'), path.join(context.ttsRoot, 'fonts'), context.tempRoot, context.generatedRoot]) mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(context.ttsRoot, 'fonts', 'arial.ttf'), 'test-font');
  const voice = { provider: 'elevenlabs', model: 'eleven_multilingual_v2', voiceId: 'VoiceTest1234567890', text: 'Audio desde caché.', lengthScale: 1, volume: 1 };
  const key = sha256(JSON.stringify({ provider: 'elevenlabs', model: voice.model, voiceId: voice.voiceId, text: voice.text, lengthScale: 1, volume: 1, output: 'pcm_s16le-22050-mono-v1' }));
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'pcm_s16le', '-ar', '22050', '-ac', '1', path.join(context.ttsRoot, 'cache', `${key}.wav`)]);
  const generated = generateVoice(context, voice, () => {}, { turnId: 'turno-test' });
  assert.equal(generated.cacheHit, true);
  assert.equal(generated.voiceKey, key);
  assert.equal(Number(generated.probe.format.duration) > 0, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ version: 1, passed: 15, failed: 0 })}\n`);
