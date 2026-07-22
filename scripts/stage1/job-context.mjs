import { copyFileSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, parseArguments, requireFile, resolvePath, resolveTtsRoot } from './common.mjs';
import { PipelineError } from './errors.mjs';

export function createJobContext(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? parseArguments(argv) : argv;
  const jobId = String(args['job-id'] || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(jobId)) {
    throw new PipelineError({
      code: 'JOB_ID_INVALID',
      stage: 'preparing',
      message: 'Debe indicar --job-id con 2-64 caracteres alfanuméricos, guion o guion bajo.',
      suggestedAction: 'Use un identificador como video-prueba-01.',
    });
  }
  const assetsRoot = resolvePath(args['assets-dir'] || 'public');
  const workRoot = resolvePath(args['work-dir'] || '.local-video/work');
  const outputRoot = resolvePath(args['output-dir'] || '.local-video/output');
  const publishBaseRoot = args['publish-dir'] ? resolvePath(args['publish-dir']) : null;
  const publishRoot = publishBaseRoot ? path.join(publishBaseRoot, jobId) : null;
  const ttsRoot = resolveTtsRoot(args, { validate: false });
  const jobRoot = path.join(workRoot, jobId);
  const context = {
    args, jobId, assetsRoot, workRoot, outputRoot, publishBaseRoot, publishRoot, ttsRoot, jobRoot,
    inputRoot: path.join(jobRoot, 'input'),
    generatedRoot: path.join(jobRoot, 'generated'),
    runtimeRoot: path.join(jobRoot, 'runtime'),
    tempRoot: path.join(jobRoot, 'temp'),
    statusRoot: path.join(jobRoot, 'status'),
    resultRoot: path.join(outputRoot, jobId),
  };
  for (const directory of [context.inputRoot, context.generatedRoot, context.runtimeRoot, context.tempRoot, context.statusRoot, context.resultRoot]) ensureDirectory(directory);
  context.jobConfigPath = path.join(context.inputRoot, 'scene.config.json');
  const requestedConfig = requireFile(resolvePath(args.config || 'public/scene.config.json'), 'configuración de escena');
  if (existsSync(context.jobConfigPath)) {
    if (args.config && !readFileSync(context.jobConfigPath).equals(readFileSync(requestedConfig))) {
      throw new PipelineError({
        code: 'JOB_CONFIG_CONFLICT',
        stage: 'preparing',
        message: `El jobId ${jobId} ya conserva una configuración diferente.`,
        suggestedAction: 'Use un jobId nuevo para la nueva configuración.',
      });
    }
  } else {
    copyFileSync(requestedConfig, context.jobConfigPath);
  }
  context.configPath = requestedConfig;
  context.config = null;
  return context;
}

export function resolveAsset(context, relativePath, assetName = 'asset') {
  if (!existsSync(context.assetsRoot)) {
    throw new PipelineError({
      code: 'ASSETS_ROOT_NOT_FOUND',
      stage: 'validating_config',
      message: 'No existe assets-dir.',
      suggestedAction: 'Indique una carpeta existente mediante --assets-dir.',
    });
  }
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new PipelineError({
      code: 'ASSET_PATH_INVALID',
      stage: 'validating_config',
      message: `La ruta del asset ${assetName} debe ser relativa.`,
      suggestedAction: 'Use una ruta relativa dentro de assets-dir.',
    });
  }
  const resolved = path.resolve(context.assetsRoot, relativePath);
  const relative = path.relative(context.assetsRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PipelineError({
      code: 'ASSET_PATH_INVALID',
      stage: 'validating_config',
      message: `La ruta del asset ${assetName} sale de assets-dir.`,
      suggestedAction: 'Mueva el archivo bajo assets-dir y use una ruta relativa.',
    });
  }
  if (!existsSync(resolved)) {
    throw new PipelineError({
      code: 'ASSET_NOT_FOUND',
      stage: 'validating_config',
      message: `No existe el asset ${assetName}.`,
      suggestedAction: 'Corrija la ruta o prepare el archivo dentro de assets-dir.',
    });
  }
  const file = resolved;
  const rootReal = realpathSync(context.assetsRoot);
  if (!statSync(rootReal).isDirectory()) {
    throw new PipelineError({
      code: 'ASSETS_ROOT_NOT_DIRECTORY',
      stage: 'validating_config',
      message: 'assets-dir no es una carpeta.',
      suggestedAction: 'Indique una carpeta válida mediante --assets-dir.',
    });
  }
  const fileReal = realpathSync(file);
  const realRelative = path.relative(rootReal, fileReal);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new PipelineError({
      code: 'ASSET_SYMLINK_ESCAPE',
      stage: 'validating_config',
      message: `El asset ${assetName} resuelve fuera de assets-dir.`,
      suggestedAction: 'Use un archivo real o enlace que permanezca dentro de assets-dir.',
    });
  }
  if (!statSync(fileReal).isFile()) {
    throw new PipelineError({
      code: 'ASSET_NOT_FILE',
      stage: 'validating_config',
      message: `El asset ${assetName} no es un archivo.`,
      suggestedAction: 'Indique un archivo PNG válido.',
    });
  }
  return fileReal;
}
