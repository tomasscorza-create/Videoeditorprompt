export interface DirectorEditExplanation {
  summary: string;
  changes: string[];
}

/**
 * Texto de aprobación previo a una edición del Director.
 *
 * La explicación viene del servidor después de validar el lote contra el
 * proyecto. La UI solo la presenta: no vuelve a interpretar los comandos ni
 * inventa consecuencias.
 */
export function formatDirectorEditConfirmation(explanation: DirectorEditExplanation): string {
  const changes = explanation.changes.map((change) => `• ${change}`).join('\n');
  return [
    explanation.summary,
    changes,
    'El proyecto todavía no fue modificado.',
    '¿Querés aplicar estos cambios?',
  ].filter(Boolean).join('\n\n');
}
