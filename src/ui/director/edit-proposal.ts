export interface DirectorEditExplanation {
  summary: string;
  changes: string[];
  customizedTrackRemovalIndexes: number[];
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

export function formatCustomizedRemovalConfirmation(explanation: DirectorEditExplanation): string {
  const protectedChanges = explanation.customizedTrackRemovalIndexes
    .map((index) => explanation.changes[index])
    .filter((change): change is string => typeof change === 'string')
    .map((change) => `• ${change}`)
    .join('\n');
  return [
    'Esta propuesta elimina animación creada o ajustada manualmente.',
    protectedChanges,
    'Esta acción conservará un único paso de deshacer, pero reemplazará ese trabajo si continuás.',
    '¿Confirmás la eliminación personalizada?',
  ].filter(Boolean).join('\n\n');
}

/**
 * Solo la aprobación humana en la UI añade `confirmCustomized`. El modelo y el
 * servidor de propuestas nunca pueden otorgarse esa autorización.
 */
export function authorizeCustomizedRemovals(
  commands: ReadonlyArray<Record<string, unknown>>,
  indexes: readonly number[],
): Array<Record<string, unknown>> {
  const authorized = new Set(indexes);
  return commands.map((command, index) => (
    authorized.has(index) && command.type === 'remove-animation'
      ? { ...command, confirmCustomized: true }
      : { ...command }
  ));
}
