// Vistas de SOLO LECTURA sobre el proyecto de autoría.
// No son una segunda fuente de verdad: el estado real vive en
// shared/project-editor.js y solo cambia por comandos semánticos.

export type ResourceType = 'character' | 'voice' | 'background' | 'image';

export interface ResourceEntry {
  id: string;
  type: ResourceType;
  label: string;
  tags?: string[];
  capabilities?: Record<string, unknown>;
  characterRef?: { catalog: string; entryId: string };
  backgroundManifest?: string;
  provenance?: { source?: string; license?: string };
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
  animationPreset?: string;
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
