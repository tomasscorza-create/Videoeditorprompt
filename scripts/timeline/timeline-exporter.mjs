import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, ffprobe, run, sha256 } from '../stage1/common.mjs';
import { exportTimelineDocument, timelineDurationTicks, validateTimelineDocument } from '../../shared/timeline-clip-core.js';

const TICKS_PER_SECOND = 48_000;

export function createTimelineExportPlan(project, mediaEntries, options = {}) {
  validateTimelineDocument(project);
  const byId = new Map(mediaEntries.map((entry) => [entry.id, entry]));
  const trackOrder = new Map(project.tracks.map((track) => [track.id, track.order]));
  const clips = project.clips.filter((clip) => clip.enabled).map((clip) => {
    const source = project.sources.find((item) => item.id === clip.sourceId);
    const media = byId.get(source?.id);
    if (!source || !media || source.contentHash !== media.contentHash) {
      throw exportError('TIMELINE_EXPORT_SOURCE_MISSING', `No está disponible la fuente ${clip.sourceId}.`);
    }
    if (clip.kind === 'visual' && !media.hasVideo) throw exportError('TIMELINE_EXPORT_VIDEO_MISSING', `La fuente ${clip.sourceId} no contiene video.`);
    if (clip.kind === 'audio' && !media.hasAudio) throw exportError('TIMELINE_EXPORT_AUDIO_MISSING', `La fuente ${clip.sourceId} no contiene audio.`);
    const segmentKey = sha256(JSON.stringify({
      version: 1,
      kind: clip.kind,
      contentHash: source.contentHash,
      sourceInTick: clip.sourceInTick,
      durationTicks: clip.durationTicks,
      width: options.width || 1080,
      height: options.height || 1920,
      fps: project.timebase.fps,
      sampleRate: project.timebase.audioSampleRate,
    }));
    return { ...clip, mediaId: media.id, trackOrder: trackOrder.get(clip.trackId), segmentKey };
  });
  const durationTicks = timelineDurationTicks(project);
  if (durationTicks < 1) throw exportError('TIMELINE_EXPORT_EMPTY', 'Agregá al menos un clip antes de exportar.');
  const projectKey = sha256(`${exportTimelineDocument(project)}${clips.map((clip) => clip.segmentKey).join('')}`);
  return Object.freeze({
    version: 1,
    projectId: project.id,
    projectKey,
    durationTicks,
    durationSeconds: durationTicks / TICKS_PER_SECOND,
    clips: clips.sort((left, right) => left.trackOrder - right.trackOrder || left.timelineStartTick - right.timelineStartTick || left.id.localeCompare(right.id)),
  });
}

