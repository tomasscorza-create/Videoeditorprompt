import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../stage1/common.mjs';
import { compileParametricCharacter } from './parametric-character.mjs';

const args = parseArguments(process.argv.slice(2));
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assetsRoot = path.resolve(repositoryRoot, String(args['assets-dir'] || 'public'));
const definitionPath = path.resolve(assetsRoot, String(args.definition || 'assets/character-definitions/mono-parametrico-v1.json'));
const result = compileParametricCharacter({
  assetsRoot,
  definitionPath,
  outputBase: String(args['output-base'] || 'assets/characters'),
  catalogRelative: String(args.catalog || 'assets/catalog/index.json'),
});

process.stdout.write(`${JSON.stringify({
  definition: result.sourceDefinition,
  variants: result.artifacts.map((artifact) => ({ id: artifact.variant.outputId, files: Object.keys(artifact.hashes).length })),
  catalog: path.relative(repositoryRoot, result.catalogPath),
})}\n`);
