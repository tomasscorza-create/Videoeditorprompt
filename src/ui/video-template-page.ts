// Composición de una página impresa generativa: papel, tinta, tipografía y desgaste.
//
// Separado de `video-template-editor.ts` cuando el dibujo dejó de ser un detalle
// del panel: el editor gobierna reloj, campos y cámara; este módulo solo pinta
// una página y no conoce el DOM del panel.
//
// Todo es determinista: cada página deriva de `style.seed`, así que la misma
// definición produce siempre el mismo papel, el mismo texto y el mismo desgaste.

import type { ProceduralPageLayout, ProceduralPageStyle } from './project/video-template-catalog.js';
import type { WordMatchCutEvaluation } from '../../shared/video-template-evaluator.js';

export const GENERATED_PAGE_WIDTH = 900;
export const GENERATED_PAGE_HEIGHT = 1180;

/** Desplazamiento entre la línea base tipográfica y el centro óptico de la palabra. */
export const WORD_BASELINE_OFFSET = -5;

const CONTENT_TOP = 214;
const CONTENT_BOTTOM = 1074;
const TARGET_BASELINE = Math.round(GENERATED_PAGE_HEIGHT * 0.5);

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

/**
 * Página sin la palabra: papel, cuerpo de texto y desgaste ya resueltos.
 * Es independiente del texto que escribe el usuario, así que se calcula una vez
 * por estilo y se reutiliza en cada tecla.
 */
export interface PageBase {
  canvas: HTMLCanvasElement;
  profile: PageInkProfile;
  columnWidth: number;
  leftPhrase: string;
  rightPhrase: string;
  lemma: boolean;
}

interface LayoutSpec {
  columns: 1 | 2 | 3;
  marginX: number;
  justify: boolean;
  indentParagraphs: boolean;
  centerLines: boolean;
  ruled: boolean;
  dropCap: boolean;
  header: 'none' | 'centered' | 'small-caps' | 'rule' | 'headline' | 'lemma';
  lemmas: boolean;
}

const LAYOUT_SPECS: Record<ProceduralPageLayout, LayoutSpec> = {
  classic: base({ marginX: 98, header: 'centered' }),
  novel: base({ marginX: 106, header: 'centered' }),
  columns: base({ columns: 2, marginX: 62, header: 'small-caps' }),
  editorial: base({ marginX: 88, header: 'rule', dropCap: true }),
  typewriter: base({ marginX: 112, justify: false, header: 'none' }),
  poetry: base({ marginX: 118, justify: false, centerLines: true, indentParagraphs: false, header: 'centered' }),
  encyclopedia: base({ columns: 2, marginX: 58, header: 'small-caps' }),
  essay: base({ marginX: 96, header: 'centered' }),
  manuscript: base({ marginX: 132, justify: false, dropCap: true, header: 'none' }),
  ledger: base({ marginX: 78, justify: false, indentParagraphs: false, ruled: true, header: 'rule' }),
  newspaper: base({ columns: 3, marginX: 50, header: 'headline' }),
  dictionary: base({ columns: 2, marginX: 56, header: 'lemma', lemmas: true }),
};

function base(overrides: Partial<LayoutSpec>): LayoutSpec {
  return {
    columns: 1,
    marginX: 96,
    justify: true,
    indentParagraphs: true,
    centerLines: false,
    ruled: false,
    dropCap: false,
    header: 'centered',
    lemmas: false,
    ...overrides,
  };
}

const RUNNING_HEADS = [
  'El peso de las palabras',
  'Notas sobre el tiempo',
  'Historias de una idea',
  'Capítulo de los cambios',
  'La forma de recordar',
  'Ensayo sobre la mirada',
  'Pequeñas revelaciones',
  'El lenguaje del mundo',
  'Memoria de lo escrito',
  'Registro de los días',
  'Crónica de la semana',
  'Repertorio de voces',
];

