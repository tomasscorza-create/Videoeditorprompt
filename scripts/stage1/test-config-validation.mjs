import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, projectRoot, readJson, writeJson } from './common.mjs';
import { createJobContext } from './job-context.mjs';
import { runPipeline } from './pipeline.mjs';
import { loadAndValidateJobConfig, validateMeasuredDuration } from './validate-scene-config.mjs';

const base = readJson(path.join(projectRoot, 'public', 'scene.config.json'));
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const testRoot = path.join(projectRoot, '.local-video', 'tests', 'config-validation', stamp);
const configRoot = ensureDirectory(path.join(testRoot, 'configs'));
const workRoot = path.join(testRoot, 'work');
const outputRoot = path.join(testRoot, 'output');
const common = { 'assets-dir': 'public', 'work-dir': workRoot, 'output-dir': outputRoot };
const results = [];

function contextFor(name, configValue) {
  const configPath = path.join(configRoot, `${name}.json`);
  if (typeof configValue === 'string') writeFileSync(configPath, configValue, 'utf8');
  else writeJson(configPath, configValue);
  return createJobContext({ ...common, 'job-id': `validation-${name}-${stamp}`, config: configPath });
}

function validCase(name, change = () => {}) {
  const config = structuredClone(base);
  change(config);
  const context = contextFor(name, config);
  assert.deepEqual(loadAndValidateJobConfig(context), config);
  results.push({ name, accepted: true });
}

function invalidCase(name, expectedCode, change) {
  const config = structuredClone(base);
  change(config);
  const context = contextFor(name, config);
  assert.throws(() => loadAndValidateJobConfig(context), (error) => {
    assert.equal(error.code, expectedCode, name);
    assert.ok(error.stage, `${name}: stage`);
    assert.ok(error.message, `${name}: message`);
    return true;
  });
  results.push({ name, accepted: false, expectedCode });
}

validCase('valid');
assert.deepEqual(validateMeasuredDuration(base, 4.9), { durationSeconds: 4.9, frameCount: 147 });
results.push({ name: 'measured-duration-valid', accepted: true });
assert.throws(() => validateMeasuredDuration(base, 121), (error) => error.code === 'AUDIO_DURATION_OUT_OF_RANGE');
results.push({ name: 'measured-duration-limit', accepted: false, expectedCode: 'AUDIO_DURATION_OUT_OF_RANGE' });
const lateSubtitle = structuredClone(base);
lateSubtitle.subtitle.startSeconds = 5;
assert.throws(() => validateMeasuredDuration(lateSubtitle, 4.9), (error) => error.code === 'SUBTITLE_START_AFTER_AUDIO');
results.push({ name: 'subtitle-after-audio', accepted: false, expectedCode: 'SUBTITLE_START_AFTER_AUDIO' });
invalidCase('missing-field', 'CONFIG_SCHEMA_INVALID', (config) => { delete config.video.fps; });
invalidCase('unknown-field', 'CONFIG_SCHEMA_INVALID', (config) => { config.video.codec = 'h264'; });
invalidCase('wrong-resolution', 'CONFIG_SCHEMA_INVALID', (config) => { config.video.width = 720; });
invalidCase('text-limit', 'CONFIG_SCHEMA_INVALID', (config) => { config.voice.text = 'x'.repeat(1001); });
invalidCase('absolute-asset', 'ASSET_PATH_INVALID', (config) => { config.assets.body = 'C:\\outside\\body.png'; });
invalidCase('url-asset', 'ASSET_PATH_INVALID', (config) => { config.assets.body = 'https://example.invalid/body.png'; });
invalidCase('traversal-asset', 'ASSET_PATH_INVALID', (config) => { config.assets.body = '../body.png'; });
invalidCase('missing-asset', 'ASSET_NOT_FOUND', (config) => { config.assets.body = 'assets/stage1/not-found.png'; });
invalidCase('blink-order', 'CONFIG_SEMANTIC_INVALID', (config) => {
  config.blink.minIntervalSeconds = 3;
  config.blink.maxIntervalSeconds = 2;
});
invalidCase('mouth-thresholds', 'CONFIG_SEMANTIC_INVALID', (config) => {
  config.mouth.silenceThresholdNormalized = 0.8;
  config.mouth.openThresholdNormalized = 0.4;
});

const malformed = contextFor('malformed-json', '{"version":1,');
assert.throws(() => loadAndValidateJobConfig(malformed), (error) => error.code === 'CONFIG_JSON_INVALID');
results.push({ name: 'malformed-json', accepted: false, expectedCode: 'CONFIG_JSON_INVALID' });

const pipelineConfig = structuredClone(base);
pipelineConfig.assets.body = '../outside.png';
const failedPipeline = contextFor('pipeline-failure', pipelineConfig);
await assert.rejects(() => runPipeline(failedPipeline), (error) => error.code === 'ASSET_PATH_INVALID');
const status = JSON.parse(readFileSync(path.join(failedPipeline.statusRoot, 'job-status.json'), 'utf8'));
assert.equal(status.version, 1);
assert.equal(status.jobId, failedPipeline.jobId);
assert.equal(status.state, 'failed');
assert.equal(status.stage, 'validating_config');
assert.equal(status.code, 'ASSET_PATH_INVALID');
assert.ok(status.message);
assert.ok(status.suggestedAction);
assert.equal('error' in status, false, 'El error debe ser plano, no anidado.');
results.push({ name: 'pipeline-failure-structured', accepted: false, expectedCode: status.code });

const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  schema: 'schema/scene-config.schema.json',
  passed: results.length,
  failed: 0,
  results,
  structuredFailure: {
    state: status.state,
    stage: status.stage,
    code: status.code,
    hasMessage: Boolean(status.message),
    hasSuggestedAction: Boolean(status.suggestedAction),
  },
};
writeJson(path.join(projectRoot, '.local-video', 'test-results', 'config-validation-latest.json'), summary);
console.log(JSON.stringify(summary, null, 2));
