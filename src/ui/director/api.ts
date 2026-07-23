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
  };
}

export interface ApiError {
  code?: string;
  message: string;
  suggestedAction?: string;
  technicalDetail?: string;
}

export async function getHealth(): Promise<LocalHealth> {
  return apiRequest<LocalHealth>('/api/health');
}

export async function createProposal(prompt: string, variant: number): Promise<DirectorProposal> {
  return apiRequest<DirectorProposal>('/api/director/proposals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, variant }),
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

export async function cancelRenderJob(jobId: string): Promise<RenderJob> {
  return apiRequest<RenderJob>(`/api/render-jobs/${encodeURIComponent(jobId)}?action=cancel`, {
    method: 'POST',
  });
}

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json() as T & { error?: ApiError };
  if (!response.ok) {
    const error = new Error(body.error?.message || `HTTP ${response.status}`) as Error & { detail?: ApiError };
    error.detail = body.error;
    throw error;
  }
  return body;
}
