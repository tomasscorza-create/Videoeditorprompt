import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { createProjectEditor, validateRenderableProject } from '../../shared/project-editor.js';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { compileVideoProject } from '../stage3a/compile-video-project.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { loadAuthoringCatalog } from '../director/director-plan.mjs';
import { publicTimeline } from '../local-app/render-job-manager.mjs';

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

const hash = 'a'.repeat(64);
const renderedBase = {
  jobId: 'render-compatibility',
  projectId: 'project-compatibility',
  compiledProject: 'compiled/compiled-project.json',
  compiledSemanticHash: hash,
  video: { width: 1080, height: 1920, fps: 30 },
  timeline: {
    durationSeconds: 4,
    scenes: [{
      index: 0,
      id: 'scene-compatibility',
      sceneJobId: 'scene-job-compatibility',
      config: 'scene-work/input/scene.config.json',
      runtime: 'scene-work/runtime/scene-runtime.json',
      render1: 'scene-output/render-1.mp4',
      audioDurationSeconds: 3.9,
      renderDurationSeconds: 4,
      startSeconds: 0,
      endSeconds: 4,
      verificationPassed: 1,
    }],
  },
  outputs: [{ runNumber: 1, file: 'render-1.mp4', sha256: hash, bytes: 100, durationSeconds: 4 }],
  deterministic: false,
  verification: 'verification.json',
};
const renderedV1 = { version: 1, ...structuredClone(renderedBase) };
const renderedV2 = { version: 2, ...structuredClone(renderedBase) };
renderedV2.timeline.scenes[0].turns = [
  { id: 'turn-compatibility-1', speakerId: 'speaker-compatibility-1', startSeconds: 0, endSeconds: 1.5, durationSeconds: 1.5, gapAfterSeconds: 0.5 },
  { id: 'turn-compatibility-2', speakerId: 'speaker-compatibility-2', startSeconds: 2, endSeconds: 3.9, durationSeconds: 1.9, gapAfterSeconds: 0 },
];

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRenderedV1 = ajv.compile(readJson(path.join(projectRoot, 'schema', 'rendered-project-v1.schema.json')));
const validateRenderedV2 = ajv.compile(readJson(path.join(projectRoot, 'schema', 'rendered-project.schema.json')));
assert.equal(validateRenderedV1(renderedV1), true, JSON.stringify(validateRenderedV1.errors));
assert.equal(validateRenderedV2(renderedV2), true, JSON.stringify(validateRenderedV2.errors));
assert.equal(validateRenderedV1(renderedV2), false);
assert.equal(validateRenderedV2(renderedV1), false);
assert.deepEqual(publicTimeline(renderedV1.timeline).scenes[0].turns, []);
assert.deepEqual(publicTimeline(renderedV2.timeline).scenes[0].turns, renderedV2.timeline.scenes[0].turns);

process.stdout.write(`${JSON.stringify({ version: 1, passed: 22, failed: 0 })}\n`);
