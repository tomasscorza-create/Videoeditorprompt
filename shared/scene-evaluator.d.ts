export interface MouthCue { start: number; end: number; state: 'closed' | 'medium' | 'open' }
export interface SceneState {
  time: number;
  character: { x: number; y: number; scale: number; opacity: number };
  eyes: 'open' | 'closed';
  mouth: 'closed' | 'medium' | 'open';
  gesture: 'neutral' | 'point';
  subtitleVisible: boolean;
}
export function buildBlinkSchedule(durationSeconds: number, options: any): Array<{ start: number; end: number }>;
export function evaluateScene(config: any, runtime: any, mouthCues: MouthCue[], timeSeconds: number): SceneState;
export function createFfmpegMotionExpressions(config: any): { scaleWidth: string; scaleHeight: string; x: string; y: string };
