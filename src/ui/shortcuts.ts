import type { PreviewHandle } from '../preview/types.js';
import { optional } from './dom.js';

const STEP_SECONDS = 0.5;

function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

// Atajos documentados en docs/comandos.md.
export function initShortcuts(handle: PreviewHandle): void {
  const { audio, render, durationSeconds } = handle;
  window.addEventListener('keydown', (event) => {
    if (isTyping(event.target)) return;
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        if (audio.paused) void audio.play();
        else audio.pause();
        break;
      case 'KeyL':
        event.preventDefault();
        optional<HTMLButtonElement>('#loop-btn')?.click();
        break;
      case 'KeyM':
        event.preventDefault();
        audio.muted = !audio.muted;
        break;
      case 'ArrowLeft': {
        event.preventDefault();
        const target = Math.max(0, audio.currentTime - STEP_SECONDS);
        audio.currentTime = target;
        render(target);
        break;
      }
      case 'ArrowRight': {
        event.preventDefault();
        const target = Math.min(durationSeconds, audio.currentTime + STEP_SECONDS);
        audio.currentTime = target;
        render(target);
        break;
      }
      default:
        break;
    }
  });
}
