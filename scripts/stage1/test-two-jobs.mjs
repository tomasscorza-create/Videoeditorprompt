import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot, readJson, writeJson } from './common.mjs';
import { createJobContext } from './job-context.mjs';
import { runPipeline } from './pipeline.mjs';

const base = readJson(path.join(projectRoot, 'public', 'scene.config.json'));
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', stamp);
const configRoot = path.join(testRoot, 'configs');
const workRoot = path.join(testRoot, 'work');
const outputRoot = path.join(testRoot, 'output');
const jobA = `hardening-a-${stamp}`;
const jobB = `hardening-b-${stamp}`;
const configA = structuredClone(base);
const configB = structuredClone(base);
configA.voice.text = 'Esta es la primera prueba aislada para comprobar el trabajo local de animación.';
configA.subtitle.text = 'Primera prueba aislada\npara el trabajo local\nde animación.';
configA.blink.seed = 10421;
configB.voice.text = 'Esta es la segunda prueba independiente para validar rutas, audio y video determinista.';
configB.subtitle.text = 'Segunda prueba independiente\ncon audio y video\ndeterminista.';
configB.blink.seed = 90817;
const configAPath = path.join(configRoot, 'job-a.json');
const configBPath = path.join(configRoot, 'job-b.json');
writeJson(configAPath, configA);
writeJson(configBPath, configB);

const common = { 'assets-dir': 'public', 'work-dir': workRoot, 'output-dir': outputRoot };
const contextA = createJobContext({ ...common, 'job-id': jobA, config: configAPath });
const resultA = await runPipeline(contextA);
const contextB = createJobContext({ ...common, 'job-id': jobB, config: configBPath });
const resultB = await runPipeline(contextB);

const runtimeA = readJson(path.join(contextA.runtimeRoot, 'scene-runtime.json'));
const runtimeB = readJson(path.join(contextB.runtimeRoot, 'scene-runtime.json'));
const copiedConfigA = readJson(contextA.jobConfigPath);
const copiedConfigB = readJson(contextB.jobConfigPath);
const audioA = path.join(contextA.generatedRoot, runtimeA.audio.path);
const audioB = path.join(contextB.generatedRoot, runtimeB.audio.path);
const audioHash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const progressStates = (context) => readFileSync(path.join(context.statusRoot, 'progress.jsonl'), 'utf8')
  .trim().split(/\r?\n/).map((line) => JSON.parse(line).state);
const requiredStates = ['preparing', 'generating_voice', 'analyzing_audio', 'rendering_frames', 'encoding', 'completed'];
const checks = {
  jobIdsDistinct: contextA.jobId !== contextB.jobId,
  workDirectoriesDistinct: contextA.jobRoot !== contextB.jobRoot && !contextA.jobRoot.startsWith(contextB.jobRoot) && !contextB.jobRoot.startsWith(contextA.jobRoot),
  resultDirectoriesDistinct: contextA.resultRoot !== contextB.resultRoot,
  configsPreserved: copiedConfigA.voice.text === configA.voice.text && copiedConfigB.voice.text === configB.voice.text && copiedConfigA.voice.text !== copiedConfigB.voice.text,
  cacheKeysDistinct: runtimeA.cacheKey !== runtimeB.cacheKey,
  audioFilesDistinct: audioA !== audioB && audioHash(audioA) !== audioHash(audioB),
  mp4FilesPresent: [contextA, contextB].every((context) => existsSync(path.join(context.resultRoot, 'render-1.mp4')) && existsSync(path.join(context.resultRoot, 'render-2.mp4'))),
  bothDeterministic: resultA.manifest.deterministic && resultB.manifest.deterministic,
  progressComplete: [contextA, contextB].every((context) => requiredStates.every((state) => progressStates(context).includes(state))),
  noPublishingRequired: !contextA.publishRoot && !contextB.publishRoot,
};
for (const [name, passed] of Object.entries(checks)) assert.ok(passed, name);

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  mode: 'sequential-headless',
  testRoot: path.relative(projectRoot, testRoot).replaceAll('\\', '/'),
  checks,
  jobs: [contextA, contextB].map((context) => {
    const runtime = readJson(path.join(context.runtimeRoot, 'scene-runtime.json'));
    const verification = readJson(path.join(context.resultRoot, 'verification.json'));
    return {
      jobId: context.jobId,
      config: path.relative(testRoot, context.jobConfigPath).replaceAll('\\', '/'),
      audio: path.relative(testRoot, path.join(context.generatedRoot, runtime.audio.path)).replaceAll('\\', '/'),
      results: path.relative(testRoot, context.resultRoot).replaceAll('\\', '/'),
      cacheKey: runtime.cacheKey,
      durationSeconds: runtime.audio.durationSeconds,
      verificationPassed: verification.passed,
      mp4Sha256: verification.videos[0].sha256,
      deterministic: verification.videos[0].sha256 === verification.videos[1].sha256,
      progressStates: progressStates(context),
    };
  }),
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'two-jobs-latest.json'), summary);
console.log(JSON.stringify(summary, null, 2));
