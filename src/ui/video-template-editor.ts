import { optional } from './dom.js';
import {
  loadVideoTemplateDefinition,
  OPEN_VIDEO_TEMPLATE_EVENT,
  type VideoTemplateSummary,
  type VideoTemplateDefinition,
} from './project/video-template-catalog.js';
import {
  drawMatchCutFrame,
  paintWord,
  renderPageBase,
  type PageBase,
  type PreparedPage,
} from '../../shared/video-template-page.js';
import {
  evaluateWordMatchCut,
  normalizeTemplateWord,
} from '../../shared/video-template-evaluator.js';

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
  let pageBases: PageBase[] = [];
  let preparedPages: PreparedPage[] = [];
  let composeTimer = 0;
  const cutAudio = new MatchCutAudio();

  const draw = (now: number): void => {
    animationFrame = 0;
    if (panel.hidden || !definition || preparedPages.length === 0) return;
    const rawSeconds = playing ? (now - startedAt) / 1000 : pausedSeconds;
    const seconds = Math.min(rawSeconds, definition.durationSeconds - 1 / definition.fps);
    const frame = evaluateWordMatchCut(definition, seconds);
    const prepared = preparedPages[frame.sourceIndex];
    if (prepared) {
      drawMatchCutFrame(canvas, prepared, frame);
      if (frame.cutIndex !== lastCutIndex) {
        cutAudio.cue(frame.cutIndex);
        lastCutIndex = frame.cutIndex;
      }
    }
    if (time) time.textContent = `${Math.min(rawSeconds, definition.durationSeconds).toFixed(1)} s`;
    if (playing && rawSeconds >= definition.durationSeconds) {
      pausedSeconds = definition.durationSeconds;
      playing = false;
      cutAudio.setPlaying(false);
      toggle.textContent = 'Reproducir';
      return;
    }
    if (playing) animationFrame = requestAnimationFrame(draw);
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

  /** Solo recompone la línea de la palabra: el papel y el cuerpo ya están pintados. */
  const composeWord = (): void => {
    if (!definition || pageBases.length === 0) return;
    preparedPages = pageBases.map((page) => paintWord(page, word));
    status.classList.remove('error');
    status.textContent = `«${word}» quedó compuesta dentro del renglón en las ${pageBases.length} páginas.`;
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
    status.textContent = 'Componiendo las páginas…';
    fields.replaceChildren();
    attribution.hidden = true;
    pageBases = [];
    preparedPages = [];
    void loadVideoTemplateDefinition(template).then((loaded) => {
      definition = loaded;
      word = normalizeTemplateWord(loaded.defaultValues.word, 'IDEA', loaded.fields[0].maxLength);
      pageBases = loaded.pageStyles.map((style, index) => renderPageBase(style, index));
      renderFields(loaded);
      composeWord();
    }).catch((error) => {
      definition = null;
      pageBases = [];
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
    window.clearTimeout(composeTimer);
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
      // Sin espera, cada tecla recompondría doce páginas y reiniciaría el efecto.
      window.clearTimeout(composeTimer);
      composeTimer = window.setTimeout(composeWord, 190);
    });
    const help = document.createElement('small');
    help.textContent = `Hasta ${field.maxLength} caracteres. Las palabras cortas conservan mejor el tamaño natural del libro.`;
    label.append(caption, input, help);
    fields!.replaceChildren(label);
  }
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
