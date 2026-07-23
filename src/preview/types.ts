import type { MouthCue } from '../../shared/scene-evaluator.js';

export interface SceneConfig {
  version: number;
  video: { width: number; height: number; fps: number };
  assets: Record<string, string>;
  character?: Record<string, number>;
  subtitle?: { startSeconds: number };
  gestures?: Array<{ pose: 'point'; startSeconds: number; durationSeconds: number }>;
}

export interface SceneRuntime {
  version: number;
  audio: { path: string; durationSeconds: number };
  mouthCuesPath?: string;
  subtitlePath?: string;
  blinks?: Array<{ start: number; end: number }>;
  assets?: Record<string, string>;
  characterRig?: { version: number; id: string; manifestPath: string };
  dialoguePath?: string;
  characters?: Array<{
    id: string;
    assets: Record<string, string>;
    transform: Record<string, number>;
    blinks: Array<{ start: number; end: number }>;
  }>;
  backgroundAnimation?: {
    camera: Record<string, number>;
    layers: Array<{ id: string; asset: string; baseScale: number; parallaxX: number; parallaxY: number }>;
  } | null;
}

export interface DialogueData {
  turns: Array<{
    id: string;
    speakerId: string;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
    subtitlePath: string;
    mouthCues: MouthCue[];
  }>;
}

export interface PreviewJob {
  jobId: string;
  state: string;
  updatedAt: string;
  durationSeconds: number;
  previewPath: string;
  videoPath: string | null;
  verificationPassed: number | null;
  deterministic: boolean | null;
}

export interface PreviewIndex {
  version: number;
  defaultJobId: string;
  jobs: PreviewJob[];
}

export interface PreviewSelection {
  job: PreviewJob;
  baseUrl: string;
  legacy: boolean;
}

export interface PreviewUi {
  status: HTMLElement;
  renderer: HTMLElement;
  time: HTMLElement;
  audio: HTMLElement;
  mouth: HTMLElement;
  eyes: HTMLElement;
  gesture: HTMLElement;
  stage: HTMLElement;
}

// Seam de UI: el preview expone lo mínimo para que los controles e indicadores
// consuman la reproducción sin duplicar lógica temporal del motor.
export interface PreviewHandle {
  audio: HTMLAudioElement;
  render: (timeSeconds: number) => void;
  durationSeconds: number;
  turns?: DialogueData['turns'];
}

export interface PreviewStartOptions {
  selection: PreviewSelection;
  config: SceneConfig;
  runtime: SceneRuntime;
  generatedUrl: (relativePath: string) => string;
  assetUrl: (relativePath: string) => string;
  ui: PreviewUi;
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
      activeSpeakerId?: string | null;
    };
  }
}
