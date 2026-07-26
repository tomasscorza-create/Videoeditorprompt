import assert from 'node:assert/strict';
import path from 'node:path';
import { resolvePiperPython } from '../stage1/piper-voice.mjs';

const root = path.resolve('runtime', 'tts');
assert.equal(
  resolvePiperPython(root, {}, 'win32'),
  path.join(root, 'venv', 'Scripts', 'python.exe'),
);
assert.equal(
  resolvePiperPython(root, {}, 'linux'),
  path.join(root, 'venv', 'bin', 'python'),
);
assert.equal(
  resolvePiperPython(root, { LOCAL_VIDEO_PIPER_PYTHON: path.resolve('custom', 'piper') }, 'linux'),
  path.resolve('custom', 'piper'),
);
process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: 3,
  failed: 0,
  cases: ['windows-venv', 'linux-venv', 'explicit-runtime'],
})}\n`);
