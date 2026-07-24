import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectRepository } from './project-repository.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-projects-'));
const repository = createProjectRepository({ storageRoot: root });
const project = {
  version: 1,
  id: 'proyecto-prueba',
  title: 'Proyecto de prueba',
  video: { width: 1080, height: 1920, fps: 30 },
  seed: 1,
  resourceCatalog: 'assets/catalog/authoring-resources.json',
  scenes: [{
    id: 'escena-01',
    title: 'Escena 1',
    background: { resourceId: 'fondo', cameraPreset: 'static' },
    elements: [],
    dialogue: [],
  }],
};

try {
  assert.equal(repository.list().length, 0);
  assert.equal(repository.save(project).created, true);
  assert.equal(repository.save({ ...project, title: 'Editado' }).created, false);
  assert.equal(repository.get(project.id).title, 'Editado');
  assert.equal(repository.list()[0].scenes, 1);
  assert.throws(() => repository.get('../escape'), (error) => error.code === 'PROJECT_ID_INVALID');
  assert.equal(repository.remove(project.id), true);
  assert.equal(repository.remove(project.id), false);
  process.stdout.write(`${JSON.stringify({ version: 1, passed: 7, failed: 0 })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
