// Sistema único de notificaciones transitorias (M1 del plan de mejora UX/UI).
// Solo eventos que pasan: guardado, render listo, edición IA aplicada, errores.
// Los estados persistentes de página (salud del servicio, modo de la timeline)
// siguen viviendo en su propio `role="status"` y no migran acá.

import {
  createNotificationQueue,
  dismissNotification,
  isPersistent,
  pushNotification,
  type Notification,
  type NotificationInput,
  type NotificationQueueState,
} from './notifications-queue.js';

const ICONS: Record<Notification['level'], string> = {
  info: '#ui-icon-info',
  success: '#ui-icon-check',
  error: '#ui-icon-alert',
};

let state: NotificationQueueState = createNotificationQueue();
let region: HTMLElement | null = null;
const nodes = new Map<number, HTMLElement>();
const timers = new Map<number, number>();
const remaining = new Map<number, number>();
const startedAt = new Map<number, number>();

export interface NotifyOptions extends NotificationInput {
  /** Se ejecuta al pulsar el botón de acción; el toast se cierra después. */
  onAction?: () => void;
}

/** Publica una notificación. Devuelve su id para poder descartarla a mano. */
export function notify(options: NotifyOptions): number {
  const { state: next, notification } = pushNotification(state, options);
  const removed = state.items.filter((item) => !next.items.includes(item));
  state = next;
  for (const item of removed) teardown(item.id);
  render(notification, options.onAction);
  return notification.id;
}

export function dismiss(id: number): void {
  state = dismissNotification(state, id);
  teardown(id);
}

function ensureRegion(): HTMLElement {
  if (region?.isConnected) return region;
  region = document.createElement('div');
  region.className = 'toast-region';
  // polite: los toasts nunca interrumpen lo que el lector esté leyendo.
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'false');
  document.body.append(region);
  return region;
}

function render(notification: Notification, onAction?: () => void): void {
  const root = ensureRegion();
  const toast = document.createElement('div');
  toast.className = `toast is-${notification.level}`;
  toast.dataset.notificationId = String(notification.id);

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'icon toast-icon');
  icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', ICONS[notification.level]);
  icon.append(use);

  const message = document.createElement('p');
  message.className = 'toast-message';
  message.textContent = notification.message;

  const actions = document.createElement('div');
  actions.className = 'toast-actions';
  if (notification.actionLabel && onAction) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = notification.actionLabel;
    action.addEventListener('click', () => {
      onAction();
      dismiss(notification.id);
    });
    actions.append(action);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close icon-button';
  close.setAttribute('aria-label', `Descartar: ${notification.message}`);
  const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  closeIcon.setAttribute('class', 'icon');
  closeIcon.setAttribute('aria-hidden', 'true');
  const closeUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  closeUse.setAttribute('href', '#ui-icon-close');
  closeIcon.append(closeUse);
  close.append(closeIcon);
  close.addEventListener('click', () => dismiss(notification.id));
  actions.append(close);

  toast.append(icon, message, actions);
  root.append(toast);
  nodes.set(notification.id, toast);

  if (isPersistent(notification)) return;
  // El temporizador se pausa mientras el puntero o el foco están encima, para
  // no perder el mensaje mientras se lo está leyendo o usando su acción.
  toast.addEventListener('pointerenter', () => pause(notification.id));
  toast.addEventListener('pointerleave', () => resume(notification.id));
  toast.addEventListener('focusin', () => pause(notification.id));
  toast.addEventListener('focusout', () => {
    if (!toast.contains(document.activeElement)) resume(notification.id);
  });
  remaining.set(notification.id, notification.durationMs ?? 0);
  resume(notification.id);
}

function resume(id: number): void {
  if (!nodes.has(id) || timers.has(id)) return;
  const left = remaining.get(id);
  if (left === undefined) return;
  startedAt.set(id, Date.now());
  timers.set(id, window.setTimeout(() => dismiss(id), left));
}

function pause(id: number): void {
  const timer = timers.get(id);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  timers.delete(id);
  const started = startedAt.get(id) ?? Date.now();
  const left = (remaining.get(id) ?? 0) - (Date.now() - started);
  remaining.set(id, Math.max(left, 400));
}

function teardown(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(id);
  remaining.delete(id);
  startedAt.delete(id);
  const node = nodes.get(id);
  nodes.delete(id);
  if (!node) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    node.remove();
    return;
  }
  node.classList.add('is-leaving');
  node.addEventListener('animationend', () => node.remove(), { once: true });
  // Si la animación no llega a dispararse (pestaña oculta), no dejar el nodo.
  window.setTimeout(() => node.remove(), 400);
}
