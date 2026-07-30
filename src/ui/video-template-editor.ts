import { optional } from './dom.js';
import {
  loadVideoTemplateDefinition,
  OPEN_VIDEO_TEMPLATE_EVENT,
  type ProceduralPageStyle,
  type VideoTemplatePageSource,
  type VideoTemplateSummary,
  type VideoTemplateDefinition,
} from './project/video-template-catalog.js';
import {
  evaluateWordMatchCut,
  normalizeTemplateWord,
} from '../../shared/video-template-evaluator.js';

interface PreparedPage {
  canvas: HTMLCanvasElement;
  source: PageInkProfile;
  wordWidth: number;
  fontSize: number;
}

type PageInkProfile = Omit<VideoTemplatePageSource, 'src'>;

const WORD_BASELINE_OFFSET = -5;
const GENERATED_PAGE_WIDTH = 855;
const GENERATED_PAGE_HEIGHT = 1098;

export function initVideoTemplateEditor(): void {
  const panel = optional<HTMLElement>('#video-template-editor');
  const library = optional<HTMLElement>('#resource-library');
  const canvas = optional<HTMLCanvasElement>('#video-template-canvas');
  const fields = optional<HTMLElement>('#video-template-fields');
  const title = optional<HTMLElement>('#video-template-title');
  const description = optional<HTMLElement>('#video-template-description');
  const status = optional<HTMLElement>('#video-template-status');
  const attribution = optional<HTMLElement>('#video-template-attribution');
  const close = optional<HTMLButtonElement>('#video-template-close');
  const toggle = optional<HTMLButtonElement>('#video-template-toggle');
  const replay = optional<HTMLButtonElement>('#video-template-replay');
  const sound = optional<HTMLButtonElement>('#video-template-sound');
  const time = optional<HTMLElement>('#video-template-time');
  if (!panel || !library || !canvas || !fields || !title || !description || !status
    || !attribution || !close || !toggle || !replay || !sound) return;

  let definition: VideoTemplateDefinition | null = null;
  let word = 'IDEA';
  let playing = false;
  let startedAt = performance.now();
  let pausedSeconds = 0;
  let animationFrame = 0;
  let lastCutIndex = -1;
  let sourceImages: HTMLImageElement[] = [];
  let preparedPages: PreparedPage[] = [];
  let preparationGeneration = 0;
  const cutAudio = new MatchCutAudio();

  const draw = (now: number): void => {
    if (panel.hidden || !definition || preparedPages.length === 0) {
      animationFrame = 0;
      return;
    }
    const rawSeconds = playing ? (now - startedAt) / 1000 : pausedSeconds;
    const seconds = Math.min(rawSeconds, definition.durationSeconds - 1 / definition.fps);
    const frame = evaluateWordMatchCut(definition, seconds);
    const prepared = preparedPages[frame.sourceIndex];
    if (!prepared) return;
    drawMatchCutFrame(canvas, prepared, frame);
    if (frame.cutIndex !== lastCutIndex) {
      cutAudio.cue(frame.cutIndex);
      lastCutIndex = frame.cutIndex;
    }
    if (time) time.textContent = `${Math.min(rawSeconds, definition.durationSeconds).toFixed(1)} s`;
    if (playing && rawSeconds >= definition.durationSeconds) {
      pausedSeconds = definition.durationSeconds;
      playing = false;
      cutAudio.setPlaying(false);
      toggle.textContent = 'Reproducir';
      animationFrame = 0;
      return;
    }
    animationFrame = playing ? requestAnimationFrame(draw) : 0;
  };

  const ensureClock = (): void => {
    if (!animationFrame) animationFrame = requestAnimationFrame(draw);
  };

  const startClock = (): void => {
    if (!definition || preparedPages.length === 0) return;
    pausedSeconds = 0;
    startedAt = performance.now();
    lastCutIndex = -1;
    playing = true;
    cutAudio.setPlaying(true);
    cutAudio.reset();
    toggle.textContent = 'Pausar';
    ensureClock();
  };

  const rebuildPages = async (): Promise<void> => {
    if (!definition) return;
    const generation = ++preparationGeneration;
    const loaded = definition;
    status.classList.remove('error');
    status.textContent = `Integrando «${word}» dentro de las ocho páginas…`;
    const pages = loaded.kind === 'word-match-cut'
      ? await Promise.all(loaded.pageSources.map((source, index) => (
        preparePage(sourceImages[index], source, word)
      )))
      : loaded.pageStyles.map((style, index) => prepareProceduralPage(style, word, index));
    if (generation !== preparationGeneration || definition !== loaded) return;
    preparedPages = pages;
    status.textContent = `«${word}» está impresa dentro de cada línea y alineada para el corte.`;
    startClock();
  };

  window.addEventListener(OPEN_VIDEO_TEMPLATE_EVENT, (event) => {
    const template = (event as CustomEvent<VideoTemplateSummary>).detail;
    cutAudio.enable();
    library.hidden = true;
    panel.hidden = false;
    panel.closest<HTMLElement>('.editor-column')?.scrollTo({ top: 0 });
    title.textContent = template.label;
    description.textContent = template.description;
    status.classList.remove('error');
    status.textContent = 'Cargando las páginas fotográficas…';
    fields.replaceChildren();
    attribution.hidden = true;
    void loadVideoTemplateDefinition(template).then(async (loaded) => {
      sourceImages = loaded.kind === 'word-match-cut'
        ? await loadPageImages(loaded.pageSources)
        : [];
      definition = loaded;
      word = normalizeTemplateWord(loaded.defaultValues.word, 'IDEA', loaded.fields[0].maxLength);
      renderFields(loaded);
      await rebuildPages();
    }).catch((error) => {
      definition = null;
      preparedPages = [];
      status.textContent = error instanceof Error ? error.message : 'No se pudo abrir la plantilla.';
      status.classList.add('error');
    });
  });

  close.addEventListener('click', () => {
    panel.hidden = true;
    library.hidden = false;
    playing = false;
    cutAudio.setPlaying(false);
    preparationGeneration += 1;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  });

  toggle.addEventListener('click', () => {
    if (!definition || preparedPages.length === 0) return;
    if (playing) {
      pausedSeconds = (performance.now() - startedAt) / 1000;
      playing = false;
      cutAudio.setPlaying(false);
      toggle.textContent = 'Reproducir';
    } else if (pausedSeconds >= definition.durationSeconds) {
      startClock();
      return;
    } else {
      startedAt = performance.now() - pausedSeconds * 1000;
      playing = true;
      cutAudio.setPlaying(true);
      toggle.textContent = 'Pausar';
    }
    ensureClock();
  });

  replay.addEventListener('click', startClock);

  sound.addEventListener('click', () => {
    const enabled = cutAudio.toggle();
    sound.setAttribute('aria-pressed', String(enabled));
    sound.textContent = enabled ? 'Sonido: activado' : 'Sonido: desactivado';
    if (enabled) cutAudio.enable();
  });

  function renderFields(loaded: VideoTemplateDefinition): void {
    const field = loaded.fields[0];
    const label = document.createElement('label');
    label.className = 'field';
    label.htmlFor = 'video-template-word';
    const caption = document.createElement('span');
    caption.textContent = field.label;
    const input = document.createElement('input');
    input.id = 'video-template-word';
    input.type = 'text';
    input.value = word;
    input.placeholder = field.placeholder;
    input.minLength = field.minLength;
    input.maxLength = field.maxLength;
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      word = normalizeTemplateWord(input.value, loaded.defaultValues.word, field.maxLength);
      void rebuildPages().catch((error) => {
        status!.textContent = error instanceof Error ? error.message : 'No se pudo actualizar la palabra.';
        status!.classList.add('error');
      });
    });
    const help = document.createElement('small');
    help.textContent = `Hasta ${field.maxLength} caracteres. Las palabras cortas conservan mejor el tamaño natural del libro.`;
    label.append(caption, input, help);
    fields!.replaceChildren(label);
  }
}

