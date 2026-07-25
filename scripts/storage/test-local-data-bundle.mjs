import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  exportLocalDataBundle,
  inventoryLocalData,
  verifyLocalDataBundle,
} from './local-data-bundle.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-bundle-'));
let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

try {
  const emptyRoots = rootsAt(path.join(root, 'empty-source'));
  const emptyOutput = path.join(root, 'empty-bundle');
  const emptyExport = await exportLocalDataBundle({ ...emptyRoots, output: emptyOutput });
  check(emptyExport.summary.totalFiles === 0, 'bundle vacío exportado');
  check((await verifyLocalDataBundle({ bundle: emptyOutput })).valid, 'bundle vacío verificado');

  const source = path.join(root, 'source');
  const roots = rootsAt(source);
  const project = {
    version: 1,
    id: 'proyecto-bundle-01',
    title: 'Proyecto portable',
    scenes: [{ id: 'escena-01' }],
  };
  writeJson(path.join(roots.projectsRoot, `${project.id}.json`), project);

  const partialOutput = path.join(root, 'partial-bundle');
  await exportLocalDataBundle({
    ...roots,
    libraryRoot: path.join(root, 'missing-library'),
    jobsRoot: path.join(root, 'missing-jobs'),
    outputRoot: path.join(root, 'missing-output'),
    output: partialOutput,
  });
  const partial = await verifyLocalDataBundle({ bundle: partialOutput });
  check(partial.valid && partial.summary.projects === 1, 'bundle parcial válido');
  check(partial.summary.totalFiles === 1, 'bundle parcial no inventa datos');

  const resourceId = 'fondo-bundle-01';
  const registry = {
    version: 1,
    entries: [{
      id: resourceId,
      contentHash: '1'.repeat(64),
      registeredAt: '2026-07-25T00:00:00.000Z',
      entry: {
        id: resourceId,
        type: 'background',
        backgroundManifest: `assets/library/backgrounds/${resourceId}/background.manifest.json`,
      },
    }],
  };
  writeJson(path.join(roots.libraryRoot, 'library-index.json'), registry);
  writeJson(
    path.join(
      roots.libraryRoot,
      'assets',
      'backgrounds',
      resourceId,
      'background.manifest.json',
    ),
    { version: 1, id: resourceId },
  );
  writeBytes(
    path.join(roots.libraryRoot, 'assets', 'backgrounds', resourceId, 'background.png'),
    Buffer.from('imagen-portable'),
  );
  writeBytes(path.join(roots.libraryRoot, '.work', 'temporary.bin'), Buffer.from('no-migrar'));

  const jobId = 'render-bundle-01';
  writeJson(path.join(roots.jobsRoot, `${jobId}.json`), {
    version: 1,
    jobId,
    projectId: project.id,
    state: 'completed',
    stage: 'project_pipeline',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:01:00.000Z',
    progress: null,
    error: null,
  });
  writeJson(path.join(roots.jobsRoot, 'render-fallido-01.json'), {
    version: 1,
    jobId: 'render-fallido-01',
    projectId: project.id,
    state: 'failed',
    stage: 'encoding',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:01:00.000Z',
    progress: null,
    error: { code: 'TEST' },
  });
  writeJson(path.join(roots.outputRoot, jobId, 'project-manifest.json'), {
    version: 2,
    jobId,
    projectId: project.id,
  });
  writeBytes(path.join(roots.outputRoot, jobId, 'render-1.mp4'), Buffer.from('video-final'));

  const sourceHashBefore = treeHash(source);
  const inventory = await inventoryLocalData(roots);
  check(inventory.manifest.summary.projects === 1, 'proyecto inventariado');
  check(inventory.manifest.summary.resources === 1, 'registro inventariado');
  check(inventory.manifest.summary.resourceFiles === 2, 'assets inventariados');
  check(inventory.manifest.summary.jobs === 1, 'solo job completado inventariado');
  check(inventory.manifest.summary.jobArtifacts === 2, 'artefactos finales inventariados');
  check(!JSON.stringify(inventory.manifest).includes(root), 'inventario sin ruta absoluta');
  check(
    !inventory.manifest.entries.some((entry) => entry.path.includes('.work')),
    'temporales excluidos',
  );

  const outputA = path.join(root, 'bundle-a');
  const outputB = path.join(root, 'bundle-b');
  const exportedA = await exportLocalDataBundle({ ...roots, output: outputA });
  const exportedB = await exportLocalDataBundle({ ...roots, output: outputB });
  check(exportedA.fingerprint === exportedB.fingerprint, 'fingerprint repetible');
  check(treeHash(outputA) === treeHash(outputB), 'exportación byte a byte repetible');
  check(treeHash(source) === sourceHashBefore, 'origen no modificado');
  const verified = await verifyLocalDataBundle({ bundle: outputA });
  check(verified.valid, 'bundle completo verificado');
  check(verified.summary.totalFiles === 7, 'conteo completo estable');

  await assert.rejects(
    () => exportLocalDataBundle({ ...roots, output: outputA }),
    (error) => error.code === 'BUNDLE_OUTPUT_EXISTS',
  );
  passed += 1;

  const corrupt = path.join(root, 'bundle-corrupt');
  cpSync(outputA, corrupt, { recursive: true });
  writeBytes(path.join(corrupt, 'jobs', jobId, 'artifacts', 'render-1.mp4'), Buffer.from('alterado'));
  await assert.rejects(
    () => verifyLocalDataBundle({ bundle: corrupt }),
    (error) => error.code === 'BUNDLE_SIZE_MISMATCH' || error.code === 'BUNDLE_HASH_MISMATCH',
  );
  passed += 1;

  const missing = path.join(root, 'bundle-missing');
  cpSync(outputA, missing, { recursive: true });
  unlinkSync(path.join(missing, 'resources', 'assets', 'backgrounds', resourceId, 'background.png'));
  await assert.rejects(
    () => verifyLocalDataBundle({ bundle: missing }),
    (error) => error.code === 'BUNDLE_FILE_SET_MISMATCH',
  );
  passed += 1;

  const extra = path.join(root, 'bundle-extra');
  cpSync(outputA, extra, { recursive: true });
  writeBytes(path.join(extra, 'extra.bin'), Buffer.from('no-listado'));
  await assert.rejects(
    () => verifyLocalDataBundle({ bundle: extra }),
    (error) => error.code === 'BUNDLE_FILE_SET_MISMATCH',
  );
  passed += 1;

  const absolute = path.join(root, 'bundle-absolute');
  cpSync(outputA, absolute, { recursive: true });
  const absoluteProjectPath = path.join(absolute, 'projects', `${project.id}.json`);
  writeJson(absoluteProjectPath, { ...project, title: 'C:\\datos\\privados\\proyecto.json' });
  rewriteManifestEntry(absolute, `projects/${project.id}.json`, absoluteProjectPath, (entry, value) => ({
    ...entry,
    revision: jsonRevision(value),
  }));
  await assert.rejects(
    () => verifyLocalDataBundle({ bundle: absolute }),
    (error) => error.code === 'BUNDLE_ABSOLUTE_PATH',
  );
  passed += 1;

  process.stdout.write(`${JSON.stringify({ version: 1, passed, failed: 0 })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

function rootsAt(source) {
  return {
    projectsRoot: path.join(source, 'projects'),
    libraryRoot: path.join(source, 'library'),
    jobsRoot: path.join(source, 'jobs'),
    outputRoot: path.join(source, 'output'),
  };
}

function writeJson(file, value) {
  writeBytes(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

function writeBytes(file, bytes) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

function treeHash(directory) {
  const files = walk(directory);
  const hash = createHash('sha256');
  for (const file of files) {
    const relative = path.relative(directory, file).split(path.sep).join('/');
    const bytes = readFileSync(file);
    hash.update(`${relative}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const entries = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, item.name);
    if (item.isDirectory()) entries.push(...walk(target));
    else if (item.isFile()) entries.push(target);
  }
  return entries.sort();
}

function rewriteManifestEntry(bundle, relative, changedFile, transform) {
  const manifestPath = path.join(bundle, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const index = manifest.entries.findIndex((entry) => entry.path === relative);
  const value = JSON.parse(readFileSync(changedFile, 'utf8'));
  const bytes = readFileSync(changedFile);
  manifest.entries[index] = transform({
    ...manifest.entries[index],
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }, value);
  const { fingerprint: _old, ...body } = manifest;
  manifest.fingerprint = jsonRevision(body);
  writeJson(manifestPath, manifest);
}

function jsonRevision(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}
