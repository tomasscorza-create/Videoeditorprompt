import { fetchJson, required } from './preview/common.js';
import { startDialoguePreview } from './preview/dialogue.js';
import { startLegacyPreview } from './preview/legacy.js';
import type { PreviewIndex, PreviewSelection, PreviewUi, SceneConfig, SceneRuntime } from './preview/types.js';
import { initEditorUi, initProjectUi, initShellUi, renderJobGallery } from './ui/index.js';
import './style.css';

const previewUi: PreviewUi = {
  status: required<HTMLElement>('#status'),
  renderer: required<HTMLElement>('#renderer'),
  time: required<HTMLElement>('#time'),
  audio: required<HTMLElement>('#audio-status'),
  mouth: required<HTMLElement>('#mouth-status'),
  eyes: required<HTMLElement>('#eyes-status'),
  gesture: required<HTMLElement>('#gesture-status'),
  stage: required<HTMLElement>('#stage'),
};

const shellUi = {
  jobStatus: required<HTMLElement>('#job-status'),
  jobSelect: required<HTMLSelectElement>('#job-select'),
  jobMeta: required<HTMLElement>('#job-meta'),
  download: required<HTMLAnchorElement>('#download'),
};

initShellUi();
void initProjectUi();

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  previewUi.status.textContent = `Error: ${message}`;
  shellUi.jobMeta.textContent = message;
  shellUi.jobMeta.classList.add('error');
  console.error(error);
});

async function start(): Promise<void> {
  const selection = await selectPreview();
  configureJobUi(selection);
  const cacheKey = encodeURIComponent(selection.job.updatedAt);
  const generatedUrl = (relativePath: string): string => `${selection.baseUrl}${relativePath.replace(/^\/+/, '')}?v=${cacheKey}`;
  const assetUrl = (relativePath: string): string => `/${relativePath.replace(/^\/+/, '')}?v=${cacheKey}`;
  const [config, runtime] = await Promise.all([
    fetchJson<SceneConfig>(`${selection.baseUrl}scene.config.json?v=${cacheKey}`),
    fetchJson<SceneRuntime>(`${selection.baseUrl}scene-runtime.json?v=${cacheKey}`),
  ]);
  const options = { selection, config, runtime, generatedUrl, assetUrl, ui: previewUi };
  const handle = config.version === 2 ? await startDialoguePreview(options) : await startLegacyPreview(options);
  initEditorUi(handle);
}

async function selectPreview(): Promise<PreviewSelection> {
  const response = await fetch('/generated/index.json', { cache: 'no-store' });
  if (response.status === 404) {
    return {
      job: {
        jobId: 'preview', state: 'legacy', updatedAt: 'legacy', durationSeconds: 0,
        previewPath: '', videoPath: null, verificationPassed: null, deterministic: null,
      },
      baseUrl: '/generated/',
      legacy: true,
    };
  }
  if (!response.ok) throw new Error(`/generated/index.json: HTTP ${response.status}`);
  const index = await response.json() as PreviewIndex;
  if (index.version !== 1 || !Array.isArray(index.jobs)) throw new Error('El índice de previews no tiene un formato compatible.');
  const jobs = index.jobs.filter((job) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(job.jobId));
  if (jobs.length === 0) throw new Error('No hay trabajos publicados.');
  const requestedJobId = new URLSearchParams(window.location.search).get('job');
  const selectedJobId = requestedJobId || index.defaultJobId || jobs[0].jobId;
  const job = jobs.find((item) => item.jobId === selectedJobId);
  if (!job) throw new Error(`No existe el trabajo "${selectedJobId}". Disponibles: ${jobs.map((item) => item.jobId).join(', ')}.`);
  shellUi.jobSelect.replaceChildren(...jobs.map((item) => {
    const option = document.createElement('option');
    option.value = item.jobId;
    option.textContent = item.jobId;
    option.selected = item.jobId === job.jobId;
    return option;
  }));
  shellUi.jobSelect.disabled = false;
  renderJobGallery(jobs, job.jobId);
  shellUi.jobSelect.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('job', shellUi.jobSelect.value);
    window.location.assign(url);
  });
  if (!requestedJobId) {
    const url = new URL(window.location.href);
    url.searchParams.set('job', job.jobId);
    window.history.replaceState(null, '', url);
  }
  return { job, baseUrl: `/generated/${encodeURIComponent(job.jobId)}/`, legacy: false };
}

function configureJobUi(selection: PreviewSelection): void {
  const { job } = selection;
  shellUi.jobStatus.textContent = job.jobId;
  if (selection.legacy) {
    shellUi.jobSelect.innerHTML = '<option value="preview">preview (formato anterior)</option>';
    shellUi.jobMeta.textContent = 'Publicación legacy: vuelva a publicar los jobs para habilitar el selector.';
    return;
  }
  const duration = Number.isFinite(job.durationSeconds) ? `${job.durationSeconds.toFixed(2)} s` : 'duración desconocida';
  const verification = job.verificationPassed === null ? 'sin verificación publicada' : `${job.verificationPassed} verificaciones`;
  const deterministic = job.deterministic === true ? 'determinista' : job.deterministic === false ? 'no determinista' : 'determinismo sin registrar';
  shellUi.jobMeta.textContent = `${job.state} · ${duration} · ${verification} · ${deterministic}`;
  if (job.videoPath) {
    shellUi.download.href = `/generated/${job.videoPath}`;
    shellUi.download.hidden = false;
  }
}
