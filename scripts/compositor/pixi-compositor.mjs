// Fase 3 — compositor headless con PixiJS.
//
// ESTADO: funciona y está probado (`npm run compositor:test-headless`), pero
// TODAVÍA NO ES EL PREDETERMINADO: el plan pide un checkpoint humano sobre
// calidad, velocidad y RAM antes de cambiarlo. `npm run compositor:benchmark` da
// esos números.
//
// EL CUELGUE QUE COSTÓ ENCONTRAR, para no repetirlo: la página cargaba, importaba
// PixiJS y se quedaba muerta apenas tocaba el canvas, sin error y sin traza. La
// causa era el flag `--default-background-color=00000000` del navegador, no el
// servidor ni el `fetch` ni PixiJS; aislando flag por flag con una página mínima
// se ve que con ese flag Chrome 151 deja de responder al primer uso del canvas.
// Tampoco hacía falta: los frames salen de leer el canvas de Pixi, que ya tiene
// su propio alfa, y nunca se captura la ventana del navegador.
//
// Por qué así y no de otra forma:
//
//   - Corre el MISMO PixiJS que la vista previa del navegador. La paridad entre
//     preview y MP4 deja de ser algo que hay que mantener a mano: es la misma
//     implementación de dibujo.
//   - No agrega dependencias nativas. Nada de puppeteer ni de node-gyp, así que el
//     worker portable sigue siendo portable.
//   - UNA sola instancia de Chrome para todos los frames. Lanzar el navegador por
//     frame, como hace el rasterizador de assets, costaría minutos por render.
//
// La página maneja el trabajo completo y devuelve cada PNG por POST a este
// servidor local. La primera versión manejaba Chrome por CDP y las sesiones se
// caían entre comandos; además leer el canvas de Pixi da exactamente los píxeles
// dibujados, mientras que una captura de pantalla depende del compositor del
// navegador.
//
// FFmpeg sigue siendo el encoder, el mixer y el muxer: acá solo salen PNG.
//
// Determinismo: Chrome sin GPU dibuja con SwiftShader, que es determinista en una
// misma máquina y versión de navegador. Entre máquinas distintas no está
// garantizado, y por eso la comparación contra frames dorados usa SSIM con
// tolerancia y no igualdad de bytes.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDirectory, projectRoot } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { resolveBrowserExecutable } from '../stage2f/rasterizer.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(moduleDirectory, 'compositor-page.html');
const pixiPath = path.join(projectRoot, 'node_modules', 'pixi.js', 'dist', 'pixi.min.mjs');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

function compositorError(code, message, detail, action = 'Revise que Chrome o Edge esté disponible y soporte WebGL por software.') {
  return new PipelineError({ code, stage: 'rendering_frames', message, technicalDetail: detail, suggestedAction: action });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/**
 * Servidor local del trabajo.
 *
 * Hace falta un origen HTTP porque Chrome bloquea los módulos ES cargados desde
 * `file://`: sin servidor, PixiJS no se puede importar. Y de paso es el canal por
 * el que la página devuelve los frames.
 */
function startJobServer({ assetsRoot, job, framesDirectory, onFrame }) {
  const written = [];
  const pageLog = [];
  let settle = null;
  const finished = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);

    if (request.method === 'POST' && name.startsWith('/frame/')) {
      const index = Number.parseInt(name.slice('/frame/'.length), 10);
      readBody(request).then((body) => {
        const file = path.join(framesDirectory, `frame_${String(index).padStart(4, '0')}.png`);
        writeFileSync(file, body);
        written.push(file);
        if (onFrame) onFrame({ index, total: job.frames.length, file });
        response.writeHead(204).end();
      }).catch((error) => {
        response.writeHead(500).end('error');
        settle.reject(compositorError('COMPOSITOR_FRAME_WRITE_FAILED', 'No se pudo guardar un frame compuesto.', String(error)));
      });
      return;
    }

    if (request.method === 'POST' && name === '/done') {
      readBody(request).then((body) => {
        response.writeHead(204).end();
        let info = {};
        try {
          info = JSON.parse(body.toString('utf8'));
        } catch {
          // Sin metadatos no se cae el render; los frames ya están escritos.
        }
        settle.resolve({ info, written });
      });
      return;
    }

    // Canal de diagnóstico: la página cuenta en qué punto está. Sin esto, un
    // fallo al importar el módulo deja al render esperando sin ninguna pista.
    if (request.method === 'POST' && name === '/log') {
      readBody(request).then((body) => {
        pageLog.push(body.toString('utf8').slice(0, 300));
        response.writeHead(204).end();
      });
      return;
    }

    if (request.method === 'POST' && name === '/error') {
      readBody(request).then((body) => {
        response.writeHead(204).end();
        settle.reject(compositorError(
          'COMPOSITOR_PAGE_FAILED',
          'El compositor falló dentro del navegador.',
          body.toString('utf8').slice(0, 1200),
          'Revise el soporte WebGL del navegador y que las capas del recurso existan.',
        ));
      });
      return;
    }

    if (name === '/job.json') {
      response.writeHead(200, { 'content-type': MIME['.json'] });
      response.end(JSON.stringify(job));
      return;
    }

    let file;
    if (name === '/' || name === '/compositor.html') file = pagePath;
    else if (name === '/pixi.min.mjs') file = pixiPath;
    else {
      const candidate = path.join(assetsRoot, name.replace(/^\/+/u, ''));
      const relative = path.relative(assetsRoot, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        response.writeHead(403).end('fuera de la raíz');
        return;
      }
      file = candidate;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('no existe');
      return;
    }
    response.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, finished, pageLog });
    });
  });
}

