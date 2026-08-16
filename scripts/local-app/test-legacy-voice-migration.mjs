import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  migrateLegacyProjectVoices,
  replaceLegacyVoices,
} from './migrate-legacy-voices.mjs';
import { createProjectRepository } from './project-repository.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'local-video-voice-migration-'));
const repository = createProjectRepository({ storageRoot: root });
const project = {
  version: 1,
  id: 'proyecto-legacy',
  title: 'Proyecto legacy',
  video: { width: 1080, height: 1920, fps: 30 },
  seed: 1,
  resourceCatalog: 'assets/catalog/authoring-resources.json',
  scenes: [{
    id: 'escena-01',
    title: 'Escena 1',
    background: { resourceId: 'fondo', cameraPreset: 'static' },
    elements: [],
    dialogue: [
      { id: 'turno-01', voiceId: 'voz-daniela-ar-v1' },
      { id: 'turno-02', voiceId: 'voz-davefx-es-v1' },
    ],
  }],
};

try {
  const pure = replaceLegacyVoices(project);
  assert.equal(project.scenes[0].dialogue[0].voiceId, 'voz-daniela-ar-v1');
  assert.equal(pure.project.scenes[0].dialogue[0].voiceId, 'voz-elevenlabs-c8ff047a678d');
  assert.equal(pure.project.scenes[0].dialogue[1].voiceId, 'voz-elevenlabs-e029c0d67044');

  await repository.save(project);
  const dryRun = await migrateLegacyProjectVoices(repository);
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.changedProjects, 1);
  assert.equal(dryRun.replacementCount, 2);
  assert.equal((await repository.get(project.id)).project.scenes[0].dialogue[0].voiceId, 'voz-daniela-ar-v1');

  const applied = await migrateLegacyProjectVoices(repository, { apply: true });
  assert.equal(applied.mode, 'apply');
  assert.equal(applied.changedProjects, 1);
  assert.equal((await repository.get(project.id)).project.scenes[0].dialogue[0].voiceId, 'voz-elevenlabs-c8ff047a678d');
  assert.equal((await repository.get(project.id)).project.scenes[0].dialogue[1].voiceId, 'voz-elevenlabs-e029c0d67044');

  const repeated = await migrateLegacyProjectVoices(repository, { apply: true });
  assert.equal(repeated.changedProjects, 0);
  assert.equal(repeated.replacementCount, 0);
  process.stdout.write(`${JSON.stringify({ version: 1, passed: 13, failed: 0 })}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
