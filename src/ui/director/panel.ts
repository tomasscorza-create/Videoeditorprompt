import { required } from '../dom.js';
import { persistLastJobId, readLastJobId } from '../project/persistence.js';
import { createProjectStore, type ProjectStore } from '../project/store.js';
import { showFinalVideo } from '../viewer.js';
import {
  cancelDirectorProposal,
  cancelRenderJob,
  createProposal,
  getHealth,
  getRenderJob,
  listRenderJobs,
  startRender,
  type ApiError,
  type DirectorConstraints,
  type RenderJob,
} from './api.js';

const POLL_INTERVAL_MS = 1000;
const HEALTH_INTERVAL_MS = 15_000;

export function initDirectorUi(initialStore: ProjectStore | null, onStoreCreated: (store: ProjectStore) => void): void {
  const root = required<HTMLElement>('#director-panel');
  const prompt = required<HTMLTextAreaElement>('#director-prompt');
  const tone = required<HTMLSelectElement>('#director-tone');
  const duration = required<HTMLSelectElement>('#director-duration');
  const scenes = required<HTMLSelectElement>('#director-scenes');
  const generate = required<HTMLButtonElement>('#director-generate');
  const render = required<HTMLButtonElement>('#director-render');
  const cancel = required<HTMLButtonElement>('#director-cancel');
  const status = required<HTMLElement>('#director-status');
  const proposal = required<HTMLElement>('#director-proposal');
  const healthBadge = required<HTMLElement>('#director-health-badge');
  const progressRoot = required<HTMLElement>('#render-progress');
  const progressBar = required<HTMLElement>('#render-progress-bar');
  const progressLabel = required<HTMLElement>('#render-progress-label');
  const gallery = required<HTMLElement>('#render-job-gallery');
  const refreshJobs = required<HTMLButtonElement>('#jobs-refresh');

  let variant = 0;
  let store = initialStore;
  let proposalController: AbortController | null = null;
  let currentJobId: string | null = null;
  let pollTimer: number | null = null;
  let readyForProposal = false;
  let readyForRender = false;

  root.hidden = false;
  syncButtons();
  void refreshHealth();
  void refreshGallery(true);
  const healthTimer = window.setInterval(() => void refreshHealth(), HEALTH_INTERVAL_MS);
  window.addEventListener('pagehide', () => window.clearInterval(healthTimer), { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void refreshHealth();
      void refreshGallery(false);
    }
  });
  refreshJobs.addEventListener('click', () => void refreshGallery(false));

  generate.addEventListener('click', async () => {
    const value = prompt.value.trim();
    if (value.length < 3) {
      report('Escribí una idea de al menos tres caracteres.');
      return;
    }
    if (store?.canUndo() && !window.confirm('Crear otra propuesta reemplazará tus cambios manuales y el historial de deshacer. ¿Continuar?')) {
      return;
    }
    proposalController = new AbortController();
    setBusy(true, 'El Director IA está preparando la propuesta. Puede tardar entre uno y cuatro minutos en CPU.');
    cancel.disabled = false;
    proposal.textContent = '';
    try {
      const result = await createProposal(value, variant, readConstraints(), proposalController.signal);
      if (store) {
        const replacementError = store.replaceProject(result.project);
        if (replacementError) throw new Error(replacementError);
      } else {
        store = await createProjectStore(result.project);
        onStoreCreated(store);
      }
      variant += 1;
      proposal.textContent = [
        result.plan.title,
        `${result.plan.scenes.length} escena(s)`,
        `${result.budget.totalWords} palabras`,
        `objetivo ${result.plan.targetDurationSeconds} s`,
        result.cacheHit ? 'caché local' : result.model,
      ].join(' · ');
      report('Propuesta creada. Podés corregirla antes de renderizar.', true);
    } catch (error) {
      reportError(error);
    } finally {
      proposalController = null;
      setBusy(false);
    }
  });

  render.addEventListener('click', async () => {
    if (!store) {
      report('Primero creá una propuesta válida.');
      return;
    }
    const validationError = store.validate();
    if (validationError) {
      report(`El proyecto no se puede renderizar: ${validationError}`);
      return;
    }
    setBusy(true, 'Enviando el proyecto al pipeline local…');
    try {
      const job = await startRender(store.project());
      currentJobId = job.jobId;
      persistLastJobId(job.jobId);
      cancel.disabled = false;
      reportJob(job);
      await refreshGallery(false);
      schedulePoll();
    } catch (error) {
      currentJobId = null;
      setBusy(false);
      reportError(error);
    }
  });

  cancel.addEventListener('click', async () => {
    if (proposalController) {
      proposalController.abort();
      void cancelDirectorProposal().catch(() => {});
      proposalController = null;
      cancel.disabled = true;
      return;
    }
    if (!currentJobId) return;
    cancel.disabled = true;
    try {
      const job = await cancelRenderJob(currentJobId);
      finishPolling();
      reportJob(job);
      await refreshGallery(false);
    } catch (error) {
      reportError(error);
    }
  });

  function readConstraints(): DirectorConstraints {
    return {
      tone: tone.value as DirectorConstraints['tone'],
      targetDurationSeconds: Number(duration.value),
      sceneCount: Number(scenes.value),
    };
  }

  async function refreshHealth(): Promise<void> {
    try {
      const health = await getHealth();
      readyForProposal = health.ollama.available && health.ollama.modelInstalled;
      readyForRender = health.tts.available;
      healthBadge.className = `health-badge ${readyForProposal && readyForRender ? 'is-ready' : 'is-error'}`;
      healthBadge.textContent = readyForProposal && readyForRender ? 'Listo' : 'Revisar';
      healthBadge.title = !health.ollama.available
        ? 'Ollama no está disponible.'
        : !health.ollama.modelInstalled
          ? `Falta instalar ${health.ollama.model ?? 'qwen3:8b'}.`
          : !health.tts.available ? 'Falta Piper para renderizar.' : `Ollama ${health.ollama.version ?? ''}`;
      if (status.textContent === 'Comprobando el servicio local…') {
        report(readyForProposal
          ? readyForRender ? 'Listo para crear una propuesta o renderizar.' : 'Director listo; falta Piper para renderizar.'
          : 'Ollama no está listo para crear propuestas.', readyForProposal);
      }
      syncButtons();
    } catch {
      readyForProposal = false;
      readyForRender = false;
      healthBadge.className = 'health-badge is-error';
      healthBadge.textContent = 'Sin servicio';
      healthBadge.title = 'Iniciá la aplicación con npm run dev.';
      syncButtons();
    }
  }

  async function refreshGallery(resumeLastJob: boolean): Promise<void> {
    try {
      const jobs = await listRenderJobs();
      gallery.replaceChildren(...jobs.slice(0, 12).map(jobCard));
      if (jobs.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Todavía no hay videos creados desde la app.';
        gallery.replaceChildren(empty);
      }
      if (resumeLastJob) {
        const wanted = readLastJobId();
        const job = jobs.find((item) => item.jobId === wanted) ?? jobs.find((item) => ['queued', 'rendering'].includes(item.state));
        if (job) {
          if (['queued', 'rendering'].includes(job.state)) {
            currentJobId = job.jobId;
            setBusy(true);
            cancel.disabled = false;
            reportJob(job);
            schedulePoll();
          } else if (job.state === 'completed' && job.result) {
            showCompleted(job, false);
          }
        }
      }
    } catch {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No se pudo leer el historial local.';
      gallery.replaceChildren(empty);
    }
  }

  function jobCard(job: RenderJob): HTMLElement {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'render-job-card';
    card.classList.toggle('is-active', job.jobId === currentJobId);
    card.disabled = job.state !== 'completed' || !job.result;
    card.setAttribute('role', 'listitem');
    const icon = document.createElement('span');
    icon.className = 'render-job-icon';
    icon.textContent = job.state === 'completed' ? '▶' : job.state === 'failed' ? '!' : '…';
    const copy = document.createElement('span');
    copy.className = 'render-job-copy';
    const name = document.createElement('strong');
    name.textContent = job.projectId;
    const detail = document.createElement('span');
    detail.textContent = job.result
      ? `${job.result.scenes} escena(s) · ${job.result.durationSeconds.toFixed(1)} s`
      : humanStage(job.stage);
    copy.append(name, detail);
    const state = document.createElement('span');
    state.className = 'render-job-state';
    state.textContent = humanState(job.state);
    card.append(icon, copy, state);
    if (job.result) card.addEventListener('click', () => showCompleted(job, true));
    return card;
  }

  function schedulePoll(): void {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }

  async function poll(): Promise<void> {
    if (!currentJobId) return;
    try {
      const job = await getRenderJob(currentJobId);
      reportJob(job);
      if (['completed', 'failed', 'cancelled'].includes(job.state)) {
        finishPolling();
        await refreshGallery(false);
        return;
      }
      schedulePoll();
    } catch (error) {
      finishPolling();
      reportError(error);
    }
  }

  function reportJob(job: RenderJob): void {
    if (job.state === 'completed' && job.result) {
      showCompleted(job, true);
      report(`Video completado · ${job.result.scenes} escena(s) · ${job.result.durationSeconds.toFixed(2)} s.`, true);
      return;
    }
    if (job.state === 'failed') {
      progressRoot.hidden = true;
      report(formatApiError(job.error || { message: 'El render falló.' }));
      return;
    }
    if (job.state === 'cancelled') {
      progressRoot.hidden = true;
      report('Render cancelado.');
      return;
    }
    const progressState = typeof job.progress?.state === 'string' ? job.progress.state : job.stage;
    const progress = stageProgress(progressState);
    progressRoot.hidden = false;
    progressBar.style.width = `${progress}%`;
    progressLabel.textContent = `${progress}% · ${humanStage(progressState)}`;
    report(`Render ${job.jobId}: ${humanStage(progressState)}.`, true);
  }

  function showCompleted(job: RenderJob, switchSource: boolean): void {
    if (!job.result) return;
    const source = `${job.result.videoUrl}?v=${encodeURIComponent(job.updatedAt ?? '')}`;
    if (switchSource) showFinalVideo(source, job.result.downloadName);
    else {
      const finalTab = required<HTMLButtonElement>('#source-final');
      const video = required<HTMLVideoElement>('#director-result-video');
      const download = required<HTMLAnchorElement>('#director-result-download');
      finalTab.disabled = false;
      video.src = source;
      download.href = source;
      download.download = job.result.downloadName;
      download.hidden = false;
    }
    persistLastJobId(job.jobId);
    progressRoot.hidden = true;
  }

  function finishPolling(): void {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
    currentJobId = null;
    setBusy(false);
    cancel.disabled = true;
  }

  function setBusy(busy: boolean, message?: string): void {
    generate.dataset.busy = String(busy);
    render.dataset.busy = String(busy);
    if (!currentJobId && !proposalController) cancel.disabled = true;
    if (message) report(message, true);
    syncButtons();
  }

  function syncButtons(): void {
    const busy = generate.dataset.busy === 'true' || render.dataset.busy === 'true';
    generate.disabled = busy || !readyForProposal;
    render.disabled = busy || store === null || !readyForRender;
  }

  function report(message: string, ok = false): void {
    status.textContent = message;
    status.classList.toggle('error', !ok);
    status.classList.toggle('ok', ok);
  }

  function reportError(error: unknown): void {
    const detail = error instanceof Error && 'detail' in error
      ? (error as Error & { detail?: ApiError }).detail
      : null;
    report(detail ? formatApiError(detail) : error instanceof Error ? error.message : String(error));
  }
}

