import type { DirectorMode, DirectorPage } from './navigation.js';

export type DirectorFlowAction = 'command' | 'project' | 'render' | 'editor' | 'health';
export type DirectorBusyMode = 'ai' | 'render' | null;
export type RenderRequirementState = 'complete' | 'pending' | 'blocked';

export interface DirectorFlowInput {
  mode: DirectorMode;
  page: DirectorPage;
  projectAvailable: boolean;
  validationError: string | null;
  workspaceMode: 'editor' | 'creator';
  healthChecked: boolean;
  directorReady: boolean;
  renderReady: boolean;
  outputState: 'missing' | 'current' | 'stale';
  busyMode: DirectorBusyMode;
}

export interface DirectorFlowGuidance {
  eyebrow: string;
  title: string;
  detail: string;
  action: { id: DirectorFlowAction; label: string } | null;
}

export interface RenderRequirement {
  id: 'content' | 'contract' | 'workspace' | 'voice';
  label: string;
  detail: string;
  state: RenderRequirementState;
}

export function describeDirectorFlow(input: DirectorFlowInput): DirectorFlowGuidance {
  if (input.busyMode === 'ai') {
    return {
      eyebrow: 'En curso',
      title: 'El Director está preparando los cambios',
      detail: 'Al terminar podrás revisar el resultado antes de continuar.',
      action: null,
    };
  }
  if (input.busyMode === 'render') {
    return {
      eyebrow: 'En curso',
      title: 'Estamos generando el video',
      detail: 'Podés seguir el avance en Render o cancelar el trabajo actual.',
      action: input.page === 'render' ? null : { id: 'render', label: 'Ver progreso' },
    };
  }
  if (!input.projectAvailable) {
    if (input.healthChecked && !input.directorReady) {
      return {
        eyebrow: 'Antes de empezar',
        title: 'Prepará el Director IA',
        detail: 'Ollama y el modelo local deben estar disponibles para crear la primera propuesta.',
        action: { id: 'health', label: 'Ver diagnóstico' },
      };
    }
    return {
      eyebrow: 'Paso 1 de 3',
      title: 'Empezá por una idea',
      detail: 'Describí el video y el Director preparará una propuesta editable.',
      action: input.page === 'command' ? null : { id: 'command', label: 'Escribir la idea' },
    };
  }
  if (input.validationError) {
    return {
      eyebrow: 'Acción necesaria',
      title: 'Completá el proyecto',
      detail: input.validationError,
      action: input.page === 'project' ? null : { id: 'project', label: 'Revisar proyecto' },
    };
  }
  if (input.workspaceMode === 'creator') {
    return {
      eyebrow: 'Acción necesaria',
      title: 'Volvé al Editor de video',
      detail: 'El Creador sirve para preparar recursos; el proyecto se revisa y renderiza desde el Editor.',
      action: { id: 'editor', label: 'Volver al Editor' },
    };
  }
  if (!input.healthChecked) {
    return {
      eyebrow: 'Comprobando',
      title: 'Estamos revisando el motor local',
      detail: 'La disponibilidad de voces y render aparecerá en unos instantes.',
      action: null,
    };
  }
  if (!input.renderReady) {
    return {
      eyebrow: 'Acción necesaria',
      title: 'Prepará el motor de voces',
      detail: 'Piper debe estar disponible para medir los diálogos y generar el MP4.',
      action: { id: 'health', label: 'Ver diagnóstico' },
    };
  }
  if (input.outputState === 'current') {
    return {
      eyebrow: 'Video al día',
      title: 'La edición y el último MP4 coinciden',
      detail: 'Podés reproducirlo, descargarlo o volver a editar el proyecto.',
      action: null,
    };
  }
  if (input.outputState === 'stale') {
    return {
      eyebrow: 'Paso 3 de 3',
      title: 'Actualizá el video',
      detail: 'Hay cambios posteriores al último MP4. El render anterior se conserva.',
      action: input.page === 'render' ? null : { id: 'render', label: 'Ir a Render' },
    };
  }
  if (input.page === 'project') {
    return {
      eyebrow: 'Paso 2 de 3',
      title: 'Revisá la propuesta',
      detail: 'Comprobá escenas y diálogos. Cuando esté lista, generá el primer MP4.',
      action: { id: 'render', label: 'Preparar render' },
    };
  }
  if (input.page === 'render') {
    return {
      eyebrow: 'Paso 3 de 3',
      title: 'Todo listo para renderizar',
      detail: 'El render generará las voces, medirá los tiempos reales y producirá el MP4.',
      action: null,
    };
  }
  return {
    eyebrow: input.mode === 'editing' ? 'Siguiente paso' : 'Paso 2 de 3',
    title: input.mode === 'editing' ? 'Ajustá o continuá al render' : 'Revisá la propuesta',
    detail: input.mode === 'editing'
      ? 'Podés pedir un cambio al Director o generar el video con el estado actual.'
      : 'La propuesta ya puede revisarse antes de producir el video.',
    action: { id: input.mode === 'editing' ? 'render' : 'project', label: input.mode === 'editing' ? 'Ir a Render' : 'Revisar propuesta' },
  };
}

export function describeRenderRequirements(input: DirectorFlowInput): RenderRequirement[] {
  return [
    {
      id: 'content',
      label: 'Contenido',
      detail: input.projectAvailable ? 'El proyecto tiene escenas y contenido.' : 'Primero creá o abrí un proyecto.',
      state: input.projectAvailable ? 'complete' : 'blocked',
    },
    {
      id: 'contract',
      label: 'Proyecto',
      detail: input.validationError ? input.validationError : 'La estructura es compatible con el render.',
      state: !input.projectAvailable || input.validationError ? 'blocked' : 'complete',
    },
    {
      id: 'workspace',
      label: 'Espacio de trabajo',
      detail: input.workspaceMode === 'editor' ? 'Estás trabajando en el Editor de video.' : 'Volvé al Editor antes de renderizar.',
      state: input.workspaceMode === 'editor' ? 'complete' : 'blocked',
    },
    {
      id: 'voice',
      label: 'Voces y tiempos',
      detail: !input.healthChecked
        ? 'Comprobando Piper…'
        : input.renderReady
          ? 'Piper está disponible para generar y medir las voces.'
          : 'Piper no está disponible.',
      state: !input.healthChecked ? 'pending' : input.renderReady ? 'complete' : 'blocked',
    },
  ];
}