async function preparePage(
  image: HTMLImageElement,
  source: VideoTemplatePageSource,
  word: string,
): Promise<PreparedPage> {
  const page = document.createElement('canvas');
  page.width = image.naturalWidth;
  page.height = image.naturalHeight;
  const context = page.getContext('2d');
  if (!context) throw new Error('No se pudo preparar una de las páginas.');
  context.drawImage(image, 0, 0);

  let fontSize = source.fontSize;
  context.font = fontDeclaration(source, fontSize);
  let wordWidth = context.measureText(word).width;
  if (wordWidth > source.maxWordWidth) {
    fontSize *= source.maxWordWidth / wordWidth;
    context.font = fontDeclaration(source, fontSize);
    wordWidth = context.measureText(word).width;
  }

  context.save();
  context.globalCompositeOperation = 'multiply';
  context.globalAlpha = source.inkOpacity;
  context.fillStyle = source.inkColor;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.filter = `blur(${source.blur}px)`;
  context.shadowColor = source.inkColor;
  context.shadowBlur = Math.max(0.15, source.blur * 0.7);
  const wordBaseline = source.baselineY + WORD_BASELINE_OFFSET;
  context.fillText(word, source.wordX, wordBaseline);

  // Una segunda pasada mínima rompe el borde digital perfecto y lo acerca a tinta impresa.
  context.globalAlpha = source.inkOpacity * 0.13;
  context.shadowBlur = 0;
  context.fillText(word, source.wordX + 0.28, wordBaseline + 0.18);
  context.restore();

  applyPrintedGrain(context, source, wordWidth, fontSize);
  return { canvas: page, source, wordWidth, fontSize };
}

