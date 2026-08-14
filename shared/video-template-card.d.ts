import type { MotionCardTemplateDefinition } from './video-template-definition.js';
import type { MotionCardEvaluation } from './video-template-evaluator.js';

export function drawMotionCardFrame(
  canvas: HTMLCanvasElement,
  definition: MotionCardTemplateDefinition,
  word: string,
  frame: MotionCardEvaluation,
): void;
