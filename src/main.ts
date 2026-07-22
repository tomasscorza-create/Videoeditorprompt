import { Application, Assets, Container, Sprite, type Texture } from 'pixi.js';
import { evaluateScene, type MouthCue } from '../shared/scene-evaluator.js';
import './style.css';

interface SceneConfig {
  video: { width: number; height: number; fps: number };
  assets: Record<string, string>;
  character: Record<string, number>;
  subtitle: { startSeconds: number };
  gestures?: Array<{ pose: 'point'; startSeconds: number; durationSeconds: number }>;
}

interface SceneRuntime {
  audio: { path: string; durationSeconds: number };
  mouthCuesPath: string;
  subtitlePath: string;
  blinks: Array<{ start: number; end: number }>;
  assets?: Record<string, string>;
  characterRig?: { version: number; id: string; manifestPath: string };
}

interface PreviewJob {
  jobId: string;
  state: string;
  updatedAt: string;
  durationSeconds: number;
  previewPath: string;
  videoPath: string | null;
  verificationPassed: number | null;
  deterministic: boolean | null;
}

interface PreviewIndex {
  version: number;
  defaultJobId: string;
  jobs: PreviewJob[];
}

interface PreviewSelection {
  job: PreviewJob;
  baseUrl: string;
  legacy: boolean;
}

declare global {
  interface Window {
    __STAGE1__?: {
      ready: boolean;
      jobId: string;
      renderer: string;
      width: number;
      height: number;
      durationSeconds: number;
      mouthCueCount: number;
      currentMouth: string;
      currentEyes: string;
      currentGesture: string;
    };
  }
}

const ui = {
  status: required<HTMLElement>('#status'),
  jobStatus: required<HTMLElement>('#job-status'),
  jobSelect: required<HTMLSelectElement>('#job-select'),
  jobMeta: required<HTMLElement>('#job-meta'),
  download: required<HTMLAnchorElement>('#download'),
  renderer: required<HTMLElement>('#renderer'),
  time: required<HTMLElement>('#time'),
  audio: required<HTMLElement>('#audio-status'),
  mouth: required<HTMLElement>('#mouth-status'),
  eyes: required<HTMLElement>('#eyes-status'),
  gesture: required<HTMLElement>('#gesture-status'),
  stage: required<HTMLElement>('#stage'),
  canvasShell: required<HTMLElement>('.canvas-shell'),
  canvasLoading: required<HTMLElement>('#canvas-loading'),
  play: required<HTMLButtonElement>('#play'),
  pause: required<HTMLButtonElement>('#pause'),
  restart: required<HTMLButtonElement>('#restart'),
};

// Refleja en los controles qué acciones son válidas según la reproducción.
type PlaybackState = 'loading' | 'idle' | 'playing' | 'paused' | 'ended';
function setPlaybackState(state: PlaybackState): void {
  const loading = state === 'loading';
  const playing = state === 'playing';
  ui.play.disabled = loading || playing;
  ui.pause.disabled = loading || !playing;
  ui.restart.disabled = loading;
}

setPlaybackState('loading');

void start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  ui.status.textContent = `Error: ${message}`;
  ui.jobMeta.textContent = message;
  ui.jobMeta.classList.add('error');
  ui.canvasLoading.textContent = 'No se pudo cargar la escena.';
  ui.canvasLoading.classList.add('error');
  ui.canvasShell.setAttribute('aria-busy', 'false');
  console.error(error);
});

