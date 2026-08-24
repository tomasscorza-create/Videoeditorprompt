import type { CharacterDesign } from '../../../shared/character-design-presets.js';
import { getDirectorProviderSettings } from './provider-settings.js';

export interface LocalHealth {
  version: number;
  ready: boolean;
  director?: {
    provider: 'ollama' | 'openai';
    available: boolean;
    modelInstalled: boolean;
    model?: string;
    version?: string;
    digest?: string | null;
    error?: ApiError;
  };
  ollama?: {
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
    version?: number;
    title: string;
    tone: string;
    targetDurationSeconds: number;
    richnessProfile?: string;
    scenes: Array<{
      title?: string;
      mode?: string;
      sceneRecipeId?: string;
      participants?: unknown[];
      visualElements?: unknown[];
      speech?: unknown[];
    }>;
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
  usage?: DirectorUsage;
}

export interface DirectorUsage {
  version?: number;
  requestCount?: number;
  currentRequestCount?: number;
  transportAttempts?: number;
  retryCount?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  uncachedInputTokens?: number | null;
  totalTokens?: number | null;
  promptEvalCount?: number | null;
  evalCount?: number | null;
  totalDurationNanoseconds?: number | null;
  elapsedMilliseconds?: number | null;
  cacheHit?: boolean;
  repairAttempts?: number;
  generationCount?: number;
  qualityEscalations?: number;
  judgeRequestCount?: number;
  candidateElapsedMilliseconds?: number[];
}

export interface DirectorQualityReport {
  version: number;
  score: number;
  floor: number;
  passed: boolean;
  issues: Array<{ code: string; penalty: number; instruction: string }>;
  metrics: Record<string, unknown>;
  richness?: {
    passed: boolean;
    policy: { requested: string; resolved: string };
    issues: string[];
    metrics: { modes: string[]; visualFamilies: string[]; recipeCount: number; animatedScenes: number };
  };
}

export interface DirectorContextSummary {
  version: number;
  queryTokens: string[];
  resourceIds: string[];
  resourceScores: Record<string, number>;
  explicitResourceIds?: string[];
  templateIds: string[];
  recommendedTemplateId: string | null;
  selectedTemplateId?: string | null;
  totalCatalogEntries: number;
  shortlistedEntries: number;
  availableByType?: Record<string, number>;
  shortlistedByType?: Record<string, number>;
  unsupportedResourceTypes?: string[];
  resolvedConstraints?: DirectorConstraints;
  preconfiguration?: DirectorPreconfigurationSummary | null;
}

export interface RenderJob {
  version: number;
  jobId: string;
  projectId: string;
  projectRevision?: string;
  timelineRevision?: string;
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
  if (code === 'DIRECTOR_CANCELLED' || code === 'OLLAMA_CANCELLED' || code === 'OPENAI_CANCELLED') return 'cancelled';
  if (code === 'DIRECTOR_BUSY' || code === 'RENDER_BUSY') return 'busy';
  if (code.includes('TIMEOUT')) return 'timeout';
  if (
    code === 'LOCAL_SERVICE_UNAVAILABLE'
    || code === 'OLLAMA_UNAVAILABLE'
    || code === 'OLLAMA_DIRECTOR_REQUEST_FAILED'
    || code === 'OPENAI_UNAVAILABLE'
    || code === 'OPENAI_API_KEY_MISSING'
    || code === 'OPENAI_AUTH_INVALID'
    || code === 'OPENAI_RATE_LIMITED'
    || code === 'OPENAI_REQUEST_FAILED'
    || code.startsWith('TTS_')
  ) return 'dependency';
  if (code === 'LOCAL_SERVICE_INVALID_RESPONSE' || code.includes('JSON_INVALID') || code === 'OLLAMA_RESPONSE_EMPTY' || code === 'OPENAI_RESPONSE_EMPTY') {
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
  segmentIndex?: number;
  segmentCount?: number;
}

export interface DirectorConstraints {
  tone?: 'educational' | 'ironic' | 'serious' | 'energetic' | 'inspirational';
  targetDurationSeconds?: number;
  sceneCount?: number;
  planVersion: 2;
  richnessProfile?: 'automatic' | 'simple' | 'varied' | 'dynamic';
  structure?: 'automatic' | 'narration' | 'one-character' | 'dialogue';
}

export interface DirectorGenerationOptions {
  think: boolean;
  bestOf: 1 | 2 | 3;
}

export interface DirectorChoiceQuestion {
  id: string;
  kind: 'choice';
  prompt: string;
  multiple: boolean;
  options: Array<{ id: string; label: string }>;
  otherPlaceholder: string;
}

export type DirectorQuestion = DirectorChoiceQuestion;

export interface DirectorQuestionSet {
  version: number;
  questionContract: 2;
  cacheHit: boolean;
  model: string;
  questions: [DirectorChoiceQuestion, DirectorChoiceQuestion, DirectorChoiceQuestion];
  modelIdentity?: { model: string; digest: string | null; runtimeVersion: string | null };
  usage?: DirectorUsage;
  preconfigurationSnapshot?: DirectorPreconfigurationSnapshot | null;
}

export interface DirectorPersonalizationAnswer {
  question: string;
  answer: string;
}

export interface DirectorPreconfigurationBinding {
  roleId: string;
  characterResourceId: string;
  voiceResourceId: string;
  animationPresetId?: string;
}

export interface DirectorPreconfiguration {
  version: 2;
  id: string;
  name: string;
  description?: string;
  structurePreference?: 'automatic' | 'narration' | 'one-character' | 'dialogue';
  richnessProfile?: 'simple' | 'varied' | 'dynamic';
  characterBindings: DirectorPreconfigurationBinding[];
  narratorVoiceResourceId?: string;
  backgroundResourceId: string;
  tonePreference?: 'educational' | 'ironic' | 'serious' | 'energetic' | 'inspirational';
}

export interface DirectorPreconfigurationSnapshot {
  preconfigurationId: string;
  revision: number;
  snapshotHash: string;
  preconfiguration: DirectorPreconfiguration;
}

export interface DirectorPreconfigurationRecord {
  revision: number;
  createdAt: string;
  updatedAt: string;
  preconfiguration: DirectorPreconfiguration;
  health?: { status: 'valid' | 'incomplete' | 'incompatible'; issues: string[] };
}

export interface DirectorPreconfigurationSummary {
  id: string;
  name: string;
  structure: string;
  richness: string;
  backgroundStrategy: string;
  backgrounds: string[];
  narratorVoiceResourceId: string | null;
  cast: Array<DirectorPreconfigurationBinding & { animationPresetId: string }>;
}

export interface DirectorAuthoringResource {
  id: string;
  type: 'character' | 'voice' | 'background' | string;
  label: string;
  capabilities?: { animationPresets?: string[] };
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
  const settings = getDirectorProviderSettings();
  const query = new URLSearchParams({ provider: settings.provider });
  if (settings.model) query.set('model', settings.model);
  return apiRequest<LocalHealth>(`/api/health?${query}`);
}

export async function getDirectorStatus(): Promise<DirectorStatus> {
  return apiRequest<DirectorStatus>('/api/director/status');
}

export async function createProposal(
  prompt: string,
  variant: number,
  constraints: DirectorConstraints,
  generation: DirectorGenerationOptions,
  personalization: DirectorPersonalizationAnswer[],
  signal?: AbortSignal,
  preconfigurationId?: string,
  preconfigurationSnapshot?: DirectorPreconfigurationSnapshot | null,
): Promise<DirectorProposal> {
  const provider = getDirectorProviderSettings();
  return apiRequest<DirectorProposal>('/api/director/proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, variant, constraints, personalization, preconfigurationId, preconfigurationSnapshot, ...generation, ...provider }),
    signal,
  });
}

export async function createClarifyingQuestions(
  prompt: string,
  constraints: DirectorConstraints,
  signal?: AbortSignal,
  preconfigurationId?: string,
  preconfigurationSnapshot?: DirectorPreconfigurationSnapshot | null,
): Promise<DirectorQuestionSet> {
  const provider = getDirectorProviderSettings();
  const response = await apiRequest<DirectorQuestionSet>('/api/director/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, constraints, preconfigurationId, preconfigurationSnapshot, ...provider }),
    signal,
  });
  const validQuestions = response.questionContract === 2
    && Array.isArray(response.questions)
    && response.questions.length === 3
    && response.questions.every((question) => (
      question?.kind === 'choice'
      && Array.isArray(question.options)
      && question.options.length === 3
      && typeof question.otherPlaceholder === 'string'
      && question.otherPlaceholder.trim().length > 0
    ));
  if (!validQuestions) {
    throw friendlyError(
      'LOCAL_SERVICE_RESTART_REQUIRED',
      'El servicio local sigue usando una versión anterior del formulario.',
      'Cerrá por completo npm run dev, volvé a iniciarlo y repetí la idea.',
    );
  }
  return response;
}

