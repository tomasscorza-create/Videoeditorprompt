export interface WordMatchCutEvaluation {
  frameIndex: number;
  loopFrame: number;
  cutIndex: number;
  sourceIndex: number;
  frameWithinCut: number;
  cutProgress: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotationDegrees: number;
  flashOpacity: number;
  underlineProgress: number;
}

export function evaluateWordMatchCut(
  definition: { durationSeconds: number; fps: number; cutFrames: number; sequence: number[] },
  seconds: number,
): WordMatchCutEvaluation;

export function normalizeTemplateWord(value: unknown, fallback?: string, maxLength?: number): string;
