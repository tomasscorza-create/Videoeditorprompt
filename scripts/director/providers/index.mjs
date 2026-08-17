import { PipelineError } from '../../stage1/errors.mjs';
import { createOllamaProvider } from './ollama.mjs';
import { createOpenAIProvider } from './openai.mjs';

// Registro de proveedores de IA (D2). Sumar un proveedor = implementar la interfaz
// DirectorProvider (generatePlan/generateCommands/inspect) y registrarlo acá.
// Contrato documentado en docs/PROVEEDORES_IA.md.
const FACTORIES = new Map([
  ['ollama', createOllamaProvider],
  ['openai', createOpenAIProvider],
]);

export const DEFAULT_PROVIDER_NAME = 'ollama';

export function listProviderNames() {
  return [...FACTORIES.keys()];
}

export function resolveDirectorProvider(name, config = {}) {
  const key = name === undefined || name === null || name === '' ? DEFAULT_PROVIDER_NAME : String(name);
  const factory = FACTORIES.get(key);
  if (!factory) {
    throw new PipelineError({
      code: 'DIRECTOR_PROVIDER_UNKNOWN',
      stage: 'directing',
      message: `El proveedor de IA «${key}» no está registrado.`,
      technicalDetail: `disponibles: ${[...FACTORIES.keys()].join(', ')}`,
      suggestedAction: 'Usá un proveedor registrado o registrá el nuevo en scripts/director/providers/index.mjs.',
    });
  }
  return factory(config);
}
