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

export interface MotionCardEvaluation {
  frameIndex: number;
  loopFrame: number;
  progress: number;
  opacity: number;
  scale: number;
  offsetY: number;
  accentProgress: number;
  pulse: number;
  comparisonBalance: number;
  itemProgress: readonly number[];
}

export function evaluateMotionCard(
  definition: { durationSeconds: number; fps: number },
  seconds: number,
): MotionCardEvaluation;

export function normalizeTemplateWord(value: unknown, fallback?: string, maxLength?: number): string;
