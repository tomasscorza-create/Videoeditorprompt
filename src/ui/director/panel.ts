import { required } from '../dom.js';
import { notify } from '../notifications.js';
import { editorOutputState, editorWorkspace, EDITOR_WORKSPACE_EVENT } from '../editor-workspace.js';
import { createProjectStore, type ProjectStore } from '../project/store.js';
import { persistLastJobId, readLastJobId } from '../project/persistence.js';
import { showFinalVideo } from '../viewer.js';
import { projectFingerprint, projectTimingFingerprint } from '../../../shared/project-fingerprint.js';
import { buildDirectorConstraints } from './brief.js';
import { canOpenDirectorPhase, initialDirectorPhase, type DirectorPhase } from './flow-state.js';
import { describeDirectorProgress } from './progress-copy.js';
import { DIRECTOR_PROVIDER_CHANGE_EVENT, getDirectorProviderSettings } from './provider-settings.js';
import { initDirectorPreconfigurationManager } from './preconfiguration-manager.js';
import {
  cancelDirectorProposal,
  cancelRenderJob,
  classifyApiError,
  createClarifyingQuestions,
  createProposal,
  formatApiError,
  formatApiTechnicalDetails,
  getDirectorStatus,
  getHealth,
  getRenderJob,
  listDirectorPreconfigurations,
  listRenderJobs,
  startRender,
  type ApiError,
  type DirectorConstraints,
  type DirectorPersonalizationAnswer,
  type DirectorQuestion,
  type DirectorQuestionSet,
  type DirectorPreconfigurationRecord,
  type DirectorUsage,
  type RenderJob,
} from './api.js';
import { unifiedMediaDocument, unifiedMediaRevision } from '../timeline-v2.js';

const POLL_INTERVAL_MS = 1000;
const HEALTH_INTERVAL_MS = 15_000;
const DIRECTOR_USAGE_STORAGE_KEY = 'local-video.director-usage.v1';

interface IdeaDraft {
  prompt: string;
  constraints: DirectorConstraints;
  preconfigurationId?: string;
}

type EditableProject = ReturnType<ProjectStore['project']>;

interface DirectorUsageRecord {
  provider: 'ollama' | 'openai';
  model: string;
  usage: DirectorUsage;
  cache: { questionsFromCache: boolean; planFromCache: boolean };
  resources?: { selected: number; total: number; unsupportedTypes: string[] };
}

