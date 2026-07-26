import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PipelineError } from '../stage1/errors.mjs';
import { projectRoot, readJson } from '../stage1/common.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';
import { DIRECTOR_PIPELINE_VERSION } from './version.mjs';

const planSchema = readJson(path.join(projectRoot, 'schema', 'ai-video-plan.schema.json'));
const validatePlanSchema = new Ajv2020({ allErrors: true, strict: true }).compile(planSchema);
const catalogSchema = readJson(path.join(projectRoot, 'schema', 'authoring-resource-catalog.schema.json'));
const validateCatalogSchema = new Ajv2020({ allErrors: true, strict: true }).compile(catalogSchema);
const catalogCache = new Map();

// A4: el vocabulario de layouts es un dato validado por schema, no código. Agregar
// una composición nueva es editar el JSON; la IA la ve en el enum en la próxima
// propuesta. Se sigue eligiendo por ID de preset (no x/y libres en la propuesta).
const LAYOUTS = loadLayoutPresets();
const LAYOUT_PRESET_IDS = Object.freeze(Object.keys(LAYOUTS));

function loadLayoutPresets() {
  const layoutSchema = readJson(path.join(projectRoot, 'schema', 'layout-presets.schema.json'));
  const validateLayoutSchema = new Ajv2020({ allErrors: true, strict: true }).compile(layoutSchema);
  const document = readJson(path.join(projectRoot, 'public', 'assets', 'catalog', 'layout-presets.json'));
  if (!validateLayoutSchema(document)) {
    const detail = (validateLayoutSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    directorError('DIRECTOR_LAYOUT_CATALOG_INVALID', 'El catálogo de layouts no tiene un formato válido.', detail);
  }
  const map = {};
  for (const preset of document.presets) map[preset.id] = preset.slots;
  return Object.freeze(map);
}

export function listLayoutPresetIds() {
  return [...LAYOUT_PRESET_IDS];
}

export function getLayoutPreset(id) {
  return LAYOUTS[id] ? structuredClone(LAYOUTS[id]) : null;
}

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
  if (plan.musicResourceId) {
    requireResource(resources, plan.musicResourceId, 'music', '/musicResourceId');
  }
  const castEntries = Object.entries(plan.cast);
  const characterIds = new Set();
  const voiceIds = new Set();
  for (const [slot, member] of castEntries) {
    const character = requireResource(resources, member.characterResourceId, 'character', `/cast/${slot}/characterResourceId`);
    requireResource(resources, member.voiceId, 'voice', `/cast/${slot}/voiceId`);
    if (!character.capabilities.poses.includes(member.poseId)) {
      directorError('DIRECTOR_RESOURCE_UNSUPPORTED', 'El personaje no soporta la pose inicial seleccionada.', `/cast/${slot}/poseId`);
    }
    if (!character.capabilities.animationPresets.includes(member.animationPreset)) {
      directorError('DIRECTOR_RESOURCE_UNSUPPORTED', 'El personaje no soporta la animación seleccionada.', `/cast/${slot}/animationPreset`);
    }
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
    if (!Object.hasOwn(LAYOUTS, scene.layoutPreset)) {
      directorError('DIRECTOR_RESOURCE_UNSUPPORTED', 'El layout elegido no existe en el catálogo de composiciones.', `/scenes/${sceneIndex}/layoutPreset`);
    }
    const isLastScene = sceneIndex === plan.scenes.length - 1;
    if (!isLastScene && scene.transitionPreset === 'fade') {
      if (scene.transitionDurationSeconds < 0.15 || scene.transitionDurationSeconds > 1) {
        directorError('DIRECTOR_TRANSITION_INVALID', 'La duración del fundido debe estar entre 0.15 y 1.0 segundos.', `/scenes/${sceneIndex}/transitionDurationSeconds`);
      }
    }
    const speakers = new Set();
    for (const [turnIndex, turn] of scene.dialogue.entries()) {
      speakers.add(turn.speaker);
      const member = plan.cast[turn.speaker];
      const character = resources.get(member.characterResourceId);
      if (!character.capabilities.poses.includes(turn.gestureId)) {
        directorError('DIRECTOR_RESOURCE_UNSUPPORTED', 'El personaje no soporta el gesto seleccionado.', `/scenes/${sceneIndex}/dialogue/${turnIndex}/gestureId`);
      }
      const words = wordCount(turn.text);
      if (turn.gestureAtWord !== undefined && turn.gestureAtWord >= words) {
        directorError('DIRECTOR_GESTURE_TIMING_INVALID', 'El índice del gesto excede las palabras del turno.', `/scenes/${sceneIndex}/dialogue/${turnIndex}/gestureAtWord`);
      }
      if (turn.layoutPreset !== undefined && !Object.hasOwn(LAYOUTS, turn.layoutPreset)) {
        directorError('DIRECTOR_RESOURCE_UNSUPPORTED', 'El layout del turno no existe.', `/scenes/${sceneIndex}/dialogue/${turnIndex}/layoutPreset`);
      }
      totalWords += words;
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
  const budget = validateDirectorPlan(plan, catalog);
  const semanticHash = hashJson({
    plan,
    promptHash: options.promptHash || null,
    normalizerVersion: DIRECTOR_PIPELINE_VERSION,
  });
  const projectId = safeId(options.projectId || `${slug(plan.title)}-${semanticHash.slice(0, 8)}`);
  const seed = Number.parseInt(semanticHash.slice(0, 8), 16);
  const project = {
    version: 1,
    id: projectId,
    title: plan.title,
    video: { width: 1080, height: 1920, fps: 30 },
    seed,
    resourceCatalog: options.resourceCatalog || 'assets/catalog/authoring-resources.json',
    ...(plan.musicResourceId ? { musicResourceId: plan.musicResourceId } : {}),
    scenes: plan.scenes.map((scene, sceneIndex) => normalizeScene(plan, scene, sceneIndex)),
  };
  validateVideoProjectDocument({
    project,
    catalog,
    assetsRoot: options.assetsRoot || path.join(projectRoot, 'public'),
  });
  return { project, semanticHash, budget };
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
      poseId: plan.cast[slot].poseId,
      animationPreset: plan.cast[slot].animationPreset,
    };
  });
  const normalized = {
    id: safeId(`escena-${String(sceneNumber).padStart(2, '0')}`),
    title: scene.title,
    background: {
      resourceId: scene.backgroundResourceId,
      // A5: `static` es una elección legítima de la IA (el compilador la soporta),
      // ya no se coerciona a slow-pan.
      cameraPreset: scene.cameraPreset,
    },
    elements,
    dialogue: scene.dialogue.map((turn, turnIndex) => ({
      id: safeId(`turno-${String(sceneNumber).padStart(2, '0')}-${String(turnIndex + 1).padStart(2, '0')}`),
      speakerElementId: `personaje-${turn.speaker}`,
      text: turn.text.trim(),
      voiceId: plan.cast[turn.speaker].voiceId,
      gestureId: turn.gestureId,
      ...(turn.gestureAtWord !== undefined ? { gestureAtWord: turn.gestureAtWord } : {}),
      ...(turn.pace !== undefined ? { pace: turn.pace } : {}),
      ...(turn.layoutPreset !== undefined ? { layoutPreset: turn.layoutPreset } : {}),
      gapAfterSeconds: turnIndex === scene.dialogue.length - 1 ? 0 : turn.gapAfterSeconds,
    })),
  };
  if (sceneIndex < plan.scenes.length - 1) {
    normalized.transitionToNext = {
      preset: scene.transitionPreset,
      durationSeconds: scene.transitionPreset === 'fade' ? scene.transitionDurationSeconds : 0,
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
  const stats = statSync(catalogPath);
  const cacheKey = `${catalogPath}:${stats.mtimeMs}:${stats.size}`;
  if (catalogCache.has(cacheKey)) return catalogCache.get(cacheKey);
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  if (!validateCatalogSchema(catalog)) {
    const detail = (validateCatalogSchema.errors || []).slice(0, 12)
      .map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    directorError('DIRECTOR_CATALOG_SCHEMA_INVALID', 'El catálogo de autoría no tiene un formato válido.', detail);
  }
  catalogCache.clear();
  catalogCache.set(cacheKey, catalog);
  return catalog;
}
