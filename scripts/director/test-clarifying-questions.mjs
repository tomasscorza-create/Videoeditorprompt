import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createClarifyingQuestions,
  formatPersonalizedPrompt,
} from './clarifying-questions.mjs';

const sample = {
  version: 1,
  questions: [
    { id: 'audiencia', kind: 'choice', prompt: '¿A quién querés dirigir el mensaje?', multiple: false, options: [{ id: 'curiosos', label: 'Personas curiosas' }, { id: 'expertos', label: 'Profesionales expertos' }, { id: 'estudiantes', label: 'Estudiantes' }], otherPlaceholder: 'Ejemplo: emprendedores sin experiencia técnica' },
    { id: 'enfoque', kind: 'choice', prompt: '¿Qué enfoque querés para la explicación?', multiple: false, options: [{ id: 'practico', label: 'Ejemplos prácticos' }, { id: 'conceptual', label: 'Conceptos simples' }, { id: 'comparativo', label: 'Comparación de casos' }], otherPlaceholder: 'Ejemplo: una historia con humor' },
    { id: 'detalle', kind: 'choice', prompt: '¿Qué detalle concreto no debería faltar?', multiple: false, options: [{ id: 'busqueda', label: 'Una búsqueda cotidiana' }, { id: 'trabajo', label: 'Una situación laboral' }, { id: 'noticia', label: 'Una noticia viral' }], otherPlaceholder: 'Ejemplo: una compra por internet' },
  ],
};

function ollamaResponse(value) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      message: { content: JSON.stringify(value) },
      prompt_eval_count: 12,
      eval_count: 34,
      total_duration: 56,
    }),
  };
}

const fetchImpl = async (_url, options) => {
  const request = JSON.parse(options.body);
  assert.equal(request.format.properties.questions.minItems, 3);
  assert.equal(request.format.properties.version.type, 'integer');
  assert.equal(request.format.$defs.choiceQuestion.properties.kind.type, 'string');
  assert.equal(request.format.$defs.choiceQuestion.properties.multiple.type, 'boolean');
  assert.match(request.messages[1].content, /inteligencia artificial/u);
  return ollamaResponse(sample);
};

const cacheRoot = mkdtempSync(path.join(tmpdir(), 'director-questions-'));
try {
  const result = await createClarifyingQuestions({
    prompt: 'Un video educativo sobre inteligencia artificial.',
    constraints: { planVersion: 2, targetDurationSeconds: 30 },
    provider: 'ollama',
    model: 'qwen3:8b',
    fetchImpl,
    cacheRoot,
    useCache: false,
  });
  assert.equal(result.questions.length, 3);
  assert.equal(result.questionContract, 2);
  assert.deepEqual(result.questions.map((question) => question.kind), ['choice', 'choice', 'choice']);
  assert.equal(result.questions.every((question) => question.options.length === 3), true);
  assert.equal(result.questions.every((question) => question.multiple === false), true);
  assert.equal(result.questions.every((question) => question.otherPlaceholder.length > 0), true);

  const fourOptions = structuredClone(sample);
  fourOptions.questions[0].options.push({ id: 'familias', label: 'Familias' });
  fourOptions.questions[0].id = 'AUDIENCIA_PRINCIPAL';
  const normalizedOptions = await createClarifyingQuestions({
    prompt: 'Un video educativo sobre inteligencia artificial.',
    provider: 'ollama',
    fetchImpl: async () => ollamaResponse(fourOptions),
    cacheRoot,
    useCache: false,
  });
  assert.equal(normalizedOptions.questions[0].options.length, 3);
  assert.equal(normalizedOptions.questions[0].id, 'audiencia-principal');

  const missingOther = structuredClone(sample);
  delete missingOther.questions[1].otherPlaceholder;
  const normalizedOther = await createClarifyingQuestions({
    prompt: 'Un video educativo sobre inteligencia artificial.',
    provider: 'ollama',
    fetchImpl: async () => ollamaResponse(missingOther),
    cacheRoot,
    useCache: false,
  });
  assert.equal(normalizedOther.questions[1].otherPlaceholder, 'Escribí una alternativa breve.');

  const incomplete = structuredClone(sample);
  incomplete.questions[2].options = incomplete.questions[2].options.slice(0, 2);
  let repairCalls = 0;
  const repaired = await createClarifyingQuestions({
    prompt: 'Un video educativo sobre inteligencia artificial.',
    provider: 'ollama',
    fetchImpl: async () => {
      repairCalls += 1;
      return ollamaResponse(repairCalls === 1 ? incomplete : sample);
    },
    cacheRoot,
    useCache: false,
  });
  assert.equal(repairCalls, 2);
  assert.equal(repaired.repairAttempts, 1);
  assert.equal(repaired.questions[2].options.length, 3);
  assert.equal(repaired.usage.requestCount, 2);
  assert.equal(repaired.usage.inputTokens, 24);
  assert.equal(repaired.usage.outputTokens, 68);

  const cachedPrompt = 'Una idea distinta para comprobar la caché de preguntas.';
  const filesBeforeCachedPrompt = new Set(readdirSync(cacheRoot));
  await createClarifyingQuestions({
    prompt: cachedPrompt,
    provider: 'ollama',
    fetchImpl: async () => ollamaResponse(sample),
    cacheRoot,
    useCache: false,
  });
  const cachedQuestions = await createClarifyingQuestions({
    prompt: cachedPrompt,
    provider: 'ollama',
    fetchImpl: async () => { throw new Error('no debe consultar el proveedor'); },
    cacheRoot,
  });
  assert.equal(cachedQuestions.cacheHit, true);
  assert.equal(cachedQuestions.usage.currentRequestCount, 0);

  const cachedFileName = readdirSync(cacheRoot).find((name) => name.endsWith('.json') && !filesBeforeCachedPrompt.has(name));
  assert.ok(cachedFileName);
  const corruptFile = path.join(cacheRoot, cachedFileName);
  writeFileSync(corruptFile, '{"version":1,"questions":[]}', 'utf8');
  let recoveryCalls = 0;
  const recovered = await createClarifyingQuestions({
    prompt: cachedPrompt,
    provider: 'ollama',
    fetchImpl: async () => { recoveryCalls += 1; return ollamaResponse(sample); },
    cacheRoot,
  });
  assert.equal(recoveryCalls, 1);
  assert.equal(recovered.cacheHit, false);

  const personalized = formatPersonalizedPrompt('Idea original.', [
    { question: sample.questions[0].prompt, answer: 'Personas curiosas' },
    { question: sample.questions[1].prompt, answer: 'Ejemplos prácticos y conceptos simples' },
    { question: sample.questions[2].prompt, answer: 'Una búsqueda cotidiana' },
  ]);
  assert.match(personalized, /^Idea original\./u);
  assert.match(personalized, /Decisiones de personalización confirmadas/u);
  assert.match(personalized, /Una búsqueda cotidiana/u);
  assert.equal(formatPersonalizedPrompt('Idea original.', []), 'Idea original.');
  assert.throws(
    () => formatPersonalizedPrompt('Idea original.', [{ question: 'Pregunta válida', answer: 'Sí' }]),
    (error) => error.code === 'DIRECTOR_PERSONALIZATION_INVALID',
  );
} finally {
  rmSync(cacheRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ version: 1, passed: 30, failed: 0 })}\n`);