function prepareProceduralPage(
  style: ProceduralPageStyle,
  word: string,
  pageIndex: number,
): PreparedPage {
  const page = document.createElement('canvas');
  page.width = GENERATED_PAGE_WIDTH;
  page.height = GENERATED_PAGE_HEIGHT;
  const context = page.getContext('2d');
  if (!context) throw new Error('No se pudo construir una de las páginas generativas.');

  const targetBaseline = Math.round(GENERATED_PAGE_HEIGHT * 0.525);
  const source: PageInkProfile = {
    fontFamily: style.fontFamily,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
    wordX: GENERATED_PAGE_WIDTH / 2,
    baselineY: targetBaseline - WORD_BASELINE_OFFSET,
    maxWordWidth: 250,
    inkColor: style.inkColor,
    underlineColor: style.highlightColor,
    inkOpacity: 0.82 + style.age * 0.08,
    blur: 0.12 + style.age * 0.22,
    rotationDegrees: ((style.seed % 7) - 3) * 0.035,
    exposure: 0.98 + (pageIndex % 3) * 0.012,
  };

  drawProceduralPaper(context, style);
  drawBleedThrough(context, style);
  const wordMetrics = drawProceduralTypography(context, style, source, word, targetBaseline, pageIndex);
  drawPageWear(context, style);
  applyPrintedGrain(context, source, wordMetrics.wordWidth, wordMetrics.fontSize);
  return {
    canvas: page,
    source,
    wordWidth: wordMetrics.wordWidth,
    fontSize: wordMetrics.fontSize,
  };
}

function drawProceduralPaper(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
): void {
  context.fillStyle = style.paperColor;
  context.fillRect(0, 0, GENERATED_PAGE_WIDTH, GENERATED_PAGE_HEIGHT);

  const edge = context.createRadialGradient(
    GENERATED_PAGE_WIDTH * 0.5,
    GENERATED_PAGE_HEIGHT * 0.46,
    GENERATED_PAGE_WIDTH * 0.16,
    GENERATED_PAGE_WIDTH * 0.5,
    GENERATED_PAGE_HEIGHT * 0.5,
    GENERATED_PAGE_HEIGHT * 0.72,
  );
  edge.addColorStop(0, 'rgba(255,255,255,0.055)');
  edge.addColorStop(0.68, 'rgba(97,70,35,0.018)');
  edge.addColorStop(1, `rgba(71,48,24,${0.09 + style.age * 0.11})`);
  context.fillStyle = edge;
  context.fillRect(0, 0, GENERATED_PAGE_WIDTH, GENERATED_PAGE_HEIGHT);

  const random = seededRandom(style.seed);
  context.save();
  context.globalCompositeOperation = 'multiply';
  for (let index = 0; index < 320; index += 1) {
    const x = random() * GENERATED_PAGE_WIDTH;
    const y = random() * GENERATED_PAGE_HEIGHT;
    const length = 3 + random() * 34;
    context.strokeStyle = random() > 0.42
      ? `rgba(112,82,44,${0.018 + style.age * 0.026})`
      : 'rgba(255,255,255,0.035)';
    context.lineWidth = 0.25 + random() * 0.55;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + (random() - 0.5) * 1.8);
    context.stroke();
  }
  for (let index = 0; index < 34; index += 1) {
    const x = random() * GENERATED_PAGE_WIDTH;
    const y = random() * GENERATED_PAGE_HEIGHT;
    const radius = 8 + random() * 54;
    const stain = context.createRadialGradient(x, y, 0, x, y, radius);
    stain.addColorStop(0, `rgba(121,82,39,${0.006 + style.age * 0.014})`);
    stain.addColorStop(1, 'rgba(121,82,39,0)');
    context.fillStyle = stain;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.restore();
}

