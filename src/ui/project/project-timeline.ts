import { attachProjectTimeline } from '../timeline.js';
import type { ProjectStore } from './store.js';

// Adaptador fino: la implementación temporal vive en ui/timeline.ts para que
// proyecto, preview medido y MP4 final compartan la misma superficie.
export function initProjectTimeline(store: ProjectStore): void {
  attachProjectTimeline(store);
}
