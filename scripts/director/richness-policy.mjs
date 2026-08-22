export const RICHNESS_POLICY_VERSION = 2;

export function resolveRichnessPolicy(profile = 'automatic', context = {}) {
  const resolved = profile === 'automatic' ? automaticProfile(context) : profile;
  return {
    version: RICHNESS_POLICY_VERSION,
    requested: profile,
    resolved,
    rationale: profile !== 'automatic' ? 'El usuario eligió el perfil.' : automaticRationale(context, resolved),
    minimumModes: 1,
    minimumVisualFamilies: resolved === 'simple' ? 0 : resolved === 'varied' ? 1 : 1,
    minimumAnimatedScenes: resolved === 'dynamic' ? Math.max(1, Math.ceil((context.sceneCount ?? 1) / 2)) : 0,
    maximumVisualElementsPerScene: resolved === 'simple' ? 1 : resolved === 'varied' ? 3 : 4,
  };
}

export function analyzeCreativeRichness(plan, context = {}) {
  const policy = resolveRichnessPolicy(plan.richnessProfile ?? context.richnessProfile ?? 'automatic', {
    ...context, sceneCount: plan.scenes.length,
  });
  const modes = new Set(plan.scenes.map((scene) => scene.mode ?? 'dialogue'));
  const visualFamilies = new Set(plan.scenes.flatMap((scene) => (scene.visualElements ?? []).map((entry) => entry.type)));
  const recipes = new Set(plan.scenes.map((scene) => scene.sceneRecipeId).filter(Boolean));
  const layouts = new Set(plan.scenes.map((scene) => scene.layoutPreset).filter(Boolean));
  const resources = plan.scenes.flatMap((scene) => (scene.visualElements ?? []).map((entry) => entry.resourceId));
  const animatedScenes = plan.scenes.filter((scene) => (scene.effectSequenceIds ?? []).length > 0).length;
  const effectCount = plan.scenes.reduce((sum, scene) => sum + (scene.effectSequenceIds ?? []).length, 0);
  const durationWeights = plan.scenes.map((scene) => scene.durationWeight ?? 1);
  const repeatedModeRatio = plan.scenes.length ? Math.max(...[...modes].map((mode) => plan.scenes.filter((scene) => (scene.mode ?? 'dialogue') === mode).length)) / plan.scenes.length : 1;
  const issues = [];
  if (visualFamilies.size < policy.minimumVisualFamilies) issues.push('Falta una familia visual útil, como prop o plantilla.');
  if (animatedScenes < policy.minimumAnimatedScenes) issues.push('Faltan secuencias coordinadas en escenas dinámicas.');
  if (plan.scenes.some((scene) => (scene.visualElements ?? []).length > policy.maximumVisualElementsPerScene)) issues.push('Una escena supera la densidad visual del perfil.');
  if (policy.resolved !== 'simple' && plan.scenes.length > 2 && layouts.size < 2) issues.push('Todas las escenas repiten la misma composición.');
  if (policy.resolved !== 'simple' && resources.length > 1 && new Set(resources).size === 1) issues.push('Todos los apoyos visuales repiten el mismo recurso.');
  if (effectCount > plan.scenes.length * 3) issues.push('La densidad de movimiento puede competir con el contenido.');
  if (Math.max(...durationWeights) / Math.min(...durationWeights) > 6) issues.push('La distribución editorial entre escenas está demasiado desequilibrada.');
  return {
    version: RICHNESS_POLICY_VERSION, passed: issues.length === 0, policy, issues,
    metrics: { modes: [...modes], visualFamilies: [...visualFamilies], recipeCount: recipes.size, layoutCount: layouts.size, uniqueVisualResources: new Set(resources).size, animatedScenes, effectCount, repeatedModeRatio: Number(repeatedModeRatio.toFixed(3)), durationWeightRatio: Number((Math.max(...durationWeights) / Math.min(...durationWeights)).toFixed(3)) },
  };
}

function automaticProfile(context) {
  const text = String(context.prompt ?? '').toLowerCase();
  if (/(simple|sobrio|mínimo|directo)/u.test(text)) return 'simple';
  if (/(dinámico|rápido|energía|impacto)/u.test(text)) return 'dynamic';
  return (context.sceneCount ?? 1) >= 2 ? 'varied' : 'simple';
}

function automaticRationale(context, resolved) {
  const text = String(context.prompt ?? '').toLowerCase();
  if (resolved === 'simple') return /(simple|sobrio|mínimo|directo)/u.test(text) ? 'El pedido prioriza simplicidad.' : 'Una sola escena no necesita variedad forzada.';
  if (resolved === 'dynamic') return 'El pedido contiene una intención de ritmo o impacto.';
  return 'Varias escenas se benefician de diversidad estructural moderada.';
}
