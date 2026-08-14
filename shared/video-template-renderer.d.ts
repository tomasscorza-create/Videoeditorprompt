import type { VideoTemplateDefinition } from './video-template-definition.js';
import type { MotionCardEvaluation, WordMatchCutEvaluation } from './video-template-evaluator.js';

export interface PreparedVideoTemplate {
  kind: VideoTemplateDefinition['kind'];
  definition: VideoTemplateDefinition;
  word: string;
  pages?: unknown[];
}

export function prepareVideoTemplate(definition: VideoTemplateDefinition, word: string): PreparedVideoTemplate;
export function drawVideoTemplateFrame(
  canvas: HTMLCanvasElement,
  prepared: PreparedVideoTemplate,
  seconds: number,
): WordMatchCutEvaluation | MotionCardEvaluation;