function drawBleedThrough(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
): void {
  if (style.bleed <= 0) return;
  const random = seededRandom(style.seed ^ 0x5f3759df);
  context.save();
  context.translate(GENERATED_PAGE_WIDTH, 0);
  context.scale(-1, 1);
  context.globalCompositeOperation = 'multiply';
  context.globalAlpha = 0.018 + style.bleed * 0.045;
  context.fillStyle = style.inkColor;
  context.font = `${Math.max(25, style.fontSize * 0.82)}px ${style.fontFamily}, Georgia, serif`;
  for (let row = 0; row < 22; row += 1) {
    const y = 82 + row * 44 + random() * 5;
    context.fillText(makeBodyLine(style.seed + 47, row + 13), 55 + random() * 20, y, 730);
  }
  context.restore();
}

function drawProceduralTypography(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  source: PageInkProfile,
  word: string,
  targetBaseline: number,
  pageIndex: number,
): { wordWidth: number; fontSize: number } {
  const layout = style.layout;
  const margin = layout === 'editorial' ? 74 : layout === 'typewriter' ? 88 : 62;
  const contentWidth = GENERATED_PAGE_WIDTH - margin * 2;
  const lineStep = style.fontSize * style.lineHeight;
  const random = seededRandom(style.seed ^ 0x13579bdf);

  context.save();
  context.globalCompositeOperation = 'multiply';
  context.fillStyle = style.inkColor;
  context.globalAlpha = 0.8 + style.age * 0.12;

  drawProceduralHeader(context, style, pageIndex, margin);
  if (layout === 'columns') {
    const gap = 38;
    const columnWidth = (contentWidth - gap) / 2;
    drawGeneratedColumn(context, style, margin, columnWidth, 150, targetBaseline - lineStep * 1.25, 0);
    drawGeneratedColumn(context, style, margin + columnWidth + gap, columnWidth, 150, targetBaseline - lineStep * 1.25, 31);
    drawGeneratedColumn(context, style, margin, columnWidth, targetBaseline + lineStep * 1.15, 1000, 59);
    drawGeneratedColumn(context, style, margin + columnWidth + gap, columnWidth, targetBaseline + lineStep * 1.15, 1000, 83);
  } else {
    context.font = fontDeclaration(source, style.fontSize);
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    let row = 0;
    for (let y = 170; y < 1010; y += lineStep) {
      if (Math.abs(y - targetBaseline) < lineStep * 0.72) continue;
      const indent = layout === 'novel' && row % 7 === 0 ? style.fontSize * 1.3 : 0;
      const poetic = layout === 'poetry' ? 26 + ((row * 37 + style.seed) % 95) : 0;
      const x = margin + indent + poetic + (random() - 0.5) * 1.2;
      const maxWidth = contentWidth - indent - poetic;
      context.globalAlpha = 0.76 + random() * 0.14;
      context.fillText(makeBodyLine(style.seed, row), x, y, maxWidth);
      row += 1;
    }
  }

  let fontSize = style.fontSize;
  context.font = fontDeclaration(source, fontSize);
  let wordWidth = context.measureText(word).width;
  if (wordWidth > source.maxWordWidth) {
    fontSize *= source.maxWordWidth / wordWidth;
    context.font = fontDeclaration(source, fontSize);
    wordWidth = context.measureText(word).width;
  }
  const wordLeft = source.wordX - wordWidth / 2;
  const wordRight = source.wordX + wordWidth / 2;
  context.textBaseline = 'alphabetic';
  context.globalAlpha = source.inkOpacity;
  context.textAlign = 'right';
  context.fillText(style.leftPhrase, wordLeft - 10, targetBaseline);
  context.textAlign = 'left';
  context.fillText(style.rightPhrase, wordRight + 10, targetBaseline);
  context.textAlign = 'center';
  context.filter = `blur(${source.blur}px)`;
  context.fillText(word, source.wordX, targetBaseline);
  context.filter = 'none';
  context.globalAlpha = source.inkOpacity * 0.12;
  context.fillText(word, source.wordX + 0.24, targetBaseline + 0.18);

  context.globalAlpha = 0.52;
  context.font = `${Math.max(15, style.fontSize * 0.38)}px ${style.fontFamily}, Georgia, serif`;
  context.textAlign = 'center';
  context.fillText(String(40 + ((style.seed + pageIndex * 17) % 170)), GENERATED_PAGE_WIDTH / 2, 1050);
  context.restore();
  return { wordWidth, fontSize };
}

