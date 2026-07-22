import { Sprite, type Texture } from 'pixi.js';
import type { PreviewUi } from './types.js';

export function fullSprite(texture: Texture, width: number, height: number): Sprite {
  const sprite = new Sprite(texture);
  sprite.width = width;
  sprite.height = height;
  return sprite;
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function wirePlayback(audio: HTMLAudioElement, render: (timeSeconds: number) => void, ui: PreviewUi): void {
  required<HTMLButtonElement>('#play').addEventListener('click', () => {
    void audio.play().then(() => { ui.audio.textContent = 'Reproduciendo'; });
  });
  required<HTMLButtonElement>('#pause').addEventListener('click', () => {
    audio.pause();
    ui.audio.textContent = 'Pausado';
  });
  required<HTMLButtonElement>('#restart').addEventListener('click', () => {
    audio.pause();
    audio.currentTime = 0;
    ui.audio.textContent = 'Detenido';
    render(0);
  });
  audio.addEventListener('ended', () => { ui.audio.textContent = 'Finalizado'; });
}

export function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontró ${selector}`);
  return element;
}
