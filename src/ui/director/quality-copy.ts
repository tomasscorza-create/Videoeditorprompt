// E1 — Traducción a lenguaje de usuario del reporte de calidad que ya produce
// el motor (scripts/director/plan-quality.mjs). Módulo puro y testeable.
//
// El score real es sobre 100, no sobre 10: se muestra tal cual para no
// deformar el dato. La `instruction` de cada issue ya viene redactada por el
// motor y se usa sin reescribir; acá solo se le pone un título corto.

import type { DirectorQualityReport } from './api.js';

const ISSUE_LABELS: Record<string, string> = {
  GENERIC_HOOK: 'Apertura genérica',
  WEAK_HOOK: 'Gancho inicial corto',
  WEAK_ENDING: 'Cierre débil',
  OPEN_ENDING: 'Cierre sin conclusión',
  LOW_RELEVANCE: 'Se aleja de tu idea',
  PARTIAL_RELEVANCE: 'Relación parcial con tu idea',
  REPETITIVE_TURNS: 'Diálogos que se repiten',
  UNBALANCED_SCENES: 'Ritmo desbalanceado',
  SPEAKER_MONOLOGUE: 'Un personaje habla de más',
  TTS_FRICTION: 'Texto difícil de locutar',
};

export interface QualityIssueView {
  code: string;
  label: string;
  instruction: string;
  penalty: number;
}

export interface QualitySummary {
  score: number;
  floor: number;
  passed: boolean;
  headline: string;
  issues: QualityIssueView[];
  repairNote: string | null;
}

/** Un código desconocido no se oculta: se muestra tal cual, legible. */
export function issueLabel(code: string): string {
  return ISSUE_LABELS[code] ?? code.toLowerCase().replace(/_/gu, ' ');
}

export function summarizeQuality(
  report: DirectorQualityReport | undefined,
  repairAttempts?: number,
): QualitySummary | null {
  if (!report) return null;
  const score = Math.round(report.score);
  const floor = Math.round(report.floor);
  const headline = report.passed
    ? `Calidad ${score} sobre 100 — supera el mínimo de ${floor}`
    : `Calidad ${score} sobre 100 — por debajo del mínimo de ${floor}`;
  return {
    score,
    floor,
    passed: report.passed,
    headline,
    issues: [...report.issues]
      .sort((left, right) => right.penalty - left.penalty)
      .map((issue) => ({
        code: issue.code,
        label: issueLabel(issue.code),
        instruction: issue.instruction,
        penalty: issue.penalty,
      })),
    repairNote: describeRepairs(repairAttempts),
  };
}

/** Solo se menciona la reparación si de verdad ocurrió. */
export function describeRepairs(repairAttempts?: number): string | null {
  if (!repairAttempts || repairAttempts < 1) return null;
  return repairAttempts === 1
    ? 'El Director reescribió la propuesta una vez para alcanzar la calidad mínima.'
    : `El Director reescribió la propuesta ${repairAttempts} veces para alcanzar la calidad mínima.`;
}
