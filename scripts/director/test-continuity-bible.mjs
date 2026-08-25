import assert from 'node:assert/strict';
import { analyzeDirectorContinuity, buildContinuityBible } from './continuity-bible.mjs';

const coherent = {
  richnessProfile: 'varied',
  scenes: [
    {
      backgroundResourceId: 'fondo-a',
      participants: [{ roleId: 'guia', characterResourceId: 'personaje-a', voiceId: 'voz-a' }],
      speech: [{ kind: 'character', speakerRoleId: 'guia' }],
    },
    {
      backgroundResourceId: 'fondo-a',
      participants: [{ roleId: 'guia', characterResourceId: 'personaje-a', voiceId: 'voz-a' }],
      speech: [{ kind: 'voiceover', voiceId: 'voz-narrador' }],
    },
    {
      backgroundResourceId: 'fondo-b',
      participants: [{ roleId: 'contrapunto', characterResourceId: 'personaje-b', voiceId: 'voz-b' }],
      speech: [{ kind: 'voiceover', voiceId: 'voz-narrador' }],
    },
  ],
};
const report = analyzeDirectorContinuity(coherent);
assert.equal(report.passed, true);
assert.deepEqual(buildContinuityBible(coherent), {
  version: 1,
  cast: [
    { roleId: 'guia', characterResourceId: 'personaje-a', voiceId: 'voz-a' },
    { roleId: 'contrapunto', characterResourceId: 'personaje-b', voiceId: 'voz-b' },
  ],
  narratorVoiceId: 'voz-narrador',
  backgroundStrategy: 'beat-variation',
  backgroundResourceIds: ['fondo-a', 'fondo-b'],
});

const broken = structuredClone(coherent);
broken.scenes[1].participants[0].voiceId = 'voz-b';
broken.scenes[2].speech[0].voiceId = 'otra-voz';
broken.scenes.forEach((scene) => { scene.backgroundResourceId = 'fondo-a'; });
const brokenReport = analyzeDirectorContinuity(broken);
assert.equal(brokenReport.passed, false);
for (const code of ['CHARACTER_VOICE_CHANGED', 'VOICE_SHARED_BY_CHARACTERS', 'NARRATOR_VOICE_CHANGED']) {
  assert.ok(brokenReport.issues.some((issue) => issue.code === code), code);
}
assert.equal(brokenReport.hardPassed, false);

const singleBackgroundCatalog = structuredClone(coherent);
singleBackgroundCatalog.scenes.forEach((scene) => { scene.backgroundResourceId = 'fondo-unico'; });
assert.equal(analyzeDirectorContinuity(singleBackgroundCatalog, { availableBackgroundCount: 1 }).passed, true);

process.stdout.write(`${JSON.stringify({ version: 1, passed: 9, failed: 0 })}\n`);
