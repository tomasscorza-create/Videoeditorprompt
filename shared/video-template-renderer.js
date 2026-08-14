import { drawMotionCardFrame } from './video-template-card.js';
import { drawMatchCutFrame, paintWord, renderPageBase } from './video-template-page.js';
import { evaluateMotionCard, evaluateWordMatchCut } from './video-template-evaluator.js';

export function prepareVideoTemplate(definition, word) {
  if (definition.kind === 'procedural-word-match-cut') {
    return {
      kind: definition.kind,
      definition,
      word,
      pages: definition.pageStyles.map((style, index) => paintWord(renderPageBase(style, index), word)),
    };
  }
  return { kind: definition.kind, definition, word };
}

export function drawVideoTemplateFrame(canvas, prepared, seconds) {
  if (prepared.kind === 'procedural-word-match-cut') {
    const frame = evaluateWordMatchCut(prepared.definition, seconds);
    drawMatchCutFrame(canvas, prepared.pages[frame.sourceIndex], frame);
    return frame;
  }
  const frame = evaluateMotionCard(prepared.definition, seconds);
  drawMotionCardFrame(canvas, prepared.definition, prepared.word, frame);
  return frame;
}
