import type { ResolvedAnimationScene } from './animation-evaluator.js';

export type MouthState = 'closed' | 'medium' | 'open' | 'round' | 'labiodental' | 'bilabial';
export type GestureState = 'neutral' | 'point' | 'celebrate' | 'doubt' | 'deny';
export interface MouthCue { start: number; end: number; state: MouthState }
export interface SceneState {
  time: number;
  character: { x: number; y: number; scale: number; opacity: number };
  eyes: 'open' | 'closed';
  mouth: MouthState;
  gesture: GestureState;
  subtitleVisible: boolean;
}
export interface DialogueCharacterState {
  id: string;
  character: { x: number; y: number; scale: number; opacity: number };
  eyes: 'open' | 'closed';
  mouth: MouthState;
  gesture: GestureState;
  speaking: boolean;
}
export interface DialogueSceneState {
  time: number;
  background: null | {
    camera: { x: number; y: number; zoom: number };
    layers: Array<{ id: string; x: number; y: number; scale: number }>;
  };
  backgroundVideo?: { sourceFrameIndex: number; sourceSeconds: number };
  activeSpeakerId: string | null;
  activeTurnId: string | null;
  /** Ruta del fragmento corto activo, no necesariamente la ruta general del turno. */
  subtitlePath: string | null;
  characters: DialogueCharacterState[];
  /** Solo presente cuando se evalúa con animación resuelta (Fase 2). */
  elements?: Record<string, { params: Record<string, number> }>;
}
export function buildBlinkSchedule(durationSeconds: number, options: any): Array<{ start: number; end: number }>;
export function evaluateScene(config: any, runtime: any, temporalData: MouthCue[] | any, timeSeconds: number, animation?: ResolvedAnimationScene | null): SceneState | DialogueSceneState;
export function createFfmpegMotionExpressions(config: any, character?: any, dialogueData?: any, characterId?: string): { scaleWidth: string; scaleHeight: string; x: string; y: string };
export function createFfmpegBackgroundExpressions(runtime: any, layer: any): { scaleWidth: string; scaleHeight: string; x: string; y: string };
