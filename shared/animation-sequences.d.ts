import type { AnimationAnchor } from './animation-contract.js';
import type { AnimationIntensity } from './animation-presets.js';

export interface EffectSequenceAction {
  slotId: string;
  presetId: string;
  offsetSeconds: number;
  intensity: 'inherit' | AnimationIntensity;
}

export interface EffectSequenceSlot {
  id: string;
  elementTypes: Array<'character' | 'prop'>;
  requiredParameters: string[];
}

export interface EffectSequence {
  id: string;
  label: string;
  description: string;
  tags: string[];
  phase: 'opening' | 'development' | 'closing';
  compatibleAnchorKinds: Array<AnimationAnchor['kind']>;
  slots: EffectSequenceSlot[];
  actions: EffectSequenceAction[];
}

export interface CreativeRecipeCatalog {
  version: 1;
  effectSequences: EffectSequence[];
}

export function listApplicableEffectSequences(
  recipeCatalog: CreativeRecipeCatalog,
  element: { type: string },
  resource?: { capabilities?: { parameters?: string[] } },
): EffectSequence[];

export function effectSequenceWindow(
  sequence: EffectSequence,
  intensity?: AnimationIntensity,
): { startOffsetSeconds: number; endOffsetSeconds: number };

export function expandEffectSequenceCommands(
  request: {
    sequenceId: string;
    anchor: AnimationAnchor;
    intensity?: AnimationIntensity;
    offsetSeconds?: number;
    bindings: Array<{ slotId: string; sceneId: string; elementId: string }>;
  },
  project: unknown,
  catalog: unknown,
  recipeCatalog: CreativeRecipeCatalog,
): Array<Record<string, unknown>>;
