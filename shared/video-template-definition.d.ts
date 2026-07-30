import type { ProceduralPageStyle } from './video-template-page.js';

export declare const TEMPLATE_WORD_MAX_LENGTH: number;

export interface VideoTemplateTextField {
  id: string;
  type: 'text';
  label: string;
  placeholder: string;
  minLength: number;
  maxLength: number;
}

export interface VideoTemplateDefinition {
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

export function parseVideoTemplateDefinition(value: unknown, expectedId?: string): VideoTemplateDefinition;
