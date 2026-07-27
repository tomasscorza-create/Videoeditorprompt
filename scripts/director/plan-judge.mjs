import { PipelineError } from '../stage1/errors.mjs';

export const PLAN_JUDGE_VERSION = 2;
export const PLAN_JUDGE_SCORE_KEYS = [
  'relevance',
  'hook',
  'naturalness',
  'progression',
  'ending',
  'tone',
  'tts',
  'audiovisual',
];
export const PLAN_JUDGE_QUALITY_FLOOR = 18;

export async function judgeDirectorPlans({
  provider,
  plans,
  prompt,
  constraints,
  templates,
  model,
  signal,
  timeoutMs,
  seed,
}) {
  if (!Array.isArray(plans) || plans.length < 2 || plans.length > 3) {
    judgeError('DIRECTOR_JUDGE_INPUT_INVALID', 'El juez necesita entre dos y tres planes candidatos.');
  }
  const candidates = plans.map(compactCandidate);
  const schema = buildJudgeSchema(plans.length);
  const result = await provider.generatePlan({
    schema,
    signal,
    messages: [
      {
        role: 'system',
        content: [
          'Sos un juez de guiones breves para voz en videos verticales.',
          'Evaluá cada candidato de 0 a 4 en ocho criterios:',
          '- relevance: responde fielmente la idea del usuario sin inventar otro tema.',
          '- hook: la primera línea despierta interés sin fórmulas repetidas.',
          '- naturalness: el diálogo suena natural al ser leído en voz alta.',
          '- progression: las escenas y turnos avanzan sin relleno ni repeticiones.',
          '- ending: el cierre es útil, concreto o memorable.',
          '- tone: respeta el tono editorial solicitado.',
          '- tts: evita frases extensas, siglas, símbolos y construcciones difíciles de pronunciar.',
          '- audiovisual: propósito, casting, gestos, cámara, layout y transiciones acompañan el contenido.',
          'Penalizá datos no respaldados o afirmaciones específicas que la idea no proporciona.',
          'Elegí el mayor puntaje total. Ante empate, elegí el índice menor.',
          'Respondé únicamente el JSON pedido y no agregues explicaciones.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          request: {
            idea: prompt,
            constraints,
            templates: (templates || []).map((template) => ({
              id: template.id,
              label: template.label,
              beats: template.beats,
            })),
          },
          candidates,
        }),
      },
    ],
    options: {
      model,
      temperature: 0,
      think: false,
      seed,
      maxOutputTokens: 900,
      timeoutMs,
    },
  });
  const decision = parseJudgeDecision(result.content, plans.length);
  const totals = decision.scores.map(totalScore);
  const maximumTotal = Math.max(...totals);
  return {
    ...decision,
    totals,
    maximumTotal,
    qualityFloor: PLAN_JUDGE_QUALITY_FLOOR,
    qualityFloorMet: maximumTotal >= PLAN_JUDGE_QUALITY_FLOOR,
    usage: result.usage || null,
  };
}

export function buildJudgeSchema(candidateCount) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['winnerIndex', 'scores'],
    properties: {
      winnerIndex: { type: 'integer', minimum: 0, maximum: candidateCount - 1 },
      scores: {
        type: 'array',
        minItems: candidateCount,
        maxItems: candidateCount,
        items: {
          type: 'object',
          additionalProperties: false,
          required: PLAN_JUDGE_SCORE_KEYS,
          properties: Object.fromEntries(PLAN_JUDGE_SCORE_KEYS.map((key) => [key, {
            type: 'integer',
            minimum: 0,
            maximum: 4,
          }])),
        },
      },
    },
  };
}

function parseJudgeDecision(content, candidateCount) {
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new PipelineError({
      code: 'DIRECTOR_JUDGE_RESPONSE_INVALID',
      stage: 'directing',
      message: 'El juez de propuestas devolvió contenido que no es JSON válido.',
      technicalDetail: error instanceof Error ? error.message : String(error),
      suggestedAction: 'Volvé a intentar con una sola variante o regenerá la propuesta.',
    });
  }
  const validWinner = Number.isInteger(value?.winnerIndex)
    && value.winnerIndex >= 0
    && value.winnerIndex < candidateCount;
  const validScores = Array.isArray(value?.scores)
    && value.scores.length === candidateCount
    && value.scores.every((score) => PLAN_JUDGE_SCORE_KEYS.every(
      (key) => Number.isInteger(score?.[key]) && score[key] >= 0 && score[key] <= 4,
    ));
  if (!validWinner || !validScores) {
    judgeError('DIRECTOR_JUDGE_RESPONSE_INVALID', 'El juez de propuestas devolvió una evaluación fuera del contrato.');
  }
  const totals = value.scores.map(totalScore);
  const maximum = Math.max(...totals);
  return {
    winnerIndex: totals.indexOf(maximum),
    scores: value.scores,
  };
}

function compactCandidate(plan, index) {
  return {
    index,
    title: plan.title,
    tone: plan.tone,
    narrativeTemplateId: plan.narrativeTemplateId,
    cast: plan.cast,
    musicResourceId: plan.musicResourceId || null,
    scenes: plan.scenes.map((scene) => ({
      title: scene.title,
      purpose: scene.purpose,
      backgroundResourceId: scene.backgroundResourceId,
      cameraPreset: scene.cameraPreset,
      layoutPreset: scene.layoutPreset,
      transitionPreset: scene.transitionPreset,
      dialogue: scene.dialogue,
    })),
  };
}

function totalScore(score) {
  return PLAN_JUDGE_SCORE_KEYS.reduce((total, key) => total + score[key], 0);
}

function judgeError(code, message) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message,
    suggestedAction: 'Volvé a intentar con una sola variante o revisá el proveedor de IA.',
  });
}
