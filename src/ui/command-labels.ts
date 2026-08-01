// C3/U1 — Traducción de los comandos del motor a lenguaje de usuario.
// Módulo puro y testeable, compartido por el resumen «qué cambió» de una
// edición IA y por el relato de undo/redo.
//
// Regla: si un comando no está mapeado no se inventa una descripción; se
// devuelve una forma legible de su propio tipo. Así, agregar un comando nuevo
// al motor degrada a texto pobre pero nunca a texto falso.

export interface CommandLike {
  type?: unknown;
  [key: string]: unknown;
}

/** Contexto opcional para nombrar escenas por su número en vez de su id. */
export interface LabelContext {
  /** Orden de las escenas del proyecto, para traducir sceneId → «escena 2». */
  sceneIds?: readonly string[];
}

function sceneName(sceneId: unknown, context?: LabelContext): string {
  if (typeof sceneId !== 'string') return 'una escena';
  const index = context?.sceneIds?.indexOf(sceneId) ?? -1;
  return index >= 0 ? `la escena ${index + 1}` : 'una escena';
}

/** Nombre del parámetro animable en lenguaje de usuario, no en vocabulario del motor. */
const PARAMETER_NAMES: Record<string, string> = {
  'position.x': 'la posición horizontal',
  'position.y': 'la posición vertical',
  scale: 'la escala',
  rotationDegrees: 'la rotación',
  opacity: 'la opacidad',
  armRaise: 'el brazo derecho',
  leftArmRaise: 'el brazo izquierdo',
  rightElbowBend: 'el codo derecho',
  leftElbowBend: 'el codo izquierdo',
  headTilt: 'la inclinación de la cabeza',
  headNod: 'el asentimiento',
  bodyLean: 'la inclinación del cuerpo',
  bodyBounce: 'el rebote del cuerpo',
};

function parameterName(parameterId: unknown): string {
  return typeof parameterId === 'string' ? PARAMETER_NAMES[parameterId] ?? parameterId : 'un parámetro';
}

/** Forma con preposición, contrayendo «de el» en «del». */
function ofParameter(parameterId: unknown): string {
  const name = parameterName(parameterId);
  return name.startsWith('el ') ? `del ${name.slice(3)}` : `de ${name}`;
}

const LABELS: Record<string, (command: CommandLike, context?: LabelContext) => string> = {
  'add-scene': () => 'Agregó una escena',
  'delete-scene': (command, context) => `Eliminó ${sceneName(command.sceneId, context)}`,
  'duplicate-scene': (command, context) => `Duplicó ${sceneName(command.sceneId, context)}`,
  'split-scene': (command, context) => `Dividió ${sceneName(command.sceneId, context)}`,
  'reorder-scenes': () => 'Reordenó las escenas',
  'set-scene-title': (command, context) => `Renombró ${sceneName(command.sceneId, context)}`,
  'set-project-title': () => 'Cambió el título del proyecto',
  'set-scene-background': (command, context) => `Cambió el fondo de ${sceneName(command.sceneId, context)}`,
  'set-transition': (command, context) => `Ajustó la transición que sale de ${sceneName(command.sceneId, context)}`,
  'add-character': (command, context) => `Agregó un personaje en ${sceneName(command.sceneId, context)}`,
  'add-prop': (command, context) => `Agregó un prop en ${sceneName(command.sceneId, context)}`,
  'set-prop-resource': (command, context) => `Cambió un prop de ${sceneName(command.sceneId, context)}`,
  'delete-element': (command, context) => `Quitó un elemento de ${sceneName(command.sceneId, context)}`,
  'place-character-resource': (command, context) => `Colocó un personaje en ${sceneName(command.sceneId, context)}`,
  'set-character-resource': (command, context) => `Cambió el personaje de ${sceneName(command.sceneId, context)}`,
  'set-character-animation': (command, context) => `Cambió el movimiento de un personaje en ${sceneName(command.sceneId, context)}`,
  'set-character-transform': (command, context) => `Movió un personaje en ${sceneName(command.sceneId, context)}`,
  'set-element-transform': (command, context) => `Ajustó un elemento en ${sceneName(command.sceneId, context)}`,
  'add-dialogue-turn': (command, context) => `Agregó un diálogo en ${sceneName(command.sceneId, context)}`,
  'delete-dialogue-turn': (command, context) => `Eliminó un diálogo de ${sceneName(command.sceneId, context)}`,
  'set-dialogue-turn': (command, context) => `Cambió un diálogo de ${sceneName(command.sceneId, context)}`,
  'set-dialogue-speaker': (command, context) => `Cambió quién habla en ${sceneName(command.sceneId, context)}`,
  'reorder-dialogue-turns': (command, context) => `Reordenó los diálogos de ${sceneName(command.sceneId, context)}`,
  'split-dialogue-turn': (command, context) => `Cortó un diálogo de ${sceneName(command.sceneId, context)}`,
  // Animación. Se nombra el preset cuando el comando lo trae: «Aplicó enter-left»
  // le dice al usuario qué deshace, y «Aplicó un movimiento» no.
  'apply-animation-preset': (command, context) => {
    const preset = typeof command.presetId === 'string' ? `«${command.presetId}»` : 'un movimiento';
    return `Aplicó ${preset} a un personaje de ${sceneName(command.sceneId, context)}`;
  },
  'create-track': (command, context) => `Animó ${parameterName(command.parameterId)} de un personaje en ${sceneName(command.sceneId, context)}`,
  'add-keyframe': (command, context) => `Agregó un keyframe ${ofParameter(command.parameterId)} en ${sceneName(command.sceneId, context)}`,
  'set-keyframe': (command, context) => `Ajustó un keyframe ${ofParameter(command.parameterId)} en ${sceneName(command.sceneId, context)}`,
  'delete-keyframe': (command, context) => `Eliminó un keyframe ${ofParameter(command.parameterId)} en ${sceneName(command.sceneId, context)}`,
  'delete-track': (command, context) => `Quitó la animación ${ofParameter(command.parameterId)} en ${sceneName(command.sceneId, context)}`,
  'remove-animation': (command, context) => `Quitó la animación ${ofParameter(command.parameterId)} en ${sceneName(command.sceneId, context)}`,
};

export function describeCommand(command: CommandLike, context?: LabelContext): string {
  const type = typeof command.type === 'string' ? command.type : '';
  const label = LABELS[type];
  if (label) return label(command, context);
  return type ? `Aplicó ${type.replace(/-/gu, ' ')}` : 'Aplicó un cambio';
}

/**
 * Resumen de una tanda de comandos. Los cambios repetidos se agrupan
 * («Cambió un diálogo de la escena 2 (×3)») para que el resumen quede legible
 * cuando la IA toca muchas cosas a la vez.
 */
export function describeCommands(
  commands: readonly CommandLike[],
  context?: LabelContext,
  maximum = 4,
): string[] {
  const counts = new Map<string, number>();
  for (const command of commands) {
    const label = describeCommand(command, context);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const entries = [...counts.entries()].map(([label, count]) => (count > 1 ? `${label} (×${count})` : label));
  if (entries.length <= maximum) return entries;
  const rest = entries.length - maximum;
  return [...entries.slice(0, maximum), `y ${rest} cambio${rest === 1 ? '' : 's'} más`];
}

/** Texto de una línea para notificación o toast. */
export function summarizeCommands(commands: readonly CommandLike[], context?: LabelContext): string {
  if (commands.length === 0) return 'El Director no encontró cambios para aplicar.';
  return describeCommands(commands, context).join(' · ');
}
