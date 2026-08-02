import assert from 'node:assert/strict';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import {
  TimelineClipError,
  applyTimelineClipCommand,
  applyTimelineClipCommandBatch,
  createTimelineClipEditor,
  exportTimelineDocument,
  redoTimelineClip,
  timelineFrameTicks,
  undoTimelineClip,
  validateTimelineDocument,
} from '../../shared/timeline-clip-core.js';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateDocumentSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'timeline-project-v2.schema.json')));
const validateCommandSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'timeline-command-v2.schema.json')));
const results = [];

function test(name, run) {
  try {
    run();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, detail: error instanceof Error ? error.stack || error.message : String(error) });
  }
}

function rejects(code, run) {
  assert.throws(run, (error) => error instanceof TimelineClipError && error.code === code);
}

function hash(character) {
  return character.repeat(64);
}

function fixture() {
  return {
    version: 2,
    id: 'timeline-profesional-01',
    timebase: { ticksPerSecond: 48_000, fps: 30, audioSampleRate: 48_000 },
    sources: [
      { id: 'visual-source-01', kind: 'visual', durationTicks: 480_000, contentHash: hash('a') },
      { id: 'dialogue-source-01', kind: 'dialogue-audio', durationTicks: 240_000, contentHash: hash('b') },
      { id: 'video-source-01', kind: 'video', durationTicks: 480_000, contentHash: hash('c') },
    ],
    tracks: [
      { id: 'visual-track-01', kind: 'visual', order: 0 },
      { id: 'visual-track-02', kind: 'visual', order: 1 },
      { id: 'audio-track-01', kind: 'audio', order: 2 },
      { id: 'audio-track-02', kind: 'audio', order: 3 },
    ],
    clips: [
      {
        id: 'visual-clip-01',
        kind: 'visual',
        sourceId: 'visual-source-01',
        trackId: 'visual-track-01',
        timelineStartTick: 0,
        sourceInTick: 32_000,
        durationTicks: 160_000,
        enabled: true,
        automation: [{
          parameterId: 'position.x',
          keyframes: [
            { id: 'position-start', sourceTick: 32_000, value: 100, interpolation: 'ease' },
            { id: 'position-middle', sourceTick: 112_000, value: 540, interpolation: 'linear' },
            { id: 'position-end', sourceTick: 192_000, value: 900, interpolation: 'hold' },
          ],
        }],
      },
      {
        id: 'visual-clip-02',
        kind: 'visual',
        sourceId: 'visual-source-01',
        trackId: 'visual-track-01',
        timelineStartTick: 320_000,
        sourceInTick: 192_000,
        durationTicks: 160_000,
        enabled: true,
      },
      {
        id: 'dialogue-clip-01',
        kind: 'audio',
        sourceId: 'dialogue-source-01',
        trackId: 'audio-track-01',
        timelineStartTick: 0,
        sourceInTick: 100,
        durationTicks: 96_000,
        enabled: true,
      },
    ],
  };
}

test('documento-y-comandos-validan-con-json-schema', () => {
  const document = fixture();
  assert.equal(validateDocumentSchema(document), true, JSON.stringify(validateDocumentSchema.errors));
  for (const command of [
    { type: 'split-clip', clipId: 'visual-clip-01', atTimelineTick: 80_000, newClipId: 'visual-clip-01-b' },
    { type: 'trim-clip', clipId: 'visual-clip-01', edge: 'end', toTimelineTick: 80_000 },
    { type: 'move-clip', clipId: 'visual-clip-01', trackId: 'visual-track-02', timelineStartTick: 0 },
    { type: 'duplicate-clip', clipId: 'visual-clip-01', newClipId: 'visual-copy-01', trackId: 'visual-track-02', timelineStartTick: 0 },
    { type: 'delete-clip', clipId: 'visual-clip-01' },
  ]) assert.equal(validateCommandSchema(command), true, JSON.stringify(validateCommandSchema.errors));
});

