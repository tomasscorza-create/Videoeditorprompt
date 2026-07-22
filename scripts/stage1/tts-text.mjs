export function normalizeSpanishTtsText(value) {
  let text = String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim();

  text = text
    .replace(/\s*%/gu, ' por ciento')
    .replace(/\s*&\s*/gu, ' y ')
    .replace(/([,;:.!?])(?=[\p{L}\p{N}])/gu, '$1 ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (text && !/[.!?…]$/u.test(text)) text += '.';
  return text;
}
