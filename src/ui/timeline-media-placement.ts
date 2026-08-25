import type {
  TimelineClipCommandV2,
  TimelineDocumentV2,
} from '../../shared/timeline-clip-core.js';

const FRAME_TICKS = 1_600;

export interface TimelineMediaDescriptor {
  id: string;
  contentHash: string;
  kind: 'video' | 'audio';
  name: string;
  durationTicks: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface TimelineMediaInsertionPlan {
  commands: TimelineClipCommandV2[];
  clipIds: string[];
  startTick: number;
  endTick: number;
}

/**
 * Convierte medios ya medidos en un lote único del núcleo de clips.
 *
 * La biblioteca conserva una fuente por hash, mientras cada importación crea
 * instancias nuevas. Un video con audio produce dos clips enlazados y todos los
 * archivos de un mismo drop se agregan de forma consecutiva.
 */
export function planTimelineMediaInsertion(
  document: TimelineDocumentV2,
  entries: readonly TimelineMediaDescriptor[],
  options: { startTick?: number } = {},
): TimelineMediaInsertionPlan {
  if (entries.length === 0) {
    return { commands: [], clipIds: [], startTick: timelineEnd(document), endTick: timelineEnd(document) };
  }
  const visualTrack = document.tracks.find((track) => track.id === 'video-track-01')
    ?? document.tracks.find((track) => track.kind === 'visual');
  const audioTrack = document.tracks.find((track) => track.id === 'audio-track-01')
    ?? document.tracks.find((track) => track.kind === 'audio');
  if (entries.some((entry) => entry.hasVideo) && !visualTrack) {
    throw new Error('La timeline no tiene una pista de video disponible.');
  }
  if (entries.some((entry) => entry.hasAudio) && !audioTrack) {
    throw new Error('La timeline no tiene una pista de audio disponible.');
  }

  const commands: TimelineClipCommandV2[] = [];
  const clipIds: string[] = [];
  const knownSources = new Map(document.sources.map((source) => [source.id, source]));
  const usedIds = new Set([
    ...document.clips.map((clip) => clip.id),
    ...document.clips.map((clip) => clip.linkGroupId).filter((value): value is string => Boolean(value)),
  ]);
  const initialStart = Math.max(timelineEnd(document), Math.round(options.startTick ?? 0));
  let cursor = initialStart;

  for (const entry of entries) {
    if (!Number.isInteger(entry.durationTicks) || entry.durationTicks < 1) {
      throw new Error(`«${entry.name}» no tiene una duración válida.`);
    }
    const existing = knownSources.get(entry.id);
    if (existing && existing.contentHash !== entry.contentHash) {
      throw new Error(`«${entry.name}» no coincide con la fuente ya registrada.`);
    }
    if (!existing) {
      const source = {
        id: entry.id,
        kind: entry.kind,
        durationTicks: entry.durationTicks,
        contentHash: entry.contentHash,
      } as const;
      commands.push({ type: 'add-source', source });
      knownSources.set(entry.id, source);
    }

    const durationTicks = entry.hasVideo
      ? Math.max(FRAME_TICKS, Math.floor(entry.durationTicks / FRAME_TICKS) * FRAME_TICKS)
      : entry.durationTicks;
    const stem = safeStem(entry.name);
    const linkGroupId = entry.hasVideo && entry.hasAudio ? nextId(`link-${stem}`, usedIds) : undefined;
    if (linkGroupId) usedIds.add(linkGroupId);
    if (entry.hasVideo) {
      const id = nextId(`video-${stem}`, usedIds);
      usedIds.add(id);
      clipIds.push(id);
      commands.push({
        type: 'add-clip',
        clip: {
          id,
          kind: 'visual',
          sourceId: entry.id,
          trackId: visualTrack!.id,
          timelineStartTick: cursor,
          sourceInTick: 0,
          durationTicks,
          enabled: true,
          ...(linkGroupId ? { linkGroupId } : {}),
        },
      });
    }
    if (entry.hasAudio) {
      const id = nextId(`audio-${stem}`, usedIds);
      usedIds.add(id);
      clipIds.push(id);
      commands.push({
        type: 'add-clip',
        clip: {
          id,
          kind: 'audio',
          sourceId: entry.id,
          trackId: audioTrack!.id,
          timelineStartTick: cursor,
          sourceInTick: 0,
          durationTicks,
          enabled: true,
          ...(linkGroupId ? { linkGroupId } : {}),
        },
      });
    }
    cursor += durationTicks;
  }
  return { commands, clipIds, startTick: initialStart, endTick: cursor };
}

function timelineEnd(document: TimelineDocumentV2): number {
  return document.clips.reduce(
    (maximum, clip) => Math.max(maximum, clip.timelineStartTick + clip.durationTicks),
    0,
  );
}

function safeStem(name: string): string {
  return String(name || 'medio')
    .replace(/\.[^.]+$/u, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 38) || 'medio';
}

function nextId(prefix: string, used: ReadonlySet<string>): string {
  const clean = prefix.replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+/u, '').slice(0, 52) || 'clip';
  for (let counter = 1; counter < 100_000; counter += 1) {
    const candidate = `${clean}-${counter}`.slice(0, 64);
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('No se pudo crear un identificador multimedia.');
}
