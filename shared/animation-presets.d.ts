import type { AnimationAnchor, AnimationInterpolation } from './animation-contract.js';

export type AnimationIntensity = 'soft' | 'medium' | 'strong';
export type AnimationPresetGroupId = 'entrance' | 'exit' | 'visibility' | 'emphasis' | 'movement' | 'articulation';

export const ANIMATION_INTENSITIES: Readonly<Record<AnimationIntensity, { amplitude: number; duration: number }>>;
export const ANIMATION_PRESET_GROUPS: Readonly<Record<AnimationPresetGroupId, { label: string }>>;

export interface AnimationPresetDefinition {
  version: number;
  groupId: AnimationPresetGroupId;
  parameterId: string;
  label: string;
  steps: ReadonlyArray<{
    atSeconds: number;
    mode: 'offset' | 'absolute' | 'factor';
    amount: number;
    interpolation: AnimationInterpolation;
  }>;
}

export const ANIMATION_PRESETS: Readonly<Record<string, AnimationPresetDefinition>>;

export interface ExpandedAnimationTrack {
  parameterId: string;
  source: { kind: 'preset'; presetId: string; version: number; customized: boolean };
  keyframes: Array<{
    id: string;
    anchor: AnimationAnchor;
    offsetSeconds: number;
    value: number;
    interpolation: AnimationInterpolation;
  }>;
}

export function animationPresetWindow(
  presetId: string,
  intensity?: AnimationIntensity,
): {
  startOffsetSeconds: number;
  endOffsetSeconds: number;
};

export function expandAnimationPreset(
  presetId: string,
  options?: {
    anchor?: AnimationAnchor;
    offsetSeconds?: number;
    intensity?: AnimationIntensity;
    baseValue?: number;
    keyframeIdPrefix?: string;
  },
): ExpandedAnimationTrack;

export function listApplicablePresets(
  declaredParameters?: readonly string[],
): Array<{
  id: string;
  label: string;
  groupId: AnimationPresetGroupId;
  parameterId: string;
  version: number;
}>;
