import { PipelineError } from '../stage1/errors.mjs';

export const PLAN_JUDGE_VERSION = 1;

const SCORE_KEYS = ['hook', 'naturalness', 'ending', 'variety'];

export async function judgeDirectorPlans({
  provider,
  plans,
  model,
  signal,
  timeoutMs,
  seed,
}) {
  if (!Array.isArray(plans) || plans.length < 2 || plans.length > 3) {
    judgeError('DIRECTOR_JUDGE_INPUT_INVALID', 'El juez necesita entre dos y tres planes candidatos.');
  }
  const candidates = plans.map((plan, index) => ({
    index,
    scenes: plan.scenes.map((scene) => scene.dialogue.map((turn) => turn.text)),
  }));
  const schema = buildJudgeSchema(plans.length);
  const result = await provider.generatePlan({
    schema,
    signal,
    messages: [
      {
        role: 'system',
        content: [
          'Sos un juez de guiones breves para voz en videos verticales.',
          'Evaluá cada candidato de 0 a 3 en cuatro criterios:',
          '- hook: la primera línea despierta interés sin fórmulas repetidas.',
          '- naturalness: el diálogo suena natural al ser leído en voz alta.',
          '- ending: el cierre es útil o memorable.',
          '- variety: los turnos avanzan la idea sin repetirse.',
          'Elegí el mayor puntaje total. Ante empate, elegí el índice menor.',
          'Respondé únicamente el JSON pedido y no agregues explicaciones.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({ candidates }),
      },
    ],
    options: {
      model,
      temperature: 0,
      think: false,
      seed,
      maxOutputTokens: 512,
      timeoutMs,
    },
  });
  const decision = parseJudgeDecision(result.content, plans.length);
  return {
    ...decision,
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
          required: SCORE_KEYS,
          properties: Object.fromEntries(SCORE_KEYS.map((key) => [key, {
            type: 'integer',
            minimum: 0,
            maximum: 3,
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
    && value.scores.every((score) => SCORE_KEYS.every(
      (key) => Number.isInteger(score?.[key]) && score[key] >= 0 && score[key] <= 3,
    ));
  if (!validWinner || !validScores) {
    judgeError(
      'DIRECTOR_JUDGE_RESPONSE_INVALID',
      'El juez de propuestas devolvió una evaluación fuera del contrato.',
    );
  }
  const totals = value.scores.map((score) => SCORE_KEYS.reduce((total, key) => total + score[key], 0));
  const maximum = Math.max(...totals);
  return {
    winnerIndex: totals.indexOf(maximum),
    scores: value.scores,
  };
}

function judgeError(code, message) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message,
    suggestedAction: 'Volvé a intentar con una sola variante o revisá el proveedor de IA.',
  });
}