function drawProceduralHeader(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  pageIndex: number,
  margin: number,
): void {
  const titles = [
    'El peso de las palabras',
    'Notas sobre el tiempo',
    'Historias de una idea',
    'Capítulo de los cambios',
    'La forma de recordar',
    'Ensayo sobre la mirada',
    'Pequeñas revelaciones',
    'El lenguaje del mundo',
  ];
  const title = titles[pageIndex % titles.length];
  context.save();
  context.fillStyle = style.inkColor;
  context.globalAlpha = 0.74;
  context.textBaseline = 'alphabetic';
  if (style.layout === 'editorial') {
    context.font = `600 ${Math.round(style.fontSize * 1.65)}px ${style.fontFamily}, Georgia, serif`;
    context.textAlign = 'left';
    context.fillText(title, margin, 92, GENERATED_PAGE_WIDTH - margin * 2);
    context.globalAlpha = 0.32;
    context.fillRect(margin, 112, GENERATED_PAGE_WIDTH - margin * 2, 1.4);
  } else if (style.layout === 'encyclopedia' || style.layout === 'columns') {
    context.font = `600 ${Math.round(style.fontSize * 0.72)}px ${style.fontFamily}, Georgia, serif`;
    context.textAlign = 'center';
    context.fillText(title.toUpperCase(), GENERATED_PAGE_WIDTH / 2, 92);
    context.globalAlpha = 0.38;
    context.fillRect(margin, 108, GENERATED_PAGE_WIDTH - margin * 2, 1);
  } else {
    context.font = `${style.fontStyle} 600 ${Math.round(style.fontSize * 0.92)}px ${style.fontFamily}, Georgia, serif`;
    context.textAlign = 'center';
    context.fillText(title, GENERATED_PAGE_WIDTH / 2, 104);
  }
  context.restore();
}

function drawGeneratedColumn(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
  x: number,
  width: number,
  startY: number,
  endY: number,
  seedOffset: number,
): void {
  const step = style.fontSize * style.lineHeight;
  context.save();
  context.font = fontDeclaration({
    fontFamily: style.fontFamily,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
  }, style.fontSize * 0.72);
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  for (let y = startY, row = 0; y < endY; y += step * 0.78, row += 1) {
    context.globalAlpha = 0.72 + ((row + style.seed) % 5) * 0.035;
    context.fillText(makeBodyLine(style.seed + seedOffset, row), x, y, width);
  }
  context.restore();
}

function drawPageWear(
  context: CanvasRenderingContext2D,
  style: ProceduralPageStyle,
): void {
  const random = seededRandom(style.seed ^ 0x2468ace);
  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = style.paperColor;
  for (let index = 0; index < 210; index += 1) {
    context.globalAlpha = 0.025 + random() * style.age * 0.075;
    const size = 0.3 + random() * 1.15;
    context.fillRect(
      random() * GENERATED_PAGE_WIDTH,
      random() * GENERATED_PAGE_HEIGHT,
      size,
      size * (0.5 + random()),
    );
  }
  context.restore();
}

function makeBodyLine(seed: number, row: number): string {
  const fragments = [
    'La memoria conserva aquello que el tiempo intenta borrar',
    'cada página propone una forma distinta de mirar el mundo',
    'las historias permanecen ocultas entre silencios y señales',
    'una voz antigua vuelve cuando alguien decide escucharla',
    'el sentido aparece lentamente detrás de las cosas pequeñas',
    'ningún camino es idéntico después de haber sido contado',
    'la tinta guarda preguntas que todavía no tienen respuesta',
    'toda transformación comienza en un gesto casi imperceptible',
    'el lector reconoce en esas líneas una experiencia compartida',
    'algunas certezas cambian cuando se observan desde más cerca',
    'la historia continúa aun cuando la página parece terminada',
    'cada detalle participa de una composición mucho más amplia',
  ];
  return fragments[Math.abs((seed * 17 + row * 7)) % fragments.length];
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967295;
  };
}

