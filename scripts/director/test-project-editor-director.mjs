import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { editProjectWithDirector } from './project-editor-director.mjs';

const project = readJson(path.join(projectRoot, 'pilots', 'proyecto-compilable-01', 'project.json'));
const catalog = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'authoring-resources.json'));
const cacheRoot = mkdtempSync(path.join(tmpdir(), 'director-edit-'));
let calls = 0;
const fetchImpl = async (_url, options) => {
  calls += 1;
  const request = JSON.parse(options.body);
  assert.equal(request.think, false);
  assert.equal(request.stream, false);
  return new Response(JSON.stringify({
    message: {
      content: JSON.stringify({
        commands: [{
          type: 'set-dialogue-turn',
          sceneId: project.scenes[1].id,
          turnId: project.scenes[1].dialogue[0].id,
          text: 'Texto actualizado por el Director.',
        }],
      }),
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

try {
  const first = await editProjectWithDirector({
    instruction: 'Cambiá el primer texto de la escena 2.',
    project, catalog, cacheRoot, fetchImpl,
  });
  assert.equal(first.cacheHit, false);
  assert.equal(first.commands.length, 1);
  assert.equal(first.project.scenes[1].dialogue[0].text, 'Texto actualizado por el Director.');
  const second = await editProjectWithDirector({
    instruction: 'Cambiá el primer texto de la escena 2.',
    project, catalog, cacheRoot, fetchImpl,
  });
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
  await assert.rejects(() => editProjectWithDirector({ instruction: 'x', project, catalog, cacheRoot, fetchImpl }));
  process.stdout.write(`${JSON.stringify({ version: 1, passed: 8, failed: 0 })}\n`);
} finally {
  rmSync(cacheRoot, { recursive: true, force: true });
}
