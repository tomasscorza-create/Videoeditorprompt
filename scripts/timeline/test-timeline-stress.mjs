import assert from 'node:assert/strict';
import {
  applyTimelineClipCommand,
  createTimelineClipEditor,
  exportTimelineDocument,
  timelineDurationTicks,
  undoTimelineClip,
  validateTimelineDocument,
} from '../../shared/timeline-clip-core.js';

const initialClipCount = 500;
const splitCount = 100;
const clipDuration = 48_000;
const sourceDuration = initialClipCount * clipDuration;

function fixture() {
  return {
    version: 2,
    id: 'timeline-stress-01',
    timebase: { ticksPerSecond: 48_000, fps: 30, audioSampleRate: 48_000 },
    sources: [{
      id: 'audio-stress-source',
      kind: 'audio',
      durationTicks: sourceDuration,
      contentHash: 'e'.repeat(64),
    }],
    tracks: [{ id: 'audio-stress-track', kind: 'audio', order: 0 }],
    clips: Array.from({ length: initialClipCount }, (_, index) => ({
      id: `stress-clip-${String(index).padStart(4, '0')}`,
      kind: 'audio',
      sourceId: 'audio-stress-source',
      trackId: 'audio-stress-track',
      timelineStartTick: index * clipDuration,
      sourceInTick: index * clipDuration,
      durationTicks: clipDuration,
      enabled: true,
    })),
  };
}

function execute() {
  let state = createTimelineClipEditor(fixture(), { historyLimit: 10 });
  for (let index = 0; index < splitCount; index += 1) {
    state = applyTimelineClipCommand(state, {
      type: 'split-clip',
      clipId: `stress-clip-${String(index).padStart(4, '0')}`,
      atTimelineTick: index * clipDuration + clipDuration / 2,
      newClipId: `stress-right-${String(index).padStart(4, '0')}`,
    });
  }
  return state;
}

const first = execute();
const second = execute();
assert.equal(validateTimelineDocument(first.document), true);
assert.equal(first.document.clips.length, initialClipCount + splitCount);
assert.equal(timelineDurationTicks(first.document), sourceDuration);
assert.equal(first.past.length, 10);
assert.equal(exportTimelineDocument(first), exportTimelineDocument(second));
assert.equal(undoTimelineClip(first).document.clips.length, initialClipCount + splitCount - 1);
assert.equal(new Set(first.document.clips.map((clip) => clip.sourceId)).size, 1);

process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: 7,
  failed: 0,
  initialClipCount,
  finalClipCount: first.document.clips.length,
  operations: splitCount,
})}\n`);
