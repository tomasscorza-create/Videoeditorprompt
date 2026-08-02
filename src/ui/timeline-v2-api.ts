import type { TimelineDocumentV2 } from '../../shared/timeline-clip-core.js';

export interface TimelineMediaEntry {
  id: string;
  contentHash: string;
  kind: 'video' | 'audio';
  name: string;
  mimeType: string;
  bytes: number;
  durationTicks: number;
  durationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
}

export interface TimelineExportResult {
  exportId: string;
  projectId: string;
  durationSeconds: number;
  bytes: number;
  cacheHit: boolean;
  reusedSegments: number;
  videoUrl: string;
  downloadName: string;
}

export async function listTimelineMedia(): Promise<TimelineMediaEntry[]> {
  return (await request<{ entries: TimelineMediaEntry[] }>('/api/timeline/media')).entries;
}

export async function importTimelineMedia(file: File): Promise<TimelineMediaEntry> {
  const response = await request<{ entry: TimelineMediaEntry }>('/api/timeline/media', {
    method: 'POST',
    headers: {
      'content-type': file.type || mimeFromName(file.name),
      'x-resource-file-name': encodeURIComponent(file.name),
    },
    body: file,
  });
  return response.entry;
}

export async function importTimelineRender(jobId: string): Promise<TimelineMediaEntry> {
  return (await request<{ entry: TimelineMediaEntry }>('/api/timeline/media/from-render', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }),
  })).entry;
}

export async function importTimelineMeasurement(measurementId: string): Promise<TimelineMediaEntry> {
  return (await request<{ entry: TimelineMediaEntry }>('/api/timeline/media/from-measurement', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ measurementId }),
  })).entry;
}

export async function saveTimelineProject(project: TimelineDocumentV2, expectedRevision?: string | null): Promise<string> {
  const response = await request<{ revision: string }>(`/api/timeline/projects/${encodeURIComponent(project.id)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, expectedRevision: expectedRevision || undefined }),
  });
  return response.revision;
}

export async function exportTimelineProject(project: TimelineDocumentV2): Promise<TimelineExportResult> {
  return request('/api/timeline/exports', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project }),
  });
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.method && options.method !== 'GET' ? { 'x-local-video-token': import.meta.env.VITE_LOCAL_VIDEO_TOKEN || '' } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error('No se pudo conectar con el servicio local. Iniciá la aplicación con npm run dev.');
  }
  const body = await response.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!response.ok || !body) throw new Error(body?.error?.message || `El servicio respondió HTTP ${response.status}.`);
  return body;
}

function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  return 'application/octet-stream';
}
