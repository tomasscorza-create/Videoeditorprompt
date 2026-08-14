// Pintor procedural de tarjetas animadas. Lo consumen navegador y compositor
// headless para que preview y MP4 compartan exactamente la misma geometría.

import { seededRandom } from './video-template-page.js';

const LOGICAL_WIDTH = 1080;
const LOGICAL_HEIGHT = 1920;
const FONT = 'Arial, "Liberation Sans", "DejaVu Sans", sans-serif';

export function drawMotionCardFrame(canvas, definition, word, frame) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const scale = Math.min(canvas.width / LOGICAL_WIDTH, canvas.height / LOGICAL_HEIGHT);
  const offsetX = (canvas.width - LOGICAL_WIDTH * scale) / 2;
  const offsetY = (canvas.height - LOGICAL_HEIGHT * scale) / 2;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(offsetX, offsetY);
  context.scale(scale, scale);
  drawBackdrop(context, definition);
  context.globalAlpha = frame.opacity;
  context.translate(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + frame.offsetY);
  context.scale(frame.scale, frame.scale);
  context.translate(-LOGICAL_WIDTH / 2, -LOGICAL_HEIGHT / 2);
  if (definition.layout === 'title') drawTitle(context, definition, word, frame);
  else if (definition.layout === 'list') drawList(context, definition, word, frame);
  else if (definition.layout === 'comparison') drawComparison(context, definition, word, frame);
  else drawCta(context, definition, word, frame);
  context.restore();
}

