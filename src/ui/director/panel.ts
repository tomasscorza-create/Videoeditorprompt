import { summarizeCommands } from '../command-labels.js';
import { required } from '../dom.js';
import { notify } from '../notifications.js';
import {
  authorizeCustomizedRemovals,
  formatCustomizedRemovalConfirmation,
  formatDirectorEditConfirmation,
} from './edit-proposal.js';
import { revealResource } from '../project/library.js';
import { persistLastJobId, readLastJobId } from '../project/persistence.js';
import { createProjectStore, type ProjectStore } from '../project/store.js';
import { projectSelection } from '../project/selection.js';
import { showFinalVideo } from '../viewer.js';
import { EDITOR_WORKSPACE_EVENT, editorOutputState, editorWorkspace } from '../editor-workspace.js';
import { projectFingerprint, projectTimingFingerprint } from '../../../shared/project-fingerprint.js';
import {
  cancelDirectorProposal,
  cancelRenderJob,
  classifyApiError,
  createProposal,
  editProjectWithAi,
  formatApiError,
  formatApiTechnicalDetails,
  getDirectorStatus,
  getHealth,
  getRenderJob,
  listRenderJobs,
  startRender,
  type ApiError,
  type DirectorConstraints,
  type DirectorGenerationOptions,
  type DirectorProposal,
  type RenderJob,
} from './api.js';
import { describeDirectorProgress } from './progress-copy.js';
import { compareCandidates, strongestCriterion } from './candidates-copy.js';
import { summarizeHealth, type DependencyView } from './health-copy.js';
import { summarizeQuality } from './quality-copy.js';
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
  const healthBadge = required<HTMLButtonElement>('#director-health-badge');
  const healthPopover = required<HTMLElement>('#director-health-popover');
  const proposalQuality = required<HTMLElement>('#proposal-quality');
  const progressRoot = required<HTMLElement>('#render-progress');
  const progressBar = required<HTMLElement>('#render-progress-bar');
  const progressLabel = required<HTMLElement>('#render-progress-label');
  const renderReadiness = required<HTMLElement>('#render-readiness');
  const gallery = required<HTMLElement>('#render-job-gallery');
  const jobDetails = required<HTMLElement>('#render-job-details');
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
  let directorStatusTimer: number | null = null;
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
    if (event.key !== 'Escape') return;
    filesMenu.open = false;
    if (!healthPopover.hidden) {
      toggleHealthPopover(false);
      healthBadge.focus();
    }
  });
  healthBadge.addEventListener('click', () => toggleHealthPopover(healthPopover.hidden !== false));
  document.addEventListener('pointerdown', (event) => {
    if (healthPopover.hidden || !(event.target instanceof Node)) return;
    if (!healthPopover.contains(event.target) && !healthBadge.contains(event.target)) toggleHealthPopover(false);
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
        if (result.commands.length > 0 && !window.confirm(formatDirectorEditConfirmation(result.explanation))) {
          report('La propuesta del Director no se aplicó. El proyecto conserva su estado anterior.', true);
          notify({ message: 'Propuesta del Director cancelada sin modificar el proyecto.', level: 'info' });
          return;
        }
        if (
          result.explanation.customizedTrackRemovalIndexes.length > 0
          && !window.confirm(formatCustomizedRemovalConfirmation(result.explanation))
        ) {
          report('La eliminación de animación personalizada fue cancelada. El proyecto conserva su estado anterior.', true);
          notify({ message: 'No se eliminó la animación personalizada.', level: 'info' });
          return;
        }
        const executableCommands = authorizeCustomizedRemovals(
          result.commands,
          result.explanation.customizedTrackRemovalIndexes,
        );
        const commandError = store.dispatchBatch(executableCommands);
        if (commandError) throw new Error(commandError);
      } else if (store) {
        const replacementError = store.replaceProject(result.project);
        if (replacementError) throw new Error(replacementError);
      } else {
        store = await createProjectStore(result.project);
        onStoreCreated(store);
        subscribeToStore(store);
      }
      // E1: la propuesta trae su reporte de calidad; una edición IA no.
      renderProposalQuality('commands' in result ? null : result);
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
      // C3: la respuesta trae los comandos exactos; se narran en vez de contarlos.
      if (editing && 'commands' in result) {
        const changes = summarizeCommands(result.commands, { sceneIds: store?.project().scenes.map((scene) => scene.id) });
        report(appliedCommands > 0
          ? `${changes}.${contextDetail} El render quedó pendiente; podés deshacer desde la timeline.`
          : `El Director no encontró cambios representables para aplicar.${contextDetail}`, true);
        notify({
          message: appliedCommands > 0 ? `El Director cambió: ${changes}.` : 'El Director no encontró cambios para aplicar.',
          level: appliedCommands > 0 ? 'success' : 'info',
        });
      } else {
        report(`Propuesta creada.${templateDetail}${contextDetail} Está lista para revisar y renderizar.`, true);
      }
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
      const summary = summarizeHealth(health);
      healthBadge.className = `health-badge ${summary.ready ? 'is-ready' : 'is-error'}`;
      healthBadge.textContent = summary.badge;
      healthBadge.title = 'Ver diagnóstico del servicio local';
      renderHealthPopover(summary.dependencies, summary.modelIdentity);
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
      healthBadge.title = 'Ver diagnóstico del servicio local';
      renderHealthPopover([{
        id: 'service',
        name: 'Servicio local',
        state: 'error',
        detail: 'No se pudo contactar al servicio local.',
        action: 'Iniciá la aplicación con npm run dev.',
      }], null);
      syncButtons();
    }
  }

  // E3: el badge deja de ser solo un semáforo y explica cada dependencia.
  function renderHealthPopover(dependencies: DependencyView[], modelIdentity: string | null): void {
    const list = document.createElement('ul');
    list.className = 'health-list';
    for (const dependency of dependencies) {
      const item = document.createElement('li');
      item.className = `health-item is-${dependency.state}`;
      const name = document.createElement('strong');
      name.textContent = dependency.name;
      const detail = document.createElement('span');
      detail.textContent = dependency.detail;
      item.append(name, detail);
      if (dependency.action) {
        const action = document.createElement('span');
        action.className = 'health-action';
        action.textContent = dependency.action;
        item.append(action);
      }
      list.append(item);
    }
    const children: HTMLElement[] = [list];
    if (modelIdentity) {
      const identity = document.createElement('p');
      identity.className = 'health-identity';
      identity.textContent = `Modelo: ${modelIdentity}`;
      children.push(identity);
    }
    const recheck = document.createElement('button');
    recheck.type = 'button';
    recheck.className = 'text-button';
    recheck.textContent = 'Comprobar de nuevo';
    recheck.addEventListener('click', () => void refreshHealth());
    children.push(recheck);
    healthPopover.replaceChildren(...children);
  }

  function toggleHealthPopover(open: boolean): void {
    healthPopover.hidden = !open;
    healthBadge.setAttribute('aria-expanded', String(open));
  }

  // E1: el reporte de calidad que el motor ya calcula deja de descartarse.
  function renderProposalQuality(proposal: DirectorProposal | null): void {
    const summary = proposal ? summarizeQuality(proposal.quality, proposal.repairAttempts) : null;
    if (!summary) {
      proposalQuality.hidden = true;
      proposalQuality.replaceChildren();
      return;
    }
    const heading = document.createElement('div');
    heading.className = `quality-heading ${summary.passed ? 'is-passed' : 'is-below'}`;
    const score = document.createElement('strong');
    score.textContent = String(summary.score);
    const headline = document.createElement('span');
    headline.textContent = summary.headline;
    heading.append(score, headline);

    const children: HTMLElement[] = [heading];
    if (summary.repairNote) {
      const repair = document.createElement('p');
      repair.className = 'quality-repair';
      repair.textContent = summary.repairNote;
      children.push(repair);
    }
    if (summary.issues.length > 0) {
      const list = document.createElement('ul');
      list.className = 'quality-issues';
      for (const issue of summary.issues) {
        const item = document.createElement('li');
        const label = document.createElement('strong');
        label.textContent = issue.label;
        const instruction = document.createElement('span');
        instruction.textContent = issue.instruction;
        item.append(label, instruction);
        list.append(item);
      }
      children.push(list);
    } else {
      const clean = document.createElement('p');
      clean.className = 'quality-clean';
      clean.textContent = 'El revisor no encontró problemas en el guion.';
      children.push(clean);
    }
    const comparison = proposal ? compareCandidates(proposal.selection) : null;
    if (comparison) children.push(renderCandidateTable(comparison));
    const context = proposal ? renderProposalContext(proposal.context) : null;
    if (context) children.push(context);
    proposalQuality.replaceChildren(...children);
    proposalQuality.hidden = false;
  }

  // C4: qué recursos de la biblioteca consideró la IA. Cada chip lleva a su
  // tarjeta, para que la conexión Director↔biblioteca sea navegable.
  function renderProposalContext(context: DirectorProposal['context']): HTMLElement | null {
    if (!context || context.resourceIds.length === 0) return null;
    const details = document.createElement('details');
    details.className = 'proposal-context';
    const summary = document.createElement('summary');
    summary.textContent = `Recursos elegidos (${context.resourceIds.length} de ${context.totalCatalogEntries})`;
    details.append(summary);
    const template = context.selectedTemplateId ?? context.recommendedTemplateId;
    if (template) {
      const line = document.createElement('p');
      line.className = 'proposal-context-template';
      line.textContent = `Plantilla base: ${template}`;
      details.append(line);
    }
    const chips = document.createElement('div');
    chips.className = 'proposal-context-chips';
    for (const resourceId of context.resourceIds) {
      const label = store?.resources('character').find((entry) => entry.id === resourceId)?.label
        ?? store?.resources('background').find((entry) => entry.id === resourceId)?.label
        ?? store?.resources('voice').find((entry) => entry.id === resourceId)?.label
        ?? resourceId;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'proposal-context-chip';
      chip.textContent = label;
      chip.title = `Mostrar ${label} en la biblioteca`;
      chip.addEventListener('click', () => revealResource(resourceId));
      chips.append(chip);
    }
    details.append(chips);
    return details;
  }

  // E2a: se muestra qué evaluó el juez. No se ofrece elegir otro candidato:
  // la API solo devuelve el proyecto del ganador (eso es E2b, con servidor).
  function renderCandidateTable(comparison: NonNullable<ReturnType<typeof compareCandidates>>): HTMLElement {
    const details = document.createElement('details');
    details.className = 'candidate-comparison';
    const summary = document.createElement('summary');
    const strongest = strongestCriterion(comparison);
    summary.textContent = comparison.verdict
      ? `${comparison.verdict}${strongest ? ` Destacó en ${strongest.toLowerCase()}.` : ''}`
      : `Se compararon ${comparison.rows.length} propuestas.`;
    details.append(summary);

    const table = document.createElement('table');
    table.className = 'candidate-table';
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.append(document.createElement('th'));
    for (const row of comparison.rows) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = row.winner ? `${row.name} ✓` : row.name;
      if (row.winner) cell.className = 'is-winner';
      headRow.append(cell);
    }
    head.append(headRow);
    const body = document.createElement('tbody');
    for (const [index, criterion] of comparison.criteria.entries()) {
      const line = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = criterion;
      line.append(label);
      for (const row of comparison.rows) {
        const cell = document.createElement('td');
        cell.textContent = String(row.scores[index]?.value ?? '—');
        if (row.winner) cell.className = 'is-winner';
        line.append(cell);
      }
      body.append(line);
    }
    if (comparison.rows.some((row) => row.total !== null)) {
      const totals = document.createElement('tr');
      totals.className = 'candidate-total';
      const label = document.createElement('th');
      label.scope = 'row';
      label.textContent = 'Total';
      totals.append(label);
      for (const row of comparison.rows) {
        const cell = document.createElement('td');
        cell.textContent = row.total === null ? '—' : String(Math.round(row.total * 10) / 10);
        if (row.winner) cell.className = 'is-winner';
        totals.append(cell);
      }
      body.append(totals);
    }
    table.append(head, body);
    details.append(table);
    return details;
  }

  async function refreshGallery(resumeLastJob: boolean): Promise<void> {
    // M3: esqueleto mientras llega la respuesta, en lugar de un texto de espera.
    hideJobDetails();
    if (gallery.childElementCount === 0 || gallery.querySelector('.empty-state')) {
      gallery.replaceChildren(skeleton(3, true));
    }
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
    card.disabled = !((job.state === 'completed' && job.result) || job.state === 'failed');
    card.setAttribute('role', 'listitem');
    if (job.state === 'failed') card.title = 'Ver por qué falló este render';
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
        hideJobDetails();
        const current = showCompleted(job, true, true);
        if (!current) report('Mostrando un render anterior. La edición actual permanece sin renderizar.', true);
        filesMenu.open = false;
      });
    } else if (job.state === 'failed') {
      card.addEventListener('click', () => showJobDetails(job));
    }
    return card;
  }

  function showJobDetails(job: RenderJob): void {
    const error = job.error ?? {
      message: 'El render falló sin conservar un detalle adicional.',
      suggestedAction: 'Volvé al proyecto, revisá su estado e intentá renderizarlo otra vez.',
    };
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = 'No se pudo completar el render';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'text-button';
    close.textContent = 'Cerrar';
    close.addEventListener('click', hideJobDetails);
    header.append(title, close);

    const context = document.createElement('p');
    context.className = 'render-job-detail-context';
    context.textContent = `${job.projectId} · ${humanStage(job.stage)}`;
    const message = document.createElement('p');
    message.textContent = formatApiError(error);
    const children: HTMLElement[] = [header, context, message];

    const technical = formatApiTechnicalDetails(error);
    if (technical) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = 'Detalles técnicos';
      const pre = document.createElement('pre');
      pre.textContent = technical;
      details.append(summary, pre);
      children.push(details);
    }
    jobDetails.replaceChildren(...children);
    jobDetails.hidden = false;
    jobDetails.scrollIntoView({ block: 'nearest' });
  }

  function hideJobDetails(): void {
    jobDetails.hidden = true;
    jobDetails.replaceChildren();
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
      // El trabajo guarda la revisión completa, no la de tiempo. Cuando el render
      // corresponde al proyecto que está abierto, el proyecto medido es este y su
      // revisión de tiempo se puede derivar; si no, se deja en null y la timeline
      // vuelve a la regla estricta en vez de suponer una medición ajena.
      timingRevision: current && currentProject ? projectTimingFingerprint(currentProject) : null,
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

  function scheduleDirectorStatusPoll(delay = 0): void {
    if (directorStatusTimer !== null) window.clearTimeout(directorStatusTimer);
    directorStatusTimer = window.setTimeout(() => void pollDirectorStatus(), delay);
  }

  async function pollDirectorStatus(): Promise<void> {
    if (busyMode !== 'ai') return;
    try {
      const progress = describeDirectorProgress(await getDirectorStatus());
      if (progress) report(progress, true);
    } catch {
      // La petición principal conserva el error autoritativo. El progreso es
      // auxiliar y no debe reemplazarlo por un segundo fallo.
    }
    if (busyMode === 'ai') scheduleDirectorStatusPoll(700);
  }

  function stopDirectorStatusPoll(): void {
    if (directorStatusTimer !== null) window.clearTimeout(directorStatusTimer);
    directorStatusTimer = null;
  }

  function setBusy(mode: 'ai' | 'render' | null, message?: string): void {
    const previousMode = busyMode;
    busyMode = mode;
    if (mode === 'ai' && previousMode !== 'ai') scheduleDirectorStatusPoll();
    if (mode !== 'ai') stopDirectorStatusPoll();
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

  // U5: todo error ofrece un siguiente paso. Cuando la causa es una
  // dependencia local, el botón abre el diagnóstico (E3) en vez de dejar al
  // usuario con un texto sin salida.
  function reportError(error: unknown): void {
    const detail = error instanceof Error && 'detail' in error
      ? (error as Error & { detail?: ApiError }).detail
      : null;
    const message = detail ? formatApiError(detail) : error instanceof Error ? error.message : String(error);
    const kind = detail ? classifyApiError(detail) : 'error';
    if (kind === 'cancelled') {
      report(message, true);
      return;
    }
    if (kind === 'busy') {
      report(message, true);
      notify({ message, level: 'info' });
      return;
    }
    report(message);
    const isDependencyFailure = kind === 'dependency';
    notify({
      message,
      level: 'error',
      ...(isDependencyFailure
        ? {
          actionLabel: 'Ver diagnóstico',
          onAction: () => {
            void refreshHealth();
            toggleHealthPopover(true);
            healthBadge.focus();
          },
        }
        : kind === 'timeout' || kind === 'invalid-response'
          ? {
            actionLabel: 'Volver a intentar',
            onAction: () => {
              transitionNavigation({ type: 'select-page', page: 'command' });
              prompt.focus();
            },
          }
        : {}),
    });
  }
}

function hasAuthoredContent(store: ProjectStore | null): boolean {
  return Boolean(store?.project().scenes.some((scene) => scene.elements.length > 0 || scene.dialogue.length > 0));
}

function isDirectorPage(value: string | undefined): value is DirectorPage {
  return DIRECTOR_PAGES.includes(value as DirectorPage);
}

/** Placeholder de carga: barras que ocupan el lugar del contenido real. */
function skeleton(lines: number, asCards = false): HTMLElement {
  const root = document.createElement('div');
  root.className = 'skeleton';
  root.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < lines; index += 1) {
    const line = document.createElement('div');
    line.className = asCards ? 'skeleton-line is-card' : 'skeleton-line';
    root.append(line);
  }
  return root;
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
