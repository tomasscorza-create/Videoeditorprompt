import path from 'node:path';
import { parseArguments, projectRoot } from '../stage1/common.mjs';
import {
  exportLocalDataBundle,
  inventoryLocalData,
  verifyLocalDataBundle,
} from './local-data-bundle.mjs';
import { defaultProjectStorageRoot } from '../local-app/project-repository.mjs';
import { defaultLibraryStorageRoot } from '../local-app/resource-library.mjs';

const [operation, ...argv] = process.argv.slice(2);
const args = parseArguments(argv);
const roots = {
  projectsRoot: path.resolve(args['projects-root'] || defaultProjectStorageRoot()),
  libraryRoot: path.resolve(args['library-root'] || defaultLibraryStorageRoot()),
  jobsRoot: path.resolve(args['jobs-root'] || path.join(projectRoot, '.local-video', 'app-jobs')),
  outputRoot: path.resolve(args['output-root'] || path.join(projectRoot, '.local-video', 'output')),
};

try {
  if (operation === 'inventory') {
    const { manifest } = await inventoryLocalData(roots);
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else if (operation === 'export') {
    const result = await exportLocalDataBundle({
      ...roots,
      output: requiredArgument(args.output, '--output'),
    });
    process.stdout.write(`${JSON.stringify({ version: 1, ...result }, null, 2)}\n`);
  } else if (operation === 'verify') {
    const result = await verifyLocalDataBundle({
      bundle: requiredArgument(args.bundle, '--bundle'),
    });
    process.stdout.write(`${JSON.stringify({ version: 1, ...result }, null, 2)}\n`);
  } else {
    throw cliError(
      'BUNDLE_OPERATION_INVALID',
      'Use inventory, export o verify.',
    );
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    version: 1,
    state: 'failed',
    stage: error.stage || 'storage_bundle',
    code: error.code || 'UNEXPECTED_ERROR',
    message: error.message,
    technicalDetail: error.technicalDetail,
  })}\n`);
  process.exitCode = 1;
}

function requiredArgument(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw cliError('BUNDLE_ARGUMENT_REQUIRED', `Falta ${name}.`);
  }
  return value;
}

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.stage = 'storage_bundle';
  return error;
}
