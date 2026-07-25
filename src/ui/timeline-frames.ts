// Capa DOM de las miniaturas de frames de la timeline (A2). Extrae frames del MP4
// vigente con un <video> oculto (seek + drawImage), de a uno (una sola búsqueda a la
// vez), y los cachea por url+tiempo. El dibujo se hace desde la caché en cada render;
// nunca se re-extrae al hacer scroll/zoom. Trabajo async fuera del render de la UI.

const FRAME_HEIGHT = 56; // alto de la miniatura cacheada; el ancho sale del aspecto real

const cache = new Map<string, HTMLCanvasElement>();
const queued = new Set<string>();
const queue: Array<{ url: string; time: number }> = [];
let processing = false;
let video: HTMLVideoElement | null = null;
let videoUrl: string | null = null;
let notifyReady: (() => void) | null = null;
let notifyScheduled = false;

function key(url: string, time: number): string {
  return `${url}|${time.toFixed(2)}`;
}

// Agrupa los avisos de "hay un frame nuevo" en un solo redibujado por frame de animación,
// para que extraer muchas miniaturas no dispare decenas de renders seguidos.
function scheduleNotify(): void {
  if (notifyScheduled) return;
  notifyScheduled = true;
  requestAnimationFrame(() => {
    notifyScheduled = false;
    notifyReady?.();
  });
}

// Devuelve la miniatura cacheada para (url, time) o null mientras se extrae. La primera
// llamada encola la extracción; al terminar cada frame se agenda un redibujado.
export function requestFrame(url: string, time: number, onReady: () => void): HTMLCanvasElement | null {
  notifyReady = onReady;
  const cached = cache.get(key(url, time));
  if (cached) return cached;
  const pendingKey = key(url, time);
  if (!queued.has(pendingKey)) {
    queued.add(pendingKey);
    queue.push({ url, time });
    void processQueue();
  }
  return null;
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      try {
        const canvas = await extractFrame(next.url, next.time);
        if (canvas) cache.set(key(next.url, next.time), canvas);
      } catch {
        // Frame no extraíble: se omite; no se reintenta (queda fuera de la cola).
      } finally {
        queued.delete(key(next.url, next.time));
        scheduleNotify();
      }
    }
  } finally {
    processing = false;
  }
}

async function ensureVideo(url: string): Promise<HTMLVideoElement> {
  if (video && videoUrl === url) return video;
  if (!video) {
    video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.style.position = 'fixed';
    video.style.left = '-99999px';
    video.style.width = '1px';
    video.style.height = '1px';
    document.body.append(video);
  }
  video.src = url;
  videoUrl = url;
  await once(video, 'loadeddata');
  return video;
}

async function extractFrame(url: string, time: number): Promise<HTMLCanvasElement | null> {
  const element = await ensureVideo(url);
  element.currentTime = Math.max(0, time);
  await once(element, 'seeked');
  const width = element.videoWidth;
  const height = element.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.height = FRAME_HEIGHT;
  canvas.width = Math.max(1, Math.round((width / height) * FRAME_HEIGHT));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(element, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function once(target: HTMLVideoElement, event: 'loadeddata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error(`fallo al esperar ${event}`)); };
    const cleanup = () => {
      target.removeEventListener(event, settle);
      target.removeEventListener('error', fail);
    };
    target.addEventListener(event, settle, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}
