// Vistas de SOLO LECTURA sobre el proyecto de autoría.
// No son una segunda fuente de verdad: el estado real vive en
// shared/project-editor.js y solo cambia por comandos semánticos.

export type ResourceType = 'character' | 'voice' | 'background' | 'image';

export interface ResourceEntry {
  id: string;
  type: ResourceType;
  label: string;
  capabilities?: Record<string, unknown>;
}

export interface TransformView {
  x: number;
  y: number;
  scale: number;
  zIndex: number;
}

export interface ElementView {
  id: string;
  type: string;
  resourceId?: string;
  text?: string;
  poseId?: string;
  transform: TransformView;
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
  scenes: SceneView[];
}
