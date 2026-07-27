// Lógica pura de la cola de notificaciones: sin DOM ni temporizadores, para
// poder probarla en ui:test-modules. El módulo de presentación
// (src/ui/notifications.ts) traduce este estado a nodos y timers.

export type NotificationLevel = 'info' | 'success' | 'error';

export interface NotificationInput {
  message: string;
  level?: NotificationLevel;
  /** Etiqueta del botón de acción. Sin `actionLabel` el toast no ofrece acción. */
  actionLabel?: string;
  /** Milisegundos hasta el autodescarte. `null` = persistente hasta descartar. */
  durationMs?: number | null;
  /** Notificaciones con la misma clave se reemplazan en vez de apilarse. */
  dedupeKey?: string;
}

export interface Notification {
  id: number;
  message: string;
  level: NotificationLevel;
  actionLabel: string | null;
  durationMs: number | null;
  dedupeKey: string | null;
}

export interface NotificationQueueState {
  items: readonly Notification[];
  nextId: number;
}

/** Máximo de toasts simultáneos: por encima, el más viejo cede su lugar. */
export const MAX_VISIBLE = 4;

/** Los errores no se autodescartan: exigen lectura y suelen traer acción. */
const DEFAULT_DURATION_MS: Record<NotificationLevel, number | null> = {
  info: 6000,
  success: 5000,
  error: null,
};

export function createNotificationQueue(): NotificationQueueState {
  return { items: [], nextId: 1 };
}

export function pushNotification(
  state: NotificationQueueState,
  input: NotificationInput,
): { state: NotificationQueueState; notification: Notification } {
  const level = input.level ?? 'info';
  const notification: Notification = {
    id: state.nextId,
    message: input.message,
    level,
    actionLabel: input.actionLabel ?? null,
    durationMs: input.durationMs === undefined ? DEFAULT_DURATION_MS[level] : input.durationMs,
    dedupeKey: input.dedupeKey ?? null,
  };
  const withoutDuplicate = notification.dedupeKey === null
    ? state.items
    : state.items.filter((item) => item.dedupeKey !== notification.dedupeKey);
  const items = [...withoutDuplicate, notification].slice(-MAX_VISIBLE);
  return { state: { items, nextId: state.nextId + 1 }, notification };
}

export function dismissNotification(state: NotificationQueueState, id: number): NotificationQueueState {
  const items = state.items.filter((item) => item.id !== id);
  return items.length === state.items.length ? state : { ...state, items };
}

export function clearNotifications(state: NotificationQueueState): NotificationQueueState {
  return state.items.length === 0 ? state : { ...state, items: [] };
}

/** Las notificaciones que el propio usuario debe cerrar no se autodescartan. */
export function isPersistent(notification: Notification): boolean {
  return notification.durationMs === null;
}
