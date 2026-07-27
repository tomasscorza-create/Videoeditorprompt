import path from 'node:path';
import { createDirectorProposal } from './ollama-director.mjs';
import { projectRoot, readJson } from '../stage1/common.mjs';

const benchmark = readJson(path.join(projectRoot, 'scripts', 'director', 'fixtures', 'quality-prompts.json'));
const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='));
const limit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : benchmark.cases.length;
if (!Number.isInteger(limit) || limit < 1 || limit > benchmark.cases.length) {
  throw new Error(`--limit debe estar entre 1 y ${benchmark.cases.length}.`);
}

const results = [];
for (const fixture of benchmark.cases.slice(0, limit)) {
  const startedAt = Date.now();
  try {
    const result = await createDirectorProposal({
      prompt: fixture.prompt,
      constraints: {
        tone: fixture.tone,
        targetDurationSeconds: fixture.targetDurationSeconds,
        sceneCount: fixture.sceneCount,
      },
      bestOf: 1,
      useCache: false,
    });
    results.push({
      id: fixture.id,
      passed: result.quality.passed,
      score: result.quality.score,
      issues: result.quality.issues.map((issue) => issue.code),
      repairs: result.repairAttempts,
      elapsedMilliseconds: Date.now() - startedAt,
    });
  } catch (error) {
    results.push({
      id: fixture.id,
      passed: false,
      score: null,
      error: error?.code || error?.message || String(error),
      elapsedMilliseconds: Date.now() - startedAt,
    });
  }
}

const passed = results.filter((result) => result.passed).length;
process.stdout.write(`${JSON.stringify({
  version: 1,
  model: 'qwen3:8b',
  cases: results.length,
  passed,
  failed: results.length - passed,
  averageScore: average(results.map((result) => result.score).filter(Number.isFinite)),
  results,
}, null, 2)}\n`);
if (passed !== results.length) process.exitCode = 1;

function average(values) {
  if (!values.length) return null;
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}
