import type { CharacterDesign } from '../../../shared/character-design-presets.js';

export interface LocalHealth {
  version: number;
  ready: boolean;
  ollama: {
    available: boolean;
    modelInstalled: boolean;
    model?: string;
    version?: string;
    error?: ApiError;
  };
  tts: { available: boolean };
  renderBusy: boolean;
}

export interface DirectorProposal {
  version: number;
  cacheHit: boolean;
  model: string;
  plan: {
    title: string;
    tone: string;
    targetDurationSeconds: number;
    scenes: unknown[];
  };
  project: unknown;
  budget: { totalWords: number; maximumWords: number };
}

export interface RenderJob {
  version: number;
  jobId: string;
  projectId: string;
  state: 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  createdAt: string;
  updatedAt: string;
  progress: Record<string, unknown> | null;
  error: ApiError | null;
  result?: {
    durationSeconds: number;
    scenes: number;
    deterministic: boolean;
    videoUrl: string;
    downloadName: string;
    timeline?: {
      durationSeconds: number;
      scenes: Array<{
        id: string;
        startSeconds: number;
        endSeconds: number;
        audioDurationSeconds?: number;
        transitionToNext?: {
          preset: string;
          durationSeconds: number;
          startSeconds: number;
          endSeconds: number;
        };
      }>;
    };
  };
}

export interface ApiError {
  code?: string;
  message: string;
  suggestedAction?: string;
  technicalDetail?: string;
}

export interface DirectorConstraints {
  tone: 'educational' | 'ironic' | 'serious' | 'energetic' | 'inspirational';
  targetDurationSeconds: number;
  sceneCount: number;
}

export interface RegisteredResource {
  id: string;
  type: string;
  label: string;
  origin: 'builtin' | 'local';
}

export interface SavedCharacterDesign {
  id: string;
  name: string;
  design: CharacterDesign;
  thumbnail: string;
}

export interface SavedProjectSummary {
  id: string;
  title: string;
  scenes: number;
  updatedAt: string;
}

export async function listSavedProjects(): Promise<SavedProjectSummary[]> {
  const response = await apiRequest<{ version: number; projects: SavedProjectSummary[] }>('/api/projects');
  return response.projects;
}

export async function loadSavedProject(id: string): Promise<unknown> {
  const response = await apiRequest<{ version: number; project: unknown }>(`/api/projects/${encodeURIComponent(id)}`);
  return response.project;
}

export async function saveEditableProject(project: { id: string }): Promise<SavedProjectSummary> {
  const response = await apiRequest<{ version: number; summary: SavedProjectSummary }>(`/api/projects/${encodeURIComponent(project.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  });
  return response.summary;
}

export async function deleteSavedProject(id: string): Promise<void> {
  await apiRequest(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getHealth(): Promise<LocalHealth> {
  return apiRequest<LocalHealth>('/api/health');
}

export async function createProposal(
  prompt: string,
  variant: number,
  constraints: DirectorConstraints,
  signal?: AbortSignal,
): Promise<DirectorProposal> {
  return apiRequest<DirectorProposal>('/api/director/proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, variant, constraints }),
    signal,
  });
}

export async function editProjectWithAi(instruction: string, project: unknown): Promise<{
  version: number;
  model: string;
  cacheHit: boolean;
  commands: Array<Record<string, unknown>>;
  project: unknown;
}> {
  return apiRequest('/api/director/edits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instruction, project }),
  });
}

export async function startRender(project: unknown): Promise<RenderJob> {
  return apiRequest<RenderJob>('/api/render-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  });
}

export async function getRenderJob(jobId: string): Promise<RenderJob> {
  return apiRequest<RenderJob>(`/api/render-jobs/${encodeURIComponent(jobId)}`);
}

export async function listRenderJobs(): Promise<RenderJob[]> {
  const response = await apiRequest<{ version: number; jobs: RenderJob[] }>('/api/render-jobs');
  return response.jobs;
}

export async function cancelRenderJob(jobId: string): Promise<RenderJob> {
  return apiRequest<RenderJob>(`/api/render-jobs/${encodeURIComponent(jobId)}?action=cancel`, {
    method: 'POST',
  });
}

export async function cancelDirectorProposal(): Promise<void> {
  await apiRequest('/api/director/cancel', { method: 'POST' });
}

export async function registerLibraryResource(entry: unknown): Promise<{ version: number; created: boolean; resource: RegisteredResource }> {
  return apiRequest('/api/library/resources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entry }),
  });
}

export async function importBackgroundResource(file: File): Promise<{
  version: number;
  created: boolean;
  resource: RegisteredResource;
  image?: { width: number; height: number; mimeType: string; bytes: number };
}> {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type === 'image/png' || lowerName.endsWith('.png') ? 'image/png'
    : file.type === 'image/jpeg' || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') ? 'image/jpeg'
      : file.type;
  return apiRequest('/api/library/backgrounds', {
    method: 'POST',
    headers: {
      'content-type': mimeType,
      'x-resource-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
}

export async function listCharacterDesigns(): Promise<SavedCharacterDesign[]> {
  const response = await apiRequest<{ version: number; designs: SavedCharacterDesign[] }>('/api/library/character-designs');
  return response.designs;
}

export async function saveCharacterDesign(design: CharacterDesign): Promise<{
  version: number;
  created: boolean;
  resource: RegisteredResource;
}> {
  return apiRequest('/api/library/characters', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ design }),
  });
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options?.method && options.method !== 'GET' ? { 'x-local-video-token': import.meta.env.VITE_LOCAL_VIDEO_TOKEN || '' } : {}),
        ...options?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw friendlyError('Se canceló la generación de la propuesta.', 'Podés modificar el prompt y volver a intentarlo.');
    }
    throw friendlyError('No se pudo conectar con el servicio local.', 'Iniciá la aplicación con npm run dev.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw friendlyError('El servicio local devolvió una respuesta inesperada.', 'Reiniciá npm run dev y volvé a intentar.');
  }
  let body: T & { error?: ApiError };
  try {
    body = await response.json() as T & { error?: ApiError };
  } catch {
    throw friendlyError('El servicio local devolvió datos incompletos.', 'Reiniciá npm run dev y volvé a intentar.');
  }
  if (!response.ok) {
    const error = new Error(body.error?.message || `HTTP ${response.status}`) as Error & { detail?: ApiError };
    error.detail = body.error;
    throw error;
  }
  return body;
}

function friendlyError(message: string, suggestedAction: string) {
  const error = new Error(message) as Error & { detail?: ApiError };
  error.detail = { code: 'LOCAL_SERVICE_UNAVAILABLE', message, suggestedAction };
  return error;
}
