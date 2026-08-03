export type CreativeSupportState = 'available' | 'limited' | 'draft-only' | 'planned' | 'excluded';
export type CreativeConsumer = 'authoring' | 'preview' | 'export' | 'directorCreation' | 'directorEditing';
export type CreativeSceneModeId = 'voiceover' | 'solo' | 'dialogue' | 'visual-with-voiceover';

export interface CreativeCapabilityMatrix {
  version: 1;
  limits: Record<string, unknown>;
  sceneModes: Array<{
    id: CreativeSceneModeId;
    label: string;
    participantRange: { minimum: number; maximum: number };
    speechKinds: Array<'character' | 'voiceover'>;
  }>;
  capabilities: Array<{
    id: string;
    label: string;
    support: Record<CreativeConsumer, CreativeSupportState>;
  }>;
  animation: { parameterIds: string[]; presetIds: string[] };
  resources: Array<{
    id: string;
    type: string;
    label: string;
    parameters: string[];
    animationPresetIds: string[];
  }>;
  recipes: { sceneRecipeIds: string[]; effectSequenceIds: string[] };
}

export const CREATIVE_CAPABILITY_VERSION: 1;
export const CREATIVE_SUPPORT_STATES: readonly CreativeSupportState[];
export const CREATIVE_LIMITS: Readonly<Record<string, unknown>>;
export const CREATIVE_SCENE_MODES: Readonly<Record<CreativeSceneModeId, {
  label: string;
  participantRange: { minimum: number; maximum: number };
  speechKinds: Array<'character' | 'voiceover'>;
}>>;
export const CREATIVE_CAPABILITY_DEFINITIONS: CreativeCapabilityMatrix['capabilities'];
export function buildCreativeCapabilityMatrix(options?: {
  resourceCatalog?: { entries?: Array<Record<string, unknown>> };
  recipeCatalog?: { sceneRecipes?: Array<{ id: string }>; effectSequences?: Array<{ id: string }> };
}): CreativeCapabilityMatrix;
export function capabilityStatus(
  matrix: CreativeCapabilityMatrix,
  capabilityId: string,
  consumer: CreativeConsumer,
): CreativeSupportState | null;
