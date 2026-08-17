export type DirectorPhase = 'idea' | 'base' | 'video';

export interface DirectorFlowState {
  phase: DirectorPhase;
  projectAvailable: boolean;
  questionsAvailable: boolean;
  busy: 'ai' | 'render' | null;
}

export function initialDirectorPhase(projectAvailable: boolean): DirectorPhase {
  return projectAvailable ? 'video' : 'idea';
}

export function canOpenDirectorPhase(state: DirectorFlowState, phase: DirectorPhase): boolean {
  if (state.busy !== null) return phase === state.phase;
  if (phase === 'idea') return true;
  if (phase === 'base') return state.questionsAvailable;
  return state.projectAvailable;
}