function drawBackdrop(context, definition) {
  const { palette } = definition;
  context.fillStyle = palette.background;
  context.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  const random = seededRandom(definition.seed);
  context.save();
  for (let index = 0; index < 7; index += 1) {
    const x = random() * LOGICAL_WIDTH;
    const y = random() * LOGICAL_HEIGHT;
    const radius = 90 + random() * 270;
    context.globalAlpha = 0.05 + random() * 0.08;
    context.fillStyle = index % 2 ? palette.primary : palette.secondary;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawTitle(context, definition, word, frame) {
  const { palette, labels } = definition;
  panel(context, 92, 430, 896, 840, 64, palette.surface);
  pill(context, 165, 520, 370, 74, palette.secondary, labels[0]);
  heading(context, word, 165, 690, 750, 150, palette.text, 'left');
  context.fillStyle = palette.muted;
  context.fillRect(165, 965, 560 * frame.accentProgress, 18);
  context.fillStyle = palette.primary;
  context.fillRect(165, 1010, 320 * frame.accentProgress, 18);
  context.strokeStyle = palette.primary;
  context.lineWidth = 18;
  context.beginPath();
  context.arc(820, 1090, 72 + frame.pulse * 14, 0, Math.PI * 2 * frame.accentProgress);
  context.stroke();
}

function drawList(context, definition, word, frame) {
  const { palette, labels } = definition;
  smallLabel(context, 'GUÍA RÁPIDA', 110, 340, palette.primary, 46, 'left');
  heading(context, word, 110, 430, 820, 102, palette.text, 'left');
  for (let index = 0; index < 3; index += 1) {
    const progress = frame.itemProgress[index];
    const y = 670 + index * 270;
    context.save();
    context.globalAlpha *= progress;
    context.translate((1 - progress) * 120, 0);
    panel(context, 105, y, 870, 205, 38, palette.surface);
    context.fillStyle = index === 1 ? palette.secondary : palette.primary;
    context.beginPath();
    context.arc(205, y + 102, 48, 0, Math.PI * 2);
    context.fill();
    smallLabel(context, String(index + 1).padStart(2, '0'), 205, y + 118, palette.background, 34, 'center');
    smallLabel(context, labels[index] ?? labels.at(-1), 295, y + 92, palette.text, 42, 'left');
    context.fillStyle = palette.muted;
    roundRect(context, 295, y + 125, 470 * progress, 18, 9);
    context.fill();
    context.restore();
  }
}

function drawComparison(context, definition, word, frame) {
  const { palette, labels } = definition;
  smallLabel(context, labels[2] ?? 'COMPARACIÓN', 540, 315, palette.secondary, 44, 'center');
  heading(context, word, 120, 400, 840, 100, palette.text, 'center');
  const leftWidth = 790 * frame.comparisonBalance;
  const rightWidth = 790 - leftWidth;
  panel(context, 105, 665, 405, 690, 48, palette.surface);
  panel(context, 570, 665, 405, 690, 48, palette.surface);
  smallLabel(context, labels[0], 307, 790, palette.primary, 46, 'center');
  smallLabel(context, labels[1] ?? labels[0], 772, 790, palette.secondary, 46, 'center');
  metric(context, 307, 1015, Math.round(frame.comparisonBalance * 100), palette.primary, frame.accentProgress);
  metric(context, 772, 1015, Math.round((1 - frame.comparisonBalance) * 100), palette.secondary, frame.accentProgress);
  context.fillStyle = palette.muted;
  roundRect(context, 145, 1435, 790, 30, 15);
  context.fill();
  context.fillStyle = palette.primary;
  roundRect(context, 145, 1435, leftWidth * frame.accentProgress, 30, 15);
  context.fill();
  context.fillStyle = palette.secondary;
  roundRect(context, 145 + leftWidth, 1435, rightWidth * frame.accentProgress, 30, 15);
  context.fill();
}

function drawCta(context, definition, word, frame) {
  const { palette, labels } = definition;
  const radius = 245 + frame.pulse * 26;
  context.save();
  context.globalAlpha *= 0.18;
  context.strokeStyle = palette.primary;
  context.lineWidth = 22;
  for (let index = 0; index < 3; index += 1) {
    context.beginPath();
    context.arc(540, 790, radius + index * 105, 0, Math.PI * 2 * frame.accentProgress);
    context.stroke();
  }
  context.restore();
  smallLabel(context, labels[0], 540, 450, palette.secondary, 42, 'center');
  panel(context, 135, 660, 810, 300, 150, palette.primary);
  heading(context, word, 200, 742, 680, 100, palette.background, 'center');
  context.fillStyle = palette.background;
  context.beginPath();
  context.moveTo(770, 865);
  context.lineTo(832, 895);
  context.lineTo(770, 925);
  context.closePath();
  context.fill();
  smallLabel(context, labels[1] ?? 'TOCÁ PARA CONTINUAR', 540, 1125, palette.text, 38, 'center');
  context.fillStyle = palette.muted;
  roundRect(context, 250, 1190, 580, 18, 9);
  context.fill();
  context.fillStyle = palette.secondary;
  roundRect(context, 250, 1190, 580 * frame.accentProgress, 18, 9);
  context.fill();
}

function panel(context, x, y, width, height, radius, color) {
  context.fillStyle = color;
  roundRect(context, x, y, width, height, radius);
  context.fill();
}

function pill(context, x, y, width, height, color, text) {
  panel(context, x, y, width, height, height / 2, color);
  smallLabel(context, text, x + width / 2, y + height * 0.68, '#ffffff', 30, 'center');
}

function heading(context, text, x, y, width, size, color, align) {
  context.fillStyle = color;
  context.font = `800 ${fitFont(context, text, width, size)}px ${FONT}`;
  context.textAlign = align;
  context.textBaseline = 'top';
  context.fillText(text, align === 'center' ? x + width / 2 : x, y, width);
}

function smallLabel(context, text, x, y, color, size, align) {
  context.fillStyle = color;
  context.font = `700 ${size}px ${FONT}`;
  context.textAlign = align;
  context.textBaseline = 'alphabetic';
  context.fillText(String(text).toUpperCase(), x, y);
}

function metric(context, x, y, value, color, progress) {
  context.save();
  context.globalAlpha *= 0.35 + progress * 0.65;
  context.fillStyle = color;
  context.font = `800 118px ${FONT}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`${Math.round(value)}%`, x, y);
  context.restore();
}

function fitFont(context, text, width, maximum) {
  let size = maximum;
  while (size > 42) {
    context.font = `800 ${size}px ${FONT}`;
    if (context.measureText(text).width <= width) break;
    size -= 4;
  }
  return size;
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}
