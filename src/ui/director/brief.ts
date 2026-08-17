import type { DirectorConstraints } from './api.js';

export interface DirectorBriefInput {
  duration: string;
  scenes: string;
}

/** Convierte solo decisiones humanas explícitas en restricciones del modelo. */
export function buildDirectorConstraints(input: DirectorBriefInput): DirectorConstraints {
  const constraints: DirectorConstraints = { planVersion: 2 };
  const duration = Number(input.duration);
  if (input.duration && duration >= 8 && duration <= 90) constraints.targetDurationSeconds = duration;
  const scenes = Number(input.scenes);
  if (input.scenes && scenes >= 1 && scenes <= 8) constraints.sceneCount = scenes;
  return constraints;
}
