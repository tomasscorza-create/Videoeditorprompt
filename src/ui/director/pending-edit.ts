import { projectFingerprint } from '../../../shared/project-fingerprint.js';
import type { ProjectView } from '../project/types.js';
import type { DirectorEditExplanation } from './edit-proposal.js';

export interface PendingDirectorEdit {
  commands: Array<Record<string, unknown>>;
  explanation: DirectorEditExplanation;
  baseFingerprint: string;
  customizedRemovalConfirmed: boolean;
}

export function createPendingDirectorEdit(
  project: ProjectView,
  commands: Array<Record<string, unknown>>,
  explanation: DirectorEditExplanation,
): PendingDirectorEdit {
  return {
    commands,
    explanation,
    baseFingerprint: projectFingerprint(project),
    customizedRemovalConfirmed: false,
  };
}

export function pendingEditIsCurrent(pending: PendingDirectorEdit, project: ProjectView): boolean {
  return pending.baseFingerprint === projectFingerprint(project);
}
