import type { CharacterDesign } from '../../../shared/character-design-presets.js';

export interface LocalHealth {
  version: number;
  ready: boolean;
  ollama: {
    available: boolean;
    modelInstalled: boolean;
    model?: string;
    version?: string;
    digest?: string | null;
    error?: ApiError;
  };
  tts: { available: boolean };
  renderBusy: boolean;
}

export interface DirectorProposal {
  version: number;
  cacheHit: boolean;
  model: string;
  modelIdentity?: { model: string; digest: string | null; runtimeVersion: string | null };
  plan: {
    title: string;
    tone: string;
    targetDurationSeconds: number;
    scenes: unknown[];
  };
  project: unknown;
  budget: { totalWords: number; maximumWords: number };
  selection: {
    bestOf: number;
    winnerIndex: number;
    judgeVersion: number | null;
    scores: Array<{
      relevance: number;
      hook: number;
      naturalness: number;
      progression: number;
      ending: number;
      tone: number;
      tts: number;
      audiovisual: number;
    }> | null;
    totals?: number[] | null;
    qualityFloor?: number | null;
    qualityFloorMet?: boolean;
  };
  context: DirectorContextSummary;
  quality?: DirectorQualityReport;
  candidateQuality?: DirectorQualityReport[];
  repairAttempts?: number;
  usage?: {
    think: boolean;
    generationCount: number;
    qualityEscalations: number;
    promptEvalCount: number | null;
    evalCount: number | null;
    totalDurationNanoseconds: number | null;
    elapsedMilliseconds: number;
    candidateElapsedMilliseconds: number[];
  };
}

export interface DirectorQualityReport {
  version: number;
  score: number;
  floor: number;
  passed: boolean;
  issues: Array<{ code: string; penalty: number; instruction: string }>;
  metrics: Record<string, unknown>;
}

export interface DirectorContextSummary {
  version: number;
  queryTokens: string[];
  resourceIds: string[];
  resourceScores: Record<string, number>;
  templateIds: string[];
  recommendedTemplateId: string | null;
  selectedTemplateId?: string | null;
  totalCatalogEntries: number;
  shortlistedEntries: number;
}

