import { spawnSync } from 'node:child_process';

export function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw new Error(`No se pudo ejecutar ${executable}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = options.capture ? `\n${result.stderr ?? ''}` : '';
    throw new Error(`${executable} terminó con código ${result.status}.${details}`);
  }

  return result;
}