test('schemas-rechazan-campos-arbitrarios', () => {
  assert.equal(validateDocumentSchema({ ...fixture(), script: 'alert(1)' }), false);
  assert.equal(validateCommandSchema({ type: 'delete-clip', clipId: 'visual-clip-01', shell: 'cmd.exe' }), false);
});

test('estado-inicial-es-profundo-e-inmutable', () => {
  const source = fixture();
  const state = createTimelineClipEditor(source);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.document.clips[0].automation[0].keyframes), true);
  assert.notEqual(state.document, source);
  assert.equal(state.revision, 0);
});

test('timebase-convierte-cada-frame-en-1600-ticks', () => {
  assert.equal(timelineFrameTicks(fixture()), 1_600);
});

test('split-visual-conserva-cobertura-y-fuente', () => {
  const initial = createTimelineClipEditor(fixture());
  const next = applyTimelineClipCommand(initial, {
    type: 'split-clip', clipId: 'visual-clip-01', atTimelineTick: 80_000, newClipId: 'visual-clip-01-b',
  });
  const [left, right] = next.document.clips.slice(0, 2);
  assert.equal(left.durationTicks, 80_000);
  assert.equal(right.timelineStartTick, 80_000);
  assert.equal(right.sourceInTick, 112_000);
  assert.equal(right.durationTicks, 80_000);
  assert.equal(left.durationTicks + right.durationTicks, initial.document.clips[0].durationTicks);
  assert.equal(left.sourceId, right.sourceId);
  assert.equal(initial.document.clips[0].durationTicks, 160_000);
});

test('split-clona-automatizacion-sin-reescribir-keyframes', () => {
  const initial = createTimelineClipEditor(fixture());
  const originalAutomation = initial.document.clips[0].automation;
  const next = applyTimelineClipCommand(initial, {
    type: 'split-clip', clipId: 'visual-clip-01', atTimelineTick: 80_000, newClipId: 'visual-clip-01-b',
  });
  assert.deepEqual(next.document.clips[0].automation, originalAutomation);
  assert.deepEqual(next.document.clips[1].automation, originalAutomation);
  assert.notEqual(next.document.clips[0].automation, next.document.clips[1].automation);
});

test('split-audio-es-preciso-a-una-muestra', () => {
  const next = applyTimelineClipCommand(createTimelineClipEditor(fixture()), {
    type: 'split-clip', clipId: 'dialogue-clip-01', atTimelineTick: 12_345, newClipId: 'dialogue-clip-01-b',
  });
  const left = next.document.clips.find((clip) => clip.id === 'dialogue-clip-01');
  const right = next.document.clips.find((clip) => clip.id === 'dialogue-clip-01-b');
  assert.equal(left.durationTicks, 12_345);
  assert.equal(right.sourceInTick, 12_445);
  assert.equal(right.durationTicks, 83_655);
});

test('split-rechaza-bordes-y-desalineacion-visual', () => {
  const state = createTimelineClipEditor(fixture());
  const command = (atTimelineTick) => ({
    type: 'split-clip', clipId: 'visual-clip-01', atTimelineTick, newClipId: `split-${atTimelineTick}`,
  });
  rejects('TIMELINE_RANGE_INVALID', () => applyTimelineClipCommand(state, command(0)));
  rejects('TIMELINE_RANGE_INVALID', () => applyTimelineClipCommand(state, command(159_999)));
  rejects('TIMELINE_RANGE_INVALID', () => applyTimelineClipCommand(state, command(80_001)));
});

