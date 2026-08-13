import assert from 'node:assert/strict';
import path from 'node:path';
import {
  applyProjectEditorCommandBatch,
  createProjectEditor,
  undoProjectEditor,
  validateEditableProject,
} from '../../shared/project-editor.js';
import { projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { loadCreativeRecipeCatalog } from './creative-contract.mjs';
import { expandEffectSequenceCommands } from './recipe-expander.mjs';

const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
const recipes = loadCreativeRecipeCatalog();
const scene = project.scenes[0];
const element = scene.elements.find((candidate) => candidate.type === 'character');
const newSequenceIds = [
  'rise-and-settle-v2',
  'pop-and-wobble-v2',
  'jump-and-flash-v2',
  'shake-and-pulse-v2',
  'float-and-pulse-v2',
  'exit-up-and-fade-v2',
];
const results = [];

for (const sequenceId of newSequenceIds) {
  const sequence = recipes.effectSequences.find((candidate) => candidate.id === sequenceId);
  assert.ok(sequence, `${sequenceId} debe existir`);
  const request = {
    sequenceId,
    anchor: { kind: 'scene', edge: 'start' },
    intensity: 'medium',
    bindings: [{ slotId: 'subject', sceneId: scene.id, elementId: element.id }],
  };
  if (!sequence.compatibleAnchorKinds.includes('scene')) {
    request.anchor = { kind: 'turn', turnId: scene.dialogue[0].id, edge: 'start' };
  }
  const first = expandEffectSequenceCommands(request, project, catalog, { recipeCatalog: recipes });
  const second = expandEffectSequenceCommands(request, project, catalog, { recipeCatalog: recipes });
  assert.deepEqual(first, second, `${sequenceId} debe expandirse de forma determinista`);
  assert.equal(first.length, sequence.actions.length);
  assert.equal(new Set(first.map((command) => command.presetId)).size, first.length);

  const initial = createProjectEditor(project, catalog);
  const applied = applyProjectEditorCommandBatch(initial, first);
  const animated = applied.project.scenes[0].elements.find((candidate) => candidate.id === element.id);
  assert.equal(animated.tracks.length, first.length, `${sequenceId} debe crear una pista por acción`);
  assert.equal(applied.past.length, 1, `${sequenceId} debe deshacerse como una operación`);
  assert.deepEqual(undoProjectEditor(applied).project, initial.project);
  validateEditableProject(applied.project, catalog);
  results.push({ name: sequenceId, actions: first.length, accepted: true });
}

assert.throws(
  () => expandEffectSequenceCommands({
    sequenceId: 'rise-and-settle-v2',
    anchor: { kind: 'scene', edge: 'start' },
    intensity: 'medium',
    bindings: [],
  }, project, catalog, { recipeCatalog: recipes }),
  (error) => error.code === 'DIRECTOR_RECIPE_INVALID',
);
results.push({ name: 'bindings-incompletos-rechazados', accepted: false, expectedCode: 'DIRECTOR_RECIPE_INVALID' });

const summary = {
  version: 2,
  passed: results.length,
  failed: 0,
  effectSequences: recipes.effectSequences.length,
  results,
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'effect-sequences-v2-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
