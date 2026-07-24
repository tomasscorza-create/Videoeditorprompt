export type CharacterShape = Record<string, string | number | Array<{ x: number; y: number }>>;

export interface CharacterDesign {
  version: 1;
  preset: 'mono-parametrico-v1';
  name: string;
  accessory: 'none' | 'glasses' | 'badge';
  headwear: 'none' | 'cap';
  palette: Record<string, string>;
}

export const CHARACTER_PALETTE_KEYS: string[];
export const CHARACTER_PALETTE_PRESETS: Record<string, Record<string, string>>;
export function applyCharacterDesign(
  baseDefinition: Record<string, unknown>,
  design: CharacterDesign,
  outputId: string,
): Record<string, any>;
