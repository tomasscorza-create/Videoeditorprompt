export const DIRECTION_QUALITY_VERSION = 1;

export function analyzeDirectorComposition({ plan = null, project = null, recipes = null } = {}) {
  const issues = [];
  if (plan && recipes) analyzePlan(plan, recipes, issues);
  if (project) analyzeProject(project, issues);
  return {
    version: DIRECTION_QUALITY_VERSION,
    passed: issues.length === 0,
    issues,
    metrics: {
      sceneCount: plan?.scenes?.length ?? project?.scenes?.length ?? 0,
      fullFrameTemplateScenes: plan?.scenes?.filter((scene) => (
        scene.visualElements?.some((element) => element.type === 'template')
      )).length ?? 0,
      earlyHiddenSpeakers: issues.filter((issue) => issue.code === 'SPEAKER_HIDDEN_BEFORE_SCENE_END').length,
    },
  };
}

function analyzePlan(plan, recipes, issues) {
  const recipeById = new Map((recipes.sceneRecipes ?? []).map((recipe) => [recipe.id, recipe]));
  for (const [sceneIndex, scene] of (plan.scenes ?? []).entries()) {
    const base = `/scenes/${sceneIndex}`;
    const recipe = recipeById.get(scene.sceneRecipeId);
    if (recipe) {
      const allowed = new Set([...recipe.requiredElementTypes, ...recipe.optionalElementTypes]);
      const present = new Set([
        ...(scene.participants?.length ? ['character'] : []),
        ...(scene.visualElements ?? []).map((element) => element.type),
      ]);
      for (const type of present) {
        if (!allowed.has(type)) add(issues, 'RECIPE_ELEMENT_NOT_ALLOWED', base, `La receta ${recipe.id} no admite ${type}.`);
      }
    }

    const templates = (scene.visualElements ?? []).filter((element) => element.type === 'template');
    if (templates.length > 1) add(issues, 'MULTIPLE_FULL_FRAME_TEMPLATES', `${base}/visualElements`, 'Solo se admite una plantilla de pantalla completa por escena.');
    if (!templates.length) continue;
    if ((scene.participants?.length ?? 0) > 0) add(issues, 'FULL_FRAME_TEMPLATE_WITH_PARTICIPANTS', base, 'Una plantilla de pantalla completa necesita una escena gráfica sin personajes visibles.');
    if ((scene.visualElements?.length ?? 0) > 1) add(issues, 'FULL_FRAME_TEMPLATE_WITH_OTHER_VISUALS', `${base}/visualElements`, 'La plantilla de pantalla completa debe ser el único elemento visual de la escena.');
    if (!['voiceover', 'visual-with-voiceover'].includes(scene.mode)
      || (scene.speech ?? []).some((turn) => turn.kind !== 'voiceover')) {
      add(issues, 'FULL_FRAME_TEMPLATE_REQUIRES_VOICEOVER', `${base}/speech`, 'La escena gráfica debe usar exclusivamente voz fuera de campo.');
    }
  }
}

function analyzeProject(project, issues) {
  for (const [sceneIndex, scene] of (project.scenes ?? []).entries()) {
    const speakerIds = new Set((scene.dialogue ?? []).map((turn) => turn.speakerElementId).filter(Boolean));
    for (const [elementIndex, element] of (scene.elements ?? []).entries()) {
      if (!speakerIds.has(element.id)) continue;
      const opacityTrack = (element.tracks ?? []).find((track) => track.parameterId === 'opacity');
      if (!opacityTrack?.keyframes?.length) continue;
      const finalKeyframe = opacityTrack.keyframes.at(-1);
      const closesAtSceneEnd = finalKeyframe.anchor?.kind === 'scene'
        && finalKeyframe.anchor?.edge === 'end'
        && (finalKeyframe.offsetSeconds ?? 0) <= 0;
      if (finalKeyframe.value <= 0.001 && !closesAtSceneEnd) {
        add(
          issues,
          'SPEAKER_HIDDEN_BEFORE_SCENE_END',
          `/scenes/${sceneIndex}/elements/${elementIndex}/tracks`,
          `El personaje hablante ${element.id} termina invisible antes del cierre de la escena.`,
        );
      }
    }
  }
}

function add(issues, code, path, message) {
  issues.push({ code, path, message });
}
