// Vistas de SOLO LECTURA sobre el proyecto de autoría.
// No son una segunda fuente de verdad: el estado real vive en
// shared/project-editor.js y solo cambia por comandos semánticos.

export type ResourceType = 'character' | 'prop' | 'template' | 'voice' | 'background' | 'image';

export interface ResourceEntry {
  id: string;
  type: ResourceType;
  label: string;
  tags?: string[];
  capabilities?: Record<string, unknown>;
  characterRef?: { catalog: string; entryId: string };
  resourceRef?: { catalog: string; entryId: string };
  templateRef?: { definition: string };
  thumbnail?: string;
  backgroundManifest?: string;
  provenance?: { source?: string; license?: string };
}

export interface TransformView {
  x: number;
  y: number;
  scale: number;
  zIndex: number;
  rotationDegrees: number;
  opacity: number;
}

/**
 * Pistas de animación del elemento (Fase 4). El vocabulario es el congelado en
 * `shared/animation-contract.js`: acá solo se declara la forma que la interfaz
 * lee, nunca una regla nueva.
 */
export type AnchorView =
  | { kind: 'scene'; edge: 'start' | 'end' }
  | { kind: 'turn'; turnId: string; edge: 'start' | 'end' }
  | { kind: 'word'; turnId: string; wordIndex: number };

export type InterpolationView = 'linear' | 'ease' | 'hold';

export interface KeyframeView {
  id: string;
  anchor: AnchorView;
  offsetSeconds: number;
  value: number;
  interpolation: InterpolationView;
}

export type TrackSourceView =
  | { kind: 'preset'; presetId: string; version: number; customized: boolean }
  | { kind: 'manual' };

export interface TrackView {
  parameterId: string;
  source: TrackSourceView;
  keyframes: KeyframeView[];
}

export interface ElementView {
  id: string;
  type: string;
  resourceId?: string;
  /** Solo en elementos de tipo `template`. */
  templateId?: string;
  values?: { word: string };
  text?: string;
  poseId?: string;
  animationPreset?: string;
  transform: TransformView;
  tracks?: TrackView[];
}

export interface TurnView {
  id: string;
  speakerElementId: string;
  text: string;
  voiceId: string;
  gestureId: string;
  gapAfterSeconds: number;
}

export interface TransitionView {
  preset: 'cut' | 'fade';
  durationSeconds: number;
}

export interface SceneView {
  id: string;
  title: string;
  background: { resourceId: string; cameraPreset: string };
  elements: ElementView[];
  dialogue: TurnView[];
  transitionToNext?: TransitionView;
}

export interface ProjectView {
  id: string;
  title: string;
  /** Formato del video; la animación necesita los fps para ubicar un frame. */
  video: { width: number; height: number; fps: number };
  scenes: SceneView[];
}