export interface RenderJob {
  version: number;
  jobId: string;
  projectId: string;
  projectRevision?: string;
  timingRevision?: string;
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

export function formatApiError(error: ApiError): string {
  const detail = error.code === 'PROJECT_SCENE_UNSUPPORTED'
    ? formatUnsupportedSceneDetail(error.technicalDetail)
    : null;
  return [error.message, detail, error.suggestedAction]
    .filter(Boolean)
    .join(' ');
}

export type ApiErrorKind = 'cancelled' | 'busy' | 'timeout' | 'dependency' | 'invalid-response' | 'error';

export function classifyApiError(error: ApiError): ApiErrorKind {
  const code = error.code ?? '';
  if (code === 'DIRECTOR_CANCELLED' || code === 'OLLAMA_CANCELLED') return 'cancelled';
  if (code === 'DIRECTOR_BUSY' || code === 'RENDER_BUSY') return 'busy';
  if (code.includes('TIMEOUT')) return 'timeout';
  if (
    code === 'LOCAL_SERVICE_UNAVAILABLE'
    || code === 'OLLAMA_UNAVAILABLE'
    || code === 'OLLAMA_DIRECTOR_REQUEST_FAILED'
    || code.startsWith('TTS_')
  ) return 'dependency';
  if (code === 'LOCAL_SERVICE_INVALID_RESPONSE' || code.includes('JSON_INVALID') || code === 'OLLAMA_RESPONSE_EMPTY') {
    return 'invalid-response';
  }
  return 'error';
}

export function formatApiTechnicalDetails(error: ApiError): string | null {
  const parts = [
    error.code ? `Código: ${error.code}` : null,
    error.technicalDetail?.trim() ? `Detalle: ${error.technicalDetail.trim().slice(0, 1200)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : null;
}

export interface DirectorStatus {
  version: number;
  state: 'idle' | 'running' | 'cancelling';
  stage: string;
  updatedAt: string;
  candidateIndex?: number;
  candidateCount?: number;
  attempt?: number;
}

export interface DirectorConstraints {
  tone: 'educational' | 'ironic' | 'serious' | 'energetic' | 'inspirational';
  targetDurationSeconds: number;
  sceneCount: number;
}

export interface DirectorGenerationOptions {
  think: boolean;
  bestOf: 1 | 2 | 3;
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

export async function getDirectorStatus(): Promise<DirectorStatus> {
  return apiRequest<DirectorStatus>('/api/director/status');
}

export async function createProposal(
  prompt: string,
  variant: number,
  constraints: DirectorConstraints,
  generation: DirectorGenerationOptions,
  signal?: AbortSignal,
): Promise<DirectorProposal> {
  return apiRequest<DirectorProposal>('/api/director/proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, variant, constraints, ...generation }),
    signal,
  });
}

export async function editProjectWithAi(
  instruction: string,
  project: unknown,
  selection?: Record<string, unknown> | null,
  signal?: AbortSignal,
): Promise<{
  version: number;
  model: string;
  cacheHit: boolean;
  commands: Array<Record<string, unknown>>;
  project: unknown;
  baseProjectRevision: string;
  projectRevision: string;
  context: DirectorContextSummary;
  status?: 'proposed' | 'no-change';
  explanation: {
    summary: string;
    changes: string[];
    customizedTrackRemovalIndexes: number[];
  };
  modelIdentity?: { model: string; digest: string | null; runtimeVersion: string | null };
  usage?: {
    promptEvalCount: number | null;
    evalCount: number | null;
    totalDurationNanoseconds: number | null;
    elapsedMilliseconds: number;
  };
}> {
  return apiRequest('/api/director/edits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instruction, project, selection }),
    signal,
  });
}

/**
 * Mide los tiempos reales del proyecto sin renderizarlo.
 *
 * Corre solo la síntesis de voz y su medición, que es lo único que produce una
 * duración; la caché de voz está indexada por contenido, así que después de un
 * corte solo se sintetizan los dos textos nuevos.
 */
export async function measureProject(project: unknown): Promise<{
  projectId: string;
  timeline: { durationSeconds: number; scenes: unknown[] };
  audioUrl: string;
}> {
  return apiRequest('/api/measurements', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
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
      throw friendlyError(
        'DIRECTOR_CANCELLED',
        'La operación del Director fue cancelada.',
        'Podés modificar la petición y volver a intentarlo.',
      );
    }
    throw friendlyError('LOCAL_SERVICE_UNAVAILABLE', 'No se pudo conectar con el servicio local.', 'Iniciá la aplicación con npm run dev.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw friendlyError(
      'LOCAL_SERVICE_INVALID_RESPONSE',
      'El servicio local devolvió una respuesta inesperada.',
      'Reiniciá npm run dev y volvé a intentar.',
    );
  }
  let body: T & { error?: ApiError };
  try {
    body = await response.json() as T & { error?: ApiError };
  } catch {
    throw friendlyError(
      'LOCAL_SERVICE_INVALID_RESPONSE',
      'El servicio local devolvió datos incompletos.',
      'Reiniciá npm run dev y volvé a intentar.',
    );
  }
  if (!response.ok) {
    const error = new Error(body.error?.message || `HTTP ${response.status}`) as Error & { detail?: ApiError };
    error.detail = body.error;
    throw error;
  }
  return body;
}

function friendlyError(code: string, message: string, suggestedAction: string) {
  const error = new Error(message) as Error & { detail?: ApiError };
  error.detail = { code, message, suggestedAction };
  return error;
}

function formatUnsupportedSceneDetail(value: string | undefined): string | null {
  if (!value) return null;
  const safe = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, 300);
  const match = /^\/scenes\/(\d+)\s+(.+)$/u.exec(safe);
  if (!match) return null;
  return `Escena ${Number(match[1]) + 1}: ${match[2]}`;
}
