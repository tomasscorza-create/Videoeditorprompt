import type { DirectorStatus } from './api.js';

export function describeDirectorProgress(status: DirectorStatus): string | null {
  if (status.state === 'idle') return null;
  if (status.state === 'cancelling' || status.stage === 'cancelling') return 'Cancelando el trabajo del Director…';

  const candidate = status.candidateIndex && status.candidateCount
    ? ` ${status.candidateIndex} de ${status.candidateCount}`
    : '';
  const segment = status.segmentIndex && status.segmentCount
    ? ` · bloque ${status.segmentIndex} de ${status.segmentCount}`
    : '';
  const repairing = (status.attempt ?? 1) > 1;
  const messages: Record<string, string> = {
    checking_model: 'Comprobando el proveedor y el modelo de IA…',
    preparing_context: 'Preparando recursos y contexto del proyecto…',
    cache: 'Recuperando una propuesta ya calculada…',
    generating_questions: 'Preparando tres preguntas para personalizar tu idea…',
    validating_questions: 'Revisando que las preguntas sean claras y útiles…',
    repairing_questions: 'Ajustando las preguntas al formato correcto…',
    generating: repairing ? `Reparando la propuesta${candidate}${segment}…` : `Generando la propuesta${candidate}${segment}…`,
    validating: `Validando la propuesta${candidate}…`,
    comparing: 'Comparando las propuestas y eligiendo la más sólida…',
    repairing: 'Reparando la propuesta mejor puntuada…',
    applying: 'Validando los cambios antes de presentarlos…',
    finalizing: 'Preparando el resultado editable…',
  };
  return messages[status.stage] ?? 'El Director sigue trabajando…';
}
