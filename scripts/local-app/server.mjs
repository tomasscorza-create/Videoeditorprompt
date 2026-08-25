import { existsSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { createDirectorProposal, inspectDirectorProvider } from '../director/ollama-director.mjs';
import { createClarifyingQuestions } from '../director/clarifying-questions.mjs';
import { editProjectWithDirector } from '../director/project-editor-director.mjs';
import { loadAuthoringCatalog } from '../director/director-plan.mjs';
import { createDirectorPreconfigurationStore } from '../director/preconfiguration-store.mjs';
import { applyPreconfigurationConstraints, createPreconfigurationSnapshot } from '../director/preconfiguration-director.mjs';
import { listProviderNames } from '../director/providers/index.mjs';
import { isMain, projectRoot, resolveTtsRoot } from '../stage1/common.mjs';
import { serializeError } from '../stage1/errors.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { createMeasurementManager } from './measurement-manager.mjs';
import { createRenderJobManager, streamVideoResponse } from './render-job-manager.mjs';
import {
  createResourceLibrary,
  createResourceLibraryRepository,
} from './resource-library.mjs';
import { createProjectRepository } from './project-repository.mjs';
import { runStartupRetention } from './retention.mjs';
import { cleanDirectorCaches } from '../director/cache.mjs';
import { createFileRenderJobRepository } from '../storage/file-render-job-repository.mjs';
import { createPersistenceRuntime } from '../storage/persistence-runtime.mjs';
import { createTimelineMediaLibrary } from '../timeline/media-library.mjs';
import { createTimelineProjectRepository } from '../timeline/timeline-project-repository.mjs';
import { createTimelineExporter } from '../timeline/timeline-exporter.mjs';
import { getElevenLabsVoice, inspectElevenLabs, listElevenLabsVoices, DEFAULT_ELEVENLABS_MODEL } from '../tts/elevenlabs-client.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_BACKGROUND_BODY_BYTES = 80 * 1024 * 1024;
const BODY_TIMEOUT_MS = 15_000;
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4174',
  'http://localhost:4174',
]);

