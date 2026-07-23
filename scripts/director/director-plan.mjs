import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PipelineError } from '../stage1/errors.mjs';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';

const planSchema = readJson(path.join(projectRoot, 'schema', 'ai-video-plan.schema.json'));
const validatePlanSchema = new Ajv2020({ allErrors: true, strict: true }).compile(planSchema);

const LAYOUTS = Object.freeze({
  balanced: Object.freeze({
    a: Object.freeze({ x: 300, y: 1100, scale: 0.7, zIndex: 20 }),
    b: Object.freeze({ x: 780, y: 1100, scale: 0.7, zIndex: 21 }),
  }),
  'focus-a': Object.freeze({
    a: Object.freeze({ x: 350, y: 1080, scale: 0.78, zIndex: 20 }),
    b: Object.freeze({ x: 800, y: 1130, scale: 0.62, zIndex: 21 }),
  }),
  'focus-b': Object.freeze({
    a: Object.freeze({ x: 280, y: 1130, scale: 0.62, zIndex: 20 }),
    b: Object.freeze({ x: 730, y: 1080, scale: 0.78, zIndex: 21 }),
  }),
});

export function getDirectorPlanSchema() {
  return structuredClone(planSchema);
}

export function validateDirectorPlan(plan, catalog) {
  if (!validatePlanSchema(plan)) {
    const detail = (validatePlanSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    directorError('DIRECTOR_PLAN_SCHEMA_INVALID', 'El Director IA produjo un plan con formato inválido.', detail);
  }

  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const castEntries = Object.entries(plan.cast);
  const characterIds = new Set();
  const voiceIds = new Set();
  for (const [slot, member] of castEntries) {
    requireResource(resources, member.characterResourceId, 'character', `/cast/${slot}/characterResourceId`);
    requireResource(resources, member.voiceId, 'voice', `/cast/${slot}/voiceId`);
    characterIds.add(member.characterResourceId);
    voiceIds.add(member.voiceId);
  }
  if (characterIds.size !== 2) directorError('DIRECTOR_CAST_INVALID', 'Los dos roles deben usar personajes diferentes.', '/cast');
  if (voiceIds.size !== 2) directorError('DIRECTOR_CAST_INVALID', 'Los dos roles deben usar voces diferentes.', '/cast');

  let totalWords = 0;
  for (const [sceneIndex, scene] of plan.scenes.entries()) {
    const background = requireResource(resources, scene.backgroundResourceId, 'background', `/scenes/${sceneIndex}/backgroundResourceId`);
    if (!background.capabilities.cameraPresets.includes(scene.cameraPreset)) {
      directorError('DIRECTOR_RESOURCE_UNSUPPORTED', 'El fondo no soporta la cámara seleccionada.', `/scenes/${sceneIndex}/cameraPreset`);
    }
    const speakers = new Set();
    for (const [turnIndex, turn] of scene.dialogue.entries()) {
      speakers.add(turn.speaker);
      const member = plan.cast[turn.speaker];
      const character = resources.get(member.characterResourceId);
      if (!character.capabilities.poses.includes(turn.gestureId)) {
        directorError('DIRECTOR_RESOURCE_UNSUPPORTED', 'El personaje no soporta el gesto seleccionado.', `/scenes/${sceneIndex}/dialogue/${turnIndex}/gestureId`);
      }
      totalWords += wordCount(turn.text);
    }
    if (speakers.size !== 2) {
      directorError('DIRECTOR_SCENE_DIALOGUE_INVALID', 'Cada escena debe incluir al menos un turno de cada personaje.', `/scenes/${sceneIndex}/dialogue`);
    }
  }
  const maximumWords = Math.max(40, Math.ceil(plan.targetDurationSeconds * 3.2));
  if (totalWords > maximumWords) {
    directorError(
      'DIRECTOR_DURATION_BUDGET_EXCEEDED',
      'El guion excede el presupuesto aproximado de palabras.',
      `words=${totalWords}; maximum=${maximumWords}; targetSeconds=${plan.targetDurationSeconds}`,
    );
  }
  return { totalWords, maximumWords };
}

export function normalizeDirectorPlan(plan, catalog, options = {}) {
  validateDirectorPlan(plan, catalog);
  const semanticHash = hashJson({
    plan,
    promptHash: options.promptHash || null,
    normalizerVersion: 2,
  });
  const projectId = safeId(options.projectId || `${slug(plan.title)}-${semanticHash.slice(0, 8)}`);
  const seed = Number.parseInt(semanticHash.slice(0, 8), 16);
  const project = {
    version: 1,
    id: projectId,
    title: plan.title,
    video: { width: 1080, height: 1920, fps: 30 },
    seed,
    resourceCatalog: 'assets/catalog/authoring-resources.json',
    scenes: plan.scenes.map((scene, sceneIndex) => normalizeScene(plan, scene, sceneIndex)),
  };
  validateVideoProjectDocument({
    project,
    catalog,
    assetsRoot: options.assetsRoot || path.join(projectRoot, 'public'),
  });
  return { project, semanticHash };
}

function normalizeScene(plan, scene, sceneIndex) {
  const layout = LAYOUTS[scene.layoutPreset];
  const sceneNumber = sceneIndex + 1;
  const elements = ['a', 'b'].map((slot) => {
    const transform = layout[slot];
    return {
      id: `personaje-${slot}`,
      type: 'character',
      resourceId: plan.cast[slot].characterResourceId,
      transform: {
        x: transform.x,
        y: transform.y,
        anchorX: 0.5,
        anchorY: 0.5,
        scale: transform.scale,
        rotationDegrees: 0,
        opacity: 1,
        zIndex: transform.zIndex,
      },
      poseId: 'neutral',
      animationPreset: 'talk-calm',
    };
  });
  const normalized = {
    id: safeId(`escena-${String(sceneNumber).padStart(2, '0')}`),
    title: scene.title,
    background: {
      resourceId: scene.backgroundResourceId,
      cameraPreset: scene.cameraPreset === 'static' ? 'slow-pan' : scene.cameraPreset,
    },
    elements,
    dialogue: scene.dialogue.map((turn, turnIndex) => ({
      id: safeId(`turno-${String(sceneNumber).padStart(2, '0')}-${String(turnIndex + 1).padStart(2, '0')}`),
      speakerElementId: `personaje-${turn.speaker}`,
      text: turn.text.trim(),
      voiceId: plan.cast[turn.speaker].voiceId,
      gestureId: turn.gestureId,
      gapAfterSeconds: turnIndex === scene.dialogue.length - 1 ? 0 : turn.gapAfterSeconds,
    })),
  };
  if (sceneIndex < plan.scenes.length - 1) {
    normalized.transitionToNext = {
      preset: scene.transitionPreset,
      durationSeconds: scene.transitionPreset === 'fade' ? 0.35 : 0,
    };
  }
  return normalized;
}

function requireResource(resources, id, type, jsonPath) {
  const resource = resources.get(id);
  if (!resource || resource.type !== type) {
    directorError('DIRECTOR_RESOURCE_INVALID', `El recurso debe existir y ser de tipo ${type}.`, jsonPath);
  }
  return resource;
}

function wordCount(text) {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

function slug(value) {
  const normalized = value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 48) || 'video-generado';
}

function safeId(value) {
  const result = value.slice(0, 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(result)) {
    directorError('DIRECTOR_ID_INVALID', 'No se pudo producir un ID portable.', value);
  }
  return result;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function directorError(code, message, technicalDetail) {
  throw new PipelineError({
    code,
    stage: 'directing',
    message,
    technicalDetail,
    suggestedAction: 'Regenerá la propuesta o corregí las selecciones usando el catálogo disponible.',
  });
}

export function loadAuthoringCatalog(assetsRoot = path.join(projectRoot, 'public')) {
  const catalogPath = path.join(assetsRoot, 'assets', 'catalog', 'authoring-resources.json');
  return JSON.parse(readFileSync(catalogPath, 'utf8'));
}
