import { ANIMATION_PARAMETERS } from '../../../shared/animation-contract.js';
import { ANIMATION_PRESETS } from '../../../shared/animation-presets.js';
import type {
  CreativeRecipeCatalog,
  EffectSequence,
  EffectSequenceAction,
  EffectSequenceSlot,
} from '../../../shared/animation-sequences.js';

export type { CreativeRecipeCatalog, EffectSequence };

export const CREATIVE_RECIPE_CATALOG_URL = '/assets/catalog/creative-recipes.json';

export async function loadAnimationSequenceCatalog(): Promise<CreativeRecipeCatalog> {
  const response = await fetch(CREATIVE_RECIPE_CATALOG_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo cargar el catálogo de animaciones coordinadas.');
  return parseAnimationSequenceCatalog(await response.json());
}

export function parseAnimationSequenceCatalog(value: unknown): CreativeRecipeCatalog {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.effectSequences)) {
    throw new Error('El catálogo de animaciones coordinadas no tiene un formato compatible.');
  }
  const effectSequences = value.effectSequences.map(parseSequence);
  if (new Set(effectSequences.map((sequence) => sequence.id)).size !== effectSequences.length) {
    throw new Error('El catálogo de animaciones coordinadas contiene identificadores repetidos.');
  }
  return { version: 1, effectSequences };
}

function parseSequence(value: unknown): EffectSequence {
  if (!isRecord(value) || !isId(value.id) || !isText(value.label) || !isText(value.description)
    || !Array.isArray(value.tags) || !value.tags.every(isText)
    || !Array.isArray(value.compatibleAnchorKinds)
    || !value.compatibleAnchorKinds.every(isAnchorKind)
    || !Array.isArray(value.slots) || value.slots.length === 0
    || !Array.isArray(value.actions) || value.actions.length < 2) {
    throw new Error('Una animación coordinada del catálogo es inválida.');
  }
  const slots = value.slots.map(parseSlot);
  const slotIds = new Set(slots.map((slot) => slot.id));
  const actions = value.actions.map((action) => parseAction(action, slotIds));
  if (slotIds.size !== slots.length) throw new Error('Una animación coordinada repite un slot.');
  return {
    id: value.id,
    label: value.label,
    description: value.description,
    tags: [...value.tags],
    compatibleAnchorKinds: [...value.compatibleAnchorKinds],
    slots,
    actions,
  };
}

function parseSlot(value: unknown): EffectSequenceSlot {
  if (!isRecord(value) || !isId(value.id) || !Array.isArray(value.elementTypes)
    || value.elementTypes.length === 0 || !value.elementTypes.every(isElementType)
    || !Array.isArray(value.requiredParameters)
    || !value.requiredParameters.every((parameter) => (
      typeof parameter === 'string' && Object.hasOwn(ANIMATION_PARAMETERS, parameter)
    ))) {
    throw new Error('Un slot de animación coordinada es inválido.');
  }
  return {
    id: value.id,
    elementTypes: [...value.elementTypes],
    requiredParameters: [...value.requiredParameters],
  };
}

function parseAction(value: unknown, slotIds: ReadonlySet<string>): EffectSequenceAction {
  if (!isRecord(value) || typeof value.slotId !== 'string' || !slotIds.has(value.slotId)
    || typeof value.presetId !== 'string' || !Object.hasOwn(ANIMATION_PRESETS, value.presetId)
    || typeof value.offsetSeconds !== 'number' || !Number.isFinite(value.offsetSeconds)
    || !isIntensity(value.intensity)) {
    throw new Error('Una acción de animación coordinada es inválida.');
  }
  return {
    slotId: value.slotId,
    presetId: value.presetId,
    offsetSeconds: value.offsetSeconds,
    intensity: value.intensity,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u.test(value);
}

function isAnchorKind(value: unknown): value is 'scene' | 'turn' | 'word' {
  return value === 'scene' || value === 'turn' || value === 'word';
}

function isElementType(value: unknown): value is 'character' | 'prop' {
  return value === 'character' || value === 'prop';
}

function isIntensity(value: unknown): value is EffectSequenceAction['intensity'] {
  return value === 'inherit' || value === 'soft' || value === 'medium' || value === 'strong';
}
