import { spawnSync } from 'node:child_process';
import { projectRoot } from './stage1/common.mjs';

const commands = [
  'stage1:test-config',
  'stage2f:test-parametric',
  'stage3a:test-project',
  'stage3a:test-compiler',
  'stage3a:test-assembly',
  'stage3b:test-editor',
  'stage3b:test-publishing',
  'stage3b:test-contracts',
  'director:test-plan',
  'director:test-ollama',
  'director:test-editor',
  'local:test-library',
  'local:test-projects',
  'local:test-server',
  'local:test-render-manager',
  'local:test-retention',
  'ui:test-modules',
];

for (const command of commands) {
  const npmCli = process.env.npm_execpath;
  const executable = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = npmCli ? [npmCli, 'run', command] : ['run', command];
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write(`${JSON.stringify({ version: 1, passed: commands.length, failed: 0, commands })}\n`);
