// M2 — Registro y búsqueda difusa de acciones para la paleta de comandos.
// Módulo puro y testeable: no conoce el DOM ni ejecuta nada.
//
// Una acción no disponible no se oculta: se muestra deshabilitada con el
// motivo. Ocultarla dejaría al usuario buscando algo que sí existe.

export interface CommandAction {
  id: string;
  label: string;
  group: string;
  /** Atajo de teclado equivalente, si el control visual tiene uno. */
  shortcut?: string;
  /** Palabras extra que deben encontrar la acción sin figurar en la etiqueta. */
  keywords?: string[];
  /** Motivo por el que no se puede ejecutar ahora. `undefined` = disponible. */
  unavailableReason?: string;
  run: () => void;
}

export interface ScoredAction {
  action: CommandAction;
  score: number;
  /** Índices de `label` que coincidieron, para resaltarlos. */
  matches: number[];
}

export function isAvailable(action: CommandAction): boolean {
  return action.unavailableReason === undefined;
}

/**
 * Coincidencia por subsecuencia: los caracteres de la consulta deben aparecer
 * en orden, no necesariamente juntos. Premia los tramos contiguos y los
 * comienzos de palabra, de modo que «np» encuentre «Nuevo proyecto».
 */
export function fuzzyMatch(text: string, query: string): { score: number; matches: number[] } | null {
  if (query === '') return { score: 0, matches: [] };
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const matches: number[] = [];
  let score = 0;
  let cursor = 0;
  let previous = -2;
  for (const character of needle) {
    if (character === ' ') continue;
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return null;
    if (found === previous + 1) score += 6;
    if (found === 0 || /[\s·/-]/u.test(haystack[found - 1] ?? '')) score += 10;
    score += 1;
    matches.push(found);
    previous = found;
    cursor = found + 1;
  }
  // A igualdad de coincidencias, gana la etiqueta más corta (más específica).
  return { score: score - Math.floor(text.length / 12), matches };
}

/** Ordena por relevancia; con consulta vacía respeta el orden de registro. */
export function filterActions(actions: readonly CommandAction[], query: string): ScoredAction[] {
  const trimmed = query.trim();
  if (trimmed === '') {
    return actions.map((action) => ({ action, score: 0, matches: [] }));
  }
  const scored: ScoredAction[] = [];
  for (const action of actions) {
    const direct = fuzzyMatch(action.label, trimmed);
    const byKeyword = direct
      ? null
      : (action.keywords ?? [])
        .map((keyword) => fuzzyMatch(keyword, trimmed))
        .find((result) => result !== null) ?? null;
    const result = direct ?? byKeyword;
    if (!result) continue;
    // Las disponibles van primero: son las que el usuario puede ejecutar ya.
    const bonus = isAvailable(action) ? 100 : 0;
    scored.push({ action, score: result.score + bonus, matches: direct ? result.matches : [] });
  }
  return scored.sort((left, right) => right.score - left.score);
}

/** Agrupa preservando el orden de aparición de cada grupo. */
export function groupActions(scored: readonly ScoredAction[]): Array<{ group: string; items: ScoredAction[] }> {
  const groups = new Map<string, ScoredAction[]>();
  for (const item of scored) {
    const existing = groups.get(item.action.group);
    if (existing) existing.push(item);
    else groups.set(item.action.group, [item]);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}
