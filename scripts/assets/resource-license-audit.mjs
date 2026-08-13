import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { isMain, projectRoot, readJson } from '../stage1/common.mjs';

const schemaPath = path.join(projectRoot, 'schema', 'resource-license-manifest.schema.json');
const defaultManifestPath = path.join(projectRoot, 'public', 'assets', 'catalog', 'resource-licenses.json');
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(readJson(schemaPath));

export class ResourceLicenseAuditError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'ResourceLicenseAuditError';
    this.code = code;
    if (detail) this.detail = detail;
  }
}

export function validateResourceLicenseManifestDocument(document, catalog) {
  if (!validateSchema(document)) {
    const detail = (validateSchema.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    fail('LICENSE_MANIFEST_SCHEMA_INVALID', 'El manifiesto legal no cumple su esquema.', detail);
  }
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.entries)) {
    fail('LICENSE_CATALOG_INVALID', 'El catálogo creativo usado por la auditoría no es válido.');
  }

  const records = uniqueBy(document.resources, 'resourceId', 'LICENSE_RESOURCE_DUPLICATED');
  uniqueBy(document.dependencies, 'id', 'LICENSE_DEPENDENCY_DUPLICATED');
  const catalogEntries = uniqueBy(catalog.entries, 'id', 'LICENSE_CATALOG_RESOURCE_DUPLICATED');

  for (const [resourceId, entry] of catalogEntries) {
    const record = records.get(resourceId);
    if (!record) {
      fail('LICENSE_RESOURCE_MISSING', `El recurso «${resourceId}» no tiene registro legal.`);
    }
    if (record.assetType !== entry.type) {
      fail(
        'LICENSE_RESOURCE_TYPE_MISMATCH',
        `El tipo legal de «${resourceId}» no coincide con el catálogo.`,
        `${record.assetType} != ${entry.type}`,
      );
    }
  }
  for (const resourceId of records.keys()) {
    if (!catalogEntries.has(resourceId)) {
      fail('LICENSE_RESOURCE_ORPHAN', `El manifiesto legal referencia un recurso inexistente: «${resourceId}».`);
    }
  }

  for (const record of [...document.resources, ...document.dependencies]) {
    if (record.status === 'cleared'
      && (record.commercialUse !== 'allowed'
        || ['prohibited', 'review-required'].includes(record.redistribution))) {
      fail('LICENSE_CLEARANCE_CONTRADICTORY', `«${record.resourceId ?? record.id}» figura liberado pero conserva restricciones pendientes.`);
    }
    if (record.status === 'attribution-required' && !record.attribution.required) {
      fail('LICENSE_ATTRIBUTION_MISSING', `«${record.resourceId ?? record.id}» requiere atribución pero no declara su texto.`);
    }
  }
  return document;
}

export function commercialReleaseBlockers(document) {
  const candidates = [
    ...document.resources.map((record) => ({ scope: 'resource', id: record.resourceId, record })),
    ...document.dependencies.map((record) => ({ scope: 'dependency', id: record.id, record })),
  ];
  return candidates.flatMap(({ scope, id, record }) => {
    const reasons = [];
    if (['review-required', 'local-only'].includes(record.status)) reasons.push(`status:${record.status}`);
    if (record.commercialUse !== 'allowed') reasons.push(`commercialUse:${record.commercialUse}`);
    if (['prohibited', 'review-required'].includes(record.redistribution)) reasons.push(`redistribution:${record.redistribution}`);
    return reasons.length > 0 ? [{ scope, id, reasons }] : [];
  });
}