test('trim-inicial-acorta-y-puede-volver-a-extender', () => {
  const initial = createTimelineClipEditor(fixture());
  const shortened = applyTimelineClipCommand(initial, {
    type: 'trim-clip', clipId: 'visual-clip-01', edge: 'start', toTimelineTick: 16_000,
  });
  const shortClip = shortened.document.clips[0];
  assert.deepEqual(
    { start: shortClip.timelineStartTick, sourceIn: shortClip.sourceInTick, duration: shortClip.durationTicks },
    { start: 16_000, sourceIn: 48_000, duration: 144_000 },
  );
  const restored = applyTimelineClipCommand(shortened, {
    type: 'trim-clip', clipId: 'visual-clip-01', edge: 'start', toTimelineTick: 0,
  });
  assert.deepEqual(restored.document.clips[0], initial.document.clips[0]);
});

test('trim-final-acorta-y-extiende-sin-salir-de-fuente', () => {
  const initial = createTimelineClipEditor(fixture());
  const shortened = applyTimelineClipCommand(initial, {
    type: 'trim-clip', clipId: 'visual-clip-01', edge: 'end', toTimelineTick: 80_000,
  });
  assert.equal(shortened.document.clips[0].durationTicks, 80_000);
  const extended = applyTimelineClipCommand(shortened, {
    type: 'trim-clip', clipId: 'visual-clip-01', edge: 'end', toTimelineTick: 240_000,
  });
  assert.equal(extended.document.clips[0].durationTicks, 240_000);
  rejects('TIMELINE_RANGE_INVALID', () => applyTimelineClipCommand(extended, {
    type: 'trim-clip', clipId: 'visual-clip-01', edge: 'end', toTimelineTick: 480_000,
  }));
});

test('trim-no-destruye-keyframes-ocultos', () => {
  const initial = createTimelineClipEditor(fixture());
  const trimmed = applyTimelineClipCommand(initial, {
    type: 'trim-clip', clipId: 'visual-clip-01', edge: 'start', toTimelineTick: 80_000,
  });
  assert.deepEqual(trimmed.document.clips[0].automation, initial.document.clips[0].automation);
});

test('move-cambia-solo-pista-y-posicion', () => {
  const initial = createTimelineClipEditor(fixture());
  const moved = applyTimelineClipCommand(initial, {
    type: 'move-clip', clipId: 'visual-clip-01', trackId: 'visual-track-02', timelineStartTick: 160_000,
  });
  const before = initial.document.clips[0];
  const after = moved.document.clips[0];
  assert.equal(after.trackId, 'visual-track-02');
  assert.equal(after.timelineStartTick, 160_000);
  assert.equal(after.sourceId, before.sourceId);
  assert.equal(after.sourceInTick, before.sourceInTick);
  assert.deepEqual(after.automation, before.automation);
});

test('move-rechaza-pista-incompatible-y-colision', () => {
  const state = createTimelineClipEditor(fixture());
  rejects('TIMELINE_KIND_MISMATCH', () => applyTimelineClipCommand(state, {
    type: 'move-clip', clipId: 'visual-clip-01', trackId: 'audio-track-02', timelineStartTick: 0,
  }));
  rejects('TIMELINE_COLLISION', () => applyTimelineClipCommand(state, {
    type: 'move-clip', clipId: 'visual-clip-02', trackId: 'visual-track-01', timelineStartTick: 80_000,
  }));
});

test('duplicate-crea-instancia-independiente-sobre-la-misma-fuente', () => {
  const initial = createTimelineClipEditor(fixture());
  const duplicated = applyTimelineClipCommand(initial, {
    type: 'duplicate-clip', clipId: 'visual-clip-01', newClipId: 'visual-copy-01',
    trackId: 'visual-track-02', timelineStartTick: 0,
  });
  const original = duplicated.document.clips.find((clip) => clip.id === 'visual-clip-01');
  const copy = duplicated.document.clips.find((clip) => clip.id === 'visual-copy-01');
  assert.equal(copy.sourceId, original.sourceId);
  assert.deepEqual(copy.automation, original.automation);
  assert.notEqual(copy.automation, original.automation);
});