const VOCABULARY = [
  'la', 'el', 'una', 'un', 'los', 'las', 'de', 'del', 'que', 'en', 'por', 'para', 'con', 'sin',
  'sobre', 'entre', 'cuando', 'aunque', 'porque', 'mientras', 'donde', 'siempre', 'nunca',
  'memoria', 'tiempo', 'página', 'historia', 'palabra', 'silencio', 'camino', 'mirada', 'gesto',
  'origen', 'sentido', 'forma', 'materia', 'costumbre', 'distancia', 'pregunta', 'respuesta',
  'lector', 'autor', 'relato', 'párrafo', 'renglón', 'tinta', 'papel', 'margen', 'volumen',
  'noche', 'mañana', 'invierno', 'verano', 'ciudad', 'campo', 'ventana', 'puerta', 'umbral',
  'antigua', 'nueva', 'lenta', 'breve', 'extensa', 'precisa', 'incierta', 'evidente', 'callada',
  'permanece', 'aparece', 'regresa', 'comienza', 'termina', 'recuerda', 'olvida', 'transforma',
  'conserva', 'anuncia', 'describe', 'sostiene', 'atraviesa', 'ilumina', 'revela', 'confirma',
  'quien', 'todo', 'nada', 'algo', 'cada', 'otra', 'misma', 'propia', 'ajena', 'común',
  'después', 'antes', 'apenas', 'todavía', 'quizá', 'acaso', 'también', 'incluso', 'además',
];

interface Token {
  text: string;
  endsParagraph: boolean;
}

/** Cursor sobre un flujo de palabras: reparte líneas del ancho que le pidan. */
class TokenCursor {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  takeLine(
    measure: (text: string) => number,
    width: number,
    indent: number,
  ): { words: string[]; endsParagraph: boolean } {
    const words: string[] = [];
    const spaceWidth = measure(' ');
    let usedWidth = indent;
    let endsParagraph = false;
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      const tokenWidth = measure(token.text);
      const candidate = words.length === 0 ? indent + tokenWidth : usedWidth + spaceWidth + tokenWidth;
      if (words.length > 0 && candidate > width) break;
      words.push(token.text);
      usedWidth = candidate;
      this.index += 1;
      if (token.endsParagraph) {
        endsParagraph = true;
        break;
      }
    }
    if (this.index >= this.tokens.length) endsParagraph = true;
    return { words, endsParagraph };
  }
}

export function renderPageBase(style: ProceduralPageStyle, pageIndex: number): PageBase {
  const canvas = document.createElement('canvas');
  canvas.width = GENERATED_PAGE_WIDTH;
  canvas.height = GENERATED_PAGE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo construir una de las páginas.');

  const spec = LAYOUT_SPECS[style.layout];
  const gutterOnLeft = (style.seed & 1) === 0;
  const columnGap = spec.columns === 3 ? 34 : 42;
  const contentWidth = GENERATED_PAGE_WIDTH - spec.marginX * 2;
  const columnWidth = (contentWidth - columnGap * (spec.columns - 1)) / spec.columns;
  const wordColumn = spec.columns === 1 ? 0 : (style.seed >> 3) % spec.columns;
  const columnLeft = spec.marginX + wordColumn * (columnWidth + columnGap);
  const columnCenterX = columnLeft + columnWidth / 2;
  const lineStep = style.fontSize * style.lineHeight;
  const wordBaseline = snapToGrid(TARGET_BASELINE, lineStep);

  drawPaper(context, style, gutterOnLeft);
  drawBleedThrough(context, style, spec);
  drawHeader(context, style, spec, pageIndex);
  drawBody(context, style, spec, {
    columnGap,
    columnWidth,
    lineStep,
    wordColumn,
    wordBaseline,
  });
  drawFolio(context, style, pageIndex);
  drawWear(context, style, gutterOnLeft);

  return {
    canvas,
    columnWidth,
    leftPhrase: style.leftPhrase,
    rightPhrase: style.rightPhrase,
    lemma: spec.lemmas,
    profile: {
      fontFamily: style.fontFamily,
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      fontSize: style.fontSize,
      wordX: columnCenterX,
      baselineY: wordBaseline - WORD_BASELINE_OFFSET,
      maxWordWidth: Math.min(320, columnWidth * 0.66),
      inkColor: style.inkColor,
      underlineColor: style.highlightColor,
      inkOpacity: 0.82 + style.age * 0.08,
      blur: 0.12 + style.age * 0.2,
      rotationDegrees: ((style.seed % 7) - 3) * 0.035,
      exposure: 0.98 + (pageIndex % 3) * 0.012,
      seed: style.seed,
    },
  };
}

