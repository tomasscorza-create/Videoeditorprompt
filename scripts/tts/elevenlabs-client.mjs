import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PipelineError } from '../stage1/errors.mjs';

export const ELEVENLABS_API_URL = 'https://api.elevenlabs.io';
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_multilingual_v2';

export function resolveElevenLabsApiKey(environment = process.env) {
  const direct = environment.ELEVENLABS_API_KEY;
  const file = environment.ELEVENLABS_API_KEY_FILE;
  if (direct && file) fail('ELEVENLABS_SECRET_CONFLICT', 'Configurá la clave de ElevenLabs como valor o archivo, no ambos.');
  if (direct) return String(direct).trim();
  if (file) {
    if (!path.isAbsolute(file)) fail('ELEVENLABS_SECRET_FILE_INVALID', 'La ruta de la clave de ElevenLabs debe ser absoluta.');
    try {
      const stats = statSync(file);
      if (!stats.isFile() || stats.size < 8 || stats.size > 16 * 1024) throw new Error('Tamaño inválido.');
      return readFileSync(file, 'utf8').trim();
    } catch (error) {
      fail('ELEVENLABS_SECRET_FILE_INVALID', 'No se pudo leer el archivo de clave de ElevenLabs.', error);
    }
  }
  fail('ELEVENLABS_API_KEY_MISSING', 'ElevenLabs no está configurado en este equipo.');
}

export async function listElevenLabsVoices(options = {}) {
  const data = await requestJson('/v2/voices?page_size=100&include_total_count=false&sort=name&sort_direction=asc', options);
  return (Array.isArray(data?.voices) ? data.voices : []).map(normalizeVoice).filter(Boolean);
}

export async function getElevenLabsVoice(voiceId, options = {}) {
  assertVoiceId(voiceId);
  return normalizeVoice(await requestJson(`/v1/voices/${encodeURIComponent(voiceId)}`, options));
}

export async function inspectElevenLabs(options = {}) {
  const voices = await listElevenLabsVoices(options);
  return { available: true, configured: true, voiceCount: voices.length };
}

export async function createElevenLabsSpeech({ text, voiceId, model = DEFAULT_ELEVENLABS_MODEL, seed }, options = {}) {
  if (typeof text !== 'string' || text.trim().length < 1 || text.length > 5000) {
    fail('ELEVENLABS_TEXT_INVALID', 'El texto para ElevenLabs está vacío o supera el límite local.');
  }
  assertVoiceId(voiceId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(model)) fail('ELEVENLABS_MODEL_INVALID', 'El modelo de ElevenLabs no es válido.');
  const response = await request(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    ...options,
    method: 'POST',
    body: JSON.stringify({
      text,
      model_id: model,
      ...(Number.isInteger(seed) ? { seed: seed >>> 0 } : {}),
    }),
  });
  return {
    audio: Buffer.from(await response.arrayBuffer()),
    requestId: response.headers.get('request-id') || null,
    characterCost: numberHeader(response.headers.get('character-cost')),
  };
}

async function requestJson(route, options) {
  const response = await request(route, options);
  try {
    return JSON.parse(await response.text());
  } catch (error) {
    fail('ELEVENLABS_RESPONSE_INVALID', 'ElevenLabs devolvió una respuesta inválida.', error);
  }
}

async function request(route, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('ELEVENLABS_FETCH_UNAVAILABLE', 'El runtime no permite conectarse con ElevenLabs.');
  const apiKey = options.apiKey || resolveElevenLabsApiKey(options.environment || process.env);
  const baseUrl = normalizeBaseUrl(options.baseUrl || process.env.ELEVENLABS_API_BASE_URL || ELEVENLABS_API_URL);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method: options.method || 'GET',
      headers: { 'xi-api-key': apiKey, ...(options.body ? { 'content-type': 'application/json' } : {}) },
      body: options.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await safeErrorDetail(response);
      const code = response.status === 401 ? 'ELEVENLABS_AUTH_INVALID'
        : response.status === 429 ? 'ELEVENLABS_LIMIT_REACHED' : 'ELEVENLABS_REQUEST_FAILED';
      const message = response.status === 401 ? 'ElevenLabs rechazó la clave configurada.'
        : response.status === 429 ? 'ElevenLabs alcanzó el límite de créditos o solicitudes.'
          : 'ElevenLabs rechazó la solicitud de voz.';
      throw new PipelineError({ code, stage: 'generating_voice', message, technicalDetail: `HTTP ${response.status}${detail ? `: ${detail}` : ''}`, suggestedAction: 'Revisá la clave, sus permisos y los créditos disponibles.' });
    }
    return response;
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    throw new PipelineError({
      code: error?.name === 'AbortError' ? 'ELEVENLABS_TIMEOUT' : 'ELEVENLABS_UNAVAILABLE',
      stage: 'generating_voice',
      message: error?.name === 'AbortError' ? 'ElevenLabs agotó el tiempo permitido.' : 'No se pudo conectar con ElevenLabs.',
      cause: error,
      suggestedAction: 'Comprobá la conexión y volvé a intentar.',
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeVoice(value) {
  if (!value || !/^[a-zA-Z0-9_-]{8,128}$/u.test(String(value.voice_id || ''))) return null;
  const labels = value.labels && typeof value.labels === 'object' ? value.labels : {};
  return {
    voiceId: value.voice_id,
    name: String(value.name || 'Voz sin nombre').slice(0, 100),
    category: String(value.category || 'voice').slice(0, 40),
    labels: Object.fromEntries(Object.entries(labels).slice(0, 20).map(([key, item]) => [String(key).slice(0, 40), String(item).slice(0, 100)])),
    description: typeof value.description === 'string' ? value.description.slice(0, 300) : null,
    previewUrl: typeof value.preview_url === 'string' && value.preview_url.startsWith('https://') ? value.preview_url : null,
  };
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  const official = url.protocol === 'https:' && url.hostname === 'api.elevenlabs.io';
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (!official && !loopback) fail('ELEVENLABS_URL_INVALID', 'La URL de ElevenLabs no está permitida.');
  return url.origin;
}

async function safeErrorDetail(response) {
  const text = (await response.text()).slice(0, 1000);
  try { return String(JSON.parse(text)?.detail?.message || JSON.parse(text)?.detail || '').slice(0, 800); } catch { return text; }
}
function numberHeader(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function assertVoiceId(value) { if (!/^[a-zA-Z0-9_-]{8,128}$/u.test(String(value || ''))) fail('ELEVENLABS_VOICE_INVALID', 'El identificador de voz de ElevenLabs no es válido.'); }
function fail(code, message, cause) { throw new PipelineError({ code, stage: 'generating_voice', message, cause, suggestedAction: 'Revisá la configuración de ElevenLabs.' }); }