export function renderThirdPartyNotices(document) {
  const thirdPartyResources = document.resources
    .filter((record) => record.origin === 'third-party')
    .sort((left, right) => left.resourceId.localeCompare(right.resourceId, 'en'));
  const dependencies = [...document.dependencies]
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  const lines = [
    '# Avisos de terceros',
    '',
    'Este archivo se genera de forma determinista desde `public/assets/catalog/resource-licenses.json`.',
    'Resume la procedencia registrada y no sustituye los textos completos de cada licencia ni una revisión jurídica.',
    '',
    '## Recursos de terceros',
    '',
  ];
  if (thirdPartyResources.length === 0) lines.push('No hay recursos de terceros registrados.', '');
  for (const record of thirdPartyResources) appendNotice(lines, record.resourceId, record);
  lines.push('## Runtime y servicios externos', '');
  if (dependencies.length === 0) lines.push('No hay dependencias externas registradas.', '');
  for (const record of dependencies) appendNotice(lines, record.label, record);
  lines.push(
    '## Política de recursos propietarios',
    '',
    `Los recursos originales cuyo registro usa \`${document.policy.proprietaryAssetLicense}\` pertenecen a ${document.policy.rightsHolder}.`,
    'Pueden distribuirse como parte del producto autorizado, pero no como una biblioteca de assets independiente salvo autorización expresa del titular.',
    '',
  );
  return `${lines.join('\n').trimEnd()}\n`;
}

export function auditResourceLicenses(options = {}) {
  const manifestPath = path.resolve(options.manifestPath ?? defaultManifestPath);
  const manifest = readJson(manifestPath);
  const catalogPath = resolveProjectPath(manifest.catalog);
  const catalog = readJson(catalogPath);
  validateResourceLicenseManifestDocument(manifest, catalog);

  const notices = renderThirdPartyNotices(manifest);
  const noticesPath = resolveProjectPath(manifest.policy.notices);
  if (options.writeNotices) writeFileSync(noticesPath, notices, 'utf8');
  let currentNotices = '';
  try {
    currentNotices = readFileSync(noticesPath, 'utf8').replaceAll('\r\n', '\n');
  } catch (error) {
    fail('LICENSE_NOTICES_MISSING', 'Falta el archivo de avisos de terceros.', error.message);
  }
  if (currentNotices !== notices) {
    fail('LICENSE_NOTICES_OUTDATED', 'Los avisos de terceros no coinciden con el manifiesto.', 'Ejecute npm run assets:licenses:write.');
  }

  const blockers = commercialReleaseBlockers(manifest);
  if (options.commercialRelease && blockers.length > 0) {
    fail(
      'LICENSE_COMMERCIAL_RELEASE_BLOCKED',
      'El release comercial está bloqueado por revisiones legales pendientes.',
      blockers.map((blocker) => `${blocker.id} (${blocker.reasons.join(', ')})`).join('; '),
    );
  }
  return {
    version: manifest.version,
    catalogResources: catalog.entries.length,
    licensedResources: manifest.resources.length,
    dependencies: manifest.dependencies.length,
    attributionRequired: manifest.resources.filter((record) => record.attribution.required).length,
    commercialReleaseReady: blockers.length === 0,
    blockers,
  };
}

function appendNotice(lines, heading, record) {
  lines.push(
    `### ${heading}`,
    '',
    `- Titular o fuente: ${record.rightsHolder ?? record.label}`,
    `- Licencia registrada: \`${record.licenseExpression}\``,
    `- Estado: \`${record.status}\``,
    `- Fuente: ${record.sourceUrl}`,
    `- Licencia: ${record.licenseUrl}`,
  );
  if (record.attribution.required) lines.push(`- Atribución: ${record.attribution.text}`);
  lines.push(`- Nota: ${record.notes}`, '');
}

function uniqueBy(values, key, code) {
  const result = new Map();
  for (const value of values) {
    if (result.has(value[key])) fail(code, `Identificador legal duplicado: «${value[key]}».`);
    result.set(value[key], value);
  }
  return result;
}

function resolveProjectPath(relativePath) {
  const resolved = path.resolve(projectRoot, relativePath);
  const relative = path.relative(projectRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('LICENSE_PATH_INVALID', `La ruta legal sale del repositorio: «${relativePath}».`);
  }
  return resolved;
}

function fail(code, message, detail = '') {
  throw new ResourceLicenseAuditError(code, message, detail);
}

if (isMain(import.meta.url)) {
  try {
    const summary = auditResourceLicenses({
      writeNotices: process.argv.includes('--write-notices'),
      commercialRelease: process.argv.includes('--commercial-release'),
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      name: error.name,
      code: error.code ?? 'LICENSE_AUDIT_FAILED',
      message: error.message,
      detail: error.detail ?? '',
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}