/** Copia la página base y compone la línea que contiene la palabra editable. */
export function paintWord(page: PageBase, word: string): PreparedPage {
  const canvas = document.createElement('canvas');
  canvas.width = GENERATED_PAGE_WIDTH;
  canvas.height = GENERATED_PAGE_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo componer la palabra en la página.');
  context.drawImage(page.canvas, 0, 0);

  const profile = page.profile;
  const baseline = profile.baselineY + WORD_BASELINE_OFFSET;
  const measure = createMeasurer(context);

  let fontSize = profile.fontSize;
  context.font = fontDeclaration(profile, fontSize);
  let wordWidth = measure(word);
  if (wordWidth > profile.maxWordWidth) {
    fontSize *= profile.maxWordWidth / wordWidth;
    context.font = fontDeclaration(profile, fontSize);
    wordWidth = measure(word);
  }

  context.save();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = profile.inkColor;
  context.textBaseline = 'alphabetic';

  const half = page.columnWidth / 2;
  const gap = fontSize * 0.3;
  const room = Math.max(0, half - wordWidth / 2 - gap);
  const left = fitPhrase(measure, page.leftPhrase, room, 'start');
  const right = fitPhrase(measure, page.rightPhrase, room, 'end');
  const wordLeft = profile.wordX - wordWidth / 2;
  const wordRight = profile.wordX + wordWidth / 2;

  context.globalAlpha = profile.inkOpacity * 0.94;
  if (page.lemma) {
    // En un diccionario la palabra encabeza su propia entrada, no una oración.
    context.font = fontDeclaration({ ...profile, fontWeight: 400 }, fontSize * 0.82);
    context.textAlign = 'left';
    context.fillText(right, wordRight + gap, baseline, room);
  } else {
    context.font = fontDeclaration(profile, fontSize);
    context.textAlign = 'right';
    context.fillText(left, wordLeft - gap, baseline);
    context.textAlign = 'left';
    context.fillText(right, wordRight + gap, baseline);
  }

  context.font = fontDeclaration({ ...profile, fontWeight: page.lemma ? 700 : profile.fontWeight }, fontSize);
  context.textAlign = 'center';
  context.globalAlpha = profile.inkOpacity;
  context.filter = `blur(${profile.blur}px)`;
  context.shadowColor = profile.inkColor;
  context.shadowBlur = Math.max(0.15, profile.blur * 0.8);
  context.fillText(word, profile.wordX, baseline);

  // Una segunda pasada mínima rompe el borde digital perfecto y lo acerca a tinta impresa.
  context.filter = 'none';
  context.shadowBlur = 0;
  context.globalAlpha = profile.inkOpacity * 0.13;
  context.fillText(word, profile.wordX + 0.26, baseline + 0.18);
  context.restore();

  applyPrintedGrain(context, profile, wordWidth, fontSize);
  return { canvas, source: profile, wordWidth, fontSize };
}

function drawPaper(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  gutterOnLeft: boolean,
): void {
  context.fillStyle = style.paperColor;
  context.fillRect(0, 0, GENERATED_PAGE_WIDTH, GENERATED_PAGE_HEIGHT);

  // Luz suave: el papel nunca es plano, recibe la iluminación desde arriba.
  const light = context.createLinearGradient(0, 0, GENERATED_PAGE_WIDTH * 0.35, GENERATED_PAGE_HEIGHT);
  light.addColorStop(0, 'rgba(255,255,255,0.09)');
  light.addColorStop(0.55, 'rgba(255,255,255,0.02)');
  light.addColorStop(1, `rgba(74,50,25,${0.05 + style.age * 0.05})`);
  context.fillStyle = light;
  context.fillRect(0, 0, GENERATED_PAGE_WIDTH, GENERATED_PAGE_HEIGHT);

  const random = seededRandom(style.seed);

  // Fibras del papel.
  context.save();
  context.globalCompositeOperation = 'multiply';
  for (let index = 0; index < 460; index += 1) {
    const x = random() * GENERATED_PAGE_WIDTH;
    const y = random() * GENERATED_PAGE_HEIGHT;
    const length = 3 + random() * 38;
    context.strokeStyle = random() > 0.42
      ? `rgba(112,82,44,${0.016 + style.age * 0.024})`
      : 'rgba(255,255,255,0.032)';
    context.lineWidth = 0.25 + random() * 0.55;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + (random() - 0.5) * 1.8);
    context.stroke();
  }
  // Manchas de humedad y foxing.
  for (let index = 0; index < 38; index += 1) {
    const x = random() * GENERATED_PAGE_WIDTH;
    const y = random() * GENERATED_PAGE_HEIGHT;
    const radius = 8 + random() * 62;
    const stain = context.createRadialGradient(x, y, 0, x, y, radius);
    stain.addColorStop(0, `rgba(121,82,39,${0.006 + style.age * 0.016})`);
    stain.addColorStop(1, 'rgba(121,82,39,0)');
    context.fillStyle = stain;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.restore();

  drawGutterShadow(context, style, gutterOnLeft);
  drawEdgeDarkening(context, style);
}

