export interface DirectorEditExplanation {
  summary: string;
  changes: string[];
  customizedTrackRemovalIndexes: number[];
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