test('duplicate-rechaza-id-y-ocupacion-existentes', () => {
  const state = createTimelineClipEditor(fixture());
  rejects('TIMELINE_ID_CONFLICT', () => applyTimelineClipCommand(state, {
    type: 'duplicate-clip', clipId: 'visual-clip-01', newClipId: 'visual-clip-02',
    trackId: 'visual-track-02', timelineStartTick: 0,
  }));
  rejects('TIMELINE_COLLISION', () => applyTimelineClipCommand(state, {
    type: 'duplicate-clip', clipId: 'visual-clip-01', newClipId: 'visual-copy-01',
    trackId: 'visual-track-01', timelineStartTick: 0,
  }));
});

test('delete-elimina-solo-la-instancia', () => {
  const initial = createTimelineClipEditor(fixture());
  const deleted = applyTimelineClipCommand(initial, { type: 'delete-clip', clipId: 'visual-clip-01' });
  assert.equal(deleted.document.clips.some((clip) => clip.id === 'visual-clip-01'), false);
  assert.deepEqual(deleted.document.sources, initial.document.sources);
});

test('batch-es-atomico-y-un-solo-paso-de-historial', () => {
  const initial = createTimelineClipEditor(fixture());
  const swapped = applyTimelineClipCommandBatch(initial, [
    { type: 'move-clip', clipId: 'visual-clip-01', trackId: 'visual-track-01', timelineStartTick: 320_000 },
    { type: 'move-clip', clipId: 'visual-clip-02', trackId: 'visual-track-01', timelineStartTick: 0 },
  ]);
  assert.equal(swapped.past.length, 1);
  assert.equal(swapped.document.clips.find((clip) => clip.id === 'visual-clip-01').timelineStartTick, 320_000);
  assert.equal(swapped.document.clips.find((clip) => clip.id === 'visual-clip-02').timelineStartTick, 0);
});

test('batch-fallido-no-publica-estado-parcial', () => {
  const initial = createTimelineClipEditor(fixture());
  const before = exportTimelineDocument(initial);
  rejects('TIMELINE_CLIP_NOT_FOUND', () => applyTimelineClipCommandBatch(initial, [
    { type: 'delete-clip', clipId: 'visual-clip-01' },
    { type: 'delete-clip', clipId: 'clip-fantasma' },
  ]));
  assert.equal(exportTimelineDocument(initial), before);
});

test('undo-y-redo-recuperan-documentos-identicos', () => {
  const initial = createTimelineClipEditor(fixture());
  const changed = applyTimelineClipCommand(initial, { type: 'delete-clip', clipId: 'visual-clip-01' });
  const undone = undoTimelineClip(changed);
  const redone = redoTimelineClip(undone);
  assert.equal(exportTimelineDocument(undone), exportTimelineDocument(initial));
  assert.equal(exportTimelineDocument(redone), exportTimelineDocument(changed));
  assert.equal(undoTimelineClip(initial), initial);
  assert.equal(redoTimelineClip(initial), initial);
});

test('serializacion-es-canonica-y-portable', () => {
  const first = exportTimelineDocument(createTimelineClipEditor(fixture()));
  const second = exportTimelineDocument(createTimelineClipEditor(JSON.parse(JSON.stringify(fixture()))));
  assert.equal(first, second);
  assert.equal(first.endsWith('\n'), true);
  assert.equal(/[A-Za-z]:\\/u.test(first), false);
  assert.equal(first.includes('script'), false);
});

test('mismo-comando-y-entrada-producen-misma-salida', () => {
  const command = { type: 'split-clip', clipId: 'visual-clip-01', atTimelineTick: 80_000, newClipId: 'visual-clip-01-b' };
  const left = applyTimelineClipCommand(createTimelineClipEditor(fixture()), command);
  const right = applyTimelineClipCommand(createTimelineClipEditor(fixture()), command);
  assert.equal(exportTimelineDocument(left), exportTimelineDocument(right));
});

