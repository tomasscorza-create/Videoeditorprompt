import type { WordMatchCutEvaluation } from './video-template-evaluator.js';

export declare const GENERATED_PAGE_WIDTH: number;
export declare const GENERATED_PAGE_HEIGHT: number;
export declare const WORD_BASELINE_OFFSET: number;
export declare const PROCEDURAL_PAGE_LAYOUTS: readonly [
  'classic',
  'novel',
  'columns',
  'editorial',
  'typewriter',
  'poetry',
  'encyclopedia',
  'essay',
  'manuscript',
  'ledger',
  'newspaper',
  'dictionary',
];

export type ProceduralPageLayout = typeof PROCEDURAL_PAGE_LAYOUTS[number];

export interface ProceduralPageStyle {
  layout: ProceduralPageLayout;
  seed: number;
  fontFamily: string;
  fontStyle: 'normal' | 'italic';
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  paperColor: string;
  inkColor: string;
  highlightColor: string;
  age: number;
  bleed: number;
  leftPhrase: string;
  rightPhrase: string;
}

export interface PageInkProfile {
  fontFamily: string;
  fontStyle: 'normal' | 'italic';
  fontWeight: number;
  fontSize: number;
  wordX: number;
  baselineY: number;
  maxWordWidth: number;
  inkColor: string;
  underlineColor: string;
  inkOpacity: number;
  blur: number;
  rotationDegrees: number;
  exposure: number;
  seed: number;
}

export interface PreparedPage {
  canvas: HTMLCanvasElement;
  source: PageInkProfile;
  wordWidth: number;
  fontSize: number;
}

export interface PageBase {
  canvas: HTMLCanvasElement;
  profile: PageInkProfile;
  columnWidth: number;
  leftPhrase: string;
  rightPhrase: string;
  lemma: boolean;
}

export function renderPageBase(style: ProceduralPageStyle, pageIndex: number): PageBase;
export function paintWord(page: PageBase, word: string): PreparedPage;
export function drawMatchCutFrame(
  canvas: HTMLCanvasElement,
  page: PreparedPage,
  frame: WordMatchCutEvaluation,
): void;
export function seededRandom(seed: number): () => number;
export function fontDeclaration(
  source: { fontFamily: string; fontStyle: string; fontWeight: number },
  size: number,
): string;
