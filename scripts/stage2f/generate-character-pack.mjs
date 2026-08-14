import path from 'node:path';
import { isMain, parseArguments, projectRoot } from '../stage1/common.mjs';
import { compileParametricResource } from './parametric-resource.mjs';
import { writeCharacterPackDefinitions } from './character-pack-definitions.mjs';

export function generateCharacterPack({ assetsRoot = path.join(projectRoot, 'public') } = {}) {
  const definitionsRoot = path.join(assetsRoot, 'assets', 'resource-definitions');
  return writeCharacterPackDefinitions(definitionsRoot).map(({ definition, file }) => ({
    definition,
    compilation: compileParametricResource({
      assetsRoot,
      definitionPath: file,
      outputBase: 'assets/resources',
      catalogRelative: 'assets/catalog/index.json',
      tags: ['personaje', 'articulado', 'rig-v3', definition.id.replace(/^def-|-[^-]+$/gu, '')],
    }),
  }));
}

if (isMain(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const results = generateCharacterPack({
    assetsRoot: path.resolve(projectRoot, String(args['assets-dir'] || 'public')),
  });
  process.stdout.write(`${JSON.stringify({
    version: 1,
    definitions: results.length,
    characters: results.flatMap((result) => result.compilation.artifacts.map((artifact) => artifact.variant.outputId)),
  }, null, 2)}\n`);
}
