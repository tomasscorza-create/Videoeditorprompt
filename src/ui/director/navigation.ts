export const DIRECTOR_PAGES = ['command', 'project', 'render'] as const;

export type DirectorPage = typeof DIRECTOR_PAGES[number];
export type DirectorMode = 'creation' | 'editing';

export interface DirectorNavigationState {
  mode: DirectorMode;
  page: DirectorPage;
  projectAvailable: boolean;
}

export type DirectorNavigationEvent =
  | { type: 'select-page'; page: DirectorPage }
  | { type: 'project-availability-changed'; available: boolean }
  | { type: 'proposal-created' }
  | { type: 'ai-change-applied' }
  | { type: 'render-opened' }
  | { type: 'render-completed' };

export interface DirectorPageDescriptor {
  page: DirectorPage;
  label: string;
  enabled: boolean;
  selected: boolean;
}

export function createDirectorNavigation(projectAvailable: boolean): DirectorNavigationState {
  return {
    mode: projectAvailable ? 'editing' : 'creation',
    page: 'command',
    projectAvailable,
  };
}

export function updateDirectorNavigation(
  state: DirectorNavigationState,
  event: DirectorNavigationEvent,
): DirectorNavigationState {
  switch (event.type) {
    case 'select-page':
      if (event.page === 'project' && !state.projectAvailable) return state;
      return { ...state, page: event.page };
    case 'project-availability-changed': {
      const page = !event.available && state.page === 'project' ? 'command' : state.page;
      return { ...state, projectAvailable: event.available, page };
    }
    case 'proposal-created':
      return { ...state, projectAvailable: true, page: 'project' };
    case 'ai-change-applied':
      return { mode: 'editing', projectAvailable: true, page: 'project' };
    case 'render-opened':
      return { ...state, page: 'render' };
    case 'render-completed':
      return { mode: 'editing', projectAvailable: true, page: 'render' };
  }
}

export function describeDirectorPages(state: DirectorNavigationState): DirectorPageDescriptor[] {
  const labels: Record<DirectorPage, string> = state.mode === 'creation'
    ? { command: 'Idea', project: 'Propuesta', render: 'Render' }
    : { command: 'Ajustar con IA', project: 'Estado actual', render: 'Render' };
  return DIRECTOR_PAGES.map((page) => ({
    page,
    label: labels[page],
    enabled: page !== 'project' || state.projectAvailable,
    selected: page === state.page,
  }));
}