export function initDirectorUi(initialStore: ProjectStore | null, onStoreCreated: (store: ProjectStore) => void): void {
  const root = required<HTMLElement>('#director-panel');
  const idea = required<HTMLElement>('#director-phase-idea');
  const base = required<HTMLElement>('#director-phase-base');
  const video = required<HTMLElement>('#director-phase-video');
  const composer = required<HTMLElement>('#director-composer');
  const prompt = required<HTMLTextAreaElement>('#director-prompt');
  const duration = required<HTMLSelectElement>('#director-duration');
  const scenes = required<HTMLSelectElement>('#director-scenes');
  const quickControls = required<HTMLElement>('#director-quick-controls');
  const generate = required<HTMLButtonElement>('#director-generate');
  const status = required<HTMLElement>('#director-status');
  const statusBlock = status.closest<HTMLElement>('.director-global-status')!;
  const submittedMessage = required<HTMLElement>('#director-submitted-message');
  const submittedText = required<HTMLElement>('#director-submitted-text');
  const cancel = required<HTMLButtonElement>('#director-cancel');
  const healthBadge = required<HTMLButtonElement>('#director-health-badge');
  const healthPopover = required<HTMLElement>('#director-health-popover');
  const phaseButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-director-phase]'));
  const questionsForm = required<HTMLFormElement>('#director-questions-form');
  const questionsRoot = required<HTMLElement>('#director-questions');
  const questionIntro = required<HTMLElement>('.director-question-intro');
  const questionsBack = required<HTMLButtonElement>('#director-questions-back');
  const createVideo = required<HTMLButtonElement>('#director-create-video');
  const backBase = required<HTMLButtonElement>('#director-back-base');
  const replacement = required<HTMLElement>('#director-replacement');
  const render = required<HTMLButtonElement>('#director-render');
  const renderReadiness = required<HTMLElement>('#render-readiness');
  const renderRequirements = required<HTMLUListElement>('#render-requirements');
  const aiUsage = required<HTMLDetailsElement>('#director-ai-usage');
  const aiUsageValues = required<HTMLElement>('#director-ai-usage-values');
  const progressRoot = required<HTMLElement>('#render-progress');
  const progressLabel = required<HTMLElement>('#render-progress-label');
  const videoResult = required<HTMLElement>('#director-video-result');
  const videoResultMeta = required<HTMLElement>('#director-video-result-meta');
  const viewVideo = required<HTMLButtonElement>('#director-view-video');
  const downloadVideo = required<HTMLAnchorElement>('#director-download-video');
  const gallery = required<HTMLElement>('#render-job-gallery');
  const jobDetails = required<HTMLElement>('#render-job-details');
  const refreshJobs = required<HTMLButtonElement>('#jobs-refresh');
  const filesMenu = required<HTMLDetailsElement>('#files-menu');
  const renderIndicator = required<HTMLButtonElement>('#render-indicator');
  const renderIndicatorLabel = required<HTMLElement>('#render-indicator-label');
  const preconfigurationSelect = document.createElement('select');
  preconfigurationSelect.id = 'director-preconfiguration';
  preconfigurationSelect.setAttribute('aria-label', 'Configuración creativa guardada');
  const preconfigurationLabel = document.createElement('label');
  preconfigurationLabel.htmlFor = preconfigurationSelect.id;
  const preconfigurationLabelText = document.createElement('span');
  preconfigurationLabelText.textContent = 'Configuración guardada';
  preconfigurationLabel.append(preconfigurationLabelText, preconfigurationSelect);
  const preconfigurationManage = document.createElement('button');
  preconfigurationManage.type = 'button';
  preconfigurationManage.className = 'text-button';
  preconfigurationManage.textContent = 'Administrar';
  const preconfigurationControl = document.createElement('div');
  preconfigurationControl.className = 'director-preconfiguration-control';
  preconfigurationControl.append(preconfigurationLabel, preconfigurationManage);
  quickControls.append(preconfigurationControl);

  let store = initialStore;
  let phase: DirectorPhase = initialDirectorPhase(hasAuthoredContent(store));
  let busyMode: 'ai' | 'render' | null = null;
  let proposalController: AbortController | null = null;
  let currentJobId: string | null = null;
  let pollTimer: number | null = null;
  let directorStatusTimer: number | null = null;
  let readyForProposal = false;
  let readyForRender = false;
  let healthChecked = false;
  let variant = 0;
  let latestCompletedJob: RenderJob | null = null;
  let submittedInstruction: string | null = null;
  let ideaDraft: IdeaDraft | null = null;
  let questionSet: DirectorQuestionSet | null = null;
  let preconfigurations: DirectorPreconfigurationRecord[] = [];
  const subscribedStores = new WeakSet<ProjectStore>();

  root.hidden = false;
  subscribeToStore(store);
  const restoredUsage = store ? readPersistedDirectorUsage(store.project()) : null;
  if (restoredUsage) renderAiUsage(restoredUsage.model, restoredUsage.usage, restoredUsage.cache, restoredUsage.provider, restoredUsage.resources);
  syncUi();
  void refreshHealth();
  void refreshGallery(true);
  void refreshPreconfigurations();
  initDirectorPreconfigurationManager({
    openButton: preconfigurationManage,
    selectedId: () => preconfigurationSelect.value || undefined,
    onRecordsChanged: (nextRecords, selectedId) => applyPreconfigurationRecords(nextRecords, selectedId),
  });

  const healthTimer = window.setInterval(() => void refreshHealth(), HEALTH_INTERVAL_MS);
  window.addEventListener('pagehide', () => window.clearInterval(healthTimer), { once: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void refreshHealth();
      void refreshGallery(false);
    }
  });

  for (const button of phaseButtons) {
    button.addEventListener('click', () => {
      const wanted = button.dataset.directorPhase as DirectorPhase;
      if (canOpenDirectorPhase(flowState(), wanted)) setPhase(wanted);
    });
  }
  questionsBack.addEventListener('click', () => {
    questionSet = null;
    ideaDraft = null;
    setPhase('idea');
    prompt.focus();
  });
  backBase.addEventListener('click', () => {
    questionSet = null;
    ideaDraft = null;
    prompt.value = '';
    setPhase('idea');
    prompt.focus();
  });
  generate.addEventListener('click', () => void requestQuestions());
  questionsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void createPersonalizedVideo();
  });
  prompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void requestQuestions();
    }
  });
  refreshJobs.addEventListener('click', () => void refreshGallery(false));
  renderIndicator.addEventListener('click', () => {
    setPhase('video');
    root.scrollIntoView({ block: 'nearest' });
  });
  render.addEventListener('click', () => void startCurrentRender());
  viewVideo.addEventListener('click', () => {
    if (latestCompletedJob) showCompleted(latestCompletedJob, true, true);
  });
  cancel.addEventListener('click', () => void cancelCurrentWork());
  healthBadge.addEventListener('click', () => toggleHealthPopover(Boolean(healthPopover.hidden)));
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Node)) return;
    if (filesMenu.open && !filesMenu.contains(event.target)) filesMenu.open = false;
    if (!healthPopover.hidden && !healthPopover.contains(event.target) && !healthBadge.contains(event.target)) toggleHealthPopover(false);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    filesMenu.open = false;
    toggleHealthPopover(false);
  });
  window.addEventListener(EDITOR_WORKSPACE_EVENT, syncUi);
  window.addEventListener(DIRECTOR_PROVIDER_CHANGE_EVENT, () => void refreshHealth());

  async function requestQuestions(): Promise<void> {
    const instruction = prompt.value.trim();
    if (instruction.length < 3) {
      report('Escribí una idea de al menos tres caracteres.');
      prompt.focus();
      return;
    }
    const constraints = buildDirectorConstraints({ duration: duration.value, scenes: scenes.value });
    if (getDirectorProviderSettings().provider === 'openai' && (constraints.sceneCount ?? 0) > 3) {
      const blocks = Math.ceil((constraints.sceneCount ?? 0) / 3);
      notify({
        message: `OpenAI preparará el plan en ${blocks} bloques. Los videos largos consumen más tokens y el total quedará visible en Video.`,
        level: 'info',
      });
    }
    proposalController = new AbortController();
    submittedInstruction = instruction;
    setBusy('ai', 'Leyendo tu idea para preparar tres preguntas…');
    root.closest<HTMLElement>('.director-column')?.scrollTo({ top: 0, behavior: 'auto' });
    let succeeded = false;
    try {
      const preconfigurationId = preconfigurationSelect.value || undefined;
      questionSet = await createClarifyingQuestions(instruction, constraints, proposalController.signal, preconfigurationId);
      ideaDraft = { prompt: instruction, constraints, preconfigurationId };
      renderQuestions(questionSet.questions);
      phase = 'base';
      report('Respondé las tres preguntas para personalizar el video.', true);
      succeeded = true;
    } catch (error) {
      submittedInstruction = null;
      reportError(error);
    } finally {
      proposalController = null;
      if (succeeded) submittedInstruction = null;
      setBusy(null);
      syncUi();
      if (succeeded) {
        statusBlock.hidden = true;
        root.closest<HTMLElement>('.director-column')?.scrollTo({ top: 0, behavior: 'auto' });
      }
    }
  }

  async function createPersonalizedVideo(): Promise<void> {
    if (!ideaDraft || !questionSet) return report('Volvé a la idea para preparar las preguntas.');
    const personalization = collectAnswers(questionSet.questions);
    if (!personalization) return;
    proposalController = new AbortController();
    submittedInstruction = ideaDraft.prompt;
    setBusy('ai', 'Creando el video con tus respuestas…');
    try {
      const questionUsage = questionSet.usage;
      const questionsFromCache = questionSet.cacheHit;
      const result = await createProposal(
        ideaDraft.prompt,
        variant,
        ideaDraft.constraints,
        { think: false, bestOf: 1 },
        personalization,
        proposalController.signal,
        ideaDraft.preconfigurationId,
      );
      if (store) {
        const error = store.replaceProject(result.project);
        if (error) throw new Error(error);
      } else {
        store = await createProjectStore(result.project);
        onStoreCreated(store);
        subscribeToStore(store);
      }
      variant += 1;
      const creationUsage = mergeDirectorUsage(questionUsage, result.usage);
      const resourceSummary = {
        selected: result.context.shortlistedEntries,
        total: result.context.totalCatalogEntries,
        unsupportedTypes: result.context.unsupportedResourceTypes ?? [],
      };
      renderAiUsage(result.model, creationUsage, {
        questionsFromCache,
        planFromCache: result.cacheHit,
      }, undefined, resourceSummary);
      persistDirectorUsage(store.project(), {
        provider: getDirectorProviderSettings().provider,
        model: result.model,
        usage: creationUsage,
        cache: { questionsFromCache, planFromCache: result.cacheHit },
        resources: resourceSummary,
      });
      phase = 'video';
      questionSet = null;
      ideaDraft = null;
      prompt.value = '';
      const appliedPreconfiguration = result.context.preconfiguration?.name;
      report(appliedPreconfiguration
        ? `Proyecto creado con «${appliedPreconfiguration}». Preparando el preview con voces y tiempos reales…`
        : 'Proyecto creado. Preparando el preview con voces y tiempos reales…', true);
      submittedInstruction = null;
      setBusy(null);
      syncUi();
    } catch (error) {
      submittedInstruction = null;
      reportError(error);
    } finally {
      proposalController = null;
      if (busyMode === 'ai') setBusy(null);
      syncUi();
    }
  }

  function renderQuestions(questions: readonly DirectorQuestion[]): void {
    questionsRoot.replaceChildren(...questions.map((question, index) => questionCard(question, index)));
    const selected = preconfigurations.find((record) => record.preconfiguration.id === ideaDraft?.preconfigurationId)?.preconfiguration;
    questionIntro.textContent = selected
      ? `La IA leyó tu idea usando «${selected.name}». Respondé las tres preguntas para completar esa base.`
      : 'La IA leyó tu idea. En cada pregunta elegí una de las tres opciones o escribí una respuesta diferente.';
    replacement.hidden = !hasAuthoredContent(store);
  }

  async function refreshPreconfigurations(): Promise<void> {
    const selectedId = preconfigurationSelect.value;
    try {
      applyPreconfigurationRecords(await listDirectorPreconfigurations(), selectedId);
    } catch {
      applyPreconfigurationRecords([]);
    }
  }

  function applyPreconfigurationRecords(records: DirectorPreconfigurationRecord[], selectedId?: string): void {
    preconfigurations = records;
    const options = [new Option('No usar una configuración guardada', '')];
    for (const record of preconfigurations) {
      const option = new Option(record.preconfiguration.name, record.preconfiguration.id);
      option.title = record.preconfiguration.description || describePreconfiguration(record);
      options.push(option);
    }
    preconfigurationSelect.replaceChildren(...options);
    if (selectedId && preconfigurations.some((record) => record.preconfiguration.id === selectedId)) {
      preconfigurationSelect.value = selectedId;
    }
  }

  function collectAnswers(questions: readonly DirectorQuestion[]): DirectorPersonalizationAnswer[] | null {
    const answers: DirectorPersonalizationAnswer[] = [];
    for (const question of questions) {
      const selected = Array.from(questionsRoot.querySelectorAll<HTMLInputElement>(`[data-question-id="${question.id}"] input:checked`));
      if (selected.length === 0) {
        report('Elegí una opción en cada pregunta para continuar.');
        questionsRoot.querySelector<HTMLInputElement>(`[data-question-id="${question.id}"] input`)?.focus();
        return null;
      }
      const selectedValue = selected[0].value;
      if (selectedValue === '__other__') {
        const otherInput = questionsRoot.querySelector<HTMLInputElement>(`[data-question-id="${question.id}"] .director-question-other-input`);
        const otherAnswer = otherInput?.value.trim() ?? '';
        if (!otherAnswer) {
          report('Escribí tu respuesta en el campo Otra para continuar.');
          otherInput?.focus();
          return null;
        }
        answers.push({ question: question.prompt, answer: otherAnswer });
        continue;
      }
      const options = Array.isArray(question.options) ? question.options : [];
      const label = options.find((option) => option.id === selectedValue)?.label ?? selectedValue;
      answers.push({ question: question.prompt, answer: label });
    }
    return answers;
  }

  async function startCurrentRender(): Promise<void> {
    if (!store) return report('Primero creá una base.');
    const validationError = store.validate();
    if (validationError) return report(`El proyecto no se puede exportar: ${validationError}`);
    videoResult.hidden = true;
    setPhase('video');
    setBusy('render', 'Preparando el video…');
    try {
      const job = await startRender(store.project(), unifiedMediaDocument());
      currentJobId = job.jobId;
      persistLastJobId(job.jobId);
      reportJob(job);
      await refreshGallery(false);
      schedulePoll();
    } catch (error) {
      currentJobId = null;
      setBusy(null);
      reportError(error);
    }
  }

  async function cancelCurrentWork(): Promise<void> {
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
    }
  }

  function subscribeToStore(target: ProjectStore | null): void {
    if (!target || subscribedStores.has(target)) return;
    subscribedStores.add(target);
    target.subscribe(syncUi);
  }

  function setPhase(next: DirectorPhase): void {
    if (!canOpenDirectorPhase(flowState(), next)) return;
    phase = next;
    syncUi();
    root.closest<HTMLElement>('.director-column')?.scrollTo({ top: 0, behavior: 'auto' });
  }

  function flowState() {
    return {
      phase,
      projectAvailable: hasAuthoredContent(store),
      questionsAvailable: questionSet !== null,
      busy: busyMode,
    };
  }

  function syncUi(): void {
    const projectAvailable = hasAuthoredContent(store);
    if (phase === 'base' && !questionSet) phase = projectAvailable ? 'video' : 'idea';
    if (phase === 'video' && !projectAvailable) phase = questionSet ? 'base' : 'idea';
    idea.hidden = phase !== 'idea';
    base.hidden = phase !== 'base';
    video.hidden = phase !== 'video';
    composer.hidden = phase !== 'idea' || busyMode === 'ai';
    submittedMessage.hidden = submittedInstruction === null;
    submittedText.textContent = submittedInstruction ?? '';
    root.dataset.phase = phase;
    for (const button of phaseButtons) {
      const buttonPhase = button.dataset.directorPhase as DirectorPhase;
      const selected = buttonPhase === phase;
      button.classList.toggle('is-active', selected);
      button.classList.toggle('is-complete', buttonPhase === 'idea' ? questionSet !== null || projectAvailable : buttonPhase === 'base' && projectAvailable);
      button.setAttribute('aria-current', selected ? 'step' : 'false');
      button.disabled = !canOpenDirectorPhase(flowState(), buttonPhase);
    }
    generate.textContent = 'Aceptar';
    generate.disabled = busyMode !== null || !readyForProposal;
    createVideo.disabled = busyMode !== null || !readyForProposal || questionSet === null;
    cancel.hidden = busyMode === null;
    cancel.disabled = busyMode === 'ai' ? proposalController === null : busyMode === 'render' ? currentJobId === null : true;
    syncRenderState();
  }

  function renderAiUsage(
    model: string,
    usage: DirectorUsage,
    cache: { questionsFromCache: boolean; planFromCache: boolean },
    persistedProvider?: 'ollama' | 'openai',
    resources?: { selected: number; total: number; unsupportedTypes: string[] },
  ): void {
    const providerName = persistedProvider ?? getDirectorProviderSettings().provider;
    const provider = providerName === 'openai' ? 'OpenAI' : 'Ollama local';
    const requests = usage.currentRequestCount ?? usage.requestCount ?? 0;
    const cacheLabel = cache.questionsFromCache && cache.planFromCache
      ? 'Preguntas y plan reutilizados'
      : cache.questionsFromCache ? 'Preguntas reutilizadas' : cache.planFromCache ? 'Plan reutilizado' : 'Sin reutilización completa';
    const rows: Array<[string, string]> = [
      ['Modelo', `${provider} · ${model}`],
      ['Solicitudes', String(requests)],
      ['Reintentos de red', String(usage.retryCount ?? 0)],
      ['Tokens de entrada', formatTokenCount(usage.inputTokens)],
      ['Entrada cacheada', formatTokenCount(usage.cachedInputTokens)],
      ['Tokens de salida', formatTokenCount(usage.outputTokens)],
      ['Tokens totales', formatTokenCount(usage.totalTokens)],
      ['Reparaciones', String(usage.repairAttempts ?? 0)],
      ['Caché local', cacheLabel],
    ];
    if (resources) {
      rows.push(['Recursos enviados', `${resources.selected} de ${resources.total}`]);
      if (resources.unsupportedTypes.length) rows.push(['Tipos aún no dirigibles', resources.unsupportedTypes.join(', ')]);
    }
    aiUsageValues.replaceChildren(...rows.flatMap(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      return [term, description];
    }));
    aiUsage.hidden = false;
  }

  function syncRenderState(): void {
    const state = describeRenderAvailability();
    render.disabled = !state.enabled;
    render.textContent = state.label;
    renderReadiness.textContent = state.message;
    renderReadiness.className = `render-readiness is-${state.kind}`;
    renderRequirements.replaceChildren();
    if (state.kind === 'blocked' && busyMode !== 'render') {
      const item = document.createElement('li');
      item.className = 'render-requirement is-blocked';
      item.textContent = state.message;
      renderRequirements.append(item);
    }
  }

  function describeRenderAvailability(): { enabled: boolean; label: string; message: string; kind: 'ready' | 'current' | 'blocked' } {
    if (busyMode === 'render') return { enabled: false, label: 'Creando MP4…', message: 'El video se está produciendo con la revisión enviada.', kind: 'blocked' };
    if (busyMode === 'ai') return { enabled: false, label: 'Exportar MP4', message: 'Esperá a que el Director termine.', kind: 'blocked' };
    if (!store) return { enabled: false, label: 'Exportar MP4', message: 'Creá una base antes de exportar el video.', kind: 'blocked' };
    if (editorWorkspace().mode === 'creator') return { enabled: false, label: 'Exportar MP4', message: 'Volvé al Editor de video para exportar el proyecto.', kind: 'blocked' };
    const validationError = store.validate();
    if (validationError) return { enabled: false, label: 'Proyecto incompleto', message: `Completá el proyecto: ${validationError}`, kind: 'blocked' };
    if (!healthChecked) return { enabled: false, label: 'Comprobando motor…', message: 'Verificando las herramientas locales.', kind: 'blocked' };
    if (!readyForRender) return { enabled: false, label: 'Video no disponible', message: 'La voz local no está disponible. Abrí el diagnóstico.', kind: 'blocked' };
    const output = editorOutputState();
    if (output === 'current') return { enabled: false, label: 'MP4 actualizado', message: 'El MP4 coincide con la edición actual.', kind: 'current' };
    if (output === 'stale') return { enabled: true, label: 'Exportar MP4 actualizado', message: 'El preview refleja los cambios. El MP4 anterior sigue disponible.', kind: 'ready' };
    return { enabled: true, label: 'Exportar MP4', message: 'Revisá el preview y exportá el archivo cuando estés listo.', kind: 'ready' };
  }

  async function refreshHealth(): Promise<void> {
    try {
      const health = await getHealth();
      healthChecked = true;
      const directorHealth = health.director ?? health.ollama;
      readyForProposal = Boolean(directorHealth?.available && directorHealth.modelInstalled);
      readyForRender = health.tts.available;
      healthBadge.textContent = health.ready ? 'Listo' : 'Revisar';
      healthBadge.className = `health-badge ${health.ready ? 'is-ready' : 'is-warning'}`;
      const title = document.createElement('strong');
      title.textContent = health.ready ? 'Herramientas locales listas' : 'Hay herramientas por revisar';
      const details = document.createElement('p');
      const providerLabel = getDirectorProviderSettings().provider === 'openai' ? 'OpenAI' : 'Ollama';
      details.textContent = `${providerLabel}: ${readyForProposal ? 'listo' : 'no disponible'} · Voz: ${readyForRender ? 'lista' : 'no disponible'} · Render: ${health.renderBusy ? 'ocupado' : 'libre'}`;
      healthPopover.replaceChildren(title, details);
      if (busyMode === null && health.ready) statusBlock.hidden = true;
    } catch (error) {
      healthChecked = true;
      readyForProposal = false;
      readyForRender = false;
      healthBadge.textContent = 'Sin servicio';
      healthBadge.className = 'health-badge is-error';
      reportError(error);
    }
    syncUi();
  }

  function toggleHealthPopover(open: boolean): void {
    healthPopover.hidden = !open;
    healthBadge.setAttribute('aria-expanded', String(open));
  }

  async function refreshGallery(resume: boolean): Promise<void> {
    try {
      const jobs = await listRenderJobs();
      gallery.replaceChildren(...jobs.slice(0, 12).map(jobCard));
      if (jobs.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Todavía no hay videos creados.';
        gallery.append(empty);
      }
      if (resume) {
        const wanted = readLastJobId();
        const job = jobs.find((item) => item.jobId === wanted) ?? jobs.find((item) => ['queued', 'rendering'].includes(item.state));
        if (job && ['queued', 'rendering'].includes(job.state)) {
          currentJobId = job.jobId;
          phase = 'video';
          setBusy('render');
          reportJob(job);
          schedulePoll();
        } else if (job?.state === 'completed' && job.result) showCompleted(job, false);
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
    card.disabled = !job.result && job.state !== 'failed';
    const icon = document.createElement('span');
    icon.className = 'render-job-icon';
    icon.textContent = job.state === 'completed' ? '▶' : job.state === 'failed' ? '!' : '…';
    const copy = document.createElement('span');
    copy.className = 'render-job-copy';
    const name = document.createElement('strong');
    name.textContent = job.projectId;
    const detail = document.createElement('span');
    detail.textContent = job.result ? `${job.result.scenes} escena(s) · ${job.result.durationSeconds.toFixed(1)} s` : humanStage(job.stage);
    copy.append(name, detail);
    card.append(icon, copy);
    card.addEventListener('click', () => {
      if (job.result) showCompleted(job, true, true);
      else showJobDetails(job);
      filesMenu.open = false;
    });
    return card;
  }

  function showJobDetails(job: RenderJob): void {
    const error = job.error ?? { message: 'La exportación no conservó detalles.' };
    const title = document.createElement('strong');
    title.textContent = 'No se pudo completar la exportación';
    const message = document.createElement('p');
    message.textContent = formatApiError(error);
    jobDetails.replaceChildren(title, message);
    const technical = formatApiTechnicalDetails(error);
    if (technical) {
      const details = document.createElement('details');
      details.innerHTML = '<summary>Detalles técnicos</summary>';
      const pre = document.createElement('pre');
      pre.textContent = technical;
      details.append(pre);
      jobDetails.append(details);
    }
    jobDetails.hidden = false;
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
      } else schedulePoll();
    } catch (error) {
      finishPolling();
      reportError(error);
    }
  }

  function reportJob(job: RenderJob): void {
    if (job.state === 'completed' && job.result) {
      latestCompletedJob = job;
      const current = showCompleted(job, true);
      const message = current ? `MP4 listo · ${job.result.scenes} escena(s) · ${job.result.durationSeconds.toFixed(1)} s.` : 'El MP4 corresponde a una versión anterior.';
      progressRoot.hidden = true;
      videoResult.hidden = false;
      videoResultMeta.textContent = `${job.result.scenes} escena${job.result.scenes === 1 ? '' : 's'} · ${job.result.durationSeconds.toFixed(1)} s`;
      downloadVideo.href = job.result.videoUrl;
      downloadVideo.download = job.result.downloadName;
      report(message, true);
      notify({ message, level: current ? 'success' : 'info', actionLabel: 'Ver video', onAction: () => showCompleted(job, true, true) });
      return;
    }
    if (job.state === 'failed') {
      progressRoot.hidden = true;
      hideRenderIndicator();
      report(formatApiError(job.error ?? { message: 'La exportación falló.' }));
      return;
    }
    if (job.state === 'cancelled') {
      progressRoot.hidden = true;
      hideRenderIndicator();
      report('Exportación cancelada.', true);
      return;
    }
    const progressState = typeof job.progress?.state === 'string' ? job.progress.state : job.stage;
    const scene = describeSceneProgress(job.progress);
    const label = `${humanStage(progressState)}${scene ? ` · ${scene}` : ''}`;
    progressRoot.hidden = false;
    progressLabel.textContent = label;
    showRenderIndicator(label);
    report(`Creando el video: ${label}.`, true);
  }

  function showCompleted(job: RenderJob, reveal: boolean, allowStaleReveal = false): boolean {
    if (!job.result) return false;
    latestCompletedJob = job;
    videoResult.hidden = false;
    videoResultMeta.textContent = `${job.result.scenes} escena${job.result.scenes === 1 ? '' : 's'} · ${job.result.durationSeconds.toFixed(1)} s`;
    downloadVideo.href = job.result.videoUrl;
    downloadVideo.download = job.result.downloadName;
    const currentProject = store?.project();
    const timelineRevision = unifiedMediaRevision();
    const timelineCurrent = timelineRevision === null ? !job.timelineRevision : job.timelineRevision === timelineRevision;
    const current = Boolean(currentProject
      && job.projectId === currentProject.id
      && job.projectRevision === projectFingerprint(currentProject)
      && timelineCurrent);
    const timingRevision = currentProject && job.projectId === currentProject.id ? projectTimingFingerprint(currentProject) : null;
    const measuredTiming = job.timingRevision ?? (current ? timingRevision : null);
    showFinalVideo({
      projectId: job.projectId,
      url: `${job.result.videoUrl}?v=${encodeURIComponent(job.updatedAt ?? '')}`,
      downloadName: job.result.downloadName,
      timeline: job.result.timeline ?? null,
      projectRevision: job.projectRevision ?? null,
      timingRevision: timingRevision === measuredTiming ? measuredTiming : null,
      current,
      reveal: reveal && (current || allowStaleReveal),
    });
    persistLastJobId(job.jobId);
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
    const previous = busyMode;
    busyMode = mode;
    root.classList.toggle('is-ai-busy', mode === 'ai');
    root.classList.toggle('is-render-busy', mode === 'render');
    root.setAttribute('aria-busy', String(mode !== null));
    if (mode === 'ai' && previous !== 'ai') scheduleDirectorStatusPoll();
    if (mode !== 'ai') stopDirectorStatusPoll();
    if (message) report(message, true);
    syncUi();
  }

  function scheduleDirectorStatusPoll(): void {
    if (directorStatusTimer !== null) window.clearTimeout(directorStatusTimer);
    directorStatusTimer = window.setTimeout(() => void pollDirectorStatus(), 700);
  }

  async function pollDirectorStatus(): Promise<void> {
    if (busyMode !== 'ai') return;
    try {
      const progress = describeDirectorProgress(await getDirectorStatus());
      if (progress) report(progress, true);
    } catch { /* la petición principal conserva el error autoritativo */ }
    if (busyMode === 'ai') scheduleDirectorStatusPoll();
  }

  function stopDirectorStatusPoll(): void {
    if (directorStatusTimer !== null) window.clearTimeout(directorStatusTimer);
    directorStatusTimer = null;
  }

  function showRenderIndicator(label: string): void {
    renderIndicator.hidden = false;
    renderIndicatorLabel.textContent = label;
    renderIndicator.title = `Video en curso: ${label}. Abrir la fase Video.`;
  }

  function hideRenderIndicator(): void {
    renderIndicator.hidden = true;
  }

  function report(message: string, ok = false): void {
    statusBlock.hidden = false;
    status.textContent = message;
    status.classList.toggle('error', !ok);
    status.classList.toggle('ok', ok);
  }

  function reportError(error: unknown): void {
    const detail = error instanceof Error && 'detail' in error ? (error as Error & { detail?: ApiError }).detail : null;
    const message = detail ? formatApiError(detail) : error instanceof Error ? error.message : String(error);
    const kind = detail ? classifyApiError(detail) : 'error';
    report(message, kind === 'cancelled' || kind === 'busy');
    notify({
      message,
      level: kind === 'cancelled' || kind === 'busy' ? 'info' : 'error',
      ...(kind === 'dependency'
        ? { actionLabel: 'Ver diagnóstico', onAction: () => toggleHealthPopover(true) }
        : kind === 'timeout' || kind === 'invalid-response'
          ? { actionLabel: 'Volver a intentar', onAction: () => { phase = questionSet ? 'base' : 'idea'; syncUi(); if (phase === 'idea') prompt.focus(); } }
          : {}),
    });
  }

}