export async function listDirectorPreconfigurations(): Promise<DirectorPreconfigurationRecord[]> {
  const response = await apiRequest<{ version: number; preconfigurations: DirectorPreconfigurationRecord[] }>('/api/director/preconfigurations');
  return response.preconfigurations;
}

export async function listDirectorAuthoringResources(): Promise<DirectorAuthoringResource[]> {
  const response = await apiRequest<{ version: number; catalog: { entries?: DirectorAuthoringResource[] } }>('/api/library/catalog');
  return Array.isArray(response.catalog?.entries) ? response.catalog.entries : [];
}

export async function saveDirectorPreconfiguration(
  preconfiguration: DirectorPreconfiguration,
  expectedRevision?: number,
): Promise<DirectorPreconfigurationRecord & { created: boolean }> {
  return apiRequest(`/api/director/preconfigurations/${encodeURIComponent(preconfiguration.id)}`, {
    method: expectedRevision === undefined ? 'POST' : 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preconfiguration, expectedRevision }),
  });
}

export async function deleteDirectorPreconfiguration(id: string, expectedRevision?: number): Promise<void> {
  const query = expectedRevision === undefined ? '' : `?expectedRevision=${encodeURIComponent(String(expectedRevision))}`;
  await apiRequest(`/api/director/preconfigurations/${encodeURIComponent(id)}${query}`, { method: 'DELETE' });
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
  const provider = getDirectorProviderSettings();
  return apiRequest('/api/director/edits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instruction, project, selection, ...provider }),
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
  visualScenes: Array<{ id: string; runtime: unknown; dialogue: unknown }>;
  audioUrl: string;
}> {
  return apiRequest('/api/measurements', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project }),
  });
}