export async function createLocalAppServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port ?? 4174);
  const sessionToken = String(options.sessionToken || randomBytes(32).toString('hex'));
  const root = path.resolve(options.root || projectRoot);
  const localRoot = path.resolve(options.localRoot || path.join(root, '.local-video'));
  const assetsRoot = path.resolve(options.assetsRoot || path.join(root, 'public'));
  const ownsPersistenceRuntime = !options.persistenceRuntime;
  const persistenceRuntime = options.persistenceRuntime || await createPersistenceRuntime({
    root,
    persistence: options.persistence || process.env.LOCAL_VIDEO_PERSISTENCE,
    environment: options.environment || process.env,
    pool: options.postgresPool,
    blobStorage: options.blobStorage,
    materializationRoot: options.materializationRoot,
  });
  const persistence = persistenceRuntime.backend;
  const builtinCatalog = options.catalog || loadAuthoringCatalog(assetsRoot);
  let library;
  let projects;
  let manager;
  try {
    library = options.library || await createResourceLibrary({
      assetsRoot,
      builtinCatalog,
      storageRoot: options.libraryStorageRoot || persistenceRuntime.libraryStorageRoot,
      publishRoot: options.libraryPublishRoot,
      repository: options.resourceRepository || persistenceRuntime.resources,
      repositoryFactory: options.resourceRepositoryFactory || createResourceLibraryRepository,
    });
    const projectRepositoryFactory = options.projectRepositoryFactory || createProjectRepository;
    projects = options.projects || persistenceRuntime.projects || projectRepositoryFactory({
      storageRoot: options.projectStorageRoot,
    });
    manager = options.manager || await createRenderJobManager({
      ...options,
      root,
      timelineMediaRoot: path.join(path.resolve(options.timelineStorageRoot || path.join(root, '.local-video', 'timeline-v2')), 'media'),
      assetsRoot,
      catalogProvider: () => library.catalog(),
      repository: options.renderJobRepository || persistenceRuntime.renderJobs,
      repositoryFactory: options.renderJobRepositoryFactory || createFileRenderJobRepository,
      blobStorage: options.blobStorage || persistenceRuntime.blobStorage,
    });
  } catch (error) {
    if (ownsPersistenceRuntime) await persistenceRuntime.close().catch(() => {});
    throw error;
  }
  const currentCatalog = () => library.catalog();
  const directorPreconfigurations = options.directorPreconfigurations || createDirectorPreconfigurationStore({
    storageRoot: options.directorPreconfigurationStorageRoot || path.join(root, '.local-video', 'director-preconfigurations'),
    catalogProvider: currentCatalog,
  });
  const resolveDirectorPreconfiguration = async (id, snapshot) => {
    if (snapshot?.preconfiguration) {
      const frozen = createPreconfigurationSnapshot({ revision: snapshot.revision, preconfiguration: snapshot.preconfiguration });
      if (!frozen || frozen.preconfigurationId !== snapshot.preconfigurationId || frozen.snapshotHash !== snapshot.snapshotHash || (id && frozen.preconfigurationId !== id)) {
        const error = new Error('La instantánea de configuración no es válida.');
        error.code = 'DIRECTOR_PRECONFIGURATION_INVALID';
        throw error;
      }
      return { revision: frozen.revision, preconfiguration: frozen.preconfiguration, snapshot: frozen };
    }
    if (id === undefined || id === null || id === '') return null;
    const record = await directorPreconfigurations.resolve(String(id));
    if (!record) {
      const error = new Error('La preconfiguración elegida ya no está disponible.');
      error.code = 'DIRECTOR_PRECONFIGURATION_NOT_FOUND';
      error.suggestedAction = 'Elegí otra preconfiguración o continuá sin usar una.';
      throw error;
    }
    return { ...record, snapshot: createPreconfigurationSnapshot(record) };
  };
  const elevenLabs = options.elevenLabs || {
    inspect: (requestOptions = {}) => inspectElevenLabs({ ...requestOptions, environment: options.environment || process.env }),
    listVoices: (requestOptions = {}) => listElevenLabsVoices({ ...requestOptions, environment: options.environment || process.env }),
    getVoice: (voiceId, requestOptions = {}) => getElevenLabsVoice(voiceId, { ...requestOptions, environment: options.environment || process.env }),
  };
  const measurements = options.measurements || createMeasurementManager({
    root,
    assetsRoot,
    catalogProvider: currentCatalog,
    workRoot: options.workRoot,
    outputRoot: options.outputRoot,
    measureRoot: options.measureRoot,
    ...(options.spawnImpl ? { spawnImpl: options.spawnImpl } : {}),
  });
  const ownsManager = !options.manager;
  // Retención automática al arrancar: solo cuando este servicio administra su propio
  // ciclo de vida de jobs (producción). Si el manager viene inyectado (tests), no se
  // toca el `.local-video` real. La política existente respeta trabajos activos y MP4.
  if (ownsManager && options.retentionOnStartup !== false) {
    runStartupRetention({ localRoot });
  }
  const director = options.director || createDirectorProposal;
  const questionDirector = options.questionDirector || createClarifyingQuestions;
  const projectDirector = options.projectDirector || editProjectWithDirector;
  const ollamaInspector = options.ollamaInspector || ((providerOptions = {}) => inspectDirectorProvider({
    ...providerOptions,
    provider: 'ollama',
  }));
  const providerInspector = options.providerInspector || ((providerOptions = {}) => {
    if (!providerOptions.provider || providerOptions.provider === 'ollama') return ollamaInspector(providerOptions);
    return inspectDirectorProvider(providerOptions);
  });
  const inspectionCache = new Map();
  const inspectionCacheTtlMs = boundedInspectionTtl(options.inspectionCacheTtlMs ?? 60_000);
  const inspectProviderCached = async (providerOptions = {}) => {
    const key = `${providerOptions.provider || 'ollama'}:${providerOptions.model || ''}`;
    const cached = inspectionCache.get(key);
    if (cached && Date.now() - cached.createdAt < inspectionCacheTtlMs) return cached.value;
    const value = await providerInspector(providerOptions);
    inspectionCache.set(key, { createdAt: Date.now(), value });
    return value;
  };
  let directorController = null;
  let directorStatus = createDirectorStatus('idle', 'idle');
  const updateDirectorStatus = (state, stage, detail = {}) => {
    directorStatus = createDirectorStatus(state, stage, detail);
  };
  let timelineRuntimePromise = null;
  const timelineRuntime = () => {
    timelineRuntimePromise ??= (async () => {
      const timelineRoot = path.resolve(options.timelineStorageRoot || path.join(root, '.local-video', 'timeline-v2'));
      const media = options.timelineMediaLibrary || await createTimelineMediaLibrary({
        storageRoot: path.join(timelineRoot, 'media'),
        ...(options.timelineProbe ? { probe: options.timelineProbe } : {}),
      });
      const timelineProjects = options.timelineProjects || await createTimelineProjectRepository({
        storageRoot: path.join(timelineRoot, 'projects'),
      });
      const exporter = options.timelineExporter || await createTimelineExporter({
        mediaLibrary: media,
        storageRoot: path.join(timelineRoot, 'exports'),
      });
      return { media, projects: timelineProjects, exporter };
    })();
    return timelineRuntimePromise;
  };

  const server = http.createServer(async (request, response) => {
    try {
      if (!isAllowedHost(request.headers.host, server.address(), host, port)) {
        sendJson(response, 403, { version: 1, error: { code: 'HOST_FORBIDDEN', message: 'Host local no permitido.' } });
        return;
      }
      if (isMutation(request.method) && !isAllowedOrigin(request.headers.origin)) {
        sendJson(response, 403, { version: 1, error: { code: 'ORIGIN_FORBIDDEN', message: 'Origen no permitido.' } });
        return;
      }
      if (isMutation(request.method) && !validToken(request.headers['x-local-video-token'], sessionToken)) {
        sendJson(response, 403, { version: 1, error: { code: 'SESSION_TOKEN_INVALID', message: 'La sesión local no es válida.' } });
        return;
      }
      const url = new URL(request.url || '/', `http://${host}:${port}`);
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const provider = String(url.searchParams.get('provider') || 'ollama');
        const model = url.searchParams.get('model') || undefined;
        let directorHealth;
        try {
          directorHealth = await inspectProviderCached({ provider, model });
        } catch (error) {
          directorHealth = { available: false, modelInstalled: false, model, error: serializeError(error, 'directing') };
        }
        const ttsRoot = resolveTtsRoot({}, { validate: false });
        const elevenLabsConfigured = Boolean(
          (options.environment || process.env).ELEVENLABS_API_KEY
          || (options.environment || process.env).ELEVENLABS_API_KEY_FILE,
        );
        sendJson(response, 200, {
          version: 1,
          ready: directorHealth.available && directorHealth.modelInstalled && existsSync(ttsRoot) && elevenLabsConfigured,
          director: { provider, ...directorHealth },
          // Compatibilidad con clientes anteriores. El diagnóstico canónico es
          // `director`, que representa al proveedor elegido por el usuario.
          ollama: provider === 'ollama'
            ? directorHealth
            : { available: false, modelInstalled: false, skipped: true },
          providers: { [provider]: directorHealth },
          registeredProviders: listProviderNames(),
          tts: {
            available: existsSync(ttsRoot) && elevenLabsConfigured,
            providers: {
              elevenlabs: { configured: elevenLabsConfigured, available: existsSync(ttsRoot) && elevenLabsConfigured },
            },
          },
          renderBusy: Boolean(manager.activeJobId),
          persistence: persistenceRuntime.diagnostic,
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/director/status') {
        sendJson(response, 200, directorStatus);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/library/resources') {
        sendJson(response, 200, {
          version: 1,
          catalogPath: library.catalogRelative,
          resources: await library.list(),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/library/catalog') {
        sendJson(response, 200, {
          version: 1,
          catalogPath: library.catalogRelative,
          catalog: currentCatalog(),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/library/character-designs') {
        sendJson(response, 200, {
          version: 1,
          designs: await library.characterDesigns(),
        });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/projects') {
        sendJson(response, 200, { version: 1, projects: await projects.list() });
        return;
      }
      const projectMatch = /^\/api\/projects\/([a-zA-Z0-9_-]{2,64})$/u.exec(url.pathname);
      if (request.method === 'GET' && projectMatch) {
        const stored = await projects.get(projectMatch[1]);
        sendJson(response, 200, { version: 1, project: stored.project, revision: stored.revision });
        return;
      }
      if (request.method === 'PUT' && projectMatch) {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        if (body.project?.id !== projectMatch[1]) {
          const error = new Error('El ID de la ruta no coincide con el proyecto.');
          error.code = 'PROJECT_ID_INVALID';
          throw error;
        }
        const result = await projects.save(body.project, body.expectedRevision);
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'DELETE' && projectMatch) {
        const removed = await projects.remove(projectMatch[1], url.searchParams.get('expectedRevision') || undefined);
        if (!removed) return sendNotFound(response);
        sendJson(response, 200, { version: 1, removed: true });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/library/voices/elevenlabs') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const voice = await elevenLabs.getVoice(String(body.voiceId || ''));
        if (!voice) {
          const error = new Error('La voz seleccionada ya no está disponible en ElevenLabs.');
          error.code = 'ELEVENLABS_VOICE_INVALID';
          throw error;
        }
        const model = ['eleven_multilingual_v2', 'eleven_v3', 'eleven_flash_v2_5'].includes(body.model)
          ? body.model
          : DEFAULT_ELEVENLABS_MODEL;
        const locale = /^[a-z]{2}_[A-Z]{2}$/u.test(String(body.locale || '')) ? body.locale : 'es_MX';
        const suffix = createHash('sha256').update(voice.voiceId).digest('hex').slice(0, 12);
        const tags = ['elevenlabs', 'premium', 'espanol', ...Object.values(voice.labels || {})]
          .map((value) => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, ''))
          .filter(Boolean)
          .slice(0, 16);
        const result = await library.register({
          id: `voz-elevenlabs-${suffix}`,
          type: 'voice',
          label: `${voice.name} · ElevenLabs`,
          tags: [...new Set(tags)],
          voice: { provider: 'elevenlabs', model, locale, voiceId: voice.voiceId, lengthScale: 1, volume: 1 },
          provenance: {
            source: `Voz ${voice.name} disponible en la cuenta local de ElevenLabs.`,
            license: 'Uso sujeto al plan y a los términos vigentes de ElevenLabs; verificar derechos de la voz antes de publicar.',
          },
        });
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/director/preconfigurations') {
        sendJson(response, 200, { version: 1, preconfigurations: await directorPreconfigurations.list() });
        return;
      }
      const preconfigurationMatch = /^\/api\/director\/preconfigurations\/([a-zA-Z0-9][a-zA-Z0-9_-]{1,63})$/u.exec(url.pathname);
      if (request.method === 'GET' && preconfigurationMatch) {
        const record = await directorPreconfigurations.get(preconfigurationMatch[1]);
        if (!record) return sendNotFound(response);
        sendJson(response, 200, { version: 1, ...record });
        return;
      }
      if (request.method === 'POST' && preconfigurationMatch && !url.searchParams.get('action')) {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        if (body?.preconfiguration?.id !== preconfigurationMatch[1]) {
          const error = new Error('El identificador de la ruta no coincide con la preconfiguración.');
          error.code = 'DIRECTOR_PRECONFIGURATION_INVALID';
          throw error;
        }
        const saved = await directorPreconfigurations.create(body.preconfiguration);
        sendJson(response, 201, { version: 1, ...saved });
        return;
      }
      if (request.method === 'PUT' && preconfigurationMatch) {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        if (body?.preconfiguration?.id !== preconfigurationMatch[1]) {
          const error = new Error('El identificador de la ruta no coincide con la preconfiguración.');
          error.code = 'DIRECTOR_PRECONFIGURATION_INVALID';
          throw error;
        }
        const saved = await directorPreconfigurations.update(body.preconfiguration, body.expectedRevision);
        sendJson(response, 200, { version: 1, ...saved });
        return;
      }
      if (request.method === 'POST' && preconfigurationMatch && url.searchParams.get('action') === 'migrate') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const saved = await directorPreconfigurations.migrate(preconfigurationMatch[1], body.expectedRevision);
        sendJson(response, 200, { version: 1, ...saved });
        return;
      }
      if (request.method === 'DELETE' && preconfigurationMatch) {
        const expectedRevisionValue = url.searchParams.get('expectedRevision');
        const expectedRevision = expectedRevisionValue === null ? undefined : Number(expectedRevisionValue);
        const removed = await directorPreconfigurations.remove(preconfigurationMatch[1], expectedRevision);
        if (!removed) return sendNotFound(response);
        sendJson(response, 200, { version: 1, removed: true, id: preconfigurationMatch[1] });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/library/resources') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const result = await library.register(body.entry);
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/library/backgrounds') {
        const mimeType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (!['image/png', 'image/jpeg', 'image/gif', 'video/mp4'].includes(mimeType)) {
          const error = new Error('El fondo debe enviarse como PNG, JPG, GIF o MP4.');
          error.code = 'LIBRARY_BACKGROUND_FORMAT_INVALID';
          throw error;
        }
        const fileName = decodeHeaderValue(request.headers['x-resource-file-name'], 'fondo');
        const bytes = await readBody(request, MAX_BACKGROUND_BODY_BYTES);
        const result = await library.importBackground({ bytes, mimeType, fileName });
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/library/characters') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const result = await library.saveCharacterDesign(body.design);
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/director/questions') {
        assertJsonContentType(request);
        if (directorController) {
          const error = new Error('El Director ya está procesando otra petición.');
          error.code = 'DIRECTOR_BUSY';
          error.suggestedAction = 'Esperá a que termine o cancelá la petición en curso.';
          throw error;
        }
        const body = await readJsonBody(request);
        const preconfiguration = await resolveDirectorPreconfiguration(body.preconfigurationId, body.preconfigurationSnapshot);
        directorController = new AbortController();
        updateDirectorStatus('running', 'checking_model');
        try {
          const modelInspection = await inspectDirectorIdentity(inspectProviderCached, body.provider, body.model);
          const result = await questionDirector({
            prompt: body.prompt,
            constraints: applyPreconfigurationConstraints(body.constraints, preconfiguration?.preconfiguration),
            provider: body.provider,
            model: body.model,
            modelIdentity: modelInspection,
            signal: directorController.signal,
            onProgress: (progress) => updateDirectorStatus('running', progress.stage, progress),
          });
          sendJson(response, 200, {
            version: 1,
            questionContract: result.questionContract,
            cacheHit: result.cacheHit,
            model: result.model,
            questions: result.questions,
            usage: result.usage,
          modelIdentity: result.modelIdentity,
          preconfigurationSnapshot: preconfiguration?.snapshot || null,
          });
        } finally {
          directorController = null;
          updateDirectorStatus('idle', 'idle');
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/director/proposals') {
        assertJsonContentType(request);
        if (directorController) {
          const error = new Error('Ya existe una propuesta en generación.');
          error.code = 'DIRECTOR_BUSY';
          error.suggestedAction = 'Esperá a que termine o cancelá la propuesta en curso.';
          throw error;
        }
        const body = await readJsonBody(request);
        const preconfiguration = await resolveDirectorPreconfiguration(body.preconfigurationId, body.preconfigurationSnapshot);
        directorController = new AbortController();
        updateDirectorStatus('running', 'checking_model');
        let proposal;
        try {
          const modelInspection = await inspectDirectorIdentity(inspectProviderCached, body.provider, body.model);
          proposal = await director({
            prompt: body.prompt,
            variant: body.variant,
            constraints: body.constraints,
            provider: body.provider,
            think: body.think,
            bestOf: body.bestOf,
            personalization: body.personalization,
            preconfiguration: preconfiguration?.preconfiguration,
            preconfigurationSnapshot: preconfiguration?.snapshot || null,
            model: body.model,
            modelIdentity: modelInspection,
            assetsRoot,
            catalog: currentCatalog(),
            resourceCatalog: library.catalogRelative,
            signal: directorController.signal,
            onProgress: (progress) => updateDirectorStatus('running', progress.stage, progress),
          });
        } finally {
          directorController = null;
          updateDirectorStatus('idle', 'idle');
        }
        sendJson(response, 200, {
          version: 1,
          cacheHit: proposal.cacheHit,
          model: proposal.model,
          plan: proposal.plan,
          project: proposal.project,
          budget: proposal.budget,
          selection: proposal.selection,
          context: proposal.context,
          quality: proposal.quality,
          candidateQuality: proposal.candidateQuality,
          repairAttempts: proposal.repairAttempts,
          usage: proposal.usage,
          modelIdentity: proposal.modelIdentity,
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/director/cancel') {
        if (directorController) updateDirectorStatus('cancelling', 'cancelling');
        directorController?.abort();
        sendJson(response, 200, { version: 1, cancelled: Boolean(directorController) });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/director/edits') {
        assertJsonContentType(request);
        if (directorController) {
          const error = new Error('El Director ya está procesando otra petición.');
          error.code = 'DIRECTOR_BUSY';
          error.suggestedAction = 'Esperá a que termine o cancelá la petición en curso.';
          throw error;
        }
        const body = await readJsonBody(request);
        directorController = new AbortController();
        updateDirectorStatus('running', 'checking_model');
        try {
          const modelInspection = await inspectDirectorIdentity(inspectProviderCached, body.provider, body.model);
          const result = await projectDirector({
            instruction: body.instruction,
            project: body.project,
            provider: body.provider,
            model: body.model,
            modelIdentity: modelInspection,
            selection: body.selection,
            catalog: currentCatalog(),
            signal: directorController.signal,
            onProgress: (progress) => updateDirectorStatus('running', progress.stage, progress),
          });
          sendJson(response, 200, result);
        } finally {
          directorController = null;
          updateDirectorStatus('idle', 'idle');
        }
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/projects/validate') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const result = validateVideoProjectDocument({ project: body.project, catalog: currentCatalog(), assetsRoot });
        sendJson(response, 200, {
          version: 1,
          valid: true,
          projectId: result.project.id,
          scenes: result.project.scenes.length,
        });
        return;
      }
      // Medir no es renderizar: devuelve los tiempos reales sin producir un MP4.
      // Es lo que permite seguir editando después de cortar un diálogo sin
      // esperar un render completo.
      if (request.method === 'POST' && url.pathname === '/api/measurements') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const measurement = await measurements.measure(body.project);
        sendJson(response, 200, { version: 1, ...measurement });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/director/cache/clear') {
        const removed = ['director-cache', 'director-question-cache', 'director-edit-cache'].map((name) => cleanDirectorCaches({
          root: path.join(localRoot, name), apply: true, maximumAgeDays: 0, maximumBytes: 0, maximumEntries: 0,
        }));
        sendJson(response, 200, { version: 1, removed: removed.reduce((total, result) => total + result.removed.length, 0) });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/tts/elevenlabs') {
        const [diagnostic, voices] = await Promise.all([elevenLabs.inspect(), elevenLabs.listVoices()]);
        sendJson(response, 200, { version: 1, diagnostic, voices });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/timeline/media') {
        const timeline = await timelineRuntime();
        sendJson(response, 200, { version: 1, entries: timeline.media.list() });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/timeline/media') {
        const timeline = await timelineRuntime();
        const fileName = decodeHeaderValue(request.headers['x-resource-file-name'], 'medio');
        const result = await timeline.media.importStream(request, {
          fileName,
          mimeType: request.headers['content-type'],
        });
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/timeline/media/from-render') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const video = await manager.video(String(body.jobId || ''));
        if (!video) return sendNotFound(response);
        const timeline = await timelineRuntime();
        const result = video.blobStorage
          ? await timeline.media.importStream((await video.blobStorage.openRead(video.key)).stream, { fileName: video.name, mimeType: video.mimeType })
          : await timeline.media.importFile(video.file, { fileName: video.name, mimeType: video.mimeType });
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/timeline/media/from-measurement') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const audio = measurements.audio?.(String(body.measurementId || ''));
        if (!audio) return sendNotFound(response);
        const timeline = await timelineRuntime();
        const result = await timeline.media.importFile(audio.file, { fileName: audio.name, mimeType: audio.mimeType });
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      const timelineMediaMatch = /^\/api\/timeline\/media\/(media-[a-f0-9]{16})\/content$/u.exec(url.pathname);
      if (request.method === 'GET' && timelineMediaMatch) {
        const timeline = await timelineRuntime();
        const media = (timeline.media.openPreview || timeline.media.open)(timelineMediaMatch[1]);
        if (!media) return sendNotFound(response);
        await streamVideoResponse(request, response, media);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/timeline/projects') {
        const timeline = await timelineRuntime();
        sendJson(response, 200, { version: 1, projects: timeline.projects.list() });
        return;
      }
      const timelineProjectMatch = /^\/api\/timeline\/projects\/([a-zA-Z0-9_-]{2,64})$/u.exec(url.pathname);
      if (request.method === 'GET' && timelineProjectMatch) {
        const timeline = await timelineRuntime();
        sendJson(response, 200, { version: 1, ...timeline.projects.get(timelineProjectMatch[1]) });
        return;
      }
      if (request.method === 'PUT' && timelineProjectMatch) {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        if (body.project?.id !== timelineProjectMatch[1]) throw Object.assign(new Error('El ID de ruta no coincide con el montaje.'), { code: 'TIMELINE_PROJECT_ID_INVALID' });
        const timeline = await timelineRuntime();
        const result = timeline.projects.save(body.project, body.expectedRevision);
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/timeline/exports') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const timeline = await timelineRuntime();
        const result = timeline.exporter.exportProject(body.project);
        sendJson(response, 200, result);
        return;
      }
      const timelineExportMatch = /^\/api\/timeline\/exports\/([a-f0-9]{64})\/video$/u.exec(url.pathname);
      if (request.method === 'GET' && timelineExportMatch) {
        const timeline = await timelineRuntime();
        const video = timeline.exporter.open(timelineExportMatch[1]);
        if (!video) return sendNotFound(response);
        await streamVideoResponse(request, response, video);
        return;
      }
      const measurementAudioMatch = /^\/api\/measurement-audio\/(measure-[a-zA-Z0-9_-]{1,56})$/u.exec(url.pathname);
      if (request.method === 'GET' && measurementAudioMatch) {
        const audio = measurements.audio?.(measurementAudioMatch[1]);
        if (!audio) {
          sendJson(response, 404, { version: 1, message: 'El audio de preview no está disponible.' });
          return;
        }
        await streamVideoResponse(request, response, audio);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/render-jobs') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const job = await manager.create(body.project, body.timeline);
        sendJson(response, 202, job);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/render-jobs') {
        sendJson(response, 200, { version: 1, jobs: await manager.list() });
        return;
      }
      const jobMatch = /^\/api\/render-jobs\/([a-zA-Z0-9_-]{2,64})$/u.exec(url.pathname);
      if (request.method === 'GET' && jobMatch) {
        const job = await manager.get(jobMatch[1]);
        if (!job) return sendNotFound(response);
        sendJson(response, 200, job);
        return;
      }
      if (request.method === 'POST' && jobMatch && url.searchParams.get('action') === 'cancel') {
        const job = await manager.cancel(jobMatch[1]);
        if (!job) return sendNotFound(response);
        sendJson(response, 200, job);
        return;
      }
      const videoMatch = /^\/api\/render-jobs\/([a-zA-Z0-9_-]{2,64})\/video$/u.exec(url.pathname);
      if (request.method === 'GET' && videoMatch) {
        const video = await manager.video(videoMatch[1]);
        if (!video) return sendNotFound(response);
        await streamVideoResponse(request, response, video);
        return;
      }
      sendNotFound(response);
    } catch (error) {
      const serialized = serializeError(error, 'local_app');
      const status = [
        'RENDER_BUSY',
        'DIRECTOR_BUSY',
        'LIBRARY_RESOURCE_ID_CONFLICT',
        'PROJECT_REVISION_CONFLICT',
        'RENDER_JOB_CONFLICT',
        'RENDER_JOB_STATE_CONFLICT',
        'TIMELINE_PROJECT_REVISION_CONFLICT',
        'DIRECTOR_PRECONFIGURATION_REVISION_CONFLICT',
        'DIRECTOR_PRECONFIGURATION_ALREADY_EXISTS',
      ].includes(error?.code) ? 409
        : ['PROJECT_NOT_FOUND', 'TIMELINE_PROJECT_NOT_FOUND', 'DIRECTOR_PRECONFIGURATION_NOT_FOUND'].includes(error?.code) ? 404
          : String(error?.code || '').includes('INVALID') || [
            'DIRECTOR_PROVIDER_UNKNOWN',
            'TIMELINE_EXPORT_EMPTY',
            'TIMELINE_EXPORT_SOURCE_MISSING',
            'TIMELINE_EXPORT_VIDEO_MISSING',
            'TIMELINE_EXPORT_AUDIO_MISSING',
          ].includes(error?.code) ? 400
            : ['REQUEST_BODY_TOO_LARGE', 'TIMELINE_MEDIA_TOO_LARGE'].includes(error?.code) ? 413
              : 500;
      sendJson(response, status, { version: 1, error: serialized });
    }
  });

  return {
    server,
    manager,
    library,
    projects,
    persistence,
    sessionToken,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          const listeningPort = typeof address === 'object' && address ? address.port : port;
          resolve({ host, port: listeningPort, url: `http://${host}:${listeningPort}` });
        });
      });
    },
    async close() {
      await manager.cancelActive?.();
      server.closeAllConnections?.();
      try {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      } finally {
        if (ownsPersistenceRuntime) await persistenceRuntime.close();
      }
    },
  };
}

