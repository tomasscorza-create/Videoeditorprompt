export type TimelineSourceKind = 'visual' | 'dialogue-audio' | 'audio' | 'video';
export type TimelineTrackKind = 'visual' | 'audio';
export type TimelineClipKind = TimelineTrackKind;
export type TimelineInterpolation = 'linear' | 'ease' | 'hold';

export interface TimelineTimebaseV2 {
  ticksPerSecond: 48000;
  fps: 30;
  audioSampleRate: 48000;
}

export interface TimelineSourceV2 {
  id: string;
  kind: TimelineSourceKind;
  durationTicks: number;
  contentHash: string;
}

export interface TimelineTrackV2 {
  id: string;
  kind: TimelineTrackKind;
  order: number;
}

export interface TimelineKeyframeV2 {
  id: string;
  sourceTick: number;
  value: number;
  interpolation: TimelineInterpolation;
}

export interface TimelineAutomationTrackV2 {
  parameterId: string;
  keyframes: TimelineKeyframeV2[];
}

export interface TimelineClipV2 {
  id: string;
  kind: TimelineClipKind;
  sourceId: string;
  trackId: string;
  timelineStartTick: number;
  sourceInTick: number;
  durationTicks: number;
  enabled: boolean;
  linkGroupId?: string;
  automation?: TimelineAutomationTrackV2[];
}

export interface TimelineDocumentV2 {
  version: 2;
  id: string;
  timebase: TimelineTimebaseV2;
  sources: TimelineSourceV2[];
  tracks: TimelineTrackV2[];
  clips: TimelineClipV2[];
}

export type TimelineClipCommandV2 =
  | { type: 'split-clip'; clipId: string; atTimelineTick: number; newClipId: string }
  | { type: 'trim-clip'; clipId: string; edge: 'start' | 'end'; toTimelineTick: number }
  | { type: 'move-clip'; clipId: string; trackId: string; timelineStartTick: number }
  | { type: 'duplicate-clip'; clipId: string; newClipId: string; trackId: string; timelineStartTick: number }
  | { type: 'delete-clip'; clipId: string };

export interface TimelineClipEditorState {
  version: 1;
  document: TimelineDocumentV2;
  revision: number;
  historyLimit: number;
  past: TimelineDocumentV2[];
  future: TimelineDocumentV2[];
}

export class TimelineClipError extends Error {
  code: string;
  path: string;
}

export const TIMELINE_V2_TIMEBASE: Readonly<TimelineTimebaseV2 & { frameTicks: 1600 }>;
export const TIMELINE_CLIP_LIMITS: Readonly<Record<string, number>>;
export const TIMELINE_CLIP_ERROR_CATALOG: Readonly<Record<string, string>>;

export function createTimelineClipEditor(document: TimelineDocumentV2, options?: { historyLimit?: number }): TimelineClipEditorState;
export function applyTimelineClipCommand(state: TimelineClipEditorState, command: TimelineClipCommandV2): TimelineClipEditorState;
export function applyTimelineClipCommandBatch(state: TimelineClipEditorState, commands: TimelineClipCommandV2[]): TimelineClipEditorState;
export function undoTimelineClip(state: TimelineClipEditorState): TimelineClipEditorState;
export function redoTimelineClip(state: TimelineClipEditorState): TimelineClipEditorState;
export function exportTimelineDocument(stateOrDocument: TimelineClipEditorState | TimelineDocumentV2): string;
export function validateTimelineDocument(document: TimelineDocumentV2): true;
export function timelineFrameTicks(document: TimelineDocumentV2): number;
