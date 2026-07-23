import type { PreviewHandle } from '../preview/types.js';
import { formatTime, optional } from './dom.js';

type PlaybackState = 'loading' | 'idle' | 'playing' | 'paused' | 'ended';

const SPEEDS = [0.5, 1, 1.5, 2];

export interface PlaybackUiOptions {
  onTime?: (timeSeconds: number) => void;
}

export function initPlaybackUi(handle: PreviewHandle, options: PlaybackUiOptions = {}): void {
  const { audio, render, durationSeconds } = handle;
  const play = optional<HTMLButtonElement>('#play');
  const pause = optional<HTMLButtonElement>('#pause');
  const restart = optional<HTMLButtonElement>('#restart');
  const viewerPlay = optional<HTMLButtonElement>('#viewer-play-btn');
  const seek = optional<HTMLInputElement>('#seek');
  const currentLabel = optional<HTMLElement>('#viewer-current');
  const durationLabel = optional<HTMLElement>('#viewer-duration');
  const speedBtn = optional<HTMLButtonElement>('#speed-btn');
  const loopBtn = optional<HTMLButtonElement>('#loop-btn');
  const iconPlay = optional<SVGElement>('#icon-play');
  const iconPause = optional<SVGElement>('#icon-pause');

  let scrubbing = false;
  let speed = 1;

  function setState(state: PlaybackState): void {
    const loading = state === 'loading';
    const playing = state === 'playing';
    if (play) play.disabled = loading || playing;
    if (pause) pause.disabled = loading || !playing;
    if (restart) restart.disabled = loading;
    if (viewerPlay) viewerPlay.disabled = loading;
    if (seek) seek.disabled = loading;
    if (iconPlay) iconPlay.style.display = playing ? 'none' : 'block';
    if (iconPause) iconPause.style.display = playing ? 'block' : 'none';
  }

  // El preview ya cablea #play/#pause/#restart. Aquí solo se refleja el estado
  // escuchando al audio, para no duplicar manejadores ni invertir la acción.
  audio.addEventListener('play', () => setState('playing'));
  audio.addEventListener('pause', () => setState(audio.currentTime > 0 ? 'paused' : 'idle'));
  audio.addEventListener('ended', () => {
    if (!audio.loop) setState('ended');
  });

  viewerPlay?.addEventListener('click', () => {
    if (audio.paused) void audio.play();
    else audio.pause();
  });

  if (seek) {
    seek.addEventListener('pointerdown', () => { scrubbing = true; });
    const stopScrub = (): void => { scrubbing = false; };
    seek.addEventListener('pointerup', stopScrub);
    seek.addEventListener('pointercancel', stopScrub);
    seek.addEventListener('input', () => {
      const target = (Number(seek.value) / 1000) * durationSeconds;
      audio.currentTime = target;
      render(target);
      options.onTime?.(target);
    });
  }

  speedBtn?.addEventListener('click', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
    audio.playbackRate = speed;
    speedBtn.textContent = `${speed}x`;
    speedBtn.title = `Velocidad: ${speed}x`;
  });

  if (loopBtn) {
    loopBtn.setAttribute('aria-pressed', 'false');
    loopBtn.addEventListener('click', () => {
      audio.loop = !audio.loop;
      loopBtn.classList.toggle('is-active', audio.loop);
      loopBtn.setAttribute('aria-pressed', String(audio.loop));
    });
  }

  if (durationLabel) durationLabel.textContent = formatTime(durationSeconds);

  // Bucle de presentación: solo refresca indicadores de UI.
  // No evalúa la escena; el evaluador temporal sigue siendo del motor.
  function tick(): void {
    const time = audio.currentTime;
    if (currentLabel) currentLabel.textContent = formatTime(time);
    if (seek && !scrubbing) {
      const pct = durationSeconds > 0 ? Math.min(100, (time / durationSeconds) * 100) : 0;
      seek.value = String(Math.round(pct * 10));
      seek.style.setProperty('--pct', `${pct}%`);
    }
    options.onTime?.(time);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  optional<HTMLElement>('#canvas-loading')?.setAttribute('hidden', '');
  optional<HTMLElement>('.canvas-shell')?.setAttribute('aria-busy', 'false');
  setState('idle');
}
