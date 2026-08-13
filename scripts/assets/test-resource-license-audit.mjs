import assert from 'node:assert/strict';
import path from 'node:path';
import { projectRoot, readJson } from '../stage1/common.mjs';
import {
  ResourceLicenseAuditError,
  auditResourceLicenses,
  commercialReleaseBlockers,
  renderThirdPartyNotices,
  validateResourceLicenseManifestDocument,
} from './resource-license-audit.mjs';

const manifest = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'resource-licenses.json'));
const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));

validateResourceLicenseManifestDocument(manifest, catalog);
assert.equal(manifest.resources.length, catalog.entries.length);
assert.equal(renderThirdPartyNotices(manifest), renderThirdPartyNotices(structuredClone(manifest)));

const missing = structuredClone(manifest);
missing.resources = missing.resources.slice(1);
assert.throws(
  () => validateResourceLicenseManifestDocument(missing, catalog),
  (error) => error instanceof ResourceLicenseAuditError && error.code === 'LICENSE_RESOURCE_MISSING',
);

const wrongType = structuredClone(manifest);
wrongType.resources[0].assetType = 'prop';
assert.throws(
  () => validateResourceLicenseManifestDocument(wrongType, catalog),
  (error) => error instanceof ResourceLicenseAuditError && error.code === 'LICENSE_RESOURCE_TYPE_MISMATCH',
);

const blockers = commercialReleaseBlockers(manifest);
assert.ok(blockers.some((blocker) => blocker.id === 'conejo-traje-v1'));
assert.ok(blockers.some((blocker) => blocker.id === 'voz-claude-mx-v1'));
assert.ok(blockers.some((blocker) => blocker.id === 'piper-tts-runtime'));
assert.ok(blockers.some((blocker) => blocker.id === 'elevenlabs-service'));

const summary = auditResourceLicenses();
assert.equal(summary.catalogResources, catalog.entries.length);
assert.equal(summary.licensedResources, catalog.entries.length);
assert.equal(summary.commercialReleaseReady, false);

process.stdout.write(`${JSON.stringify({
  version: 1,
  passed: 7,
  resources: summary.licensedResources,
  blockers: summary.blockers.length,
})}\n`);