async function inspectDirectorIdentity(inspector, provider, model) {
  try {
    const result = await inspector({ provider, model });
    return {
      digest: typeof result?.digest === 'string' ? result.digest : null,
      runtimeVersion: typeof result?.version === 'string' ? result.version : null,
    };
  } catch {
    return null;
  }
}

function boundedInspectionTtl(value) {
  const resolved = Number(value);
  if (!Number.isInteger(resolved) || resolved < 0 || resolved > 10 * 60_000) return 60_000;
  return resolved;
}

async function readJsonBody(request) {
  const body = (await readBody(request, MAX_BODY_BYTES)).toString('utf8');
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('El cuerpo de la solicitud no contiene JSON válido.');
    error.code = 'REQUEST_JSON_INVALID';
    throw error;
  }
}

async function readBody(request, maximumBytes) {
  const chunks = [];
  let receivedBytes = 0;
  request.setTimeout(BODY_TIMEOUT_MS);
  try {
    for await (const value of request) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      receivedBytes += chunk.length;
      if (receivedBytes > maximumBytes) {
        request.resume();
        const error = new Error(`El cuerpo de la solicitud supera ${Math.round(maximumBytes / (1024 * 1024))} MB.`);
        error.code = 'REQUEST_BODY_TOO_LARGE';
        throw error;
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error?.code === 'REQUEST_BODY_TOO_LARGE') throw error;
    const wrapped = new Error('No se pudo leer el cuerpo de la solicitud.');
    wrapped.code = error?.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 'REQUEST_BODY_TIMEOUT' : 'REQUEST_BODY_INVALID';
    throw wrapped;
  } finally {
    request.setTimeout(0);
  }
  return Buffer.concat(chunks, receivedBytes);
}

