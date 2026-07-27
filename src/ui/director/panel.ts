import { required } from '../dom.js';
import { notify } from '../notifications.js';
import { persistLastJobId, readLastJobId } from '../project/persistence.js';
import { createProjectStore, type ProjectStore } from '../project/store.js';
import { projectSelection } from '../project/selection.js';
import { showFinalVideo } from '../viewer.js';
import { EDITOR_WORKSPACE_EVENT, editorOutputState, editorWorkspace } from '../editor-workspace.js';
import { projectFingerprint } from '../../../shared/project-fingerprint.js';
import {
  cancelDirectorProposal,
  cancelRenderJob,
  createProposal,
  editProjectWithAi,
  formatApiError,
  getHealth,
  getRenderJob,
  listRenderJobs,
  startRender,
  type ApiError,
  type DirectorConstraints,
  type DirectorGenerationOptions,
  type RenderJob,
} from './api.js';
import {
  DIRECTOR_PAGES,
  createDirectorNavigation,
  describeDirectorPages,
  updateDirectorNavigation,
  type DirectorNavigationEvent,
  type DirectorNavigationState,
  type DirectorPage,
} from './navigation.js';

const POLL_INTERVAL_MS = 1000;
const HEALTH_INTERVAL_MS = 15_000;

export function initDirectorUi(initialStore: ProjectStore | null, onStoreCreated: (store: ProjectStore) => void): void {
  const root = required<HTMLElement>('#director-panel');
  const prompt = required<HTMLTextAreaElement>('#director-prompt');
  const tone = required<HTMLSelectElement>('#director-tone');
  const duration = required<HTMLSelectElement>('#director-duration');
  const scenes = required<HTMLSelectElement>('#director-scenes');
  const think = required<HTMLInputElement>('#director-think');
  const bestOf = required<HTMLSelectElement>('#director-best-of');
  const generate = required<HTMLButtonElement>('#director-generate');
  const render = required<HTMLButtonElement>('#director-render');
  const cancel = required<HTMLButtonElement>('#director-cancel');
  const status = required<HTMLElement>('#director-status');
  const healthBadge = required<HTMLElement>('#director-health-badge');
  const progressRoot = required<HTMLElement>('#render-progress');
  const progressBar = required<HTMLElement>('#render-progress-bar');
  const progressLabel = required<HTMLElement>('#render-progress-label');
  const renderReadiness = required<HTMLElement>('#render-readiness');
  const gallery = required<HTMLElement>('#render-job-gallery');
  const renderIndicator = required<HTMLButtonElement>('#render-indicator');
  const renderIndicatorLabel = required<HTMLElement>('#render-indicator-label');
  const refreshJobs = required<HTMLButtonElement>('#jobs-refresh');
  const filesMenu = required<HTMLDetailsElement>('#files-menu');
  const promptLabel = required<HTMLElement>('#director-prompt-label');
  const constraintsRoot = required<HTMLElement>('#director-constraints');
  const proposalKind = required<HTMLElement>('#proposal-kind');
  const proposalTitle = required<HTMLInputElement>('#proposal-title');
  const pageTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-director-page]'));
  const pagePanels = new Map<DirectorPage, HTMLElement>(
    DIRECTOR_PAGES.map((page) => [page, required<HTMLElement>(`#director-page-${page}`)] as [DirectorPage, HTMLElement]),
  );

  let variant = 0;
  let store = initialStore;
  let navigation: DirectorNavigationState = createDirectorNavigation(hasAuthoredContent(store));
  let proposalController: AbortController | null = null;
  let currentJobId: string | null = null;
  let busyMode: 'ai' | 'render' | null = null;
  let pollTimer: number | null = null;
  let readyForProposal = false;
  let readyForRender = false;
  let healthChecked = false;
  const subscribedStores = new WeakSet<ProjectStore>();

  root.hidden = false;
  wirePageNavigation();
  subscribeToStore(store);
  syncDirectorMode();
  syncPageNavigation();
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
  // C5: el render sigue visible aunque el panel esté colapsado o en otra página.
  renderIndicator.addEventListener('click', () => {
    transitionNavigation({ type: 'render-opened' });
    root.scrollIntoView({ block: 'nearest' });
  });
  document.addEventListener('pointerdown', (event) => {
    if (filesMenu.open && event.target instanceof Node && !filesMenu.contains(event.target)) filesMenu.open = false;
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') filesMenu.open = false;
  });

  generate.addEventListener('click', async () => {
    const value = prompt.value.trim();
    if (value.length < 3) {
      report('Escribí una idea de al menos tres caracteres.');
      return;
    }
    const editing = navigation.mode === 'editing';
    const editingProject = editing && store ? structuredClone(store.project()) : null;
    if (!editing && store?.canUndo() && !window.confirm('Crear otra propuesta reemplazará tus cambios manuales y el historial de deshacer. ¿Continuar?')) {
      return;
    }
    proposalController = new AbortController();
    const generation = readGenerationOptions();
    const highQuality = generation.think || generation.bestOf > 1;
    setBusy('ai', highQuality
      ? 'El Director IA está comparando propuestas en modo calidad. Puede tardar varios minutos en CPU.'
      : 'El Director IA está preparando la propuesta. Puede tardar entre uno y cuatro minutos en CPU.');
    try {
      const result = editing && store
        ? await editProjectWithAi(value, editingProject, projectSelection(), proposalController.signal)
        : await createProposal(value, variant, readConstraints(), generation, proposalController.signal);
      const appliedCommands = 'commands' in result ? result.commands.length : 0;
      if (editing && store && 'commands' in result) {
        if (JSON.stringify(store.project()) !== JSON.stringify(editingProject)) {
          throw new Error('El proyecto cambió mientras el Director trabajaba. Repetí la petición sobre la versión actual.');
        }
        const commandError = store.dispatchBatch(result.commands);
        if (commandError) throw new Error(commandError);
      } else if (store) {
        const replacementError = store.replaceProject(result.project);
        if (replacementError) throw new Error(replacementError);
      } else {
        store = await createProjectStore(result.project);
        onStoreCreated(store);
        subscribeToStore(store);
      }
      variant += 1;
      prompt.value = '';
      transitionNavigation({ type: editing ? 'ai-change-applied' : 'proposal-created' });
      syncDirectorMode();
      const contextDetail = result.context
        ? ` Recursos: ${result.context.shortlistedEntries}/${result.context.totalCatalogEntries}.`
        : '';
      const templateId = result.context?.selectedTemplateId ?? result.context?.recommendedTemplateId;
      const templateDetail = !editing && templateId
        ? ` Plantilla base: ${templateId}.`
        : '';
      report(editing
        ? appliedCommands > 0
          ? `${appliedCommands} cambio(s) aplicados por el Director.${contextDetail} El render quedó pendiente; podés deshacer desde la timeline.`
          : `El Director no encontró cambios representables para aplicar.${contextDetail}`
        : `Propuesta creada.${templateDetail}${contextDetail} Está lista para revisar y renderizar.`, true);
    } catch (error) {
      reportError(error);
    } finally {
      proposalController = null;
      setBusy(null);
    }
  });
  window.addEventListener(EDITOR_WORKSPACE_EVENT, syncButtons);

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
    setBusy('render', 'Enviando el proyecto al pipeline local…');
    try {
      const job = await startRender(store.project());
      currentJobId = job.jobId;
      persistLastJobId(job.jobId);
      transitionNavigation({ type: 'render-opened' });
      syncButtons();
      reportJob(job);
      await refreshGallery(false);
      schedulePoll();
    } catch (error) {
      currentJobId = null;
      setBusy(null);
      reportError(error);
    }
  });

  proposalTitle.addEventListener('change', () => {
    if (!store) return;
    const title = proposalTitle.value.trim();
    if (!title) {
      syncProjectHeading();
      return;
    }
    const error = store.dispatch({ type: 'set-project-title', title });
    if (error) {
      report(error);
      syncProjectHeading();
    }
  });

  cancel.addEventListener('click', async () => {
    if (proposalController) {
      cancel.disabled = true;
      proposalController.abort();
      void cancelDirectorProposal().catch(() => {});
      proposalController = null;
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
      syncButtons();
    }
  });

  function wirePageNavigation(): void {
    for (const tab of pageTabs) {
      tab.addEventListener('click', () => {
        const page = tab.dataset.directorPage;
        if (isDirectorPage(page)) transitionNavigation({ type: 'select-page', page });
      });
    }
    // La navegación por flechas vive en el helper compartido src/ui/tabs.ts.
  }

  function subscribeToStore(target: ProjectStore | null): void {
    if (!target || subscribedStores.has(target)) return;
    subscribedStores.add(target);
    target.subscribe(() => {
      transitionNavigation({
        type: 'project-availability-changed',
        available: hasAuthoredContent(target),
      });
      syncProjectHeading();
      syncButtons();
    });
  }

  function transitionNavigation(event: DirectorNavigationEvent): void {
    navigation = updateDirectorNavigation(navigation, event);
    syncPageNavigation();
  }

  function syncPageNavigation(): void {
    for (const descriptor of describeDirectorPages(navigation)) {
      const tab = pageTabs.find((candidate) => candidate.dataset.directorPage === descriptor.page);
      if (tab) {
        tab.textContent = descriptor.label;
        tab.disabled = !descriptor.enabled;
        tab.classList.toggle('is-active', descriptor.selected);
        tab.setAttribute('aria-selected', String(descriptor.selected));
        tab.tabIndex = descriptor.selected ? 0 : -1;
      }
      const panel = pagePanels.get(descriptor.page);
      if (panel) panel.hidden = !descriptor.selected;
    }
  }

  function readConstraints(): DirectorConstraints {
    return {
      tone: tone.value as DirectorConstraints['tone'],
      targetDurationSeconds: Number(duration.value),
      sceneCount: Number(scenes.value),
    };
  }

  function readGenerationOptions(): DirectorGenerationOptions {
    return {
      think: think.checked,
      bestOf: Number(bestOf.value) as DirectorGenerationOptions['bestOf'],
    };
  }

  async function refreshHealth(): Promise<void> {
    try {
      const health = await getHealth();
      healthChecked = true;
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
      healthChecked = true;
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
            transitionNavigation({ type: 'render-opened' });
            setBusy('render');
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
    if (job.result) {
      card.addEventListener('click', () => {
        const current = showCompleted(job, true, true);
        if (!current) report('Mostrando un render anterior. La edición actual permanece sin renderizar.', true);
        filesMenu.open = false;
      });
    }
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
      const current = showCompleted(job, true);
      transitionNavigation({ type: 'render-completed' });
      syncDirectorMode();
      hideRenderIndicator();
      const message = current
        ? `Video listo · ${job.result.scenes} escena(s) · ${job.result.durationSeconds.toFixed(2)} s.`
        : 'El render terminó, pero corresponde a una versión anterior. Tus cambios actuales siguen pendientes.';
      report(message, true);
      notify({
        message,
        level: current ? 'success' : 'info',
        actionLabel: 'Ver video',
        onAction: () => showCompleted(job, true, true),
      });
      return;
    }
    if (job.state === 'failed') {
      progressRoot.hidden = true;
      hideRenderIndicator();
      const message = formatApiError(job.error || { message: 'El render falló.' });
      report(message);
      notify({ message, level: 'error' });
      return;
    }
    if (job.state === 'cancelled') {
      progressRoot.hidden = true;
      hideRenderIndicator();
      report('Render cancelado.');
      notify({ message: 'Render cancelado.', level: 'info' });
      return;
    }
    const progressState = typeof job.progress?.state === 'string' ? job.progress.state : job.stage;
    const progress = stageProgress(progressState);
    progressRoot.hidden = false;
    progressBar.style.width = `${progress}%`;
    progressLabel.textContent = `${progress}% · ${humanStage(progressState)}`;
    showRenderIndicator(`${progress}% · ${humanStage(progressState)}`);
    report(`Render ${job.jobId}: ${humanStage(progressState)}.`, true);
  }

  function showRenderIndicator(label: string): void {
    renderIndicator.hidden = false;
    renderIndicatorLabel.textContent = label;
    renderIndicator.title = `Render en curso: ${label}. Abrir la página Render.`;
  }

  function hideRenderIndicator(): void {
    renderIndicator.hidden = true;
  }

  function showCompleted(job: RenderJob, switchSource: boolean, allowStaleReveal = false): boolean {
    if (!job.result) return false;
    const projectRevision = job.projectRevision ?? null;
    const currentProject = store?.project();
    const current = Boolean(currentProject
      && job.projectId === currentProject.id
      && projectRevision !== null
      && projectRevision === projectFingerprint(currentProject));
    showFinalVideo({
      projectId: job.projectId,
      url: `${job.result.videoUrl}?v=${encodeURIComponent(job.updatedAt ?? '')}`,
      downloadName: job.result.downloadName,
      timeline: job.result.timeline ?? null,
      projectRevision,
      current,
      reveal: switchSource && (current || allowStaleReveal),
    });
    persistLastJobId(job.jobId);
    progressRoot.hidden = true;
    return current;
  }

  function finishPolling(): void {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
    currentJobId = null;
    hideRenderIndicator();
    setBusy(null);
  }

  function setBusy(mode: 'ai' | 'render' | null, message?: string): void {
    busyMode = mode;
    root.classList.toggle('is-ai-busy', mode === 'ai');
    root.classList.toggle('is-render-busy', mode === 'render');
    root.setAttribute('aria-busy', String(mode !== null));
    cancel.hidden = mode === null;
    cancel.textContent = mode === 'ai' ? 'Cancelar IA' : 'Cancelar render';
    cancel.title = mode === 'ai' ? 'Detener la propuesta en curso' : 'Detener el render en curso';
    if (message) report(message, true);
    syncButtons();
  }

  function syncButtons(): void {
    const busy = busyMode !== null;
    generate.disabled = busy || !readyForProposal;
    const renderState = describeRenderAvailability();
    render.disabled = !renderState.enabled;
    render.textContent = renderState.label;
    render.title = renderState.message;
    renderReadiness.textContent = renderState.message;
    renderReadiness.classList.toggle('is-ready', renderState.kind === 'ready');
    renderReadiness.classList.toggle('is-current', renderState.kind === 'current');
    renderReadiness.classList.toggle('is-blocked', renderState.kind === 'blocked');
    const renderTab = pageTabs.find((candidate) => candidate.dataset.directorPage === 'render');
    renderTab?.classList.toggle('has-pending-render', renderState.kind === 'ready');
    renderTab?.classList.toggle('has-current-render', renderState.kind === 'current');
    if (renderTab) renderTab.title = renderState.message;
    cancel.disabled = busyMode === 'ai' ? proposalController === null : busyMode === 'render' ? currentJobId === null : true;
  }

  function describeRenderAvailability(): {
    enabled: boolean;
    label: string;
    message: string;
    kind: 'ready' | 'current' | 'blocked';
  } {
    if (busyMode === 'render') {
      return { enabled: false, label: 'Renderizando…', message: 'El video se está generando con la revisión enviada.', kind: 'blocked' };
    }
    if (busyMode === 'ai') {
      return { enabled: false, label: 'Renderizar video', message: 'Esperá a que el Director termine de aplicar la propuesta.', kind: 'blocked' };
    }
    if (!store) {
      return { enabled: false, label: 'Renderizar video', message: 'Creá o abrí un proyecto antes de renderizar.', kind: 'blocked' };
    }
    if (editorWorkspace().mode === 'creator') {
      return { enabled: false, label: 'Renderizar video', message: 'Volvé al Editor de video para revisar y renderizar el proyecto.', kind: 'blocked' };
    }
    const validationError = store.validate();
    if (validationError) {
      return { enabled: false, label: 'Proyecto incompleto', message: `Completá el proyecto antes de renderizar: ${validationError}`, kind: 'blocked' };
    }
    if (!healthChecked) {
      return { enabled: false, label: 'Comprobando motor…', message: 'Verificando que Piper y el servicio local estén disponibles.', kind: 'blocked' };
    }
    if (!readyForRender) {
      return { enabled: false, label: 'Render no disponible', message: 'Piper no está disponible para generar voces y tiempos reales.', kind: 'blocked' };
    }
    const outputState = editorOutputState();
    if (outputState === 'current') {
      return { enabled: false, label: 'Video actualizado', message: 'El MP4 ya coincide con la edición actual. Hacé un cambio para habilitar otro render.', kind: 'current' };
    }
    if (outputState === 'stale') {
      return { enabled: true, label: 'Actualizar render', message: 'Hay cambios posteriores al último MP4. Generá una versión actualizada.', kind: 'ready' };
    }
    return { enabled: true, label: 'Renderizar video', message: 'El proyecto todavía no tiene un MP4 generado.', kind: 'ready' };
  }

  function syncDirectorMode(): void {
    const editing = navigation.mode === 'editing';
    constraintsRoot.hidden = editing;
    promptLabel.textContent = editing ? 'Pedir un cambio al Director' : 'Idea del video';
    prompt.placeholder = editing
      ? 'Ejemplo: En la escena 2, cambiá el segundo diálogo y mové el personaje de la derecha.'
      : 'Ejemplo: Dos personajes explican con humor por qué conviene verificar las respuestas de una IA.';
    generate.textContent = editing ? 'Aplicar cambio con IA' : 'Crear propuesta';
    proposalKind.textContent = editing ? 'Proyecto' : 'Propuesta';
    syncProjectHeading();
    root.classList.toggle('is-editing-project', editing);
    syncPageNavigation();
  }

  function syncProjectHeading(): void {
    proposalTitle.value = store?.project().title?.trim()
      || (navigation.mode === 'editing' ? 'Proyecto sin título' : 'Revisar y ajustar');
  }

  function report(message: string, ok = false): void {
    status.textContent = message;
    status.classList.toggle('error', !ok);
    status.classList.toggle('ok', ok);
  }

  // Los errores viajan también por notificación: el panel puede estar
  // colapsado o en otra página cuando ocurren.
  function reportError(error: unknown): void {
    const detail = error instanceof Error && 'detail' in error
      ? (error as Error & { detail?: ApiError }).detail
      : null;
    const message = detail ? formatApiError(detail) : error instanceof Error ? error.message : String(error);
    report(message);
    notify({ message, level: 'error' });
  }
}

function hasAuthoredContent(store: ProjectStore | null): boolean {
  return Boolean(store?.project().scenes.some((scene) => scene.elements.length > 0 || scene.dialogue.length > 0));
}

function isDirectorPage(value: string | undefined): value is DirectorPage {
  return DIRECTOR_PAGES.includes(value as DirectorPage);
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
