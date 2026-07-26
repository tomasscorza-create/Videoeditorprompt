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
  assert.equal((await repository.list()).length, 0);
  const created = await repository.save(project);
  assert.equal(created.created, true);
  assert.match(created.revision, /^[a-f0-9]{64}$/u);
  const edited = await repository.save({ ...project, title: 'Editado' }, created.revision);
  assert.equal(edited.created, false);
  assert.notEqual(edited.revision, created.revision);
  assert.equal((await repository.get(project.id)).project.title, 'Editado');
  assert.equal((await repository.list())[0].scenes, 1);
  await assert.rejects(
    () => repository.save({ ...project, title: 'Conflicto' }, created.revision),
    (error) => error.code === 'PROJECT_REVISION_CONFLICT',
  );
  await assert.rejects(
    () => repository.get('../escape'),
    (error) => error.code === 'PROJECT_ID_INVALID',
  );
  assert.equal(await repository.remove(project.id, edited.revision), true);
  assert.equal(await repository.remove(project.id), false);
  process.stdout.write(`${JSON.stringify({ version: 1, passed: 11, failed: 0 })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
