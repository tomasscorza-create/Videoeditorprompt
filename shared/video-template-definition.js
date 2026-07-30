// Contrato cerrado de una definición de plantilla.
//
// Vive en `shared/` por la misma razón que el pintor: lo necesitan el editor del
// navegador, que carga la definición por fetch, y el validador del proyecto, que
// la lee del disco antes de compilar. Una sola implementación evita que la UI
// acepte una definición que el render después rechaza.
//
// JavaScript de navegador puro: sin dependencias de Node.

import { PROCEDURAL_PAGE_LAYOUTS } from './video-template-page.js';

export const TEMPLATE_WORD_MAX_LENGTH = 24;

/**
 * @param {unknown} value
 * @param {string} [expectedId]
 */
export function parseVideoTemplateDefinition(value, expectedId) {
  if (!isRecord(value) || value.version !== 2
    || value.kind !== 'procedural-word-match-cut'
    || !isNonEmptyString(value.id) || (expectedId !== undefined && value.id !== expectedId)
    || !isNonEmptyString(value.label) || !isFiniteInRange(value.durationSeconds, 0.5, 30)
    || !Number.isInteger(value.fps) || !isFiniteInRange(value.fps, 12, 60)
    || !Number.isInteger(value.cutFrames) || !isFiniteInRange(value.cutFrames, 2, 30)
    || !Array.isArray(value.sequence) || value.sequence.length < 4 || value.sequence.length > 240
    || !isRecord(value.defaultValues) || !isNonEmptyString(value.defaultValues.word)
    || !Array.isArray(value.fields) || value.fields.length !== 1) {
    throw new Error('La definición de la plantilla no tiene un formato compatible.');
  }
  const field = parseTextField(value.fields[0]);
  if (field.id !== 'word' || value.defaultValues.word.length > field.maxLength) {
    throw new Error('La palabra de la plantilla es inválida.');
  }
  const itemCount = Array.isArray(value.pageStyles) ? value.pageStyles.length : 0;
  if (itemCount < 4 || itemCount > 40
    || !value.sequence.every((index) => Number.isInteger(index) && index >= 0 && index < itemCount)) {
    throw new Error('La palabra o la secuencia de la plantilla es inválida.');
  }
  const expectedDuration = value.sequence.length * value.cutFrames / value.fps;
  if (Math.abs(value.durationSeconds - expectedDuration) > 1 / value.fps) {
    throw new Error('La duración de la plantilla no coincide con su secuencia.');
  }
  return {
    version: 2,
    id: value.id,
    label: value.label,
    kind: 'procedural-word-match-cut',
    durationSeconds: value.durationSeconds,
    fps: value.fps,
    cutFrames: value.cutFrames,
    sequence: [...value.sequence],
    defaultValues: { word: value.defaultValues.word },
    fields: [field],
    pageStyles: value.pageStyles.map(parseProceduralPageStyle),
  };
}

function parseProceduralPageStyle(value) {
  if (!isRecord(value)
    || !PROCEDURAL_PAGE_LAYOUTS.includes(String(value.layout))
    || !Number.isInteger(value.seed) || !isFiniteInRange(value.seed, 1, 2147483647)
    || !isNonEmptyString(value.fontFamily) || !['normal', 'italic'].includes(String(value.fontStyle))
    || !Number.isInteger(value.fontWeight) || !isFiniteInRange(value.fontWeight, 300, 900)
    || !isFiniteInRange(value.fontSize, 20, 90) || !isFiniteInRange(value.lineHeight, 1.05, 2)
    || !isHexColor(value.paperColor) || !isHexColor(value.inkColor) || !isHexColor(value.highlightColor)
    || !isFiniteInRange(value.age, 0, 1) || !isFiniteInRange(value.bleed, 0, 1)
    || !isNonEmptyString(value.leftPhrase) || !isNonEmptyString(value.rightPhrase)
    || value.leftPhrase.length > 80 || value.rightPhrase.length > 80) {
    throw new Error('Un estilo procedural de página es inválido.');
  }
  return {
    layout: value.layout,
    seed: value.seed,
    fontFamily: value.fontFamily,
    fontStyle: value.fontStyle,
    fontWeight: value.fontWeight,
    fontSize: value.fontSize,
    lineHeight: value.lineHeight,
    paperColor: value.paperColor,
    inkColor: value.inkColor,
    highlightColor: value.highlightColor,
    age: value.age,
    bleed: value.bleed,
    leftPhrase: value.leftPhrase,
    rightPhrase: value.rightPhrase,
  };
}

function parseTextField(value) {
  if (!isRecord(value) || value.type !== 'text' || !isNonEmptyString(value.id)
    || !isNonEmptyString(value.label) || !isNonEmptyString(value.placeholder)
    || !Number.isInteger(value.minLength) || !isFiniteInRange(value.minLength, 1, TEMPLATE_WORD_MAX_LENGTH)
    || !Number.isInteger(value.maxLength) || !isFiniteInRange(value.maxLength, value.minLength, 80)) {
    throw new Error('Un campo editable de la plantilla es inválido.');
  }
  return {
    id: value.id,
    type: 'text',
    label: value.label,
    placeholder: value.placeholder,
    minLength: value.minLength,
    maxLength: value.maxLength,
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteInRange(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value);
}
