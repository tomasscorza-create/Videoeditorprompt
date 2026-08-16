import { optional } from './dom.js';
import { notify } from './notifications.js';
import { importElevenLabsVoice, listElevenLabsVoices, type ElevenLabsVoice } from './director/api.js';

let modal: HTMLDialogElement | null = null;
let voices: ElevenLabsVoice[] = [];
let loaded = false;

export function initElevenLabsVoices(): void {
  modal = optional<HTMLDialogElement>('#elevenlabs-voices-modal');
  if (!modal) return;
  optional<HTMLButtonElement>('#elevenlabs-manage')?.addEventListener('click', () => void openElevenLabsVoices());
  optional<HTMLButtonElement>('#elevenlabs-voices-close')?.addEventListener('click', () => modal?.close());
  optional<HTMLInputElement>('#elevenlabs-voice-search')?.addEventListener('input', render);
  modal.addEventListener('click', (event) => { if (event.target === modal) modal?.close(); });
}

export async function openElevenLabsVoices(): Promise<void> {
  if (!modal) return;
  const settings = optional<HTMLDialogElement>('#settings-modal');
  if (settings?.open) settings.close();
  if (!modal.open) modal.showModal();
  if (loaded) return render();
  await load();
}

async function load(): Promise<void> {
  const status = optional<HTMLElement>('#elevenlabs-voices-status');
  const list = optional<HTMLElement>('#elevenlabs-voices-list');
  if (status) status.textContent = 'Conectando con ElevenLabs…';
  if (list) list.replaceChildren();
  try {
    const response = await listElevenLabsVoices();
    voices = response.voices;
    loaded = true;
    if (status) status.textContent = `${voices.length} voces disponibles en tu cuenta.`;
    render();
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'No se pudo conectar con ElevenLabs.';
  }
}

function render(): void {
  const root = optional<HTMLElement>('#elevenlabs-voices-list');
  const search = optional<HTMLInputElement>('#elevenlabs-voice-search')?.value.trim().toLocaleLowerCase('es') || '';
  if (!root) return;
  root.replaceChildren();
  const filtered = voices.filter((voice) => !search || searchable(voice).includes(search));
  if (filtered.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = loaded ? 'No hay voces que coincidan con la búsqueda.' : 'Todavía no se cargaron voces.';
    root.append(empty);
    return;
  }
  for (const voice of filtered) root.append(voiceCard(voice));
}

function voiceCard(voice: ElevenLabsVoice): HTMLElement {
  const card = document.createElement('article');
  card.className = 'elevenlabs-voice-card';
  const detail = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = voice.name;
  const meta = document.createElement('p');
  meta.className = 'muted';
  meta.textContent = [voice.labels.accent, voice.labels.gender, voice.labels.age, voice.labels.use_case, voice.category].filter(Boolean).join(' · ');
  detail.append(title, meta);
  if (voice.description) {
    const description = document.createElement('p');
    description.className = 'muted';
    description.textContent = voice.description;
    detail.append(description);
  }
  if (voice.previewUrl) {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'none';
    audio.src = voice.previewUrl;
    detail.append(audio);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'secondary-button';
  add.textContent = 'Agregar';
  add.addEventListener('click', async () => {
    add.disabled = true;
    add.textContent = 'Agregando…';
    try {
      const model = optional<HTMLSelectElement>('#elevenlabs-model-select')?.value || 'eleven_multilingual_v2';
      const result = await importElevenLabsVoice(voice.voiceId, model);
      notify({ level: 'success', message: result.created ? `${result.resource.label} quedó disponible.` : `${result.resource.label} ya estaba disponible.` });
      sessionStorage.setItem('local-video.library-active-tab', 'voice');
      window.location.reload();
    } catch (error) {
      notify({ level: 'error', message: error instanceof Error ? error.message : 'No se pudo agregar la voz.' });
      add.disabled = false;
      add.textContent = 'Agregar';
    }
  });
  card.append(detail, add);
  return card;
}

function searchable(voice: ElevenLabsVoice): string {
  return [voice.name, voice.category, voice.description, ...Object.values(voice.labels)].filter(Boolean).join(' ').toLocaleLowerCase('es');
}
