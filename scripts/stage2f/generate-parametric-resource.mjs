import path from 'node:path';
import { isMain, parseArguments, projectRoot, resolvePath } from '../stage1/common.mjs';
import { compileParametricResource } from './parametric-resource.mjs';

if (isMain(import.meta.url)) {
  const args = parseArguments();
  const assetsRoot = resolvePath(args['assets-dir'] || 'public');
  const definitionPath = path.resolve(assetsRoot, args.definition || 'assets/resource-definitions/mono-articulado-v1.json');
  const compiled = compileParametricResource({
    assetsRoot,
    definitionPath,
    outputBase: args['output-base'] || 'assets/resources',
    catalogRelative: args.catalog || 'assets/catalog/index.json',
  });
  process.stdout.write(`${JSON.stringify({
    version: 1,
    component: 'parametric-resource',
    kind: compiled.definition.kind,
    definition: compiled.sourceDefinition,
    variants: compiled.artifacts.map(({ variant, manifest, hashes }) => ({
      id: variant.outputId,
      parts: manifest.parts.length,
      parameters: manifest.parameters.map((parameter) => parameter.id),
      files: Object.keys(hashes).length,
    })),
    catalog: path.relative(projectRoot, compiled.catalogPath).split(path.sep).join('/'),
  }, null, 2)}\n`);
}
