import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createDirectorProposal, inspectOllama } from '../director/ollama-director.mjs';
import { loadAuthoringCatalog } from '../director/director-plan.mjs';
import { isMain, projectRoot, resolveTtsRoot } from '../stage1/common.mjs';
import { serializeError } from '../stage1/errors.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { createRenderJobManager, streamVideoResponse } from './render-job-manager.mjs';

const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4174',
  'http://localhost:4174',
]);

export function createLocalAppServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port ?? 4174);
  const assetsRoot = path.resolve(options.assetsRoot || path.join(projectRoot, 'public'));
  const catalog = options.catalog || loadAuthoringCatalog(assetsRoot);
  const manager = options.manager || createRenderJobManager({ ...options, assetsRoot, catalog });
  const director = options.director || createDirectorProposal;
  const ollamaInspector = options.ollamaInspector || inspectOllama;

  const server = http.createServer(async (request, response) => {
    try {
      if (!isAllowedOrigin(request.headers.origin)) {
        sendJson(response, 403, { version: 1, error: { code: 'ORIGIN_FORBIDDEN', message: 'Origen no permitido.' } });
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
          tts: { available: existsSync(ttsRoot) },
          renderBusy: Boolean(manager.activeJobId),
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/director/proposals') {
        const body = await readJsonBody(request);
        const proposal = await director({
          prompt: body.prompt,
          variant: body.variant,
          assetsRoot,
        });
        sendJson(response, 200, {
          version: 1,
          cacheHit: proposal.cacheHit,
          model: proposal.model,
          plan: proposal.plan,
          project: proposal.project,
          budget: proposal.budget,
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/projects/validate') {
        const body = await readJsonBody(request);
        const result = validateVideoProjectDocument({ project: body.project, catalog, assetsRoot });
        sendJson(response, 200, {
          version: 1,
          valid: true,
          projectId: result.project.id,
          scenes: result.project.scenes.length,
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/render-jobs') {
        const body = await readJsonBody(request);
        const job = manager.create(body.project);
        sendJson(response, 202, job);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/render-jobs') {
        sendJson(response, 200, { version: 1, jobs: manager.list() });
        return;
      }
      const jobMatch = /^\/api\/render-jobs\/([a-zA-Z0-9_-]{2,64})$/u.exec(url.pathname);
      if (request.method === 'GET' && jobMatch) {
        const job = manager.get(jobMatch[1]);
        if (!job) return sendNotFound(response);
        sendJson(response, 200, job);
        return;
      }
      if (request.method === 'POST' && jobMatch && url.searchParams.get('action') === 'cancel') {
        const job = manager.cancel(jobMatch[1]);
        if (!job) return sendNotFound(response);
        sendJson(response, 200, job);
        return;
      }
      const videoMatch = /^\/api\/render-jobs\/([a-zA-Z0-9_-]{2,64})\/video$/u.exec(url.pathname);
      if (request.method === 'GET' && videoMatch) {
        const video = manager.video(videoMatch[1]);
        if (!video) return sendNotFound(response);
        streamVideoResponse(request, response, video);
        return;
      }
      sendNotFound(response);
    } catch (error) {
      const serialized = serializeError(error, 'local_app');
      const status = error?.code === 'RENDER_BUSY' ? 409
        : String(error?.code || '').includes('INVALID') ? 400
          : error?.code === 'REQUEST_BODY_TOO_LARGE' ? 413
            : 500;
      sendJson(response, status, { version: 1, error: serialized });
    }
  });

  return {
    server,
    manager,
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
    close() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      const error = new Error('El cuerpo de la solicitud supera 1 MB.');
      error.code = 'REQUEST_BODY_TOO_LARGE';
      throw error;
    }
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    const error = new Error('El cuerpo de la solicitud no contiene JSON válido.');
    error.code = 'REQUEST_JSON_INVALID';
    throw error;
  }
}

function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
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
  const app = createLocalAppServer();
  app.listen().then(({ url }) => {
    process.stdout.write(`${JSON.stringify({ version: 1, state: 'ready', url })}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', error: serializeError(error, 'local_app') })}\n`);
    process.exitCode = 1;
  });
}