/** La sombra del lomo es lo que delata que la página pertenece a un libro abierto. */
function drawGutterShadow(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  gutterOnLeft: boolean,
): void {
  const width = GENERATED_PAGE_WIDTH * 0.22;
  const gradient = gutterOnLeft
    ? context.createLinearGradient(0, 0, width, 0)
    : context.createLinearGradient(GENERATED_PAGE_WIDTH, 0, GENERATED_PAGE_WIDTH - width, 0);
  gradient.addColorStop(0, `rgba(46,30,14,${0.3 + style.age * 0.16})`);
  gradient.addColorStop(0.35, `rgba(52,35,17,${0.1 + style.age * 0.06})`);
  gradient.addColorStop(1, 'rgba(58,40,20,0)');
  context.save();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = gradient;
  context.fillRect(
    gutterOnLeft ? 0 : GENERATED_PAGE_WIDTH - width,
    0,
    width,
    GENERATED_PAGE_HEIGHT,
  );
  context.restore();
}

function drawEdgeDarkening(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
): void {
  const edge = context.createRadialGradient(
    GENERATED_PAGE_WIDTH * 0.5,
    GENERATED_PAGE_HEIGHT * 0.46,
    GENERATED_PAGE_WIDTH * 0.2,
    GENERATED_PAGE_WIDTH * 0.5,
    GENERATED_PAGE_HEIGHT * 0.5,
    GENERATED_PAGE_HEIGHT * 0.74,
  );
  edge.addColorStop(0, 'rgba(255,255,255,0)');
  edge.addColorStop(0.7, `rgba(97,70,35,${0.02 + style.age * 0.02})`);
  edge.addColorStop(1, `rgba(71,48,24,${0.1 + style.age * 0.12})`);
  context.save();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = edge;
  context.fillRect(0, 0, GENERATED_PAGE_WIDTH, GENERATED_PAGE_HEIGHT);
  context.restore();
}

/** Texto del reverso visto por transparencia: espejado y muy tenue. */
function drawBleedThrough(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  spec: LayoutSpec,
): void {
  if (style.bleed <= 0) return;
  const cursor = new TokenCursor(makeTokens(style.seed ^ 0x5f3759df, 420));
  const measure = createMeasurer(context);
  context.save();
  context.translate(GENERATED_PAGE_WIDTH, 0);
  context.scale(-1, 1);
  context.globalCompositeOperation = 'multiply';
  context.globalAlpha = 0.016 + style.bleed * 0.04;
  context.fillStyle = style.inkColor;
  context.font = fontDeclaration(style, style.fontSize * 0.9);
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  const step = style.fontSize * style.lineHeight * 1.02;
  const width = GENERATED_PAGE_WIDTH - spec.marginX * 2;
  for (let y = CONTENT_TOP - 24; y < CONTENT_BOTTOM + 24; y += step) {
    const line = cursor.takeLine(measure, width, 0);
    if (line.words.length === 0) break;
    context.fillText(line.words.join(' '), spec.marginX - 12, y, width);
  }
  context.restore();
}

