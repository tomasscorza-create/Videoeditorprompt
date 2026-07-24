export type ProjectSelection =
  | { kind: 'scene'; sceneId: string }
  | { kind: 'element'; sceneId: string; elementId: string }
  | { kind: 'dialogue'; sceneId: string; turnId: string };

export const PROJECT_SELECTION_EVENT = 'local-video:project-selection';
let current: ProjectSelection | null = null;

export function projectSelection(): ProjectSelection | null {
  return current;
}

export function selectProjectItem(selection: ProjectSelection): void {
  current = selection;
  window.dispatchEvent(new CustomEvent<ProjectSelection>(PROJECT_SELECTION_EVENT, { detail: selection }));
}
