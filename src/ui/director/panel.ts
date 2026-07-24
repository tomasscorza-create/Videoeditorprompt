import { required } from '../dom.js';
import { createProjectStore, type ProjectStore } from '../project/store.js';
import {
  cancelRenderJob,
  cancelDirectorProposal,
  createProposal,
  getHealth,
  getRenderJob,
  startRender,
  type ApiError,
  type RenderJob,
} from './api.js';

const POLL_INTERVAL_MS = 1000;

export function initDirectorUi(initialStore: ProjectStore | null, onStoreCreated: (store: ProjectStore) => void): void {
  const root = required<HTMLElement>('#director-panel');
  const prompt = required<HTMLTextAreaElement>('#director-prompt');
  const generate = required<HTMLButtonElement>('#director-generate');
  const render = required<HTMLButtonElement>('#director-render');
  const cancel = required<HTMLButtonElement>('#director-cancel');
  const status = required<HTMLElement>('#director-status');
  const proposal = required<HTMLElement>('#director-proposal');
  const video = required<HTMLVideoElement>('#director-result-video');
  const download = required<HTMLAnchorElement>('#director-result-download');

  let variant = 0;
  let store = initialStore;
  let proposalController: AbortController | null = null;
  let currentJobId: string | null = null;
  let pollTimer: number | null = null;
  root.hidden = false;
  render.disabled = store === null;
  void refreshHealth();

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
    setBusy(true, 'El Director IA está preparando la propuesta… Puede tardar entre uno y cuatro minutos en CPU.');
    cancel.disabled = false;
    proposal.textContent = '';
    video.hidden = true;
    download.hidden = true;
    try {
      const result = await createProposal(value, variant, proposalController.signal);
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
        `objetivo aproximado ${result.plan.targetDurationSeconds} s`,
        result.cacheHit ? 'caché local' : result.model,
      ].join(' · ');
      report('Propuesta creada. Podés corregirla en el editor antes de renderizar.', true);
      render.disabled = false;
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
    video.hidden = true;
    download.hidden = true;
    try {
      const job = await startRender(store.project());
      currentJobId = job.jobId;
      cancel.disabled = false;
      reportJob(job);
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
    } catch (error) {
      reportError(error);
    }
  });

  async function refreshHealth(): Promise<void> {
    try {
      const health = await getHealth();
      if (!health.ollama.available) {
        report('Ollama no está disponible. Iniciá Ollama para crear propuestas.');
        return;
      }
      if (!health.ollama.modelInstalled) {
        report(`Falta instalar ${health.ollama.model ?? 'qwen3:8b'} en Ollama.`);
        return;
      }
      if (!health.tts.available) {
        report('El Director está listo, pero falta el runtime Piper para renderizar.');
        return;
      }
      report(`Director local listo · ${health.ollama.model ?? 'qwen3:8b'}`, true);
    } catch {
      report('El servicio local no está disponible. Iniciá la app con «npm run dev».');
    }
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
      if (job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') {
        finishPolling();
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
      const source = `${job.result.videoUrl}?v=${encodeURIComponent(job.updatedAt ?? '')}`;
      video.src = source;
      video.hidden = false;
      download.href = source;
      download.download = job.result.downloadName;
      download.hidden = false;
      report(
        `Video completado · ${job.result.scenes} escena(s) · ${job.result.durationSeconds.toFixed(2)} s · ${job.result.deterministic ? 'determinista' : 'sin confirmar'}`,
        true,
      );
      return;
    }
    if (job.state === 'failed') {
      report(formatApiError(job.error || { message: 'El render falló.' }));
      return;
    }
    if (job.state === 'cancelled') {
      report('Render cancelado.');
      return;
    }
    const progressState = typeof job.progress?.state === 'string' ? job.progress.state : job.stage;
    report(`Render ${job.jobId}: ${humanStage(progressState)}.`);
  }

  function finishPolling(): void {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
    currentJobId = null;
    generate.disabled = false;
    render.disabled = store === null;
    cancel.disabled = true;
  }

  function setBusy(busy: boolean, message?: string): void {
    generate.disabled = busy;
    render.disabled = busy || store === null;
    if (!currentJobId && !proposalController) cancel.disabled = true;
    if (message) report(message, true);
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
  return [error.message, error.suggestedAction].filter(Boolean).join(' ');
}

function humanStage(stage: string): string {
  const labels: Record<string, string> = {
    starting_pipeline: 'iniciando el pipeline',
    compiling_project: 'compilando el proyecto',
    rendering_scene: 'preparando una escena',
    generating_voice: 'generando voces',
    analyzing_audio: 'analizando audio',
    rendering_frames: 'renderizando frames',
    encoding: 'codificando video',
    assembling_project: 'ensamblando escenas',
    verifying_project: 'verificando el resultado',
  };
  return labels[stage] || stage.replaceAll('_', ' ');
}