export async function startRender(project: unknown, timeline?: unknown): Promise<RenderJob> {
  return apiRequest<RenderJob>('/api/render-jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project, ...(timeline ? { timeline } : {}) }),
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

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  description: string | null;
  previewUrl: string | null;
}

export async function listElevenLabsVoices(): Promise<{
  version: number;
  diagnostic: { available: boolean; configured: boolean; voiceCount: number };
  voices: ElevenLabsVoice[];
}> {
  return apiRequest('/api/tts/elevenlabs');
}

export async function importElevenLabsVoice(voiceId: string, model: string, locale = 'es_MX'): Promise<{
  version: number;
  created: boolean;
  resource: RegisteredResource;
}> {
  return apiRequest('/api/library/voices/elevenlabs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voiceId, model, locale }),
  });
}

export async function importBackgroundResource(file: File): Promise<{
  version: number;
  created: boolean;
  resource: RegisteredResource;
  image?: { width: number; height: number; mimeType: string; bytes: number };
  media?: { kind: 'image' | 'video'; width: number; height: number; mimeType: string; bytes: number; durationSeconds?: number; fps?: number };
}> {
  const lowerName = file.name.toLowerCase();
  const mimeType = file.type === 'image/png' || lowerName.endsWith('.png') ? 'image/png'
    : file.type === 'image/jpeg' || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg') ? 'image/jpeg'
      : file.type === 'image/gif' || lowerName.endsWith('.gif') ? 'image/gif'
        : file.type === 'video/mp4' || lowerName.endsWith('.mp4') ? 'video/mp4'
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