function drawHeader(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  spec: LayoutSpec,
  pageIndex: number,
): void {
  if (spec.header === 'none') return;
  const title = RUNNING_HEADS[pageIndex % RUNNING_HEADS.length];
  const right = GENERATED_PAGE_WIDTH - spec.marginX;
  context.save();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = style.inkColor;
  context.globalAlpha = 0.72;
  context.textBaseline = 'alphabetic';

  if (spec.header === 'headline') {
    context.font = `700 ${Math.round(style.fontSize * 2.05)}px ${fontStack(style.fontFamily)}`;
    context.textAlign = 'left';
    context.fillText(title, spec.marginX, 132, right - spec.marginX);
    context.globalAlpha = 0.5;
    context.font = `${Math.round(style.fontSize * 0.82)}px ${fontStack(style.fontFamily)}`;
    context.fillText('Edición de la mañana · Año XIV', spec.marginX, 172);
    context.globalAlpha = 0.34;
    context.fillRect(spec.marginX, 188, right - spec.marginX, 1.6);
  } else if (spec.header === 'rule') {
    context.font = `600 ${Math.round(style.fontSize * 1.5)}px ${fontStack(style.fontFamily)}`;
    context.textAlign = 'left';
    context.fillText(title, spec.marginX, 142, right - spec.marginX);
    context.globalAlpha = 0.32;
    context.fillRect(spec.marginX, 166, right - spec.marginX, 1.4);
  } else if (spec.header === 'lemma') {
    context.font = `700 ${Math.round(style.fontSize * 0.94)}px ${fontStack(style.fontFamily)}`;
    context.textAlign = 'left';
    context.fillText('memoria', spec.marginX, 142);
    context.textAlign = 'right';
    context.fillText('umbral', right, 142);
    context.globalAlpha = 0.3;
    context.fillRect(spec.marginX, 164, right - spec.marginX, 1);
  } else if (spec.header === 'small-caps') {
    context.font = `600 ${Math.round(style.fontSize * 0.74)}px ${fontStack(style.fontFamily)}`;
    context.textAlign = 'center';
    context.fillText(title.toUpperCase(), GENERATED_PAGE_WIDTH / 2, 142);
    context.globalAlpha = 0.34;
    context.fillRect(spec.marginX, 166, right - spec.marginX, 1);
  } else {
    context.font = `${style.fontStyle} 500 ${Math.round(style.fontSize * 0.9)}px ${fontStack(style.fontFamily)}`;
    context.textAlign = 'center';
    context.fillText(title, GENERATED_PAGE_WIDTH / 2, 150);
  }
  context.restore();
}

interface BodyGeometry {
  columnGap: number;
  columnWidth: number;
  lineStep: number;
  wordColumn: number;
  wordBaseline: number;
}

function drawBody(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  spec: LayoutSpec,
  geometry: BodyGeometry,
): void {
  const measure = createMeasurer(context);
  const jitter = seededRandom(style.seed ^ 0x13579bdf);
  context.save();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = style.inkColor;
  context.textBaseline = 'alphabetic';
  context.font = fontDeclaration(style, style.fontSize);

  for (let column = 0; column < spec.columns; column += 1) {
    const columnLeft = spec.marginX + column * (geometry.columnWidth + geometry.columnGap);
    const cursor = new TokenCursor(makeTokens(style.seed + column * 977, 900));
    const dropCap = spec.dropCap && column === 0;
    const dropCapWidth = dropCap ? drawDropCap(context, style, columnLeft) : 0;
    const dropCapBottom = CONTENT_TOP + geometry.lineStep * 2.1;
    let startsParagraph = true;

    if (spec.ruled) drawRules(context, style, spec, geometry, columnLeft);

    for (let y = CONTENT_TOP; y <= CONTENT_BOTTOM; y += geometry.lineStep) {
      const isWordLine = column === geometry.wordColumn && Math.abs(y - geometry.wordBaseline) < 0.5;
      if (isWordLine) {
        startsParagraph = false;
        continue;
      }
      const inDropCap = dropCap && y < dropCapBottom;
      const indent = startsParagraph && spec.indentParagraphs && !inDropCap
        ? style.fontSize * 1.25
        : 0;
      const available = geometry.columnWidth - (inDropCap ? dropCapWidth + style.fontSize * 0.24 : 0);
      const line = cursor.takeLine(measure, available, indent);
      if (line.words.length === 0) break;

      // Cada línea recibe su propia carga de tinta: una prensa nunca es uniforme.
      context.globalAlpha = (0.74 + jitter() * 0.16) * (0.86 + style.age * 0.14);
      const drift = (jitter() - 0.5) * 1.4;
      const lineLeft = columnLeft + (inDropCap ? dropCapWidth + style.fontSize * 0.24 : 0);

      if (spec.lemmas && startsParagraph) {
        drawLemmaLine(context, style, line.words, lineLeft + drift, y, available);
      } else if (spec.centerLines) {
        context.textAlign = 'center';
        context.fillText(line.words.join(' '), columnLeft + geometry.columnWidth / 2 + drift, y, available);
        context.textAlign = 'left';
      } else if (style.layout === 'typewriter') {
        drawTypewriterLine(context, style, line.words.join(' '), lineLeft + indent + drift, y, jitter);
      } else {
        drawLine(context, measure, line.words, lineLeft + drift, y, available, indent, {
          justify: spec.justify && !line.endsParagraph && line.words.length > 2,
        });
      }
      startsParagraph = line.endsParagraph;
    }
  }
  context.restore();
}

