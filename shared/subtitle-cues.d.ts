export interface SubtitleCue {
  text: string;
  wordCount: number;
  startSeconds: number;
  endSeconds: number;
  subtitlePath?: string;
}

export function segmentSubtitleText(text: string): string[];
export function buildSubtitleCues(text: string, durationSeconds: number): SubtitleCue[];
export function subtitleCueAt<T extends Pick<SubtitleCue, 'startSeconds' | 'endSeconds'>>(
  cues: readonly T[],
  timeSeconds: number,
): T | null;
