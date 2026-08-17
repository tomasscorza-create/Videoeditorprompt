// E3 — Traducción de LocalHealth a un diagnóstico por dependencia con acción
// sugerida. Módulo puro y testeable: no toca el DOM.
//
// Regla: nunca inventar un estado. Si la API no informa algo (por ejemplo la
// versión de Ollama), la fila lo omite en vez de rellenar con un valor falso.

import type { LocalHealth } from './api.js';

export type DependencyState = 'ok' | 'warn' | 'error';

export interface DependencyView {
  id: string;
  name: string;
  state: DependencyState;
  detail: string;
  /** Qué hacer para resolverlo. `null` cuando no hay nada que hacer. */
  action: string | null;
}

export interface HealthSummary {
  ready: boolean;
  badge: string;
  dependencies: DependencyView[];
  /** Identidad del modelo, para reproducibilidad. `null` si no se conoce. */
  modelIdentity: string | null;
}

export function summarizeHealth(health: LocalHealth): HealthSummary {
  const dependencies: DependencyView[] = [];
  const director = health.director ?? health.ollama ?? { available: false, modelInstalled: false };
  const providerName = health.director?.provider === 'openai' ? 'OpenAI' : 'Ollama';

  if (!director.available) {
    dependencies.push({
      id: health.director?.provider ?? 'ollama',
      name: providerName,
      state: 'error',
      detail: director.error?.message ?? 'El proveedor de IA no responde.',
      action: director.error?.suggestedAction ?? 'Revisá la configuración del proveedor y volvé a comprobar.',
    });
  } else if (!director.modelInstalled) {
    const model = director.model ?? 'el modelo del Director';
    dependencies.push({
      id: health.director?.provider ?? 'ollama',
      name: providerName,
      state: 'error',
      detail: `El servicio responde, pero falta el modelo ${model}.`,
      action: director.error?.suggestedAction ?? (providerName === 'Ollama' ? `Instalalo con: ollama pull ${model}` : 'Revisá el acceso de la clave a este modelo.'),
    });
  } else {
    dependencies.push({
      id: health.director?.provider ?? 'ollama',
      name: providerName,
      state: 'ok',
      detail: [director.model, director.version ? `versión ${director.version}` : null]
        .filter(Boolean).join(' · ') || 'Disponible.',
      action: null,
    });
  }

  dependencies.push(health.tts.available
    ? { id: 'tts', name: 'Voces (ElevenLabs)', state: 'ok', detail: 'API disponible para generar voces y medir tiempos.', action: null }
    : {
      id: 'tts',
      name: 'Voces (ElevenLabs)',
      state: 'error',
      detail: 'No está disponible: sin él no se puede renderizar ni medir la duración real.',
      action: 'Configurá la clave de ElevenLabs y verificá la conexión.',
    });

  dependencies.push(health.renderBusy
    ? { id: 'render', name: 'Exportación', state: 'warn', detail: 'Hay una exportación en curso.', action: 'Esperá a que termine para iniciar otra.' }
    : { id: 'render', name: 'Render', state: 'ok', detail: 'Libre para aceptar un trabajo.', action: null });

  const failing = dependencies.filter((item) => item.state === 'error');
  return {
    ready: failing.length === 0,
    badge: failing.length === 0 ? 'Listo' : failing.length === 1 ? `Falta ${failing[0].name}` : 'Revisar',
    dependencies,
    modelIdentity: describeModelIdentity(health),
  };
}

function describeModelIdentity(health: LocalHealth): string | null {
  const director = health.director ?? health.ollama;
  if (!director?.model) return null;
  const digest = director.digest ? ` · ${director.digest.slice(0, 12)}` : '';
  return `${director.model}${digest}`;
}
