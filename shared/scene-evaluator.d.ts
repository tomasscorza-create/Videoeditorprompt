export interface MouthCue { start: number; end: number; state: 'closed' | 'medium' | 'open' }
export interface SceneState {
  time: number;
  character: { x: number; y: number; scale: number; opacity: number };
  eyes: 'open' | 'closed';
  mouth: 'closed' | 'medium' | 'open';
  gesture: 'neutral' | 'point';
  subtitleVisible: boolean;
}
export interface DialogueCharacterState {
  id: string;
  character: { x: number; y: number; scale: number; opacity: number };
  eyes: 'open' | 'closed';
  mouth: 'closed' | 'medium' | 'open';
  gesture: 'neutral';
  speaking: boolean;
}
export interface DialogueSceneState {
  time: number;
  activeSpeakerId: string | null;
  activeTurnId: string | null;
  subtitlePath: string | null;
  characters: DialogueCharacterState[];
}
export function buildBlinkSchedule(durationSeconds: number, options: any): Array<{ start: number; end: number }>;
export function evaluateScene(config: any, runtime: any, temporalData: MouthCue[] | any, timeSeconds: number): SceneState | DialogueSceneState;
export function createFfmpegMotionExpressions(config: any, character?: any): { scaleWidth: string; scaleHeight: string; x: string; y: string };
