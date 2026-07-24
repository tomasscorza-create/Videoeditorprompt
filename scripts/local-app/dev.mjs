import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';
import { createLocalAppServer } from './server.mjs';

const sessionToken = randomBytes(32).toString('hex');
const app = createLocalAppServer({ sessionToken });
const listening = await app.listen();
process.stdout.write(`${JSON.stringify({ version: 1, component: 'local-api', state: 'ready', url: listening.url })}\n`);

const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin], {
  cwd: projectRoot,
  shell: false,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, VITE_LOCAL_VIDEO_TOKEN: sessionToken },
});

let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  vite.kill();
  await app.close().catch(() => {});
  process.exitCode = exitCode;
}

vite.on('exit', (code) => void stop(code ?? 0));
process.on('SIGINT', () => void stop(130));
process.on('SIGTERM', () => void stop(143));