function drawLine(
  context: CanvasRenderingContext2D,
  measure: (text: string) => number,
  words: readonly string[],
  x: number,
  y: number,
  width: number,
  indent: number,
  options: { justify: boolean },
): void {
  context.textAlign = 'left';
  if (!options.justify) {
    context.fillText(words.join(' '), x + indent, y, width);
    return;
  }
  const spaceWidth = measure(' ');
  const wordsWidth = words.reduce((total, word) => total + measure(word), 0);
  const gaps = words.length - 1;
  const slack = width - indent - wordsWidth - spaceWidth * gaps;
  // Una justificación real reparte el sobrante; si sobra demasiado, la línea
  // quedaría deshilachada y conviene dejarla en bandera.
  const extra = slack > 0 && slack < spaceWidth * gaps * 1.6 ? slack / gaps : 0;
  let cursor = x + indent;
  for (const word of words) {
    context.fillText(word, cursor, y);
    cursor += measure(word) + spaceWidth + extra;
  }
}

/** La máquina de escribir golpea cada tipo por separado: altura y tinta varían. */
function drawTypewriterLine(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  text: string,
  x: number,
  y: number,
  jitter: () => number,
): void {
  context.textAlign = 'left';
  const baseAlpha = context.globalAlpha;
  let cursor = x;
  for (const character of text) {
    const width = context.measureText(character).width;
    if (character !== ' ') {
      context.globalAlpha = baseAlpha * (0.62 + jitter() * 0.52);
      context.fillText(character, cursor, y + (jitter() - 0.5) * style.fontSize * 0.045);
    }
    cursor += width;
  }
  context.globalAlpha = baseAlpha;
}

function drawLemmaLine(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  words: readonly string[],
  x: number,
  y: number,
  width: number,
): void {
  const [lemma, ...rest] = words;
  context.textAlign = 'left';
  context.font = fontDeclaration({ ...style, fontWeight: 700 }, style.fontSize);
  context.fillText(lemma, x, y);
  const lemmaWidth = context.measureText(`${lemma} `).width;
  context.font = fontDeclaration(style, style.fontSize);
  if (rest.length > 0) context.fillText(rest.join(' '), x + lemmaWidth, y, width - lemmaWidth);
}

function drawDropCap(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  columnLeft: number,
): number {
  const size = style.fontSize * 2.9;
  context.save();
  context.font = `600 ${size}px ${fontStack(style.fontFamily)}`;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.globalAlpha = 0.86;
  // La capitular rubricada es la marca del manuscrito iluminado.
  context.fillStyle = style.layout === 'manuscript' ? '#8c2b1d' : style.inkColor;
  const letter = 'A';
  context.fillText(letter, columnLeft, CONTENT_TOP + size * 0.62);
  const width = context.measureText(letter).width;
  context.restore();
  return width;
}

function drawRules(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  spec: LayoutSpec,
  geometry: BodyGeometry,
  columnLeft: number,
): void {
  context.save();
  context.globalAlpha = 0.16;
  context.fillStyle = style.inkColor;
  for (let y = CONTENT_TOP; y <= CONTENT_BOTTOM; y += geometry.lineStep) {
    context.fillRect(columnLeft, y + style.fontSize * 0.22, geometry.columnWidth, 0.9);
  }
  context.globalAlpha = 0.2;
  context.fillStyle = '#9c3b2c';
  context.fillRect(spec.marginX - 22, CONTENT_TOP - 40, 1.4, CONTENT_BOTTOM - CONTENT_TOP + 80);
  context.restore();
}

