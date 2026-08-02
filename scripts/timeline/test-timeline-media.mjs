import assert from 'node:assert/strict';
import { createReadStream, rmSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, ffprobe, projectRoot, run } from '../stage1/common.mjs';
import { createTimelineMediaLibrary } from './media-library.mjs';
import { createTimelineProjectRepository } from './timeline-project-repository.mjs';
import { createTimelineExportPlan, createTimelineExporter } from './timeline-exporter.mjs';

const root = path.join(projectRoot, '.local-video', 'tests', 'timeline-v2-media');
rmSync(root, { recursive: true, force: true });
ensureDirectory(root);
const sourceFile = path.join(root, 'source.mp4');
run('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'color=c=blue:s=180x320:r=30:d=1.2',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.2',
  '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourceFile,
], { stage: 'timeline_test_source' });

const media = await createTimelineMediaLibrary({ storageRoot: path.join(root, 'media') });
const firstImport = await media.importStream(createReadStream(sourceFile), { fileName: 'Prueba azul.mp4', mimeType: 'video/mp4' });
assert.equal(firstImport.created, true);
assert.equal(firstImport.entry.hasVideo, true);
assert.equal(firstImport.entry.hasAudio, true);
assert.equal(firstImport.entry.durationTicks % 1_600, 0);
const duplicateImport = await media.importFile(sourceFile, { fileName: 'Duplicado.mp4', mimeType: 'video/mp4' });
assert.equal(duplicateImport.created, false);
assert.equal(duplicateImport.entry.id, firstImport.entry.id);
assert.equal(media.list().length, 1);

const durationTicks = firstImport.entry.durationTicks;
const project = {
  version: 2,
  id: 'montaje-prueba-01',
  timebase: { ticksPerSecond: 48_000, fps: 30, audioSampleRate: 48_000 },
  sources: [{
    id: firstImport.entry.id,
    kind: 'video',
    durationTicks,
    contentHash: firstImport.entry.contentHash,
  }],
  tracks: [
    { id: 'video-track-01', kind: 'visual', order: 0 },
    { id: 'audio-track-01', kind: 'audio', order: 1 },
  ],
  clips: [
    { id: 'video-clip-01', kind: 'visual', sourceId: firstImport.entry.id, trackId: 'video-track-01', timelineStartTick: 0, sourceInTick: 0, durationTicks, enabled: true, linkGroupId: 'link-av-01' },
    { id: 'audio-clip-01', kind: 'audio', sourceId: firstImport.entry.id, trackId: 'audio-track-01', timelineStartTick: 0, sourceInTick: 0, durationTicks, enabled: true, linkGroupId: 'link-av-01' },
  ],
};

const repository = await createTimelineProjectRepository({ storageRoot: path.join(root, 'projects') });
const stored = repository.save(project);
assert.equal(stored.created, true);
assert.equal(repository.get(project.id).revision, stored.revision);
assert.throws(() => repository.save({ ...project, clips: [] }, 'f'.repeat(64)), (error) => error.code === 'TIMELINE_PROJECT_REVISION_CONFLICT');

const plan = createTimelineExportPlan(project, media.list(), { width: 180, height: 320 });
assert.equal(plan.clips.length, 2);
assert.equal(plan.clips[0].segmentKey.length, 64);
const moved = structuredClone(project);
moved.clips.forEach((clip) => { clip.timelineStartTick = clip.kind === 'visual' ? 1_600 : 1_600; });
const movedPlan = createTimelineExportPlan(moved, media.list(), { width: 180, height: 320 });
assert.deepEqual(movedPlan.clips.map((clip) => clip.segmentKey), plan.clips.map((clip) => clip.segmentKey));
assert.notEqual(movedPlan.projectKey, plan.projectKey);

const exporter = await createTimelineExporter({ mediaLibrary: media, storageRoot: path.join(root, 'exports'), width: 180, height: 320 });
const exported = exporter.exportProject(project);
assert.equal(exported.cacheHit, false);
assert.equal(ffprobe(exporter.open(exported.exportId).file).streams.some((stream) => stream.codec_type === 'video'), true);
const cached = exporter.exportProject(project);
assert.equal(cached.cacheHit, true);
assert.equal(cached.reusedSegments, 2);

process.stdout.write(`${JSON.stringify({ version: 1, passed: 14, failed: 0, mediaId: firstImport.entry.id, exportId: exported.exportId })}\n`);
