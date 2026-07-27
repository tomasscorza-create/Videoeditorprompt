export const DIRECTOR_QUALITY_VERSION = 1;
export const DIRECTOR_QUALITY_FLOOR = 55;

const STOP_WORDS = new Set([
  'algo', 'como', 'con', 'del', 'ella', 'esta', 'este', 'las', 'los', 'para', 'por',
  'que', 'sin', 'sobre', 'sus', 'una',
]);

const CANDIDATE_STRATEGIES = Object.freeze([
  {
    id: 'directo-practico',
    instruction: 'Enfoque directo y práctico: abrí con el problema concreto, explicá una idea central y cerrá con una acción útil.',
  },
  {
    id: 'contraste',
    instruction: 'Enfoque por contraste: enfrentá una expectativa común con la realidad y resolvé la tensión sin repetir ideas.',
  },
  {
    id: 'ejemplo-concreto',
    instruction: 'Enfoque mediante ejemplo: usá una situación concreta para demostrar la idea y extraé una conclusión memorable.',
  },
]);

export function candidateStrategy(index) {
  return CANDIDATE_STRATEGIES[index % CANDIDATE_STRATEGIES.length];
}

export function editorialWordBudgets(targetDurationSeconds, sceneCount) {
  const maximumWords = Math.max(40, Math.ceil(Number(targetDurationSeconds) * 3.2));
  const count = Math.max(1, Number(sceneCount) || 1);
  const scenes = sceneWeights(count).map((weight, index) => {
    const words = Math.max(8, Math.round(maximumWords * weight));
    return {
      scene: index + 1,
      maximumWords: words,
      suggestedTurnWords: Math.max(4, Math.floor(words / 3)),
    };
  });
  scenes.at(-1).maximumWords += maximumWords
    - scenes.reduce((total, scene) => total + scene.maximumWords, 0);
  return { maximumWords, scenes };
}

export function analyzeDirectorPlanQuality(plan, options = {}) {
  const issues = [];
  const promptTokens = meaningfulTokens(options.prompt || '');
  const turns = plan.scenes.flatMap((scene) => scene.dialogue);
  const texts = turns.map((turn) => turn.text.trim());
  const wordsByScene = plan.scenes.map((scene) => (
    scene.dialogue.reduce((total, turn) => total + wordCount(turn.text), 0)
  ));
  const totalWords = wordsByScene.reduce((total, words) => total + words, 0);
  const firstText = texts[0] || '';
  const lastText = texts.at(-1) || '';

  addIssue(issues, /^(?:hola\b|hoy (?:vamos|te voy)|en este video\b|¿?sab[ií]as que\b)/iu.test(firstText),
    'GENERIC_HOOK', 16, 'Reemplazá la apertura genérica por una tensión, dato o afirmación específica.');
  addIssue(issues, wordCount(firstText) < 5,
    'WEAK_HOOK', 9, 'El gancho inicial es demasiado corto para plantear una idea clara.');
  addIssue(issues, wordCount(lastText) < 5,
    'WEAK_ENDING', 9, 'El cierre necesita una conclusión más concreta o memorable.');
  addIssue(issues, /\?\s*$/u.test(lastText),
    'OPEN_ENDING', 4, 'Cerrá con una conclusión o acción, no solamente con una pregunta.');

  const planTokens = meaningfulTokens([
    plan.title,
    ...plan.scenes.flatMap((scene) => [scene.title, scene.purpose, ...scene.dialogue.map((turn) => turn.text)]),
  ].join(' '));
  const relevance = tokenCoverage(promptTokens, planTokens);
  addIssue(issues, promptTokens.size >= 2 && relevance === 0,
    'LOW_RELEVANCE', 24, 'El guion no conserva los conceptos principales de la idea del usuario.');
  addIssue(issues, promptTokens.size >= 3 && relevance > 0 && relevance < 0.2,
    'PARTIAL_RELEVANCE', 9, 'Reforzá la relación del guion con los conceptos centrales pedidos.');

  let repeatedPairs = 0;
  for (let left = 0; left < texts.length; left += 1) {
    for (let right = left + 1; right < texts.length; right += 1) {
      if (jaccard(meaningfulTokens(texts[left]), meaningfulTokens(texts[right])) >= 0.72) repeatedPairs += 1;
    }
  }
  addIssue(issues, repeatedPairs > 0,
    'REPETITIVE_TURNS', Math.min(18, repeatedPairs * 8), 'Los turnos deben avanzar la idea sin reformular lo mismo.');

  const largestSceneShare = totalWords > 0 ? Math.max(...wordsByScene) / totalWords : 0;
  addIssue(issues, plan.scenes.length > 1 && largestSceneShare > 0.72,
    'UNBALANCED_SCENES', 12, 'Redistribuí el diálogo para que una sola escena no concentre casi todo el guion.');

  let speakerRun = 1;
  let maximumSpeakerRun = 1;
  for (let index = 1; index < turns.length; index += 1) {
    speakerRun = turns[index].speaker === turns[index - 1].speaker ? speakerRun + 1 : 1;
    maximumSpeakerRun = Math.max(maximumSpeakerRun, speakerRun);
  }
  addIssue(issues, maximumSpeakerRun > 2,
    'SPEAKER_MONOLOGUE', 6, 'Alterná mejor las intervenciones para que el diálogo tenga ritmo.');

  const ttsProblems = texts.reduce((total, text) => total
    + (/(?:https?:\/\/|www\.)/iu.test(text) ? 1 : 0)
    + (/[\p{Extended_Pictographic}]/u.test(text) ? 1 : 0)
    + (/[()[\]{}]/u.test(text) ? 1 : 0)
    + (wordCount(text) > 32 ? 1 : 0), 0);
  addIssue(issues, ttsProblems > 0,
    'TTS_FRICTION', Math.min(20, ttsProblems * 5), 'Simplificá URLs, símbolos, acotaciones o frases largas para lectura TTS.');

  const score = Math.max(0, 100 - issues.reduce((total, issue) => total + issue.penalty, 0));
  return {
    version: DIRECTOR_QUALITY_VERSION,
    score,
    floor: DIRECTOR_QUALITY_FLOOR,
    passed: score >= DIRECTOR_QUALITY_FLOOR,
    issues,
    metrics: {
      totalWords,
      wordsByScene,
      largestSceneShare: Number(largestSceneShare.toFixed(3)),
      promptTokenCoverage: Number(relevance.toFixed(3)),
      repeatedPairs,
      ttsProblems,
    },
  };
}

export function qualityRepairFeedback(report) {
  return report.issues.slice(0, 4).map((issue) => issue.instruction).join(' ');
}

function sceneWeights(count) {
  if (count === 1) return [1];
  if (count === 2) return [0.55, 0.45];
  const middleWeight = 0.52 / (count - 2);
  return [0.27, ...Array.from({ length: count - 2 }, () => middleWeight), 0.21];
}

function addIssue(issues, condition, code, penalty, instruction) {
  if (condition) issues.push({ code, penalty, instruction });
}

function meaningfulTokens(value) {
  return new Set(String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)));
}

function tokenCoverage(expected, actual) {
  if (expected.size === 0) return 1;
  let matches = 0;
  for (const token of expected) if (actual.has(token)) matches += 1;
  return matches / expected.size;
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function wordCount(text) {
  return String(text).trim().split(/\s+/u).filter(Boolean).length;
}
