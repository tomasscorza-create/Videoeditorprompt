import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupCompletedJob, cleanLocalVideo, runStartupRetention } from './retention.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'local-video-retention-'));
const localRoot = path.join(root, '.local-video');
const workRoot = path.join(localRoot, 'work');
const jobsRoot = path.join(localRoot, 'app-jobs');
const completed = path.join(workRoot, 'render-completed');
const active = path.join(workRoot, 'render-active');
const fullyCompleted = path.join(workRoot, 'render-fully-completed');
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

mkdirSync(path.join(fullyCompleted, 'scene-work'), { recursive: true });
writeFileSync(path.join(fullyCompleted, 'scene-work', 'derived.bin'), Buffer.alloc(50));
const fullPreview = cleanupCompletedJob({
  workRoot,
  jobId: 'render-fully-completed',
  apply: false,
  removeJobRoot: true,
});
assert.equal(fullPreview.removedBytes, 50);
assert.equal(fullPreview.removedJobRoot, true);
assert.equal(existsSync(fullyCompleted), true);
const fullApplied = cleanupCompletedJob({
  workRoot,
  jobId: 'render-fully-completed',
  apply: true,
  removeJobRoot: true,
});
assert.equal(fullApplied.removedBytes, 50);
assert.equal(existsSync(fullyCompleted), false);

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
const startupTests = path.join(startupLocal, 'tests');
const startupBundles = path.join(startupLocal, 'persistence-bundles');
const startupOutput = path.join(startupLocal, 'output');
const startupInput = path.join(startupLocal, 'app-input');
mkdirSync(path.join(startupWork, 'render-old', 'temp'), { recursive: true });
mkdirSync(path.join(startupWork, 'render-live', 'temp'), { recursive: true });
mkdirSync(startupJobs, { recursive: true });
writeFileSync(path.join(startupWork, 'render-old', 'temp', 'old.bin'), Buffer.alloc(100));
writeFileSync(path.join(startupWork, 'render-live', 'temp', 'live.bin'), Buffer.alloc(50));
writeFileSync(path.join(startupJobs, 'render-old.json'), JSON.stringify({ jobId: 'render-old', state: 'failed' }));
writeFileSync(path.join(startupJobs, 'render-live.json'), JSON.stringify({ jobId: 'render-live', state: 'rendering' }));
const staleStamp = new Date('2020-01-01T00:00:00Z');
utimesSync(path.join(startupWork, 'render-old'), staleStamp, staleStamp);

mkdirSync(path.join(startupTests, 'stale-suite'), { recursive: true });
mkdirSync(path.join(startupTests, 'recent-suite'), { recursive: true });
writeFileSync(path.join(startupTests, 'stale-suite', 'evidence.bin'), Buffer.alloc(11));
writeFileSync(path.join(startupTests, 'recent-suite', 'evidence.bin'), Buffer.alloc(12));
utimesSync(path.join(startupTests, 'stale-suite'), staleStamp, staleStamp);

for (let index = 1; index <= 4; index += 1) {
  const bundle = path.join(startupBundles, `bundle-${index}`);
  mkdirSync(bundle, { recursive: true });
  writeFileSync(path.join(bundle, 'bundle.bin'), Buffer.alloc(index));
  const bundleStamp = new Date(`2026-01-0${index}T00:00:00Z`);
  utimesSync(bundle, bundleStamp, bundleStamp);
}

const orphanOutput = path.join(startupOutput, 'orphan-old');
const finalOutput = path.join(startupOutput, 'render-final');
mkdirSync(orphanOutput, { recursive: true });
mkdirSync(finalOutput, { recursive: true });
writeFileSync(path.join(orphanOutput, 'partial.json'), '{}');
writeFileSync(path.join(finalOutput, 'render-1.mp4'), 'video');
utimesSync(orphanOutput, staleStamp, staleStamp);
utimesSync(finalOutput, staleStamp, staleStamp);

const orphanInput = path.join(startupInput, 'render-orphan');
const liveInput = path.join(startupInput, 'render-live');
mkdirSync(orphanInput, { recursive: true });
mkdirSync(liveInput, { recursive: true });
writeFileSync(path.join(orphanInput, 'project.json'), '{}');
writeFileSync(path.join(liveInput, 'project.json'), '{}');
utimesSync(orphanInput, staleStamp, staleStamp);
utimesSync(liveInput, staleStamp, staleStamp);

const startup = runStartupRetention({ localRoot: startupLocal, maximumAgeDays: 30 });
assert.equal(startup.applied, true);
assert.equal(existsSync(path.join(startupWork, 'render-old')), false);
assert.equal(existsSync(path.join(startupWork, 'render-live', 'temp', 'live.bin')), true);
assert.equal(startup.expired.some((entry) => entry.jobId === 'render-old' && entry.reason === 'age'), true);
assert.equal(existsSync(path.join(startupTests, 'stale-suite')), false);
assert.equal(existsSync(path.join(startupTests, 'recent-suite')), true);
assert.equal(startup.tests.some((entry) => entry.name === 'stale-suite' && entry.reason === 'age'), true);
assert.equal(existsSync(path.join(startupBundles, 'bundle-1')), false);
assert.equal(existsSync(path.join(startupBundles, 'bundle-4')), true);
assert.equal(startup.bundles.length, 1);
assert.equal(existsSync(orphanOutput), false);
assert.equal(existsSync(finalOutput), true);
assert.equal(startup.orphanOutputs.some((entry) => entry.name === 'orphan-old'), true);
assert.equal(existsSync(orphanInput), false);
assert.equal(existsSync(liveInput), true);
assert.equal(startup.orphanInputs.some((entry) => entry.name === 'render-orphan'), true);
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

rmSync(root, { recursive: true, force: true });
rmSync(startupRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ version: 1, passed: 36, failed: 0 })}\n`);
