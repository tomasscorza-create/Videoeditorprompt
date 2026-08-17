import { optional } from '../dom.js';

const PROVIDER_KEY = 'director-ai-provider';
const OPENAI_MODEL_KEY = 'director-openai-model';

export const DIRECTOR_PROVIDER_CHANGE_EVENT = 'director-provider-change';
export type DirectorProviderName = 'ollama' | 'openai';

export interface DirectorProviderSettings {
  provider: DirectorProviderName;
  model?: string;
}

export function getDirectorProviderSettings(): DirectorProviderSettings {
  const provider = localStorage.getItem(PROVIDER_KEY) === 'openai' ? 'openai' : 'ollama';
  if (provider === 'ollama') return { provider };
  return {
    provider,
    model: localStorage.getItem(OPENAI_MODEL_KEY) || 'gpt-5.6-luna',
  };
}

export function initDirectorProviderSettings(): void {
  const modelSelect = optional<HTMLSelectElement>('#director-model');
  if (!modelSelect) return;

  const initial = getDirectorProviderSettings();
  const initialValue = initial.provider === 'openai'
    ? `openai:${initial.model || 'gpt-5.6-luna'}`
    : 'ollama:qwen3:8b';
  modelSelect.value = [...modelSelect.options].some((option) => option.value === initialValue)
    ? initialValue
    : 'openai:gpt-5.6-luna';

  const sync = (notify = false) => {
    const [providerValue, ...modelParts] = modelSelect.value.split(':');
    const provider: DirectorProviderName = providerValue === 'openai' ? 'openai' : 'ollama';
    const model = modelParts.join(':');
    localStorage.setItem(PROVIDER_KEY, provider);
    if (provider === 'openai') localStorage.setItem(OPENAI_MODEL_KEY, model || 'gpt-5.6-luna');
    modelSelect.title = provider === 'openai'
      ? 'Usa la API de OpenAI configurada en el servicio local.'
      : 'Procesa la idea localmente con Ollama.';
    if (notify) window.dispatchEvent(new CustomEvent(DIRECTOR_PROVIDER_CHANGE_EVENT));
  };

  modelSelect.addEventListener('change', () => sync(true));
  sync();
}