function drawMatchCutFrame(
  canvas: HTMLCanvasElement,
  page: PreparedPage,
  frame: ReturnType<typeof evaluateWordMatchCut>,
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
  const startX = page.source.wordX - page.wordWidth * 0.58;
  const endX = page.source.wordX + page.wordWidth * 0.58;
  const currentX = startX + (endX - startX) * progress;
  const wordBaseline = page.source.baselineY + WORD_BASELINE_OFFSET;
  const y = wordBaseline - page.fontSize * 0.27;
  context.save();
  context.globalCompositeOperation = 'multiply';
  context.strokeStyle = page.source.underlineColor;
  context.globalAlpha = 0.48;
  context.lineWidth = Math.max(12, page.fontSize * 0.48);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(startX, y + page.fontSize * 0.025);
  context.quadraticCurveTo(
    startX + (currentX - startX) * 0.43,
    y - page.fontSize * 0.035,
    currentX,
    y + page.fontSize * 0.018,
  );
  context.stroke();

  // Una segunda pasada desplazada deja bordes y acumulaciones propias de un fibrón real.
  context.strokeStyle = '#ffe66a';
  context.globalAlpha = 0.2;
  context.lineWidth = Math.max(7, page.fontSize * 0.3);
  context.beginPath();
  context.moveTo(startX - page.fontSize * 0.025, y - page.fontSize * 0.055);
  context.quadraticCurveTo(
    startX + (currentX - startX) * 0.62,
    y + page.fontSize * 0.035,
    currentX + page.fontSize * 0.018,
    y - page.fontSize * 0.025,
  );
  context.stroke();
  context.restore();
}

function applyPrintedGrain(
  context: CanvasRenderingContext2D,
  source: PageInkProfile,
  wordWidth: number,
  fontSize: number,
): void {
  let state = Math.round(source.wordX * 31 + source.baselineY * 17 + wordWidth * 13);
  context.save();
  context.globalCompositeOperation = 'screen';
  context.fillStyle = '#d8c7aa';
  for (let index = 0; index < 34; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const rx = ((state >>> 0) / 4294967295);
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const ry = ((state >>> 0) / 4294967295);
    context.globalAlpha = 0.025 + (index % 4) * 0.008;
    context.fillRect(
      source.wordX - wordWidth / 2 + rx * wordWidth,
      source.baselineY - fontSize * 0.76 + ry * fontSize * 0.84,
      0.55 + (index % 3) * 0.35,
      0.45 + (index % 2) * 0.4,
    );
  }
  context.restore();
}

async function loadPageImages(sources: readonly VideoTemplatePageSource[]): Promise<HTMLImageElement[]> {
  return Promise.all(sources.map(async (source) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = `/${source.src}`;
    await image.decode();
    return image;
  }));
}

function fontDeclaration(
  source: Pick<PageInkProfile, 'fontFamily' | 'fontStyle' | 'fontWeight'>,
  size: number,
): string {
  return `${source.fontStyle} ${source.fontWeight} ${size}px ${source.fontFamily}, Georgia, "Times New Roman", serif`;
}

class MatchCutAudio {
  private context: AudioContext | null = null;
  private enabled = true;
  private playing = true;
  private lastCut = -1;

  enable(): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
    } catch {
      // La plantilla visual sigue disponible si el navegador bloquea audio.
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) this.lastCut = -1;
    return this.enabled;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  reset(): void {
    this.lastCut = -1;
  }

  cue(cutIndex: number): void {
    if (!this.enabled || !this.playing || cutIndex === this.lastCut) return;
    this.lastCut = cutIndex;
    const audio = this.context;
    if (!audio || audio.state !== 'running') return;
    const duration = 0.055;
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let state = (cutIndex + 11) * 2654435761;
    for (let index = 0; index < data.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      const noise = ((state >>> 0) / 4294967295) * 2 - 1;
      const progress = index / data.length;
      data[index] = noise * ((1 - progress) ** 2) * 0.36;
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1350 + (cutIndex % 5) * 240;
    filter.Q.value = 0.78;
    const gain = audio.createGain();
    gain.gain.value = cutIndex % 4 === 0 ? 0.16 : 0.09;
    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  }
}
