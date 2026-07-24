export type CharacterRole =
  | 'body' | 'head' | 'eye-left' | 'eye-right' | 'mouth'
  | 'arm-left' | 'arm-right' | 'leg-left' | 'leg-right'
  | 'garment' | 'accessory';

export interface TemplateCharacterDesign {
  version: 1;
  preset: 'mono-parametrico-v1';
  name: string;
  accessory: 'none' | 'glasses' | 'badge';
  headwear: 'none' | 'cap';
  palette: Record<string, string>;
}

export interface CustomCharacterPart {
  id: string;
  name: string;
  role: CharacterRole;
  shape: 'ellipse' | 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDegrees: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface CustomCharacterDesign {
  version: 2;
  mode: 'from-scratch';
  name: string;
  parts: CustomCharacterPart[];
}

export type CharacterDesign = TemplateCharacterDesign | CustomCharacterDesign;
export const CHARACTER_PALETTE_KEYS: string[];
export const CHARACTER_PALETTE_PRESETS: Record<string, Record<string, string>>;
export const CUSTOM_PART_ROLE_LABELS: Record<CharacterRole, string>;
export const REQUIRED_CUSTOM_ROLES: CharacterRole[];
export function createCustomPart(role: CharacterRole, index?: number): CustomCharacterPart;
export function createDefaultCustomCharacterDesign(): CustomCharacterDesign;
export function createEmptyCustomCharacterDesign(): CustomCharacterDesign;
export function customCharacterDesignIssues(design: unknown): string[];
export function applyCharacterDesign(
  baseDefinition: Record<string, unknown>,
  design: CharacterDesign,
  outputId: string,
): Record<string, any>;
