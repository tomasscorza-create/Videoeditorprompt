import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, projectRoot, readJson, sha256, writeJson } from '../stage1/common.mjs';
import { ProjectEditorError } from '../../shared/project-editor.js';
import { publishAuthoringProject } from './publish-project.mjs';

const testRoot = ensureDirectory(path.join(projectRoot, '.local-video', 'tests', 'project-publishing'));
const publishRoot = path.join(testRoot, 'published');
const assetsRoot = path.join(projectRoot, 'public');
const sourcePath = path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json');
const sourceBefore = readFileSync(sourcePath);
const first = publishAuthoringProject({ projectPath: sourcePath, assetsRoot, publishRoot });
const firstRevision = first.entry.revision;
const staleFile = path.join(publishRoot, first.entry.projectId, 'stale.txt');
writeFileSync(staleFile, 'debe desaparecer', 'utf8');
const repeated = publishAuthoringProject({ projectPath: sourcePath, assetsRoot, publishRoot });

const secondProject = structuredClone(readJson(sourcePath));
secondProject.id = 'proyecto-compilable-02';
secondProject.title = 'Segundo proyecto compilable';
const secondPath = path.join(testRoot, 'project-02.json');
writeJson(secondPath, secondProject);
const second = publishAuthoringProject({ projectPath: secondPath, assetsRoot, publishRoot });
const index = readJson(path.join(publishRoot, 'index.json'));
const publishedFirst = readJson(path.join(publishRoot, first.entry.projectPath));
const schema = readJson(path.join(projectRoot, 'schema', 'published-project-index.schema.json'));
const validateIndex = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

assert.equal(validateIndex(index), true, JSON.stringify(validateIndex.errors));
assert.equal(index.version, 1);
assert.equal(index.defaultProjectId, 'proyecto-compilable-02');
assert.deepEqual(index.projects.map((entry) => entry.projectId), ['proyecto-compilable-01', 'proyecto-compilable-02']);
assert.equal(repeated.entry.revision, firstRevision);
assert.equal(existsSync(staleFile), false);
assert.deepEqual(publishedFirst, readJson(sourcePath));
assert.equal(Buffer.compare(sourceBefore, readFileSync(sourcePath)), 0);
assert.equal(JSON.stringify(index).includes(projectRoot), false);
assert.equal(first.entry.projectSha256, sha256(readFileSync(first.projectFile, 'utf8')));
assert.match(first.entry.revision, /^[a-f0-9]{64}$/);
assert.throws(
  () => publishAuthoringProject({
    projectPath: path.join(projectRoot, 'pilots', 'proyecto-editable-01', 'project.json'),
    assetsRoot,
    publishRoot,
  }),
  (error) => error instanceof ProjectEditorError && error.code === 'EDITOR_ELEMENT_UNSUPPORTED',
);

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  passed: 10,
  failed: 0,
  checks: {
    schemaValid: true,
    versionedIndex: true,
    explicitDefault: true,
    multipleProjectsPreserved: true,
    revisionDeterministic: true,
    staleFilesRemoved: true,
    semanticContentPreserved: true,
    sourceUnchanged: true,
    manifestsPortable: true,
    incompatibleProjectRejected: true,
  },
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'project-publishing-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
