// U4 — Zoom y encuadre del lienzo de composición.
//
// Solo transforma la vista: aplica `transform` sobre el stage y jamás toca los
// datos del proyecto, así que la exportación es idéntica con cualquier zoom.
// El arrastre de personajes sigue funcionando sin cambios porque calcula sus
// coordenadas con getBoundingClientRect, que ya refleja la transformación.

import { optional } from '../dom.js';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const STEP = 1.25;

let zoom = 1;
let panX = 0;
let panY = 0;

export function initCompositionZoom(): void {
  const stage = optional<HTMLElement>('#composition-view');
  const wrap = stage?.parentElement;
  if (!stage || !wrap) return;

  const controls = optional<HTMLElement>('#composition-zoom-controls');
  optional<HTMLButtonElement>('#composition-zoom-out')?.addEventListener('click', () => setZoom(zoom / STEP));
  optional<HTMLButtonElement>('#composition-zoom-in')?.addEventListener('click', () => setZoom(zoom * STEP));
  optional<HTMLButtonElement>('#composition-zoom-fit')?.addEventListener('click', reset);
  if (controls) controls.hidden = false;

  // Ctrl+rueda hace zoom; la rueda sola se deja al desplazamiento normal.
  wrap.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? STEP : 1 / STEP));
  }, { passive: false });

  // Con zoom aplicado, arrastrar el fondo desplaza la vista. Sobre un
  // personaje manda el arrastre del personaje, que mueve el dato real.
  let panning = false;
  let originX = 0;
  let originY = 0;
  wrap.addEventListener('pointerdown', (event) => {
    if (zoom === 1 || !(event.target instanceof Element)) return;
    if (event.target.closest('.composition-character')) return;
    panning = true;
    originX = event.clientX - panX;
    originY = event.clientY - panY;
    wrap.classList.add('is-panning');
  });
  window.addEventListener('pointermove', (event) => {
    if (!panning) return;
    panX = event.clientX - originX;
    panY = event.clientY - originY;
    apply();
  });
  window.addEventListener('pointerup', () => {
    panning = false;
    wrap.classList.remove('is-panning');
  });

  wrap.addEventListener('dblclick', (event) => {
    if (event.target instanceof Element && event.target.closest('.composition-character')) return;
    reset();
  });

  apply();
}

function setZoom(next: number): void {
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  if (zoom === 1) {
    panX = 0;
    panY = 0;
  }
  apply();
}

function reset(): void {
  zoom = 1;
  panX = 0;
  panY = 0;
  apply();
}

function apply(): void {
  const stage = optional<HTMLElement>('#composition-view');
  if (stage) {
    stage.style.transform = zoom === 1 ? '' : `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }
  const level = optional<HTMLElement>('#composition-zoom-level');
  if (level) level.textContent = `${Math.round(zoom * 100)}%`;
  const out = optional<HTMLButtonElement>('#composition-zoom-out');
  const zoomIn = optional<HTMLButtonElement>('#composition-zoom-in');
  const fit = optional<HTMLButtonElement>('#composition-zoom-fit');
  if (out) out.disabled = zoom <= MIN_ZOOM + 0.001;
  if (zoomIn) zoomIn.disabled = zoom >= MAX_ZOOM - 0.001;
  if (fit) fit.disabled = zoom === 1 && panX === 0 && panY === 0;
}
