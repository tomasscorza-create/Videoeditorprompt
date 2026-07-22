import { Application, Assets, Container, type Sprite, type Texture } from 'pixi.js';
import { evaluateScene, type DialogueSceneState } from '../../shared/scene-evaluator.js';
import { fetchJson, fullSprite, wirePlayback } from './common.js';
import type { DialogueData, PreviewStartOptions } from './types.js';

export async function startDialoguePreview(options: PreviewStartOptions): Promise<void> {
  const { selection, config, runtime, generatedUrl, assetUrl, ui } = options;
  if (!runtime.dialoguePath || !runtime.characters) throw new Error('El runtime v2 no contiene diálogo o personajes.');
  const dialogue = await fetchJson<DialogueData>(generatedUrl(runtime.dialoguePath));
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

  const backgroundLayers: Array<{ id: string; sprite: Sprite }> = [];
  if (runtime.backgroundAnimation) {
    for (const layer of runtime.backgroundAnimation.layers) {
      const texture = await Assets.load<Texture>(assetUrl(layer.asset));
      const sprite = fullSprite(texture, config.video.width, config.video.height);
      sprite.anchor.set(0.5);
      sprite.position.set(config.video.width / 2, config.video.height / 2);
      app.stage.addChild(sprite);
      backgroundLayers.push({ id: layer.id, sprite });
    }
  } else {
    const backgroundTexture = await Assets.load<Texture>(assetUrl(config.assets.background));
    app.stage.addChild(fullSprite(backgroundTexture, config.video.width, config.video.height));
  }

  const layerKeys = ['body', 'eyesOpen', 'eyesClosed', 'mouthClosed', 'mouthMedium', 'mouthOpen', 'handNeutral', 'handPoint'];
  const visualCharacters: Array<{ id: string; container: Container; layers: Record<string, Sprite> }> = [];
  for (const characterRuntime of runtime.characters) {
    const textures = Object.fromEntries(await Promise.all(layerKeys.map(async (key) => [
      key,
      await Assets.load<Texture>(assetUrl(characterRuntime.assets[key])),
    ]))) as Record<string, Texture>;
    const container = new Container();
    const layers = Object.fromEntries(layerKeys.map((key) => [
      key,
      fullSprite(textures[key], config.video.width, config.video.height),
    ])) as Record<string, Sprite>;
    for (const layer of Object.values(layers)) layer.anchor.set(0.5);
    container.addChild(...Object.values(layers));
    app.stage.addChild(container);
    visualCharacters.push({ id: characterRuntime.id, container, layers });
  }

  const subtitles = new Map<string, Sprite>();
  for (const turn of dialogue.turns) {
    const texture = await Assets.load<Texture>(generatedUrl(turn.subtitlePath));
    const sprite = fullSprite(texture, config.video.width, config.video.height);
    sprite.visible = false;
    subtitles.set(turn.id, sprite);
    app.stage.addChild(sprite);
  }
  const audio = new Audio(generatedUrl(runtime.audio.path));
  audio.preload = 'auto';

  function render(timeSeconds: number): void {
    const state = evaluateScene(config, runtime, dialogue, timeSeconds) as DialogueSceneState;
    for (const visual of backgroundLayers) {
      const layerState = state.background?.layers.find((item) => item.id === visual.id);
      if (!layerState) continue;
      visual.sprite.position.set(config.video.width / 2 + layerState.x, config.video.height / 2 + layerState.y);
      visual.sprite.scale.set(layerState.scale);
    }
    for (const visual of visualCharacters) {
      const characterState = state.characters.find((item) => item.id === visual.id);
      if (!characterState) continue;
      visual.container.position.set(config.video.width / 2 + characterState.character.x, config.video.height / 2 + characterState.character.y);
      visual.container.scale.set(characterState.character.scale);
      visual.container.alpha = characterState.character.opacity;
      visual.layers.eyesOpen.visible = characterState.eyes === 'open';
      visual.layers.eyesClosed.visible = characterState.eyes === 'closed';
      visual.layers.mouthClosed.visible = characterState.mouth === 'closed';
      visual.layers.mouthMedium.visible = characterState.mouth === 'medium';
      visual.layers.mouthOpen.visible = characterState.mouth === 'open';
      visual.layers.handNeutral.visible = characterState.gesture === 'neutral';
      visual.layers.handPoint.visible = characterState.gesture === 'point';
    }
    for (const [turnId, subtitle] of subtitles) subtitle.visible = turnId === state.activeTurnId;
    const speakerState = state.characters.find((item) => item.speaking);
    ui.time.textContent = `${state.time.toFixed(2)} / ${runtime.audio.durationSeconds.toFixed(2)} s`;
    ui.mouth.textContent = speakerState ? `${speakerState.id}: ${speakerState.mouth}` : 'silencio';
    ui.eyes.textContent = state.characters.map((item) => `${item.id}: ${item.eyes}`).join(' · ');
    const gestureState = state.characters.find((item) => item.gesture === 'point');
    ui.gesture.textContent = gestureState ? `${gestureState.id}: señala` : state.activeSpeakerId ? `habla ${state.activeSpeakerId}` : 'pausa';
    if (window.__STAGE1__) {
      window.__STAGE1__.currentMouth = speakerState?.mouth ?? 'closed';
      window.__STAGE1__.currentEyes = state.characters.map((item) => item.eyes).join(',');
      window.__STAGE1__.currentGesture = gestureState?.gesture ?? 'neutral';
      window.__STAGE1__.activeSpeakerId = state.activeSpeakerId;
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
    mouthCueCount: dialogue.turns.reduce((total, turn) => total + turn.mouthCues.length, 0),
    currentMouth: 'closed',
    currentEyes: 'open,open',
    currentGesture: 'neutral',
    activeSpeakerId: dialogue.turns[0]?.speakerId ?? null,
  };
}