/**
 * Compone una secuencia de frames y devuelve las rutas de los PNG.
 *
 * `frames` son frames del contrato (`shared/compositor-contract.js`), con `src`
 * relativos a `assetsRoot`. `framesDirectory` recibe `frame_0000.png` en adelante,
 * el mismo patrón que ya consume FFmpeg para encodear.
 */
export async function composeFramesWithPixi({ video, frames, assetsRoot, framesDirectory, onProgress, timeoutMs }) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw compositorError('COMPOSITOR_REQUEST_INVALID', 'El compositor necesita al menos un frame.', 'frames vacío', 'Verifique el plan temporal.');
  }
  const browserExecutable = resolveBrowserExecutable();
  // El compositor es el que escribe los PNG, así que se hace cargo de su carpeta:
  // un directorio que no existe no es un fallo del render.
  ensureDirectory(framesDirectory);
  const browserProfile = mkdtempSync(path.join(tmpdir(), 'local-video-compositor-'));
  const job = {
    video,
    frames: frames.map((frame) => ({
      ...frame,
      sprites: frame.sprites.map((sprite) => ({ ...sprite, src: `/${sprite.src.replace(/^\/+/u, '')}` })),
    })),
  };
  const { server, port, finished, pageLog } = await startJobServer({ assetsRoot, job, framesDirectory, onFrame: onProgress });
  const budget = timeoutMs ?? Math.max(60000, frames.length * 4000);
  const started = Date.now();
  let browser = null;
  let budgetTimer = null;

  try {
    browser = spawn(browserExecutable, [
      '--headless=new',
      // El puerto de depuración es lo único que mantiene vivo al navegador:
      // `--headless=new` con una URL y sin trabajo que hacer termina al instante,
      // con código 0 y sin decir nada. No se le habla por CDP; la página maneja
      // el trabajo y devuelve los frames por POST.
      `--remote-debugging-port=${9222 + (process.pid % 500)}`,
      `--user-data-dir=${browserProfile}`,
      `--window-size=${video.width},${video.height}`,
      '--hide-scrollbars', '--force-device-scale-factor=1',
      // NO agregar `--default-background-color`: con Chrome 151 cuelga la página
      // apenas empieza a usar el canvas, y el render se queda esperando sin decir
      // por qué. Tampoco hace falta: los frames salen de leer el canvas de Pixi,
      // que ya tiene su propio alfa por `backgroundAlpha: 0`, y nunca se captura
      // la ventana del navegador.
      // WebGL por software: sin estos flags Chrome headless no da contexto y
      // PixiJS no arranca.
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-sync', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--metrics-recording-only',
      '--disable-features=OptimizationGuideModelDownloading,Translate,MediaRouter,DialMediaRouteProvider',
      `http://127.0.0.1:${port}/compositor.html`,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const browserLog = [];
    browser.stdout.on('data', (chunk) => browserLog.push(String(chunk)));
    browser.stderr.on('data', (chunk) => browserLog.push(String(chunk)));

    const exited = new Promise((resolve, reject) => {
      browser.once('exit', (code) => reject(compositorError(
        'COMPOSITOR_BROWSER_EXITED',
        'El navegador se cerró antes de terminar de componer.',
        `código ${code}. Salida del navegador: ${browserLog.join('').slice(-1200) || 'ninguna'}`,
      )));
      browser.once('error', (error) => reject(compositorError('COMPOSITOR_BROWSER_UNAVAILABLE', 'No se pudo lanzar el navegador.', String(error))));
    });
    // El temporizador se guarda para cancelarlo al terminar. Si queda vivo, el
    // bucle de eventos de Node no se vacía y el proceso sigue corriendo después
    // de haber compuesto bien: con el presupuesto por omisión eso son cuatro
    // segundos por frame, o sea más de quince minutos en una escena real.
    const timedOut = new Promise((resolve, reject) => {
      budgetTimer = setTimeout(() => reject(compositorError(
        'COMPOSITOR_TIMEOUT',
        'El compositor no terminó en el tiempo previsto.',
        `${frames.length} frames en más de ${budget} ms. Bitácora de la página: ${pageLog.join(' | ') || 'ninguna'}`,
        'Reduzca la cantidad de frames o revise el rendimiento del navegador.',
      )), budget);
    });

    const { info, written } = await Promise.race([finished, exited, timedOut]);
    if (written.length !== frames.length) {
      throw compositorError(
        'COMPOSITOR_FRAMES_INCOMPLETE',
        'El compositor devolvió menos frames de los pedidos.',
        `${written.length} de ${frames.length}`,
      );
    }

    return {
      backend: 'pixi-headless',
      renderer: info.renderer ?? 'desconocido',
      frameCount: written.length,
      files: written.sort(),
      framePattern: path.join(framesDirectory, 'frame_%04d.png'),
      seconds: (Date.now() - started) / 1000,
    };
  } finally {
    if (budgetTimer !== null) clearTimeout(budgetTimer);
    server.close();
    // `close()` deja de aceptar conexiones nuevas pero no corta las abiertas, y
    // Chrome deja la suya viva por keep-alive: sin esto el socket mantiene el
    // bucle de eventos y el proceso de Node no termina nunca, aunque el render
    // haya salido bien.
    server.closeAllConnections?.();
    if (browser && browser.exitCode === null) {
      browser.kill();
      // Windows mantiene tomados los archivos del perfil hasta que el proceso
      // termina de verdad; borrarlo antes falla con EPERM.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 4000);
        browser.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    // Un perfil temporal que quedó no justifica hacer fallar un render.
    try {
      rmSync(browserProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // El sistema operativo lo limpiará con el resto del temporal.
    }
  }
}
