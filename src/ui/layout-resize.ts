import { optional } from './dom.js';

const STORAGE_KEY = 'local-video-layout-v1';
const DESKTOP_QUERY = '(min-width: 1101px)';
const SIDE_MIN_RATIO = 0.16;
const SIDE_MAX_RATIO = 0.36;
const VIEWER_MIN_RATIO = 0.32;
const TIMELINE_MIN_RATIO = 0.18;
const TIMELINE_MAX_RATIO = 0.42;
const SIDE_MIN_PX = 280;
const SIDE_MAX_PX = 560;
const VIEWER_MIN_PX = 360;
const WORKSPACE_OVERHEAD_PX = 62;
const TIMELINE_MIN_PX = 150;
const TIMELINE_MAX_PX = 460;
type LayoutRatios = {
  director: number;
  inspector: number;
  timeline: number;
  directorCollapsed?: boolean;
  inspectorCollapsed?: boolean;
  timelineCollapsed?: boolean;
  directorWillCollapse?: boolean;
  inspectorWillCollapse?: boolean;
  timelineWillCollapse?: boolean;
  directorAtMax?: boolean;
  inspectorAtMax?: boolean;
  timelineAtMax?: boolean;
};

type ResizableRatio = 'director' | 'inspector' | 'timeline';

export function initWorkspaceResize(): void {
  const workspace = optional<HTMLElement>('.workspace');
  const shell = optional<HTMLElement>('.app-shell');
  const directorHandle = optional<HTMLElement>('#director-resizer');
  const inspectorHandle = optional<HTMLElement>('#inspector-resizer');
  const timelineHandle = optional<HTMLElement>('#timeline-resizer');
  if (!workspace || !shell || !directorHandle || !inspectorHandle || !timelineHandle) return;

  const desktop = window.matchMedia(DESKTOP_QUERY);
  let ratios = readRatios() ?? defaultRatios(workspace.clientWidth);

  const apply = (): void => {
    if (!desktop.matches) return;
    ratios = normalizeRatios(ratios, workspace.clientWidth, shell.clientHeight);
    document.documentElement.style.setProperty('--director-width', `${Math.round(workspace.clientWidth * ratios.director)}px`);
    document.documentElement.style.setProperty('--inspector-width', `${Math.round(workspace.clientWidth * ratios.inspector)}px`);
    document.documentElement.style.setProperty('--timeline-height', `${Math.round(shell.clientHeight * ratios.timeline)}px`);

    if (ratios.directorCollapsed) {
      workspace.classList.add('is-director-collapsed');
    } else {
      workspace.classList.remove('is-director-collapsed');
    }
    if (ratios.directorWillCollapse) workspace.classList.add('is-director-will-collapse');
    else workspace.classList.remove('is-director-will-collapse');

    if (ratios.directorAtMax) workspace.classList.add('is-director-at-max');
    else workspace.classList.remove('is-director-at-max');

    if (ratios.inspectorCollapsed) {
      workspace.classList.add('is-inspector-collapsed');
    } else {
      workspace.classList.remove('is-inspector-collapsed');
    }
    if (ratios.inspectorWillCollapse) workspace.classList.add('is-inspector-will-collapse');
    else workspace.classList.remove('is-inspector-will-collapse');

    if (ratios.inspectorAtMax) workspace.classList.add('is-inspector-at-max');
    else workspace.classList.remove('is-inspector-at-max');

    if (ratios.timelineCollapsed) {
      shell.classList.add('is-timeline-collapsed');
    } else {
      shell.classList.remove('is-timeline-collapsed');
    }
    if (ratios.timelineWillCollapse) shell.classList.add('is-timeline-will-collapse');
    else shell.classList.remove('is-timeline-will-collapse');

    if (ratios.timelineAtMax) shell.classList.add('is-timeline-at-max');
    else shell.classList.remove('is-timeline-at-max');

    syncSeparatorValue(directorHandle, ratios.director);
    syncSeparatorValue(inspectorHandle, ratios.inspector);
    syncSeparatorValue(timelineHandle, ratios.timeline);
  };

  optional<HTMLButtonElement>('#director-collapse')?.addEventListener('click', () => { ratios.directorCollapsed = true; apply(); persist(); });
  directorHandle.addEventListener('pointerdown', () => { if (ratios.directorCollapsed) { ratios.directorCollapsed = false; apply(); persist(); } });

  optional<HTMLButtonElement>('#inspector-collapse')?.addEventListener('click', () => { ratios.inspectorCollapsed = true; apply(); persist(); });
  inspectorHandle.addEventListener('pointerdown', () => { if (ratios.inspectorCollapsed) { ratios.inspectorCollapsed = false; apply(); persist(); } });

  optional<HTMLButtonElement>('#timeline-collapse')?.addEventListener('click', () => { ratios.timelineCollapsed = true; apply(); persist(); });
  timelineHandle.addEventListener('pointerdown', () => { if (ratios.timelineCollapsed) { ratios.timelineCollapsed = false; apply(); persist(); } });

  bindPointer(directorHandle, (event) => {
    const rect = workspace.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    ratios.director = ratio;
    const sideMin = Math.max(SIDE_MIN_RATIO, SIDE_MIN_PX / rect.width);
    const sideMax = Math.min(SIDE_MAX_RATIO, SIDE_MAX_PX / rect.width);
    ratios.directorWillCollapse = ratio < sideMin * 0.7;
    ratios.directorAtMax = ratio > sideMax - 0.01;
    apply();
  }, () => {
    if (ratios.directorWillCollapse) {
      ratios.directorCollapsed = true;
    }
    ratios.directorWillCollapse = false;
    ratios.directorAtMax = false;
    apply();
    persist();
  });

  bindPointer(inspectorHandle, (event) => {
    const rect = workspace.getBoundingClientRect();
    const ratio = (rect.right - event.clientX) / rect.width;
    ratios.inspector = ratio;
    const sideMin = Math.max(SIDE_MIN_RATIO, SIDE_MIN_PX / rect.width);
    const sideMax = Math.min(SIDE_MAX_RATIO, SIDE_MAX_PX / rect.width);
    ratios.inspectorWillCollapse = ratio < sideMin * 0.7;
    ratios.inspectorAtMax = ratio > sideMax - 0.01;
    apply();
  }, () => {
    if (ratios.inspectorWillCollapse) {
      ratios.inspectorCollapsed = true;
    }
    ratios.inspectorWillCollapse = false;
    ratios.inspectorAtMax = false;
    apply();
    persist();
  });

  bindPointer(timelineHandle, (event) => {
    const rect = shell.getBoundingClientRect();
    const ratio = (rect.bottom - event.clientY) / rect.height;
    ratios.timeline = ratio;
    const timelineMin = Math.max(TIMELINE_MIN_RATIO, TIMELINE_MIN_PX / rect.height);
    const timelineMax = Math.min(TIMELINE_MAX_RATIO, TIMELINE_MAX_PX / rect.height);
    ratios.timelineWillCollapse = ratio < timelineMin * 0.7;
    ratios.timelineAtMax = ratio > timelineMax - 0.01;
    apply();
  }, () => {
    if (ratios.timelineWillCollapse) {
      ratios.timelineCollapsed = true;
    }
    ratios.timelineWillCollapse = false;
    ratios.timelineAtMax = false;
    apply();
    persist();
  });

  bindKeyboard(directorHandle, {
    decrease: () => adjust('director', -0.01),
    increase: () => adjust('director', 0.01),
    reset: () => reset('director'),
  }, 'horizontal');
  bindKeyboard(inspectorHandle, {
    decrease: () => adjust('inspector', 0.01),
    increase: () => adjust('inspector', -0.01),
    reset: () => reset('inspector'),
  }, 'horizontal');
  bindKeyboard(timelineHandle, {
    decrease: () => adjust('timeline', 0.01),
    increase: () => adjust('timeline', -0.01),
    reset: () => reset('timeline'),
  }, 'vertical');

  directorHandle.addEventListener('dblclick', () => reset('director'));
  inspectorHandle.addEventListener('dblclick', () => reset('inspector'));
  timelineHandle.addEventListener('dblclick', () => reset('timeline'));
  window.addEventListener('resize', apply);
  desktop.addEventListener('change', apply);
  apply();

  function adjust(key: ResizableRatio, delta: number): void {
    ratios[key] += delta;
    apply();
    persist();
  }

  function reset(key: ResizableRatio): void {
    ratios[key] = defaultRatios(workspace!.clientWidth)[key];
    apply();
    persist();
  }

  function persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ratios));
    } catch {
      // La interfaz sigue funcionando aunque el navegador bloquee localStorage.
    }
  }
}

