import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { analyzeDirectorComposition } from './direction-quality.mjs';
import { loadCreativeRecipeCatalog } from './creative-contract.mjs';

const fixture = readJson(path.join(projectRoot, 'scripts', 'director', 'fixtures', 'direction-quality-cases.json'));
const recipes = loadCreativeRecipeCatalog();

for (const entry of fixture.cases) {
  const report = entry.scene
    ? analyzeDirectorComposition({ plan: { scenes: [entry.scene] }, recipes })
    : analyzeDirectorComposition({ project: { scenes: [entry.projectScene] } });
  assert.equal(report.passed, false, entry.id);
  assert.ok(report.issues.some((issue) => issue.code === entry.expectedIssue), entry.id);
}

const validGraphicScene = {
  mode: 'voiceover', sceneRecipeId: 'keyword-pages-v1', participants: [],
  visualElements: [{ type: 'template', resourceId: 'template-a' }],
  speech: [{ kind: 'voiceover' }],
};
assert.equal(analyzeDirectorComposition({ plan: { scenes: [validGraphicScene] }, recipes }).passed, true);

const validClosingFade = {
  dialogue: [{ speakerElementId: 'speaker-a' }],
  elements: [{ id: 'speaker-a', tracks: [{ parameterId: 'opacity', keyframes: [
    { anchor: { kind: 'scene', edge: 'end' }, offsetSeconds: -0.4, value: 1 },
    { anchor: { kind: 'scene', edge: 'end' }, offsetSeconds: 0, value: 0 },
  ] }] }],
};
assert.equal(analyzeDirectorComposition({ project: { scenes: [validClosingFade] } }).passed, true);

process.stdout.write(`${JSON.stringify({ version: 1, passed: fixture.cases.length + 2 })}\n`);
