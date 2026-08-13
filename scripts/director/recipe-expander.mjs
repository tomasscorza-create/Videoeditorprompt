import { expandEffectSequenceCommands as expandSharedEffectSequenceCommands } from '../../shared/animation-sequences.js';
import { loadCreativeRecipeCatalog } from './creative-contract.mjs';

export function expandEffectSequenceCommands(request, project, catalog, options = {}) {
  const recipes = options.recipeCatalog ?? loadCreativeRecipeCatalog();
  return expandSharedEffectSequenceCommands(request, project, catalog, recipes);
}
