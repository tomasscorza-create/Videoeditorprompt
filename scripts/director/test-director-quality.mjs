import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRoot, readJson } from '../stage1/common.mjs';
import {
  analyzeDirectorPlanQuality,
  candidateStrategy,
  DIRECTOR_QUALITY_FLOOR,
  editorialWordBudgets,
} from './plan-quality.mjs';

const benchmark = readJson(path.join(projectRoot, 'scripts', 'director', 'fixtures', 'quality-prompts.json'));
assert.equal(benchmark.version, 1);
assert.ok(benchmark.cases.length >= 15);
assert.equal(new Set(benchmark.cases.map((entry) => entry.id)).size, benchmark.cases.length);
assert.deepEqual(
  [...new Set(benchmark.cases.map((entry) => entry.tone))].sort(),
  ['educational', 'energetic', 'inspirational', 'ironic', 'serious'],
);
assert.ok(new Set(benchmark.cases.map((entry) => entry.targetDurationSeconds)).size >= 5);
assert.deepEqual([...new Set(benchmark.cases.map((entry) => entry.sceneCount))].sort(), [1, 2, 3, 4]);

const strategies = [0, 1, 2].map((index) => candidateStrategy(index));
assert.equal(new Set(strategies.map((entry) => entry.id)).size, 3);

for (const sceneCount of [1, 2, 3, 4]) {
  const budgets = editorialWordBudgets(30, sceneCount);
  assert.equal(budgets.scenes.length, sceneCount);
  assert.equal(
    budgets.scenes.reduce((total, scene) => total + scene.maximumWords, 0),
    budgets.maximumWords,
  );
}

const goodPlan = {
  title: 'Revisar inteligencia artificial con criterio',
  scenes: [{
    title: 'La respuesta rápida',
    purpose: 'Mostrar que velocidad no equivale a certeza.',
    dialogue: [
      { speaker: 'a', text: 'Una respuesta de inteligencia artificial puede sonar segura y aun así equivocarse.' },
      { speaker: 'b', text: 'Compará sus afirmaciones con fuentes confiables antes de tomar una decisión.' },
    ],
  }],
};
const good = analyzeDirectorPlanQuality(goodPlan, {
  prompt: 'Explicá cómo revisar una respuesta de inteligencia artificial.',
});
assert.equal(good.passed, true);
assert.ok(good.score >= DIRECTOR_QUALITY_FLOOR);

const weakPlan = {
  title: 'Otro tema',
  scenes: [{
    title: 'Inicio',
    purpose: 'Relleno.',
    dialogue: [
      { speaker: 'a', text: 'Hola.' },
      { speaker: 'b', text: 'Hola.' },
    ],
  }],
};
const weak = analyzeDirectorPlanQuality(weakPlan, {
  prompt: 'Explicá cómo revisar una respuesta de inteligencia artificial.',
});
assert.equal(weak.passed, false);
assert.ok(weak.issues.some((issue) => issue.code === 'GENERIC_HOOK'));
assert.ok(weak.issues.some((issue) => issue.code === 'REPETITIVE_TURNS'));
assert.ok(weak.issues.some((issue) => issue.code === 'LOW_RELEVANCE'));

const ttsPlan = structuredClone(goodPlan);
ttsPlan.scenes[0].dialogue[0].text = 'Mirá https://example.com 😃 (ahora mismo).';
const tts = analyzeDirectorPlanQuality(ttsPlan, { prompt: 'Mirá un enlace.' });
assert.ok(tts.issues.some((issue) => issue.code === 'TTS_FRICTION'));

process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: 17,
  failed: 0,
  benchmarkCases: benchmark.cases.length,
  qualityFloor: DIRECTOR_QUALITY_FLOOR,
})}\n`);