function drawFolio(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  pageIndex: number,
): void {
  context.save();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = style.inkColor;
  context.globalAlpha = 0.5;
  context.font = `${Math.max(15, style.fontSize * 0.42)}px ${fontStack(style.fontFamily)}`;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillText(
    String(40 + ((style.seed + pageIndex * 17) % 320)),
    GENERATED_PAGE_WIDTH / 2,
    GENERATED_PAGE_HEIGHT - 58,
  );
  context.restore();
}

function drawWear(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  gutterOnLeft: boolean,
): void {
  const random = seededRandom(style.seed ^ 0x2468ace);
  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = style.paperColor;
  for (let index = 0; index < 240; index += 1) {
    context.globalAlpha = 0.025 + random() * style.age * 0.075;
    const size = 0.3 + random() * 1.15;
    context.fillRect(
      random() * GENERATED_PAGE_WIDTH,
      random() * GENERATED_PAGE_HEIGHT,
      size,
      size * (0.5 + random()),
    );
  }
  // Motas oscuras: polvo y restos de tinta seca.
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = 'rgba(58,44,26,0.85)';
  for (let index = 0; index < 70; index += 1) {
    context.globalAlpha = 0.05 + random() * style.age * 0.16;
    const size = 0.35 + random() * 1.05;
    context.fillRect(random() * GENERATED_PAGE_WIDTH, random() * GENERATED_PAGE_HEIGHT, size, size);
  }
  // Un pliegue tenue, siempre del lado opuesto al lomo.
  context.globalAlpha = 0.05 + style.age * 0.05;
  context.fillStyle = 'rgba(58,38,22,0.7)';
  const creaseX = gutterOnLeft ? GENERATED_PAGE_WIDTH * 0.78 : GENERATED_PAGE_WIDTH * 0.22;
  context.fillRect(creaseX, 0, 1.6, GENERATED_PAGE_HEIGHT);
  context.restore();
}

function applyPrintedGrain(
  context: CanvasRenderingContext2D,
  profile: PageInkProfile,
  wordWidth: number,
  fontSize: number,
): void {
  const random = seededRandom(Math.round(profile.wordX * 31 + profile.baselineY * 17 + wordWidth * 13) | 1);
  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = '#d8c7aa';
  for (let index = 0; index < 44; index += 1) {
    context.globalAlpha = 0.025 + (index % 4) * 0.008;
    context.fillRect(
      profile.wordX - wordWidth / 2 + random() * wordWidth,
      profile.baselineY - fontSize * 0.76 + random() * fontSize * 0.84,
      0.55 + (index % 3) * 0.35,
      0.45 + (index % 2) * 0.4,
    );
  }
  context.restore();
}

function fitPhrase(
  measure: (text: string) => number,
  phrase: string,
  available: number,
  drop: 'start' | 'end',
): string {
  const words = phrase.split(/\s+/u).filter(Boolean);
  while (words.length > 0 && measure(words.join(' ')) > available) {
    if (drop === 'start') words.shift();
    else words.pop();
  }
  return words.join(' ');
}

function makeTokens(seed: number, count: number): Token[] {
  const random = seededRandom(seed);
  const tokens: Token[] = [];
  let previous = '';
  while (tokens.length < count) {
    const length = 7 + Math.floor(random() * 12);
    for (let index = 0; index < length; index += 1) {
      let word = VOCABULARY[Math.floor(random() * VOCABULARY.length)];
      // Dos veces la misma palabra seguida delata que el texto es generado.
      if (word === previous) word = VOCABULARY[Math.floor(random() * VOCABULARY.length)];
      previous = word;
      const last = index === length - 1;
      const punctuated = last ? `${word}.` : random() < 0.08 ? `${word},` : word;
      // Un párrafo de una o dos líneas deja la página picada; los libros no leen así.
      tokens.push({ text: punctuated, endsParagraph: last && random() < 0.12 });
    }
  }
  return tokens;
}