function decodeHeaderValue(value, fallback) {
  if (typeof value !== 'string' || value.length > 600) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return fallback;
  }
}

function assertJsonContentType(request) {
  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
      const error = new Error('El cuerpo de la solicitud supera 1 MB.');
      error.message = 'La operación requiere Content-Type application/json.';
      error.code = 'CONTENT_TYPE_INVALID';
      throw error;
  }
}

function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.has(origin);
}

function createDirectorStatus(state, stage, detail = {}) {
  return {
    version: 1,
    state,
    stage,
    updatedAt: new Date().toISOString(),
    ...(Number.isInteger(detail.candidateIndex) ? { candidateIndex: detail.candidateIndex } : {}),
    ...(Number.isInteger(detail.candidateCount) ? { candidateCount: detail.candidateCount } : {}),
    ...(Number.isInteger(detail.attempt) ? { attempt: detail.attempt } : {}),
    ...(Number.isInteger(detail.segmentIndex) ? { segmentIndex: detail.segmentIndex } : {}),
    ...(Number.isInteger(detail.segmentCount) ? { segmentCount: detail.segmentCount } : {}),
  };
}

function isAllowedHost(header, address, configuredHost, configuredPort) {
  if (typeof header !== 'string') return false;
  const actualPort = typeof address === 'object' && address ? address.port : configuredPort;
  return new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`]).has(header.toLowerCase())
    && ['127.0.0.1', 'localhost', '::1'].includes(configuredHost);
}

function isMutation(method) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

function validToken(value, expected) {
  if (typeof value !== 'string') return false;
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendNotFound(response) {
  sendJson(response, 404, { version: 1, error: { code: 'NOT_FOUND', message: 'Recurso no encontrado.' } });
}

if (isMain(import.meta.url)) {
  const app = await createLocalAppServer();
  app.listen().then(({ url }) => {
    process.stdout.write(`${JSON.stringify({ version: 1, state: 'ready', url })}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', error: serializeError(error, 'local_app') })}\n`);
    process.exitCode = 1;
  });
}
