import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, parseArguments, requireFile, resolvePath, resolveTtsRoot } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';

export function createProjectCompilationContext(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? parseArguments(argv) : argv;
  const jobId = String(args['job-id'] || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(jobId)) {
    throw new PipelineError({
      code: 'JOB_ID_INVALID',
      stage: 'compiling_project',
      message: 'Debe indicar --job-id con 2-64 caracteres alfanuméricos, guion o guion bajo.',
      suggestedAction: 'Use un identificador como proyecto-compilado-01.',
    });
  }
  const requestedProject = requireFile(resolvePath(args.project || 'pilots/proyecto-compilable-01/project.json'), 'proyecto editable');
  const assetsRoot = resolvePath(args['assets-dir'] || 'public');
  const workRoot = resolvePath(args['work-dir'] || '.local-video/work');
  const outputRoot = resolvePath(args['output-dir'] || '.local-video/output');
  const ttsRoot = resolveTtsRoot(args, { validate: false });
  const jobRoot = path.join(workRoot, jobId);
  const context = {
    args,
    jobId,
    assetsRoot,
    workRoot,
    outputRoot,
    ttsRoot,
    jobRoot,
    inputRoot: path.join(jobRoot, 'input'),
    compiledRoot: path.join(jobRoot, 'compiled'),
    statusRoot: path.join(jobRoot, 'status'),
    resultRoot: path.join(outputRoot, jobId),
  };
  for (const directory of [context.inputRoot, context.compiledRoot, context.statusRoot, context.resultRoot]) ensureDirectory(directory);
  context.projectPath = requestedProject;
  context.jobProjectPath = path.join(context.inputRoot, 'project.json');
  if (existsSync(context.jobProjectPath)) {
    if (!readFileSync(context.jobProjectPath).equals(readFileSync(requestedProject))) {
      throw new PipelineError({
        code: 'JOB_PROJECT_CONFLICT',
        stage: 'compiling_project',
        message: `El jobId ${jobId} ya conserva un proyecto diferente.`,
        suggestedAction: 'Use un jobId nuevo para el proyecto modificado.',
      });
    }
  } else {
    copyFileSync(requestedProject, context.jobProjectPath);
  }
  return context;
}
