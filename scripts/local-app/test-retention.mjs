import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupCompletedJob, cleanLocalVideo, runStartupRetention } from './retention.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'local-video-retention-'));
const localRoot = path.join(root, '.local-video');
const workRoot = path.join(localRoot, 'work');
const jobsRoot = path.join(localRoot, 'app-jobs');
const completed = path.join(workRoot, 'render-completed');
const active = path.join(workRoot, 'render-active');
mkdirSync(path.join(completed, 'scene-work', 'scene-1', 'temp'), { recursive: true });
mkdirSync(path.join(completed, 'scene-work', 'scene-1', 'results', 'frames'), { recursive: true });
mkdirSync(path.join(completed, 'status'), { recursive: true });
mkdirSync(path.join(active, 'temp'), { recursive: true });
mkdirSync(jobsRoot, { recursive: true });
writeFileSync(path.join(completed, 'scene-work', 'scene-1', 'temp', 'a.bin'), Buffer.alloc(10));
writeFileSync(path.join(completed, 'scene-work', 'scene-1', 'results', 'frames', 'a.png'), Buffer.alloc(20));
writeFileSync(path.join(completed, 'status', 'job-status.json'), '{}');
writeFileSync(path.join(active, 'temp', 'active.bin'), Buffer.alloc(40));
writeFileSync(path.join(jobsRoot, 'render-completed.json'), JSON.stringify({ jobId: 'render-completed', state: 'completed' }));
writeFileSync(path.join(jobsRoot, 'render-active.json'), JSON.stringify({ jobId: 'render-active', state: 'rendering' }));

const preview = cleanupCompletedJob({ workRoot, jobId: 'render-completed', apply: false });
assert.equal(preview.removedBytes, 30);
assert.equal(existsSync(path.join(completed, 'scene-work', 'scene-1', 'temp')), true);
const applied = cleanupCompletedJob({ workRoot, jobId: 'render-completed', apply: true });
assert.equal(applied.removedBytes, 30);
assert.equal(existsSync(path.join(completed, 'scene-work', 'scene-1', 'temp')), false);
assert.equal(existsSync(path.join(completed, 'status', 'job-status.json')), true);
assert.equal(existsSync(path.join(active, 'temp', 'active.bin')), true);
assert.throws(() => cleanupCompletedJob({ workRoot, jobId: '../escape', apply: true }), (error) => error.code === 'JOB_ID_INVALID');
const globalPreview = cleanLocalVideo({ localRoot, apply: false, maximumAgeDays: 30 });
assert.equal(globalPreview.cleaned.length, 1);
assert.equal(globalPreview.cleaned[0].removedBytes, 0);
assert.equal(globalPreview.expired.length, 0);
const sizePreview = cleanLocalVideo({ localRoot, apply: false, maximumAgeDays: 30, maximumBytes: 1 });
assert.equal(sizePreview.expired.some((entry) => entry.jobId === 'render-completed' && entry.reason === 'size'), true);

// Barrido automático de arranque: aplica la política de edad, elimina los intermedios de
// los trabajos vencidos, preserva los activos y jamás lanza.
const startupRoot = mkdtempSync(path.join(os.tmpdir(), 'local-video-startup-'));
const startupLocal = path.join(startupRoot, '.local-video');
const startupWork = path.join(startupLocal, 'work');
const startupJobs = path.join(startupLocal, 'app-jobs');
mkdirSync(path.join(startupWork, 'render-old', 'temp'), { recursive: true });
mkdirSync(path.join(startupWork, 'render-live', 'temp'), { recursive: true });
mkdirSync(startupJobs, { recursive: true });
writeFileSync(path.join(startupWork, 'render-old', 'temp', 'old.bin'), Buffer.alloc(100));
writeFileSync(path.join(startupWork, 'render-live', 'temp', 'live.bin'), Buffer.alloc(50));
writeFileSync(path.join(startupJobs, 'render-old.json'), JSON.stringify({ jobId: 'render-old', state: 'failed' }));
writeFileSync(path.join(startupJobs, 'render-live.json'), JSON.stringify({ jobId: 'render-live', state: 'rendering' }));
const staleStamp = new Date('2020-01-01T00:00:00Z');
utimesSync(path.join(startupWork, 'render-old'), staleStamp, staleStamp);
const startup = runStartupRetention({ localRoot: startupLocal, maximumAgeDays: 30 });
assert.equal(startup.applied, true);
assert.equal(existsSync(path.join(startupWork, 'render-old')), false);
assert.equal(existsSync(path.join(startupWork, 'render-live', 'temp', 'live.bin')), true);
assert.equal(startup.expired.some((entry) => entry.jobId === 'render-old' && entry.reason === 'age'), true);
const missingStartup = runStartupRetention({ localRoot: path.join(startupRoot, 'inexistente') });
assert.equal(missingStartup.applied, true);
assert.equal(missingStartup.expired.length, 0);

// Los pipelines CLI no tienen registro en app-jobs, pero sí un estado propio. La
// retención limpia sus frames al terminar y preserva los que siguen renderizando.
const cliCompleted = path.join(startupWork, 'cli-completed');
const cliActive = path.join(startupWork, 'cli-active');
mkdirSync(path.join(cliCompleted, 'results', 'frames'), { recursive: true });
mkdirSync(path.join(cliCompleted, 'status'), { recursive: true });
mkdirSync(path.join(cliActive, 'temp'), { recursive: true });
mkdirSync(path.join(cliActive, 'status'), { recursive: true });
writeFileSync(path.join(cliCompleted, 'results', 'frames', 'frame.png'), Buffer.alloc(70));
writeFileSync(path.join(cliCompleted, 'status', 'job-status.json'), JSON.stringify({ jobId: 'cli-completed', state: 'completed' }));
writeFileSync(path.join(cliActive, 'temp', 'active.bin'), Buffer.alloc(80));
writeFileSync(path.join(cliActive, 'status', 'job-status.json'), JSON.stringify({ jobId: 'cli-active', state: 'rendering' }));
const cliCleanup = runStartupRetention({ localRoot: startupLocal, maximumAgeDays: 30 });
assert.equal(cliCleanup.cleaned.some((entry) => entry.jobId === 'cli-completed' && entry.removedBytes === 70), true);
assert.equal(existsSync(path.join(cliCompleted, 'results', 'frames')), false);
assert.equal(existsSync(path.join(cliCompleted, 'status', 'job-status.json')), true);
assert.equal(existsSync(path.join(cliActive, 'temp', 'active.bin')), true);

process.stdout.write(`${JSON.stringify({ version: 1, passed: 20, failed: 0 })}\n`);
