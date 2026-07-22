const MAX_DETAIL_LENGTH = 4000;

export class PipelineError extends Error {
  constructor({ code, stage, message, technicalDetail, cause, suggestedAction }) {
    super(message, cause instanceof Error ? { cause } : undefined);
    this.name = 'PipelineError';
    this.code = code;
    this.stage = stage;
    this.technicalDetail = technicalDetail;
    this.pipelineCause = cause instanceof Error ? cause.message : cause;
    this.suggestedAction = suggestedAction;
  }
}

export function serializeError(error, fallbackStage = 'pipeline') {
  const value = error instanceof Error ? error : new Error(String(error));
  const serialized = {
    stage: value.stage || fallbackStage,
    code: value.code || 'UNEXPECTED_ERROR',
    message: value.message || 'Ocurrió un error inesperado.',
  };
  const technicalDetail = boundedDetail(value.technicalDetail);
  const cause = boundedDetail(value.pipelineCause || value.cause?.message);
  const suggestedAction = boundedDetail(value.suggestedAction);
  if (technicalDetail) serialized.technicalDetail = technicalDetail;
  if (cause && cause !== serialized.message) serialized.cause = cause;
  if (suggestedAction) serialized.suggestedAction = suggestedAction;
  return serialized;
}

function boundedDetail(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length <= MAX_DETAIL_LENGTH ? text : `${text.slice(0, MAX_DETAIL_LENGTH)}…`;
}