function formatApiError(error: ApiError): string {
  return [error.message, error.suggestedAction, error.code ? `(${error.code})` : null].filter(Boolean).join(' ');
}

function humanState(state: RenderJob['state']): string {
  return { queued: 'En cola', rendering: 'Renderizando', completed: 'Listo', failed: 'Falló', cancelled: 'Cancelado' }[state];
}

function humanStage(stage: string): string {
  const labels: Record<string, string> = {
    queueing: 'en cola',
    starting_pipeline: 'iniciando pipeline',
    compiling_project: 'compilando proyecto',
    rendering_scene: 'preparando escena',
    generating_voice: 'generando voces',
    analyzing_audio: 'analizando audio',
    rendering_frames: 'renderizando cuadros',
    encoding: 'codificando video',
    assembling_project: 'ensamblando escenas',
    verifying_project: 'verificando resultado',
  };
  return labels[stage] || stage.replaceAll('_', ' ');
}

function stageProgress(stage: string): number {
  const values: Record<string, number> = {
    queueing: 3,
    starting_pipeline: 7,
    compiling_project: 12,
    rendering_scene: 18,
    generating_voice: 28,
    analyzing_audio: 38,
    rendering_frames: 58,
    encoding: 78,
    assembling_project: 88,
    verifying_project: 96,
  };
  return values[stage] ?? 10;
}
