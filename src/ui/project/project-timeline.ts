import { attachProjectTimeline } from '../timeline.js';
import type { ProjectStore } from './store.js';

// Adaptador fino: la implementación temporal vive en ui/timeline.ts y consume
// el mismo estado coordinado que el visor del Editor.
export function initProjectTimeline(store: ProjectStore): void {
  attachProjectTimeline(store);
}