function snapToGrid(target: number, step: number): number {
  return CONTENT_TOP + Math.round((target - CONTENT_TOP) / step) * step;
}

/** Cachea anchos por texto: una página mide el mismo vocabulario cientos de veces. */
function createMeasurer(context: CanvasRenderingContext2D): (text: string) => number {
  const cache = new Map<string, number>();
  return (text) => {
    const key = `${context.font} ${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const width = context.measureText(text).width;
    cache.set(key, width);
    return width;
  };
}

export function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967295;
  };
}

export function fontDeclaration(
  source: { fontFamily: string; fontStyle: string; fontWeight: number },
  size: number,
): string {
  return `${source.fontStyle} ${source.fontWeight} ${size}px ${fontStack(source.fontFamily)}`;
}

/**
 * Las familias declaradas existen en Windows; el resto de la pila cubre Linux
 * para que la misma definición no cambie de aspecto según la máquina.
 */
function fontStack(family: string): string {
  return `${family}, "Liberation Serif", "DejaVu Serif", "Nimbus Roman", Georgia, "Times New Roman", serif`;
}

export function drawMatchCutFrame(
  canvas: HTMLCanvasElement,
  page: PreparedPage,
  frame: WordMatchCutEvaluation,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.fillStyle = '#d8c7a8';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const baseScale = Math.max(canvas.width / page.canvas.width, canvas.height / page.canvas.height);
  const scale = baseScale * frame.scale;
  context.translate(canvas.width / 2 + frame.offsetX, canvas.height * 0.51 + frame.offsetY);
  context.rotate((page.source.rotationDegrees + frame.rotationDegrees) * Math.PI / 180);
  context.scale(scale, scale);
  context.translate(-page.source.wordX, -page.source.baselineY);
  context.filter = `brightness(${page.source.exposure})`;
  context.drawImage(page.canvas, 0, 0);
  context.filter = 'none';
  drawHighlighter(context, page, frame.underlineProgress);
  context.restore();

  const vignette = context.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.12,
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.72,
  );
  vignette.addColorStop(0, 'rgba(28, 18, 9, 0)');
  vignette.addColorStop(0.72, 'rgba(28, 18, 9, 0.035)');
  vignette.addColorStop(1, 'rgba(28, 18, 9, 0.16)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (frame.flashOpacity > 0) {
    context.fillStyle = `rgba(255, 246, 223, ${frame.flashOpacity})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawHighlighter(
  context: CanvasRenderingContext2D,
  page: PreparedPage,
  progress: number,
): void {
  // El trazo nace del papel: cada página inclina y desborda el fibrón distinto.
  const random = seededRandom(page.source.seed ^ 0x7ae13d);
  const tilt = (random() - 0.5) * page.fontSize * 0.12;
  const overshoot = 0.56 + random() * 0.08;
  const startX = page.source.wordX - page.wordWidth * overshoot;
  const endX = page.source.wordX + page.wordWidth * overshoot;
  const currentX = startX + (endX - startX) * progress;
  const wordBaseline = page.source.baselineY + WORD_BASELINE_OFFSET;
  const y = wordBaseline - page.fontSize * 0.27;
  context.save();
  context.globalCompositeOperation = 'multiply';
  context.strokeStyle = page.source.underlineColor;
  context.globalAlpha = 0.56;
  context.lineWidth = Math.max(14, page.fontSize * 0.58);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(startX, y + page.fontSize * 0.025 + tilt);
  context.quadraticCurveTo(
    startX + (currentX - startX) * 0.43,
    y - page.fontSize * 0.035,
    currentX,
    y + page.fontSize * 0.018 - tilt,
  );
  context.stroke();

  // Una segunda pasada desplazada deja bordes y acumulaciones propias de un fibrón real.
  context.strokeStyle = '#ffe66a';
  context.globalAlpha = 0.24;
  context.lineWidth = Math.max(8, page.fontSize * 0.34);
  context.beginPath();
  context.moveTo(startX - page.fontSize * 0.025, y - page.fontSize * 0.055 + tilt);
  context.quadraticCurveTo(
    startX + (currentX - startX) * 0.62,
    y + page.fontSize * 0.035,
    currentX + page.fontSize * 0.018,
    y - page.fontSize * 0.025 - tilt,
  );
  context.stroke();
  context.restore();
}
