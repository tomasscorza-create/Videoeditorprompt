export function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`No se encontró ${selector}`);
  return element;
}

// La UI debe degradar sin romper si un nodo opcional no está en el markup.
export function optional<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}