function bindPointer(
  handle: HTMLElement,
  move: (event: PointerEvent) => void,
  finish: () => void,
): void {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !window.matchMedia(DESKTOP_QUERY).matches) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing');

    const onMove = (moveEvent: PointerEvent): void => move(moveEvent);
    const onEnd = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('is-resizing');
      finish();
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });
}

function bindKeyboard(
  handle: HTMLElement,
  actions: { decrease: () => void; increase: () => void; reset: () => void },
  axis: 'horizontal' | 'vertical',
): void {
  handle.addEventListener('keydown', (event) => {
    const decreaseKey = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const increaseKey = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const repeat = event.shiftKey ? 3 : 1;
    if (event.key === decreaseKey || event.key === increaseKey) {
      event.preventDefault();
      const action = event.key === decreaseKey ? actions.decrease : actions.increase;
      for (let index = 0; index < repeat; index += 1) action();
    } else if (event.key === 'Home') {
      event.preventDefault();
      actions.reset();
    }
  });
}

function normalizeRatios(input: LayoutRatios, workspaceWidth: number, shellHeight: number): LayoutRatios {
  const sideMin = Math.max(SIDE_MIN_RATIO, SIDE_MIN_PX / workspaceWidth);
  const sideMax = Math.min(SIDE_MAX_RATIO, SIDE_MAX_PX / workspaceWidth);
  const viewerMin = Math.max(VIEWER_MIN_RATIO, VIEWER_MIN_PX / workspaceWidth)
    + WORKSPACE_OVERHEAD_PX / workspaceWidth;
  let director = clamp(input.director, sideMin, sideMax);
  let inspector = clamp(input.inspector, sideMin, sideMax);
  const excess = director + inspector + viewerMin - 1;
  if (excess > 0) {
    const reducibleDirector = Math.max(0, director - sideMin);
    const directorReduction = Math.min(excess / 2, reducibleDirector);
    director -= directorReduction;
    inspector -= Math.min(excess - directorReduction, Math.max(0, inspector - sideMin));
  }

  const timelineMin = Math.max(TIMELINE_MIN_RATIO, TIMELINE_MIN_PX / shellHeight);
  const timelineMax = Math.min(TIMELINE_MAX_RATIO, TIMELINE_MAX_PX / shellHeight);
  return {
    director,
    inspector,
    timeline: clamp(input.timeline, timelineMin, timelineMax),
    directorCollapsed: input.directorCollapsed,
    inspectorCollapsed: input.inspectorCollapsed,
    timelineCollapsed: input.timelineCollapsed,
    directorWillCollapse: input.directorWillCollapse,
    inspectorWillCollapse: input.inspectorWillCollapse,
    timelineWillCollapse: input.timelineWillCollapse,
    directorAtMax: input.directorAtMax,
    inspectorAtMax: input.inspectorAtMax,
    timelineAtMax: input.timelineAtMax,
  };
}