export async function createTimelineExporter(options = {}) {
  const mediaLibrary = options.mediaLibrary;
  if (!mediaLibrary) throw new TypeError('mediaLibrary es obligatorio.');
  const storageRoot = path.resolve(options.storageRoot || path.join(process.cwd(), '.local-video', 'timeline-v2', 'exports'));
  const segmentRoot = ensureDirectory(path.join(storageRoot, 'segments'));
  const outputRoot = ensureDirectory(path.join(storageRoot, 'outputs'));
  const runImpl = options.run || run;

  function exportProject(project) {
    const plan = createTimelineExportPlan(project, mediaLibrary.list(), options);
    const outputDirectory = ensureDirectory(path.join(outputRoot, plan.projectKey));
    const outputFile = path.join(outputDirectory, 'timeline.mp4');
    if (existsSync(outputFile)) return publicOutput(plan, outputFile, true, plan.clips.length);

    const rendered = plan.clips.map((clip) => renderSegment(clip));
    const temporary = path.join(outputDirectory, `timeline.${process.pid}.tmp.mp4`);
    try {
      renderComposition(plan, rendered, temporary);
      renameSync(temporary, outputFile);
    } finally {
      rmSync(temporary, { force: true });
    }
    return publicOutput(plan, outputFile, false, rendered.filter((item) => item.cacheHit).length);
  }

  function renderSegment(clip) {
    const extension = clip.kind === 'visual' ? '.mp4' : '.wav';
    const file = path.join(segmentRoot, `${clip.segmentKey}${extension}`);
    if (existsSync(file)) return { clip, file, cacheHit: true };
    const media = mediaLibrary.open(clip.mediaId);
    if (!media) throw exportError('TIMELINE_EXPORT_SOURCE_MISSING', `No se pudo abrir ${clip.mediaId}.`);
    const temporary = path.join(segmentRoot, `${clip.segmentKey}.${process.pid}.tmp${extension}`);
    const start = seconds(clip.sourceInTick);
    const duration = seconds(clip.durationTicks);
    try {
      if (clip.kind === 'visual') {
        runImpl('ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-y', '-i', media.file,
          '-vf', `trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,scale=${options.width || 1080}:${options.height || 1920}:force_original_aspect_ratio=decrease,pad=${options.width || 1080}:${options.height || 1920}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p`,
          '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', temporary,
        ], { stage: 'timeline_segment', errorCode: 'TIMELINE_VIDEO_SEGMENT_FAILED' });
      } else {
        runImpl('ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-y', '-i', media.file,
          '-af', `atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,aresample=48000`,
          '-vn', '-ac', '2', '-c:a', 'pcm_s16le', temporary,
        ], { stage: 'timeline_segment', errorCode: 'TIMELINE_AUDIO_SEGMENT_FAILED' });
      }
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    return { clip, file, cacheHit: false };
  }

  function renderComposition(plan, rendered, outputFile) {
    const visual = rendered.filter((item) => item.clip.kind === 'visual');
    const audio = rendered.filter((item) => item.clip.kind === 'audio');
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${options.width || 1080}x${options.height || 1920}:r=30:d=${plan.durationSeconds}`];
    for (const item of [...visual, ...audio]) args.push('-i', item.file);
    const filters = ['[0:v]format=yuv420p[vbase]'];
    let previousVideo = 'vbase';
    visual.forEach((item, index) => {
      const inputIndex = index + 1;
      const shifted = `vshift${index}`;
      const output = `vout${index}`;
      filters.push(`[${inputIndex}:v]setpts=PTS-STARTPTS+${seconds(item.clip.timelineStartTick)}/TB[${shifted}]`);
      filters.push(`[${previousVideo}][${shifted}]overlay=eof_action=pass:shortest=0[${output}]`);
      previousVideo = output;
    });
    const audioLabels = [];
    audio.forEach((item, index) => {
      const inputIndex = 1 + visual.length + index;
      const label = `adelay${index}`;
      filters.push(`[${inputIndex}:a]adelay=${item.clip.timelineStartTick}S:all=1[${label}]`);
      audioLabels.push(`[${label}]`);
    });
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${plan.durationSeconds}[silence]`);
    filters.push(`${audioLabels.join('')}[silence]amix=inputs=${audioLabels.length + 1}:duration=longest:normalize=0[aout]`);
    args.push(
      '-filter_complex', filters.join(';'),
      '-map', `[${previousVideo}]`, '-map', '[aout]',
      '-t', String(plan.durationSeconds), '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-pix_fmt', 'yuv420p', outputFile,
    );
    runImpl('ffmpeg', args, { stage: 'timeline_export', errorCode: 'TIMELINE_EXPORT_FAILED' });
  }

  function open(projectKey) {
    if (!/^[a-f0-9]{64}$/u.test(projectKey)) return null;
    const file = path.join(outputRoot, projectKey, 'timeline.mp4');
    if (!existsSync(file)) return null;
    return { file, size: statSync(file).size, name: `montaje-${projectKey.slice(0, 12)}.mp4`, mimeType: 'video/mp4' };
  }

  return { storageRoot, exportProject, open };
}

function publicOutput(plan, file, cacheHit, reusedSegments) {
  const probe = ffprobe(file);
  return {
    version: 1,
    exportId: plan.projectKey,
    projectId: plan.projectId,
    durationSeconds: Number(probe.format.duration),
    bytes: statSync(file).size,
    cacheHit,
    reusedSegments,
    videoUrl: `/api/timeline/exports/${plan.projectKey}/video`,
    downloadName: `montaje-${plan.projectId}.mp4`,
  };
}

function seconds(ticks) {
  return (ticks / TICKS_PER_SECOND).toFixed(8).replace(/0+$/u, '').replace(/\.$/u, '') || '0';
}

function exportError(code, message) {
  return Object.assign(new Error(message), { code, stage: 'timeline_export' });
}
