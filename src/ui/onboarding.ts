// E5 — Guía de primer uso. Aparece sobre el visor cuando el proyecto todavía
// no tiene contenido, presenta el flujo Idea → Base → Video apuntando a
// los controles reales, y ofrece ejemplos de prompt que rellenan el textarea.
//
// Sin overlay bloqueante ni tour por pasos: es un panel descartable. Una vez
// descartado no vuelve, y tampoco aparece si ya hay trabajo hecho.

import { optional } from './dom.js';
import type { ProjectStore } from './project/store.js';

const DISMISSED_KEY = 'local-video.onboarding-dismissed';

const EXAMPLES = [
  'Dos personajes explican con humor por qué conviene verificar las respuestas de una IA.',
  'Una divulgadora cuenta en tono claro cómo se forma un arcoíris.',
  'Diálogo breve y enérgico sobre por qué dormir bien mejora la memoria.',
];

const STEPS: Array<{ title: string; detail: string }> = [
  { title: 'Escribí tu idea', detail: 'Contale al Director, en el panel izquierdo, de qué querés que trate el video.' },
  { title: 'Revisá la base', detail: 'El Director arma una secuencia continua; desde ahí podés pedir ajustes o abrir la edición contextual.' },
  { title: 'Creá el video', detail: 'Generá o actualizá el MP4 cuando la base esté lista.' },
];

export function initOnboarding(store: ProjectStore | null): void {
  const root = optional<HTMLElement>('#onboarding');
  if (!root) return;

  const sync = (): void => {
    root.hidden = !shouldShow(store);
  };

  if (isDismissed()) {
    root.hidden = true;
    return;
  }
  render(root);
  store?.subscribe(sync);
  sync();
}

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Sin almacenamiento disponible la guía simplemente vuelve a aparecer.
    return false;
  }
}

function dismiss(root: HTMLElement): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Descartarla en esta sesión ya es suficiente.
  }
  root.hidden = true;
}

/** Con trabajo hecho la guía estorba: solo se muestra sobre un proyecto vacío. */
function shouldShow(store: ProjectStore | null): boolean {
  if (isDismissed()) return false;
  if (!store) return true;
  return !store.project().scenes.some((scene) => scene.elements.length > 0 || scene.dialogue.length > 0);
}

function render(root: HTMLElement): void {
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = 'Tu primer video, en tres pasos';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-button onboarding-close';
  close.setAttribute('aria-label', 'No mostrar esta guía de nuevo');
  close.title = 'No mostrar de nuevo';
  const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  closeIcon.setAttribute('class', 'icon');
  closeIcon.setAttribute('aria-hidden', 'true');
  const closeUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  closeUse.setAttribute('href', '#ui-icon-close');
  closeIcon.append(closeUse);
  close.append(closeIcon);
  close.addEventListener('click', () => dismiss(root));
  header.append(title, close);

  const list = document.createElement('ol');
  list.className = 'onboarding-steps';
  for (const step of STEPS) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = step.title;
    const detail = document.createElement('span');
    detail.textContent = step.detail;
    item.append(name, detail);
    list.append(item);
  }

  const examplesTitle = document.createElement('p');
  examplesTitle.className = 'onboarding-examples-title';
  examplesTitle.textContent = 'O probá con un ejemplo:';
  const examples = document.createElement('div');
  examples.className = 'onboarding-examples';
  for (const example of EXAMPLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'onboarding-example';
    button.textContent = example;
    button.title = 'Usar este ejemplo en el Director';
    button.addEventListener('click', () => {
      const prompt = optional<HTMLTextAreaElement>('#director-prompt');
      if (!prompt) return;
      prompt.value = example;
      prompt.focus();
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
    });
    examples.append(button);
  }

  root.replaceChildren(header, list, examplesTitle, examples);
}
