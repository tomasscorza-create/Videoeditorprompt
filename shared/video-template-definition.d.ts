import type { ProceduralPageStyle } from './video-template-page.js';

export declare const TEMPLATE_WORD_MAX_LENGTH: number;
export declare const MOTION_CARD_LAYOUTS: readonly ['title', 'list', 'comparison', 'cta'];

export interface VideoTemplateTextField {
  id: string;
  type: 'text';
  label: string;
  placeholder: string;
  minLength: number;
  maxLength: number;
}

export interface WordMatchCutTemplateDefinition {
  version: 2;
  id: string;
  kind: 'procedural-word-match-cut';
  label: string;
  durationSeconds: number;
  fps: number;
  cutFrames: number;
  sequence: number[];
  pageStyles: ProceduralPageStyle[];
  defaultValues: { word: string };
  fields: VideoTemplateTextField[];
}

export interface MotionCardTemplateDefinition {
  version: 2;
  id: string;
  kind: 'procedural-motion-card';
  label: string;
  durationSeconds: number;
  fps: number;
  layout: 'title' | 'list' | 'comparison' | 'cta';
  seed: number;
  labels: string[];
  palette: {
    background: string;
    surface: string;
    primary: string;
    secondary: string;
    text: string;
    muted: string;
  };
  defaultValues: { word: string };
  fields: VideoTemplateTextField[];
}

export type VideoTemplateDefinition = WordMatchCutTemplateDefinition | MotionCardTemplateDefinition;

export function parseVideoTemplateDefinition(value: unknown, expectedId?: string): VideoTemplateDefinition;
