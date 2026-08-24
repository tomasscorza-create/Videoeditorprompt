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

/**
 * Contabilidad preventiva para una operación del Director. Las reservas se
 * toman antes de invocar un proveedor y se reemplazan por el uso que éste
 * informa al finalizar. Así evitamos empezar candidatos, reparaciones o jueces
 * que no caben dentro del tope local; un reintento de transporte sigue siendo
 * inevitablemente una estimación de costo remoto hasta que OpenAI informe uso.
 */
export function createDirectorUsageLedger(options = {}) {
  const maximumTokens = positiveIntegerOrNull(options.maximumTokens);
  const limits = Object.fromEntries(Object.entries(options.limits || {}).map(([key, value]) => [key, positiveIntegerOrNull(value)]));
  const settled = [];
  const reservations = new Map();
  let nextId = 1;
  const totalFor = (category = null) => aggregateProviderUsage(settled.filter((entry) => category === null || entry.category === category).map((entry) => entry.usage)).totalTokens ?? 0;
  const reservedFor = (category = null) => [...reservations.values()]
    .filter((entry) => category === null || entry.category === category)
    .reduce((total, entry) => total + entry.tokens, 0);
  return Object.freeze({
    reserve(category, request = {}) {
      const inputTokens = Math.max(0, Math.ceil(Number(request.inputTokens) || 0));
      const requestedOutput = Math.max(1, Math.floor(Number(request.maxOutputTokens) || 0));
      const categoryLimit = limits[category] ?? maximumTokens;
      const globalRemaining = maximumTokens === null ? Infinity : maximumTokens - totalFor() - reservedFor();
      const categoryRemaining = categoryLimit === null || categoryLimit === undefined ? Infinity : categoryLimit - totalFor(category) - reservedFor(category);
      const available = Math.min(globalRemaining, categoryRemaining);
      const maximumOutputTokens = Math.min(requestedOutput, Math.floor(available - inputTokens));
      if (maximumOutputTokens < 1) throw budgetExceeded(category, maximumTokens, categoryLimit, available, inputTokens);
      const reservation = Object.freeze({ id: nextId++, category, inputTokens, maxOutputTokens: maximumOutputTokens, tokens: inputTokens + maximumOutputTokens });
      reservations.set(reservation.id, reservation);
      return reservation;
    },
    settle(reservation, usage = null) {
      if (!reservation || !reservations.delete(reservation.id)) return;
      // Cuando un proveedor no informa uso (Ollama o fallo de red), se conserva
      // la reserva: es la única forma de no abrir solicitudes sucesivas sin un
      // margen conocido.
      settled.push({ category: reservation.category, usage: normalizeProviderUsage(usage || {
        inputTokens: reservation.inputTokens,
        outputTokens: reservation.maxOutputTokens,
        totalTokens: reservation.tokens,
        requestCount: 1,
      }) });
    },
    cancel(reservation) {
      if (reservation) reservations.delete(reservation.id);
    },
    remaining(category = null) {
      const limit = category === null ? maximumTokens : (limits[category] ?? maximumTokens);
      return limit === null || limit === undefined ? null : Math.max(0, limit - totalFor(category) - reservedFor(category));
    },
    usage(overrides = {}) {
      return aggregateProviderUsage(settled.map((entry) => entry.usage), {
        ...overrides,
        reservedTokens: reservedFor(),
        remainingTokens: maximumTokens === null ? null : Math.max(0, maximumTokens - totalFor() - reservedFor()),
      });
    },
  });
}

export function estimateDirectorInputTokens(messages) {
  const text = Array.isArray(messages)
    ? messages.map((message) => typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '')).join('\n')
    : String(messages ?? '');
  return Math.max(1, Math.ceil(text.length / 4));
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

function positiveIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
}

function budgetExceeded(category, maximumTokens, categoryLimit, available, inputTokens) {
  return new PipelineError({
    code: 'DIRECTOR_TOKEN_BUDGET_RESERVED',
    stage: 'directing',
    message: 'El tope operativo local no alcanza para iniciar otra solicitud del Director.',
    technicalDetail: `category=${category}; maximum=${maximumTokens}; categoryMaximum=${categoryLimit}; available=${available}; estimatedInput=${inputTokens}`,
    suggestedAction: 'Reducí la solicitud, usá el modelo local o ampliá el tope operativo local.',
  });
}
import { PipelineError } from '../../stage1/errors.mjs';
