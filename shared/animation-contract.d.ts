export type AnimationInterpolation = 'linear' | 'ease' | 'hold';

export type AnimationAnchor =
  | { kind: 'scene'; edge: 'start' | 'end' }
  | { kind: 'turn'; turnId: string; edge: 'start' | 'end' }
  | { kind: 'word'; turnId: string; wordIndex: number };

export interface AnimationParameter {
  unit: string;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum: number;
  elementTypes: readonly string[];
  requiresResourceSupport: boolean;
}

export const ANIMATION_PARAMETERS: Readonly<Record<string, AnimationParameter>>;
export const RESOURCE_DECLARED_PARAMETERS: readonly string[];
export const ANIMATION_INTERPOLATIONS: readonly AnimationInterpolation[];
export const ANIMATION_PRESET_IDS: readonly string[];

export interface AnimationLimits {
  tracksPerElement: number;
  keyframesPerTrack: number;
  keyframesPerScene: number;
  minimumKeyframesPerTrack: number;
  offsetSecondsMinimum: number;
  offsetSecondsMaximum: number;
}

export const ANIMATION_LIMITS: Readonly<AnimationLimits>;

export interface AnimationErrorEntry {
  tier: 'autoria' | 'compilacion';
  message: string;
  suggestedAction: string;
}

export const ANIMATION_ERROR_CATALOG: Readonly<Record<string, AnimationErrorEntry>>;

export class AnimationContractError extends Error {
  code: string;
  path: string;
  suggestedAction: string;
  technicalDetail?: string;
}

export function failAnimation(code: string, path?: string, detail?: string): never;
export function quantizeToFrame(seconds: number, fps: number): number;
export function anchorKey(anchor: AnimationAnchor): string;
export function describeAnchor(anchor: AnimationAnchor): string;

export interface AnchorReviewEntry {
  elementId: string;
  parameterId: string;
  keyframeId: string;
  reason: 'turn-missing' | 'word-missing';
  message: string;
}

export function listAnchorsRequiringReview(
  document: { elements: Array<{ elementId: string; tracks: Array<{ parameterId: string; keyframes: Array<{ id: string; anchor: AnimationAnchor }> }> }> },
  sceneReference: { turns?: Array<{ id: string; wordCount: number }> } | null | undefined,
): AnchorReviewEntry[];