function hasAuthoredContent(store: ProjectStore | null): boolean {
  return Boolean(store?.project().scenes.some((scene) => scene.elements.length > 0 || scene.dialogue.length > 0));
}

function questionCard(question: DirectorQuestion, index: number): HTMLElement {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'director-question-card';
  fieldset.dataset.questionId = question.id;
  const legend = document.createElement('legend');
  const number = document.createElement('span');
  number.textContent = String(index + 1).padStart(2, '0');
  const copy = document.createElement('strong');
  copy.textContent = question.prompt;
  legend.append(number, copy);
  fieldset.append(legend);

  const choices = document.createElement('div');
  choices.className = 'director-question-options';
  const options = Array.isArray(question.options) ? question.options : [];
  for (const option of options) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = question.multiple ? 'checkbox' : 'radio';
    input.name = `director-question-${question.id}`;
    input.value = option.id;
    const mark = document.createElement('span');
    mark.className = 'director-question-mark';
    const optionLabel = document.createElement('span');
    optionLabel.textContent = option.label;
    label.append(input, mark, optionLabel);
    choices.append(label);
  }
  const other = document.createElement('div');
  other.className = 'director-question-other';
  const otherRadio = document.createElement('input');
  otherRadio.type = 'radio';
  otherRadio.name = `director-question-${question.id}`;
  otherRadio.value = '__other__';
  otherRadio.id = `director-question-${question.id}-other`;
  const otherMark = document.createElement('span');
  otherMark.className = 'director-question-mark';
  const otherBody = document.createElement('div');
  const otherLabel = document.createElement('label');
  otherLabel.htmlFor = otherRadio.id;
  otherLabel.textContent = 'Otra respuesta';
  const otherInput = document.createElement('input');
  otherInput.className = 'director-question-other-input';
  otherInput.type = 'text';
  otherInput.maxLength = 300;
  otherInput.placeholder = question.otherPlaceholder;
  otherInput.setAttribute('aria-label', `Otra respuesta para: ${question.prompt}`);
  const activateOther = () => {
    otherRadio.checked = true;
  };
  otherRadio.addEventListener('change', () => {
    otherInput.focus();
  });
  otherInput.addEventListener('focus', activateOther);
  otherInput.addEventListener('input', activateOther);
  otherBody.append(otherLabel, otherInput);
  other.append(otherRadio, otherMark, otherBody);
  choices.append(other);
  fieldset.append(choices);
  return fieldset;
}

