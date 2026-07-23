import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, isMain, parseArguments, projectRoot, readJson, sha256, writeJson } from '../stage1/common.mjs';
import { PipelineError, serializeError } from '../stage1/errors.mjs';
import { loadAndValidateVideoProject } from '../stage3a/validate-video-project.mjs';
import { createProjectEditor, exportEditorProject } from '../../shared/project-editor.js';

const indexSchema = readJson(path.join(projectRoot, 'schema', 'published-project-index.schema.json'));
const validateIndexSchema = new Ajv2020({ allErrors: true, strict: true }).compile(indexSchema);

export function publishAuthoringProject({ projectPath, assetsRoot, publishRoot }) {
  const loaded = loadAndValidateVideoProject({ projectPath, assetsRoot });
  const editor = createProjectEditor(loaded.project, loaded.catalog);
  const serializedProject = exportEditorProject(editor);
  const projectId = loaded.project.id;
  const resolvedPublishRoot = path.resolve(publishRoot);
  const projectPublishRoot = path.join(resolvedPublishRoot, projectId);
  assertChildTarget(resolvedPublishRoot, projectPublishRoot);
  ensureDirectory(resolvedPublishRoot);
  if (existsSync(projectPublishRoot)) rmSync(projectPublishRoot, { recursive: true, force: true });
  ensureDirectory(projectPublishRoot);
  writeFileSync(path.join(projectPublishRoot, 'project.json'), serializedProject, 'utf8');

  const projectSha256 = sha256(serializedProject);
  const catalogSha256 = sha256(JSON.stringify(loaded.catalog));
  const entry = {
    projectId,
    title: loaded.project.title,
    projectPath: `${projectId}/project.json`,
    resourceCatalog: loaded.project.resourceCatalog,
    sceneCount: loaded.project.scenes.length,
    editorContractVersion: 1,
    projectSha256,
    catalogSha256,
    revision: sha256(`${projectSha256}:${catalogSha256}`),
  };
  const indexPath = path.join(resolvedPublishRoot, 'index.json');
  const current = readExistingIndex(indexPath, projectId);
  const projects = current.projects
    .filter((item) => item.projectId !== projectId)
    .concat(entry)
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
  const index = { version: 1, defaultProjectId: projectId, projects };
  assertPublishedIndex(index);
  writeJson(indexPath, index);
  return { index, entry, projectFile: path.join(projectPublishRoot, 'project.json'), indexFile: indexPath };
}

function readExistingIndex(indexPath, defaultProjectId) {
  if (!existsSync(indexPath)) return { version: 1, defaultProjectId, projects: [] };
  let current;
  try {
    current = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch (error) {
    throw new PipelineError({
      code: 'PROJECT_PUBLICATION_INDEX_INVALID',
      stage: 'publishing_project',
      message: 'El índice de proyectos publicados no contiene JSON válido.',
      cause: error,
      suggestedAction: 'Corrija o retire el índice y vuelva a publicar.',
    });
  }
  assertPublishedIndex(current);
  return current;
}

function assertPublishedIndex(index) {
  if (!validateIndexSchema(index)) {
    const detail = (validateIndexSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    invalidIndex(detail);
  }
  const ids = new Set();
  for (const entry of index.projects) {
    if (ids.has(entry.projectId)) invalidIndex(`projectId duplicado: ${entry.projectId}`);
    ids.add(entry.projectId);
  }
  if (!ids.has(index.defaultProjectId)) invalidIndex(`defaultProjectId inexistente: ${index.defaultProjectId}`);
}

function invalidIndex(detail) {
  throw new PipelineError({
    code: 'PROJECT_PUBLICATION_INDEX_INVALID',
    stage: 'publishing_project',
    message: 'El índice de proyectos publicados no cumple su contrato versión 1.',
    technicalDetail: detail,
    suggestedAction: 'Revise public/projects/index.json y el schema de publicación.',
  });
}

function assertChildTarget(baseRoot, targetRoot) {
  const relative = path.relative(path.resolve(baseRoot), path.resolve(targetRoot));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PipelineError({
      code: 'PROJECT_PUBLICATION_TARGET_INVALID',
      stage: 'publishing_project',
      message: 'La carpeta del proyecto debe permanecer dentro de publish-dir.',
      suggestedAction: 'Use un publish-dir válido y un projectId portable.',
    });
  }
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArguments();
    const result = publishAuthoringProject({
      projectPath: path.resolve(projectRoot, String(args.project || 'pilots/proyecto-compilable-01/project.json')),
      assetsRoot: path.resolve(projectRoot, String(args['assets-dir'] || 'public')),
      publishRoot: path.resolve(projectRoot, String(args['publish-dir'] || 'public/projects')),
    });
    process.stdout.write(`${JSON.stringify({
      version: 1,
      published: true,
      projectId: result.entry.projectId,
      projectPath: result.entry.projectPath,
      revision: result.entry.revision,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'publishing_project') })}\n`);
    process.exitCode = 1;
  }
}
