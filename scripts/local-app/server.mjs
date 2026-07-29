import { existsSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { createDirectorProposal, inspectOllama } from '../director/ollama-director.mjs';
import { editProjectWithDirector } from '../director/project-editor-director.mjs';
import { loadAuthoringCatalog } from '../director/director-plan.mjs';
import { listProviderNames } from '../director/providers/index.mjs';
import { isMain, projectRoot, resolveTtsRoot } from '../stage1/common.mjs';
import { serializeError } from '../stage1/errors.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { createRenderJobManager, streamVideoResponse } from './render-job-manager.mjs';
import {
  createResourceLibrary,
  createResourceLibraryRepository,
} from './resource-library.mjs';
import { createProjectRepository } from './project-repository.mjs';
import { runStartupRetention } from './retention.mjs';
import { createFileRenderJobRepository } from '../storage/file-render-job-repository.mjs';
import { createPersistenceRuntime } from '../storage/persistence-runtime.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_BACKGROUND_BODY_BYTES = 12 * 1024 * 1024;
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
  const ownsManager = !options.manager;
  // Retención automática al arrancar: solo cuando este servicio administra su propio
  // ciclo de vida de jobs (producción). Si el manager viene inyectado (tests), no se
  // toca el `.local-video` real. La política existente respeta trabajos activos y MP4.
  if (ownsManager && options.retentionOnStartup !== false) {
    runStartupRetention({ localRoot: options.localRoot || path.join(root, '.local-video') });
  }
  const director = options.director || createDirectorProposal;
  const projectDirector = options.projectDirector || editProjectWithDirector;
  const ollamaInspector = options.ollamaInspector || inspectOllama;
  let directorController = null;
  let directorStatus = createDirectorStatus('idle', 'idle');
  const updateDirectorStatus = (state, stage, detail = {}) => {
    directorStatus = createDirectorStatus(state, stage, detail);
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
        let ollama;
        try {
          ollama = await ollamaInspector();
        } catch (error) {
          ollama = { available: false, modelInstalled: false, error: serializeError(error, 'directing') };
        }
        const ttsRoot = resolveTtsRoot({}, { validate: false });
        sendJson(response, 200, {
          version: 1,
          ready: ollama.available && ollama.modelInstalled && existsSync(ttsRoot),
          ollama,
          // Estado por proveedor registrado (D2). Hoy solo `ollama` está registrado;
          // su salud sale del inspector inyectable. `registeredProviders` anuncia qué
          // proveedores acepta el servidor en `provider`.
          providers: { ollama },
          registeredProviders: listProviderNames(),
          tts: { available: existsSync(ttsRoot) },
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
      if (request.method === 'POST' && url.pathname === '/api/library/resources') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const result = await library.register(body.entry);
        sendJson(response, result.created ? 201 : 200, { version: 1, ...result });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/library/backgrounds') {
        const mimeType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (!['image/png', 'image/jpeg'].includes(mimeType)) {
          const error = new Error('El fondo debe enviarse como PNG o JPG.');
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
      if (request.method === 'POST' && url.pathname === '/api/director/proposals') {
        assertJsonContentType(request);
        if (directorController) {
          const error = new Error('Ya existe una propuesta en generación.');
          error.code = 'DIRECTOR_BUSY';
          error.suggestedAction = 'Esperá a que termine o cancelá la propuesta en curso.';
          throw error;
        }
        const body = await readJsonBody(request);
        directorController = new AbortController();
        updateDirectorStatus('running', 'checking_model');
        let proposal;
        try {
          const modelInspection = await inspectDirectorIdentity(ollamaInspector, body.model);
          proposal = await director({
            prompt: body.prompt,
            variant: body.variant,
            constraints: body.constraints,
            provider: body.provider,
            think: body.think,
            bestOf: body.bestOf,
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
          const modelInspection = await inspectDirectorIdentity(ollamaInspector, body.model);
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
      if (request.method === 'POST' && url.pathname === '/api/render-jobs') {
        assertJsonContentType(request);
        const body = await readJsonBody(request);
        const job = await manager.create(body.project);
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
      ].includes(error?.code) ? 409
        : String(error?.code || '').includes('INVALID') || error?.code === 'DIRECTOR_PROVIDER_UNKNOWN' ? 400
          : error?.code === 'REQUEST_BODY_TOO_LARGE' ? 413
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

async function inspectDirectorIdentity(inspector, model) {
  try {
    const result = await inspector({ model });
    return {
      digest: typeof result?.digest === 'string' ? result.digest : null,
      runtimeVersion: typeof result?.version === 'string' ? result.version : null,
    };
  } catch {
    return null;
  }
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
