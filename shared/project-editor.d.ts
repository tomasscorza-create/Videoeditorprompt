export interface EditorState {
  readonly version: 1;
  readonly project: Readonly<Record<string, unknown>> & { readonly scenes: readonly any[] };
  readonly catalog: Readonly<Record<string, unknown>> & { readonly entries: readonly any[] };
  readonly selectedSceneId: string;
  readonly revision: number;
  readonly historyLimit: number;
  readonly past: readonly any[];
  readonly future: readonly any[];
}

export class ProjectEditorError extends Error {
  code: string;
  path: string;
}

export function createProjectEditor(project: unknown, catalog: unknown, options?: { historyLimit?: number }): EditorState;
export function applyProjectEditorCommand(state: EditorState, command: Record<string, unknown>): EditorState;
export function undoProjectEditor(state: EditorState): EditorState;
export function redoProjectEditor(state: EditorState): EditorState;
export function listEditorResources(state: EditorState, type: 'character' | 'voice' | 'background' | 'image'): readonly any[];
export function exportEditorProject(state: EditorState): string;
export function validateEditableProject(project: unknown, catalog: unknown): true;