async function start(): Promise<void> {
  const selection = await selectPreview();
  configureJobUi(selection);
  const cacheKey = encodeURIComponent(selection.job.updatedAt);
  const generatedUrl = (relativePath: string): string => `${selection.baseUrl}${relativePath.replace(/^\/+/, '')}?v=${cacheKey}`;
  const assetUrl = (relativePath: string): string => `/${relativePath.replace(/^\/+/, '')}?v=${cacheKey}`;
  const [config, runtime] = await Promise.all([
    fetchJson<SceneConfig>(`${selection.baseUrl}scene.config.json?v=${cacheKey}`),
    fetchJson<SceneRuntime>(`${selection.baseUrl}scene-runtime.json?v=${cacheKey}`),
  ]);
  const mouthData = await fetchJson<{ cues: MouthCue[] }>(generatedUrl(runtime.mouthCuesPath));
  const app = new Application();
  await app.init({
    width: config.video.width,
    height: config.video.height,
    background: '#13213b',
    antialias: true,
    resolution: 1,
    preference: 'webgl',
  });
  ui.stage.appendChild(app.canvas);

  const sceneAssets = runtime.assets ?? config.assets;
  const keys = ['background', 'body', 'eyesOpen', 'eyesClosed', 'mouthClosed', 'mouthMedium', 'mouthOpen'];
  const hasHandLayers = Boolean(sceneAssets.handNeutral && sceneAssets.handPoint);
  if (hasHandLayers) keys.push('handNeutral', 'handPoint');
  const textures = Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await Assets.load<Texture>(assetUrl(sceneAssets[key]))]))) as Record<string, Texture>;
  const subtitleTexture = await Assets.load<Texture>(generatedUrl(runtime.subtitlePath));
  const background = fullSprite(textures.background, config.video.width, config.video.height);
  app.stage.addChild(background);

  const character = new Container();
  const layers: Record<string, Sprite> = {
    body: fullSprite(textures.body, config.video.width, config.video.height),
    eyesOpen: fullSprite(textures.eyesOpen, config.video.width, config.video.height),
    eyesClosed: fullSprite(textures.eyesClosed, config.video.width, config.video.height),
    mouthClosed: fullSprite(textures.mouthClosed, config.video.width, config.video.height),
    mouthMedium: fullSprite(textures.mouthMedium, config.video.width, config.video.height),
    mouthOpen: fullSprite(textures.mouthOpen, config.video.width, config.video.height),
  };
  if (hasHandLayers) {
    layers.handNeutral = fullSprite(textures.handNeutral, config.video.width, config.video.height);
    layers.handPoint = fullSprite(textures.handPoint, config.video.width, config.video.height);
  }
  for (const layer of Object.values(layers)) layer.anchor.set(0.5);
  character.addChild(...Object.values(layers));
  app.stage.addChild(character);

  const subtitle = fullSprite(subtitleTexture, config.video.width, config.video.height);
  app.stage.addChild(subtitle);
  const audio = new Audio(generatedUrl(runtime.audio.path));
  audio.preload = 'auto';

  function render(timeSeconds: number): void {
    const state = evaluateScene(config, runtime, mouthData.cues, timeSeconds);
    character.position.set(config.video.width / 2 + state.character.x, config.video.height / 2 + state.character.y);
    character.scale.set(state.character.scale);
    character.alpha = state.character.opacity;
    layers.eyesOpen.visible = state.eyes === 'open';
    layers.eyesClosed.visible = state.eyes === 'closed';
    layers.mouthClosed.visible = state.mouth === 'closed';
    layers.mouthMedium.visible = state.mouth === 'medium';
    layers.mouthOpen.visible = state.mouth === 'open';
    if (hasHandLayers) {
      layers.handNeutral.visible = state.gesture === 'neutral';
      layers.handPoint.visible = state.gesture === 'point';
    }
    subtitle.visible = state.subtitleVisible;
    ui.time.textContent = `${state.time.toFixed(2)} / ${runtime.audio.durationSeconds.toFixed(2)} s`;
    ui.mouth.textContent = state.mouth;
    ui.eyes.textContent = state.eyes;
    ui.gesture.textContent = state.gesture;
    if (window.__STAGE1__) {
      window.__STAGE1__.currentMouth = state.mouth;
      window.__STAGE1__.currentEyes = state.eyes;
      window.__STAGE1__.currentGesture = state.gesture;
    }
  }

  app.ticker.add(() => render(audio.currentTime));
  render(0);
  ui.play.addEventListener('click', () => {
    void audio.play().then(() => {
      ui.audio.textContent = 'Reproduciendo';
      setPlaybackState('playing');
    });
  });
  ui.pause.addEventListener('click', () => {
    audio.pause();
    ui.audio.textContent = 'Pausado';
    setPlaybackState('paused');
  });
  ui.restart.addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
    ui.audio.textContent = 'Detenido';
    setPlaybackState('idle');
    render(0);
  });
  audio.addEventListener('ended', () => {
    ui.audio.textContent = 'Finalizado';
    setPlaybackState('ended');
  });

  const renderer = app.renderer.constructor.name;
  ui.status.textContent = 'Lista';
  ui.renderer.textContent = renderer;
  ui.canvasLoading.hidden = true;
  ui.canvasShell.setAttribute('aria-busy', 'false');
  setPlaybackState('idle');
  window.__STAGE1__ = {
    ready: true,
    jobId: selection.job.jobId,
    renderer,
    width: app.screen.width,
    height: app.screen.height,
    durationSeconds: runtime.audio.durationSeconds,
    mouthCueCount: mouthData.cues.length,
    currentMouth: 'closed',
    currentEyes: 'open',
    currentGesture: 'neutral',
  };
}

