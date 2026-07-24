import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectEditor, validateRenderableProject } from '../../shared/project-editor.js';
import { projectRoot } from '../stage1/common.mjs';
import { compileVideoProject } from '../stage3a/compile-video-project.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { loadAuthoringCatalog } from '../director/director-plan.mjs';

const assetsRoot = path.join(projectRoot, 'public');
const catalog = loadAuthoringCatalog(assetsRoot);
const base = JSON.parse(readFileSync(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'), 'utf8'));

function verdict(project) {
  let validator = true;
  let editor = true;
  let renderGate = true;
  let compiler = true;
  try { validateVideoProjectDocument({ project, catalog, assetsRoot }); } catch { validator = false; }
  try { createProjectEditor(project, catalog); } catch { editor = false; }
  try { validateRenderableProject(project, catalog); } catch { renderGate = false; }
  const root = mkdtempSync(path.join(os.tmpdir(), 'contract-compatibility-'));
  const inputRoot = path.join(root, 'input');
  mkdirSync(inputRoot, { recursive: true });
  const jobProjectPath = path.join(inputRoot, 'project.json');
  writeFileSync(jobProjectPath, JSON.stringify(project));
  try {
    compileVideoProject({
      args: {},
      jobId: 'compatibility-test',
      assetsRoot,
      jobRoot: root,
      inputRoot,
      compiledRoot: path.join(root, 'compiled'),
      statusRoot: path.join(root, 'status'),
      resultRoot: path.join(root, 'result'),
      jobProjectPath,
    }, { report: () => {}, emitProgress: false, emitCompleted: false });
  } catch {
    compiler = false;
  }
  return { validator, editor, renderGate, compiler };
}

assert.deepEqual(verdict(structuredClone(base)), { validator: true, editor: true, renderGate: true, compiler: true });

const duplicateScene = structuredClone(base);
duplicateScene.scenes[1].id = duplicateScene.scenes[0].id;
assert.deepEqual(verdict(duplicateScene), { validator: false, editor: false, renderGate: false, compiler: false });

const futureTransform = structuredClone(base);
futureTransform.scenes[0].elements[0].transform.rotationDegrees = 10;
assert.deepEqual(verdict(futureTransform), { validator: true, editor: true, renderGate: false, compiler: false });

const missingTransition = structuredClone(base);
delete missingTransition.scenes[0].transitionToNext;
assert.deepEqual(verdict(missingTransition), { validator: false, editor: false, renderGate: false, compiler: false });

process.stdout.write(`${JSON.stringify({ version: 1, passed: 16, failed: 0 })}\n`);
