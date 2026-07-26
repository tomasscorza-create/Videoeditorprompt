import { isMain } from '../stage1/common.mjs';
import { createPostgresPool } from '../storage/postgres-client.mjs';
import { createPostgresProjectRepository } from '../storage/postgres-project-repository.mjs';
import { createProjectRepository } from './project-repository.mjs';

export const LEGACY_VOICE_REPLACEMENTS = new Map([
  ['voz-daniela-ar-v1', 'voz-claude-mx-v1'],
]);

export async function migrateLegacyProjectVoices(repository, options = {}) {
  const apply = options.apply === true;
  const summaries = await repository.list();
  const projects = [];
  let replacementCount = 0;

  for (const summary of summaries) {
    const stored = await repository.get(summary.id);
    const migrated = replaceLegacyVoices(stored.project);
    if (migrated.replacements.length === 0) continue;
    replacementCount += migrated.replacements.length;
    if (apply) {
      await repository.save(migrated.project, stored.revision);
    }
    projects.push({
      projectId: summary.id,
      replacements: migrated.replacements,
    });
  }

  return {
    version: 1,
    mode: apply ? 'apply' : 'dry-run',
    scannedProjects: summaries.length,
    changedProjects: projects.length,
    replacementCount,
    projects,
  };
}

export function replaceLegacyVoices(project) {
  const migrated = structuredClone(project);
  const replacements = [];
  if (!Array.isArray(migrated?.scenes)) return { project: migrated, replacements };

  for (const scene of migrated.scenes) {
    if (!Array.isArray(scene?.dialogue)) continue;
    for (const turn of scene.dialogue) {
      const replacementVoiceId = LEGACY_VOICE_REPLACEMENTS.get(turn?.voiceId);
      if (!replacementVoiceId) continue;
      replacements.push({
        sceneId: scene.id,
        turnId: turn.id,
        previousVoiceId: turn.voiceId,
        replacementVoiceId,
      });
      turn.voiceId = replacementVoiceId;
    }
  }
  return { project: migrated, replacements };
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const results = [];
  if (options.backends.includes('filesystem')) {
    results.push({
      backend: 'filesystem',
      ...(await migrateLegacyProjectVoices(createProjectRepository(), { apply: options.apply })),
    });
  }
  if (options.backends.includes('postgres')) {
    const pool = createPostgresPool();
    try {
      results.push({
        backend: 'postgres',
        ...(await migrateLegacyProjectVoices(createPostgresProjectRepository({ pool }), { apply: options.apply })),
      });
    } finally {
      await pool.end();
    }
  }
  process.stdout.write(`${JSON.stringify({ version: 1, results }, null, 2)}\n`);
}

function parseArguments(args) {
  const allowed = new Set(['--apply']);
  let backend = 'both';
  for (const argument of args) {
    if (argument.startsWith('--backend=')) {
      backend = argument.slice('--backend='.length);
      continue;
    }
    if (!allowed.has(argument)) {
      throw new Error(`Argumento no soportado: ${argument}`);
    }
  }
  if (!['filesystem', 'postgres', 'both'].includes(backend)) {
    throw new Error('El backend debe ser filesystem, postgres o both.');
  }
  return {
    apply: args.includes('--apply'),
    backends: backend === 'both' ? ['filesystem', 'postgres'] : [backend],
  };
}

if (isMain(import.meta.url)) {
  await runCli();
}
