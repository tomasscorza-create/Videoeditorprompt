// E2a — Comparación de candidatos cuando el usuario pidió más de una propuesta.
// Módulo puro y testeable.
//
// Solo muestra lo que el juez evaluó. NO ofrece elegir otro candidato: la API
// devuelve el proyecto del ganador únicamente, así que permitir la selección
// sería simular una capacidad inexistente (eso es E2b, y necesita servidor).

import type { DirectorProposal } from './api.js';

const CRITERIA: Array<{ key: keyof CandidateScores; label: string }> = [
  { key: 'relevance', label: 'Relevancia' },
  { key: 'hook', label: 'Gancho' },
  { key: 'naturalness', label: 'Naturalidad' },
  { key: 'progression', label: 'Progresión' },
  { key: 'ending', label: 'Cierre' },
  { key: 'tone', label: 'Tono' },
  { key: 'tts', label: 'Locución' },
  { key: 'audiovisual', label: 'Audiovisual' },
];

export interface CandidateScores {
  relevance: number;
  hook: number;
  naturalness: number;
  progression: number;
  ending: number;
  tone: number;
  tts: number;
  audiovisual: number;
}

export interface CandidateRow {
  index: number;
  name: string;
  winner: boolean;
  total: number | null;
  scores: Array<{ label: string; value: number }>;
}

export interface CandidateComparison {
  criteria: string[];
  rows: CandidateRow[];
  /** Frase que explica por qué ganó el elegido. `null` si no hay totales. */
  verdict: string | null;
}

/** Devuelve null cuando no hubo comparación real (bestOf = 1 o sin scores). */
export function compareCandidates(selection: DirectorProposal['selection']): CandidateComparison | null {
  const scores = selection?.scores;
  if (!Array.isArray(scores) || scores.length < 2) return null;
  const totals = Array.isArray(selection.totals) ? selection.totals : null;
  const rows: CandidateRow[] = scores.map((score, index) => ({
    index,
    name: `Propuesta ${index + 1}`,
    winner: index === selection.winnerIndex,
    total: totals?.[index] ?? null,
    scores: CRITERIA.map(({ key, label }) => ({ label, value: score[key] })),
  }));
  return { criteria: CRITERIA.map((item) => item.label), rows, verdict: describeVerdict(rows) };
}

function describeVerdict(rows: CandidateRow[]): string | null {
  const winner = rows.find((row) => row.winner);
  if (!winner || winner.total === null) return null;
  const others = rows.filter((row) => !row.winner && row.total !== null);
  if (others.length === 0) return null;
  const best = Math.max(...others.map((row) => row.total as number));
  const margin = Math.round((winner.total - best) * 10) / 10;
  if (margin <= 0) return `Ganó ${winner.name} por desempate.`;
  return `Ganó ${winner.name} por ${margin} punto${margin === 1 ? '' : 's'} sobre la siguiente.`;
}

/** Criterio donde el ganador sacó más ventaja; útil para explicar el fallo. */
export function strongestCriterion(comparison: CandidateComparison): string | null {
  const winner = comparison.rows.find((row) => row.winner);
  if (!winner) return null;
  let best: { label: string; margin: number } | null = null;
  for (const [index, entry] of winner.scores.entries()) {
    const rivals = comparison.rows.filter((row) => !row.winner).map((row) => row.scores[index]?.value ?? 0);
    if (rivals.length === 0) continue;
    const margin = entry.value - Math.max(...rivals);
    if (!best || margin > best.margin) best = { label: entry.label, margin };
  }
  return best && best.margin > 0 ? best.label : null;
}
