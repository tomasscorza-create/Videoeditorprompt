export type AnimationInterpolation = 'linear' | 'ease' | 'hold';

export type AnimationAnchor =
  | { kind: 'scene'; edge: 'start' | 'end' }
  | { kind: 'turn'; turnId: string; edge: 'start' | 'end' }
  | { kind: 'word'; turnId: string; wordIndex: number };

export interface SceneTimingTurn {
  id: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  wordCount: number;
}

export interface SceneTiming {
  startSeconds: number;
  endSeconds: number;
  turns: SceneTimingTurn[];
}

export interface ResolvedKeyframe {
  id: string;
  anchor: AnimationAnchor;
  /** Segundos absolutos dentro de la escena, después de medir el audio. */
  seconds: number;
  /** Frame más cercano, sujeto al último frame de la escena. */
  frameIndex: number;
  value: number;
  interpolation: AnimationInterpolation;
}

export interface ResolvedTrack {
  parameterId: string;
  source: { kind: 'preset'; presetId: string; version: number; customized: boolean } | { kind: 'manual' };
  /** Orden canónico: segundo resuelto y después id. */
  keyframes: ResolvedKeyframe[];
}

export interface ResolvedAnimationElement {
  elementId: string;
  elementType: 'character' | 'prop';
  tracks: ResolvedTrack[];
}

export interface ResolvedAnimationScene {
  sceneId: string;
  fps: number;
  frameCount: number;
  elements: ResolvedAnimationElement[];
}

export function buildSceneTiming(dialogueData: any, durationSeconds: number): SceneTiming;

export function resolveAnchorSeconds(anchor: AnimationAnchor, timing: SceneTiming, path?: string): number;

export function resolveAnimationScene(document: any, timing: SceneTiming, fps: number): ResolvedAnimationScene;

export function evaluateTrack(track: ResolvedTrack, timeSeconds: number): number;

export function evaluateAnimationParams(
  resolved: ResolvedAnimationScene,
  timeSeconds: number,
): Record<string, Record<string, number>>;