function readRatios(): LayoutRatios | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '') as Partial<LayoutRatios>;
    if (
      Number.isFinite(parsed.director)
      && Number.isFinite(parsed.inspector)
      && Number.isFinite(parsed.timeline)
    ) {
      return {
        director: Number(parsed.director),
        inspector: Number(parsed.inspector),
        timeline: Number(parsed.timeline),
        directorCollapsed: Boolean(parsed.directorCollapsed),
        inspectorCollapsed: Boolean(parsed.inspectorCollapsed),
        timelineCollapsed: Boolean(parsed.timelineCollapsed),
      };
    }
  } catch {
    // Se usan proporciones seguras si la preferencia no existe o está corrupta.
  }
  return null;
}

function defaultRatios(workspaceWidth: number): LayoutRatios {
  return {
    director: 384 / workspaceWidth,
    inspector: 400 / workspaceWidth,
    timeline: 0.23,
    directorCollapsed: false,
    inspectorCollapsed: false,
    timelineCollapsed: false,
  };
}

function syncSeparatorValue(handle: HTMLElement, ratio: number): void {
  handle.setAttribute('aria-valuemin', '0');
  handle.setAttribute('aria-valuemax', '100');
  handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  handle.setAttribute('aria-valuetext', `${Math.round(ratio * 100)} %`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