async function selectPreview(): Promise<PreviewSelection> {
  const response = await fetch('/generated/index.json', { cache: 'no-store' });
  if (response.status === 404) {
    return {
      job: {
        jobId: 'preview', state: 'legacy', updatedAt: 'legacy', durationSeconds: 0,
        previewPath: '', videoPath: null, verificationPassed: null, deterministic: null,
      },
      baseUrl: '/generated/',
      legacy: true,
    };
  }
  if (!response.ok) throw new Error(`/generated/index.json: HTTP ${response.status}`);
  const index = await response.json() as PreviewIndex;
  if (index.version !== 1 || !Array.isArray(index.jobs)) throw new Error('El índice de previews no tiene un formato compatible.');
  const jobs = index.jobs.filter((job) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(job.jobId));
  if (jobs.length === 0) throw new Error('No hay trabajos publicados.');
  const requestedJobId = new URLSearchParams(window.location.search).get('job');
  const selectedJobId = requestedJobId || index.defaultJobId || jobs[0].jobId;
  const job = jobs.find((item) => item.jobId === selectedJobId);
  if (!job) {
    throw new Error(`No existe el trabajo "${selectedJobId}". Disponibles: ${jobs.map((item) => item.jobId).join(', ')}.`);
  }
  ui.jobSelect.replaceChildren(...jobs.map((item) => {
    const option = document.createElement('option');
    option.value = item.jobId;
    option.textContent = item.jobId;
    option.selected = item.jobId === job.jobId;
    return option;
  }));
  ui.jobSelect.disabled = false;
  ui.jobSelect.addEventListener('change', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('job', ui.jobSelect.value);
    window.location.assign(url);
  });
  if (!requestedJobId) {
    const url = new URL(window.location.href);
    url.searchParams.set('job', job.jobId);
    window.history.replaceState(null, '', url);
  }
  return { job, baseUrl: `/generated/${encodeURIComponent(job.jobId)}/`, legacy: false };
}

function configureJobUi(selection: PreviewSelection): void {
  const { job } = selection;
  ui.jobStatus.textContent = job.jobId;
  if (selection.legacy) {
    ui.jobSelect.innerHTML = '<option value="preview">preview (formato anterior)</option>';
    ui.jobMeta.textContent = 'Publicación legacy: vuelva a publicar los jobs para habilitar el selector.';
    return;
  }
  const duration = Number.isFinite(job.durationSeconds) ? `${job.durationSeconds.toFixed(2)} s` : 'duración desconocida';
  const verification = job.verificationPassed === null ? 'sin verificación publicada' : `${job.verificationPassed} verificaciones`;
  const deterministic = job.deterministic === true ? 'determinista' : job.deterministic === false ? 'no determinista' : 'determinismo sin registrar';
  ui.jobMeta.textContent = `${job.state} · ${duration} · ${verification} · ${deterministic}`;
  if (job.videoPath) {
    ui.download.href = `/generated/${job.videoPath}`;
    ui.download.hidden = false;
  }
}

function fullSprite(texture: Texture, width: number, height: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.width = width;
  sprite.height = height;
  return sprite;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontró ${selector}`);
  return element;
}
