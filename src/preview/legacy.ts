import { Application, Assets, Container, type Sprite, type Texture } from 'pixi.js';
import { evaluateScene, type MouthCue, type SceneState } from '../../shared/scene-evaluator.js';
import { fetchJson, fullSprite, wirePlayback } from './common.js';
import type { PreviewHandle, PreviewStartOptions } from './types.js';

export async function startLegacyPreview(options: PreviewStartOptions): Promise<PreviewHandle> {
  const { selection, config, runtime, generatedUrl, assetUrl, ui } = options;
  if (!runtime.mouthCuesPath || !runtime.subtitlePath) throw new Error('El runtime v1 no contiene boca o subtítulo.');
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
  app.stage.addChild(fullSprite(textures.background, config.video.width, config.video.height));

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
    const state = evaluateScene(config, runtime, mouthData.cues, timeSeconds) as SceneState;
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
  wirePlayback(audio, render, ui);
  const renderer = app.renderer.constructor.name;
  ui.status.textContent = 'Lista';
  ui.renderer.textContent = renderer;
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
  return { audio, render, durationSeconds: runtime.audio.durationSeconds };
}
