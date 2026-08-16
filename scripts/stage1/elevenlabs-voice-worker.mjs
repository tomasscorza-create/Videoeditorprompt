import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createElevenLabsSpeech } from '../tts/elevenlabs-client.mjs';

const [requestPath, outputPath] = process.argv.slice(2).map((value) => path.resolve(value || ''));
try {
  if (!requestPath || !outputPath) throw new Error('Faltan las rutas de entrada o salida.');
  const request = JSON.parse(readFileSync(requestPath, 'utf8'));
  const result = await createElevenLabsSpeech(request);
  writeFileSync(outputPath, result.audio);
  process.stdout.write(`${JSON.stringify({ requestId: result.requestId, characterCost: result.characterCost, bytes: result.audio.length })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error?.code || 'ELEVENLABS_WORKER_FAILED', message: error instanceof Error ? error.message : String(error), technicalDetail: error?.technicalDetail, suggestedAction: error?.suggestedAction })}\n`);
  process.exitCode = 1;
}
