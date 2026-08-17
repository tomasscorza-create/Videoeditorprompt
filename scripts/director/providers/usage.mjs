const TOKEN_FIELDS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'cacheWriteTokens',
  'totalTokens',
]);

export function normalizeProviderUsage(value = {}, overrides = {}) {
  const inputTokens = finiteOrNull(value.inputTokens ?? value.promptEvalCount);
  const outputTokens = finiteOrNull(value.outputTokens ?? value.evalCount);
  const cachedInputTokens = finiteOrNull(value.cachedInputTokens) ?? 0;
  const cacheWriteTokens = finiteOrNull(value.cacheWriteTokens) ?? 0;
  const reportedTotal = finiteOrNull(value.totalTokens);
  const calculatedTotal = inputTokens === null && outputTokens === null
    ? null
    : (inputTokens ?? 0) + (outputTokens ?? 0);
  const totalTokens = reportedTotal ?? calculatedTotal;
  const requestCount = integerOr(value.requestCount, 1);
  const transportAttempts = integerOr(value.transportAttempts, requestCount);
  const retryCount = integerOr(value.retryCount, Math.max(0, transportAttempts - requestCount));
  return {
    version: 1,
    requestCount,
    transportAttempts,
    retryCount,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheWriteTokens,
    uncachedInputTokens: inputTokens === null ? null : Math.max(0, inputTokens - cachedInputTokens),
    totalTokens,
    // Alias de compatibilidad con Ollama y los consumidores anteriores.
    promptEvalCount: inputTokens,
    evalCount: outputTokens,
    totalDurationNanoseconds: finiteOrNull(value.totalDurationNanoseconds),
    elapsedMilliseconds: finiteOrNull(value.elapsedMilliseconds),
    ...overrides,
  };
}

export function aggregateProviderUsage(entries, overrides = {}) {
  const values = entries.filter((entry) => entry && typeof entry === 'object');
  if (values.length === 0) return normalizeProviderUsage({ requestCount: 0, transportAttempts: 0, retryCount: 0 }, overrides);
  const sums = Object.fromEntries(TOKEN_FIELDS.map((field) => [field, sumNullable(values, field)]));
  const inputTokens = sums.inputTokens ?? sumNullable(values, 'promptEvalCount');
  const outputTokens = sums.outputTokens ?? sumNullable(values, 'evalCount');
  const totalTokens = sums.totalTokens ?? (inputTokens === null && outputTokens === null
    ? null
    : (inputTokens ?? 0) + (outputTokens ?? 0));
  return normalizeProviderUsage({
    ...sums,
    inputTokens,
    outputTokens,
    totalTokens,
    requestCount: sumInteger(values, 'requestCount', 1),
    transportAttempts: sumInteger(values, 'transportAttempts', 1),
    retryCount: sumInteger(values, 'retryCount', 0),
    totalDurationNanoseconds: sumNullable(values, 'totalDurationNanoseconds'),
    elapsedMilliseconds: sumNullable(values, 'elapsedMilliseconds'),
  }, overrides);
}

export function assertWithinTokenBudget(usage, maximumTokens) {
  if (!Number.isInteger(maximumTokens) || maximumTokens <= 0) return;
  const consumed = finiteOrNull(usage?.totalTokens);
  if (consumed !== null && consumed > maximumTokens) {
    throw new PipelineError({
      code: 'DIRECTOR_TOKEN_BUDGET_EXCEEDED',
      stage: 'directing',
      message: 'La creación alcanzó el límite de tokens configurado.',
      technicalDetail: `consumed=${consumed}; maximum=${maximumTokens}`,
      suggestedAction: 'Reducí la cantidad de escenas, usá el modelo local o ampliá el presupuesto configurado.',
    });
  }
}

function sumNullable(values, field) {
  const numbers = values.map((entry) => finiteOrNull(entry[field])).filter((value) => value !== null);
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null;
}

function sumInteger(values, field, fallback) {
  return values.reduce((total, entry) => total + integerOr(entry[field], fallback), 0);
}

function finiteOrNull(value) {
  return Number.isFinite(value) && value >= 0 ? Number(value) : null;
}

function integerOr(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
import { PipelineError } from '../../stage1/errors.mjs';