function humanStage(stage: string): string {
  return ({
    queueing: 'En cola', starting_pipeline: 'Iniciando el motor', compiling_project: 'Preparando el proyecto',
    rendering_scene: 'Preparando una escena', reusing_scene: 'Reutilizando una escena', generating_voice: 'Creando las voces',
    analyzing_audio: 'Midiendo el audio', rendering_frames: 'Dibujando el video', encoding: 'Codificando el MP4',
    assembling_project: 'Uniendo las escenas', verifying_project: 'Verificando el resultado',
  } as Record<string, string>)[stage] ?? stage.replaceAll('_', ' ');
}

function describeSceneProgress(progress: Record<string, unknown> | null): string | null {
  if (!progress) return null;
  const index = Number(progress.sceneIndex ?? progress.currentScene ?? 0);
  const count = Number(progress.sceneCount ?? progress.totalScenes ?? 0);
  return index > 0 && count > 0 ? `Escena ${index} de ${count}` : null;
}

function mergeDirectorUsage(...entries: Array<DirectorUsage | undefined>): DirectorUsage {
  const values = entries.filter((entry): entry is DirectorUsage => Boolean(entry));
  const sum = (field: keyof DirectorUsage): number | null => {
    const numbers = values.map((entry) => entry[field]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null;
  };
  return {
    requestCount: sum('requestCount') ?? 0,
    currentRequestCount: sum('currentRequestCount') ?? sum('requestCount') ?? 0,
    transportAttempts: sum('transportAttempts') ?? 0,
    retryCount: sum('retryCount') ?? 0,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cachedInputTokens: sum('cachedInputTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    uncachedInputTokens: sum('uncachedInputTokens'),
    totalTokens: sum('totalTokens'),
    repairAttempts: sum('repairAttempts') ?? 0,
  };
}

function formatTokenCount(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('es-AR').format(value) : '—';
}

function describePreconfiguration(record: DirectorPreconfigurationRecord): string {
  const value = record.preconfiguration;
  const cast = value.characterBindings.length === 0
    ? 'sin personajes'
    : `${value.characterBindings.length} ${value.characterBindings.length === 1 ? 'personaje' : 'personajes'} con voz fija`;
  const backgrounds = value.preferredBackgroundResourceIds.length === 1
    ? 'un fondo preferido'
    : `${value.preferredBackgroundResourceIds.length} fondos preferidos`;
  return `${cast} · ${backgrounds}`;
}

function persistDirectorUsage(project: EditableProject, record: DirectorUsageRecord): void {
  try {
    localStorage.setItem(DIRECTOR_USAGE_STORAGE_KEY, JSON.stringify({
      version: 1,
      projectId: project.id,
      projectRevision: projectFingerprint(project),
      ...record,
    }));
  } catch {
    // La creación sigue siendo válida si el navegador bloquea almacenamiento local.
  }
}

function readPersistedDirectorUsage(project: EditableProject): DirectorUsageRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(DIRECTOR_USAGE_STORAGE_KEY) || 'null') as Partial<DirectorUsageRecord> & {
      version?: number;
      projectId?: string;
      projectRevision?: string;
    } | null;
    if (value?.version !== 1
      || value.projectId !== project.id
      || value.projectRevision !== projectFingerprint(project)
      || !['ollama', 'openai'].includes(String(value.provider))
      || typeof value.model !== 'string'
      || !value.usage
      || !value.cache) return null;
    return value as DirectorUsageRecord;
  } catch {
    return null;
  }
}