test('comandos-cerrados-rechazan-campos-y-tipos-desconocidos', () => {
  const state = createTimelineClipEditor(fixture());
  rejects('TIMELINE_COMMAND_INVALID', () => applyTimelineClipCommand(state, {
    type: 'delete-clip', clipId: 'visual-clip-01', arbitraryCode: 'run()',
  }));
  rejects('TIMELINE_COMMAND_UNSUPPORTED', () => applyTimelineClipCommand(state, {
    type: 'execute-script', clipId: 'visual-clip-01',
  }));
  rejects('TIMELINE_COMMAND_INVALID', () => applyTimelineClipCommand(state, {
    type: 'delete-clip', clipId: 'ID no portable',
  }));
});

test('documento-rechaza-referencias-rangos-y-hashes-invalidos', () => {
  const missing = fixture();
  missing.clips[0].sourceId = 'fuente-fantasma';
  rejects('TIMELINE_SOURCE_NOT_FOUND', () => validateTimelineDocument(missing));

  const overflow = fixture();
  overflow.clips[0].sourceInTick = 400_000;
  rejects('TIMELINE_RANGE_INVALID', () => validateTimelineDocument(overflow));

  const badHash = fixture();
  badHash.sources[0].contentHash = 'no-es-hash';
  rejects('TIMELINE_DOCUMENT_INVALID', () => validateTimelineDocument(badHash));
});

test('documento-rechaza-solapamiento-y-desalineacion', () => {
  const overlap = fixture();
  overlap.clips[1].timelineStartTick = 80_000;
  rejects('TIMELINE_COLLISION', () => validateTimelineDocument(overlap));

  const offFrame = fixture();
  offFrame.clips[0].durationTicks += 1;
  rejects('TIMELINE_RANGE_INVALID', () => validateTimelineDocument(offFrame));
});

test('fuente-video-es-compatible-con-pista-visual-o-audio', () => {
  const visual = fixture();
  visual.clips[0].sourceId = 'video-source-01';
  assert.equal(validateTimelineDocument(visual), true);

  const audio = fixture();
  audio.clips[2].sourceId = 'video-source-01';
  assert.equal(validateTimelineDocument(audio), true);
});

test('clips-enlazados-se-rechazan-hasta-operarlos-como-grupo', () => {
  const document = fixture();
  document.clips[0].linkGroupId = 'grupo-av-01';
  const state = createTimelineClipEditor(document);
  rejects('TIMELINE_COMMAND_UNSUPPORTED', () => applyTimelineClipCommand(state, {
    type: 'move-clip', clipId: 'visual-clip-01', trackId: 'visual-track-02', timelineStartTick: 0,
  }));
});

test('clips-contiguos-no-son-colision', () => {
  const document = fixture();
  document.clips[1].timelineStartTick = 160_000;
  assert.equal(validateTimelineDocument(document), true);
});

test('historial-respeta-limite-configurado', () => {
  let state = createTimelineClipEditor(fixture(), { historyLimit: 2 });
  state = applyTimelineClipCommand(state, { type: 'move-clip', clipId: 'visual-clip-01', trackId: 'visual-track-02', timelineStartTick: 0 });
  state = applyTimelineClipCommand(state, { type: 'move-clip', clipId: 'visual-clip-01', trackId: 'visual-track-02', timelineStartTick: 160_000 });
  state = applyTimelineClipCommand(state, { type: 'move-clip', clipId: 'visual-clip-01', trackId: 'visual-track-02', timelineStartTick: 320_000 });
  assert.equal(state.past.length, 2);
});

const failed = results.filter((result) => !result.passed);
const summary = {
  version: 1,
  executedAt: new Date().toISOString(),
  passed: results.length - failed.length,
  failed: failed.length,
  results,
};
const outputRoot = ensureDirectory(path.join(projectRoot, '.local-video', 'test-results'));
writeJson(path.join(outputRoot, 'timeline-clip-core-latest.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed.length > 0) process.exitCode = 1;
