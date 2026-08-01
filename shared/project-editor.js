import { ANIMATION_LIMITS, ANIMATION_PARAMETERS, anchorKey } from './animation-contract.js';
import { ANIMATION_PRESETS, expandAnimationPreset } from './animation-presets.js';

/** Valor vigente de un parámetro en el elemento, para expandir un preset. */
function baseValueFor(element, parameterId) {
  const transform = element.transform ?? {};
  if (parameterId === 'position.x') return transform.x ?? 0;
  if (parameterId === 'position.y') return transform.y ?? 0;
  if (parameterId === 'scale') return transform.scale ?? 1;
  if (parameterId === 'rotationDegrees') return transform.rotationDegrees ?? 0;
  if (parameterId === 'opacity') return transform.opacity ?? 1;
  // `armRaise` no vive en el transform: su base es el reposo del recurso.
  return 0;
}

const HISTORY_LIMIT_DEFAULT = 50;
const PORTABLE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u;
const PACE_IDS = new Set(['slow', 'normal', 'fast']);
const LAYOUT_PRESET_IDS = new Set(['balanced', 'focus-a', 'focus-b', 'close-up-a', 'close-up-b', 'wide', 'stacked']);

export class ProjectEditorError extends Error {
  constructor(code, message, path = '/') {
    super(message);
    this.name = 'ProjectEditorError';
    this.code = code;
    this.path = path;
  }
}

export function createProjectEditor(project, catalog, options = {}) {
  const historyLimit = options.historyLimit ?? HISTORY_LIMIT_DEFAULT;
  integerInRange(historyLimit, 1, 200, '/historyLimit');
  const projectCopy = cloneJson(project);
  const catalogCopy = cloneJson(catalog);
  validateEditableProject(projectCopy, catalogCopy);
  return freezeState({
    version: 1,
    project: projectCopy,
    catalog: catalogCopy,
    selectedSceneId: projectCopy.scenes[0].id,
    revision: 0,
    historyLimit,
    past: [],
    future: [],
  });
}

export function repairMissingVoiceReferences(project, catalog, options = {}) {
  const projectCopy = cloneJson(project);
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const resources = new Map(entries.map((entry) => [entry?.id, entry]));
  const voices = entries.filter((entry) => entry?.type === 'voice' && typeof entry.id === 'string');
  const preferredVoiceId = options.preferredVoiceId ?? 'voz-claude-mx-v1';
  const fallback = voices.find((entry) => entry.id === preferredVoiceId) ?? voices[0];
  const replacements = [];

  if (!fallback || !Array.isArray(projectCopy?.scenes)) {
    return { project: projectCopy, replacements };
  }

  for (const scene of projectCopy.scenes) {
    if (!Array.isArray(scene?.dialogue)) continue;
    for (const turn of scene.dialogue) {
      if (!turn || typeof turn.voiceId !== 'string' || resources.has(turn.voiceId)) continue;
      replacements.push({
        sceneId: scene.id,
        turnId: turn.id,
        previousVoiceId: turn.voiceId,
        replacementVoiceId: fallback.id,
      });
      turn.voiceId = fallback.id;
    }
  }

  return { project: projectCopy, replacements };
}

export function applyProjectEditorCommand(state, command) {
  assertEditorState(state);
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail('EDITOR_COMMAND_INVALID', 'El comando debe ser un objeto.', '/command');
  assertCommandShape(command);
  if (command.type === 'select-scene') {
    const scene = requireScene(state.project, command.sceneId);
    return freezeState({ ...state, selectedSceneId: scene.id });
  }

  const project = cloneJson(state.project);
  applyMutation(project, state.catalog, command);
  validateEditableProject(project, state.catalog);
  const past = [...state.past, state.project].slice(-state.historyLimit);
  return freezeState({
    ...state,
    project,
    selectedSceneId: project.scenes.some((scene) => scene.id === state.selectedSceneId) ? state.selectedSceneId : project.scenes[0].id,
    revision: state.revision + 1,
    past,
    future: [],
  });
}

/**
 * Aplica un lote como una sola transacción de autoría y un solo paso de
 * historial. Cada comando conserva exactamente la misma validación del camino
 * individual; si cualquiera falla, el estado original permanece intacto.
 */
export function applyProjectEditorCommandBatch(state, commands) {
  assertEditorState(state);
  if (!Array.isArray(commands)) fail('EDITOR_COMMAND_INVALID', 'El lote de comandos debe ser un array.', '/commands');
  if (commands.length === 0) return state;
  let next = state;
  for (const command of commands) next = applyProjectEditorCommand(next, command);
  if (next.project === state.project) return next;
  return freezeState({
    ...next,
    revision: state.revision + 1,
    past: [...state.past, state.project].slice(-state.historyLimit),
    future: [],
  });
}

export function undoProjectEditor(state) {
  assertEditorState(state);
  if (state.past.length === 0) return state;
  const project = state.past.at(-1);
  return freezeState({
    ...state,
    project,
    selectedSceneId: project.scenes.some((scene) => scene.id === state.selectedSceneId) ? state.selectedSceneId : project.scenes[0].id,
    revision: state.revision + 1,
    past: state.past.slice(0, -1),
    future: [state.project, ...state.future].slice(0, state.historyLimit),
  });
}

export function redoProjectEditor(state) {
  assertEditorState(state);
  if (state.future.length === 0) return state;
  const [project, ...future] = state.future;
  return freezeState({
    ...state,
    project,
    selectedSceneId: project.scenes.some((scene) => scene.id === state.selectedSceneId) ? state.selectedSceneId : project.scenes[0].id,
    revision: state.revision + 1,
    past: [...state.past, state.project].slice(-state.historyLimit),
    future,
  });
}

export function listEditorResources(state, type) {
  assertEditorState(state);
  if (!['character', 'prop', 'template', 'voice', 'background', 'image'].includes(type)) fail('EDITOR_RESOURCE_TYPE_INVALID', `Tipo de recurso no soportado: ${type}.`, '/type');
  return state.catalog.entries.filter((entry) => entry.type === type);
}

export function exportEditorProject(state) {
  assertEditorState(state);
  validateEditableProject(state.project, state.catalog);
  return `${JSON.stringify(state.project, null, 2)}\n`;
}

export function validateEditableProject(project, catalog) {
  if (!project || project.version !== 1 || !Array.isArray(project.scenes) || project.scenes.length < 1 || project.scenes.length > 8) {
    fail('EDITOR_PROJECT_INVALID', 'El proyecto editable no tiene una estructura v1 compatible.', '/');
  }
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.entries)) fail('EDITOR_CATALOG_INVALID', 'El catálogo de autoría no tiene una estructura v1 compatible.', '/resourceCatalog');
  stringInRange(project.title, 1, 120, '/title');
  const resources = new Map();
  for (const [index, entry] of catalog.entries.entries()) {
    if (!entry || typeof entry.id !== 'string' || resources.has(entry.id)) fail('EDITOR_CATALOG_INVALID', 'Los IDs del catálogo deben existir y ser únicos.', `/entries/${index}/id`);
    resources.set(entry.id, entry);
  }
  const sceneIds = new Set();
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const scenePath = `/scenes/${sceneIndex}`;
    if (!scene || sceneIds.has(scene.id)) fail('EDITOR_PROJECT_INVALID', 'Los IDs de escena deben existir y ser únicos.', `${scenePath}/id`);
    sceneIds.add(scene.id);
    stringInRange(scene.title, 1, 120, `${scenePath}/title`);
    const isLast = sceneIndex === project.scenes.length - 1;
    if (!isLast && !scene.transitionToNext) fail('EDITOR_TRANSITION_INVALID', 'Toda escena salvo la última necesita transición.', `${scenePath}/transitionToNext`);
    if (isLast && scene.transitionToNext) fail('EDITOR_TRANSITION_INVALID', 'La última escena no puede tener transición de salida.', `${scenePath}/transitionToNext`);
    if (scene.transitionToNext) validateTransition(scene.transitionToNext, `${scenePath}/transitionToNext`);
    const background = requireResource(resources, scene.background?.resourceId, 'background', `${scenePath}/background/resourceId`);
    if (!background.capabilities.cameraPresets.includes(scene.background.cameraPreset)) fail('EDITOR_CAMERA_PRESET_INVALID', 'El fondo no soporta el preset de cámara seleccionado.', `${scenePath}/background/cameraPreset`);
    if (!Array.isArray(scene.elements)) fail('EDITOR_PROJECT_INVALID', 'La escena debe contener elementos.', `${scenePath}/elements`);
    const elements = new Map();
    for (const [elementIndex, element] of scene.elements.entries()) {
      const elementPath = `${scenePath}/elements/${elementIndex}`;
      if (!element || elements.has(element.id)) fail('EDITOR_PROJECT_INVALID', 'Los IDs de elemento deben existir y ser únicos en la escena.', `${elementPath}/id`);
      elements.set(element.id, element);
      if (element.type === 'character') {
        const resource = requireResource(resources, element.resourceId, 'character', `${elementPath}/resourceId`);
        if (!resource.capabilities.poses.includes(element.poseId)) fail('EDITOR_POSE_INVALID', 'El personaje no soporta la pose seleccionada.', `${elementPath}/poseId`);
        if (!resource.capabilities.animationPresets.includes(element.animationPreset)) fail('EDITOR_ANIMATION_INVALID', 'El personaje no soporta la animación seleccionada.', `${elementPath}/animationPreset`);
        validateEditableTransform(element.transform, `${elementPath}/transform`);
        validateEditableTracks(element, resource, `${elementPath}/tracks`);
      } else if (element.type === 'prop') {
        const resource = requireResource(resources, element.resourceId, 'prop', `${elementPath}/resourceId`);
        validateEditableTransform(element.transform, `${elementPath}/transform`);
        validateEditableTracks(element, resource, `${elementPath}/tracks`);
      } else if (element.type === 'template') {
        const resource = requireResource(resources, element.templateId, 'template', `${elementPath}/templateId`);
        validateTemplateValues(element.values, resource, `${elementPath}/values`);
        validateEditableTransform(element.transform, `${elementPath}/transform`);
        // La plantilla resuelve su propio ciclo interno; no admite pistas de keyframes.
        if (element.tracks) fail('EDITOR_ELEMENT_UNSUPPORTED', 'Una plantilla no admite pistas de animación: resuelve su propio ciclo.', `${elementPath}/tracks`);
      } else {
        fail('EDITOR_ELEMENT_UNSUPPORTED', 'El editor vigente admite personajes, props y plantillas; texto e imágenes siguen fuera del render.', `${elementPath}/type`);
      }
    }
    if (scene.elements.length > 20) fail('EDITOR_PROJECT_INVALID', 'Una escena admite hasta 20 elementos.', `${scenePath}/elements`);
    if (!Array.isArray(scene.dialogue) || scene.dialogue.length > 20) fail('EDITOR_PROJECT_INVALID', 'Una escena admite hasta 20 turnos.', `${scenePath}/dialogue`);
    const turnIds = new Set();
    for (const [turnIndex, turn] of (scene.dialogue || []).entries()) {
      const turnPath = `${scenePath}/dialogue/${turnIndex}`;
      if (turnIds.has(turn.id)) fail('EDITOR_PROJECT_INVALID', 'Los IDs de turno deben ser únicos.', `${turnPath}/id`);
      turnIds.add(turn.id);
      const speaker = elements.get(turn.speakerElementId);
      if (!speaker || speaker.type !== 'character') fail('EDITOR_SPEAKER_INVALID', 'El hablante debe ser un personaje de la escena.', `${turnPath}/speakerElementId`);
      const speakerResource = resources.get(speaker.resourceId);
      if (!speakerResource.capabilities.poses.includes(turn.gestureId)) fail('EDITOR_GESTURE_INVALID', 'El personaje no soporta el gesto seleccionado.', `${turnPath}/gestureId`);
      requireResource(resources, turn.voiceId, 'voice', `${turnPath}/voiceId`);
      stringInRange(turn.text, 1, 500, `${turnPath}/text`);
      numberInRange(turn.gapAfterSeconds, 0, 5, `${turnPath}/gapAfterSeconds`);
      if (turn.pace !== undefined && !PACE_IDS.has(turn.pace)) fail('EDITOR_PACE_INVALID', 'El ritmo del turno no es compatible.', `${turnPath}/pace`);
      if (turn.layoutPreset !== undefined && !LAYOUT_PRESET_IDS.has(turn.layoutPreset)) fail('EDITOR_LAYOUT_INVALID', 'El layout del turno no existe.', `${turnPath}/layoutPreset`);
      if (turn.gestureAtWord !== undefined) {
        integerInRange(turn.gestureAtWord, 0, 99, `${turnPath}/gestureAtWord`);
        const wordCount = turn.text.trim().split(/\s+/u).filter(Boolean).length;
        if (turn.gestureAtWord >= wordCount) fail('EDITOR_GESTURE_TIMING_INVALID', 'El gesto debe apuntar a una palabra existente.', `${turnPath}/gestureAtWord`);
      }
    }
  }
  return true;
}

export function validateRenderableProject(project, catalog) {
  validateEditableProject(project, catalog);
  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const characters = scene.elements.filter((element) => element.type === 'character');
    if (characters.length !== 2) {
      fail('EDITOR_SCENE_NOT_RENDERABLE', 'Para renderizar, cada escena necesita exactamente dos personajes.', `/scenes/${sceneIndex}/elements`);
    }
    if (scene.dialogue.length < 2) {
      fail('EDITOR_SCENE_NOT_RENDERABLE', 'Para renderizar, cada escena necesita al menos dos turnos de diálogo.', `/scenes/${sceneIndex}/dialogue`);
    }
    for (const [elementIndex, element] of characters.entries()) {
      const transform = element.transform;
      // Visor y exportación posicionan estos recursos desde el centro. El ancla
      // de autoría se conserva como dato portable, pero no bloquea un render que
      // ya la normaliza de la misma forma en ambos consumidores.
      if (transform.opacity !== 1) {
        fail('EDITOR_SCENE_NOT_RENDERABLE', 'Este personaje tiene opacidad base incompatible. Ajustá Opacidad desde Edición para convertirla en una pista renderizable.', `/scenes/${sceneIndex}/elements/${elementIndex}/transform/opacity`);
      }
    }
  }
  return true;
}

function applyMutation(project, catalog, command) {
  const resources = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  switch (command.type) {
    case 'set-project-title':
      stringInRange(command.title, 1, 120, '/command/title');
      project.title = command.title;
      return;
    case 'set-scene-title': {
      stringInRange(command.title, 1, 120, '/command/title');
      requireScene(project, command.sceneId).title = command.title;
      return;
    }
    case 'add-scene': {
      if (project.scenes.length >= 8) fail('EDITOR_PROJECT_INVALID', 'El proyecto admite hasta ocho escenas.', '/command');
      assertObjectKeys(command.scene, ['id', 'title', 'background', 'elements', 'dialogue'], '/command/scene');
      assertObjectKeys(command.scene.background, ['resourceId', 'cameraPreset'], '/command/scene/background');
      portableId(command.scene.id, '/command/scene/id');
      if (!Array.isArray(command.scene.elements) || command.scene.elements.length !== 0 || !Array.isArray(command.scene.dialogue) || command.scene.dialogue.length !== 0) {
        fail('EDITOR_COMMAND_INVALID', 'Una escena nueva debe comenzar sin elementos ni diálogos.', '/command/scene');
      }
      if (project.scenes.some((scene) => scene.id === command.scene.id)) fail('EDITOR_PROJECT_INVALID', 'El ID de la escena ya existe.', '/command/scene/id');
      const scene = cloneJson(command.scene);
      const previousLast = project.scenes.at(-1);
      if (previousLast) previousLast.transitionToNext = { preset: 'cut', durationSeconds: 0 };
      delete scene.transitionToNext;
      project.scenes.push(scene);
      return;
    }
    case 'duplicate-scene': {
      if (project.scenes.length >= 8) fail('EDITOR_PROJECT_INVALID', 'El proyecto admite hasta ocho escenas.', '/command');
      portableId(command.newSceneId, '/command/newSceneId');
      const sourceIndex = project.scenes.findIndex((scene) => scene.id === command.sceneId);
      if (sourceIndex < 0) fail('EDITOR_SCENE_NOT_FOUND', `No existe la escena ${command.sceneId}.`, '/command/sceneId');
      if (project.scenes.some((scene) => scene.id === command.newSceneId)) fail('EDITOR_PROJECT_INVALID', 'El ID de la escena ya existe.', '/command/newSceneId');
      const copy = cloneJson(project.scenes[sourceIndex]);
      copy.id = command.newSceneId;
      copy.title = command.title;
      copy.elements = copy.elements.map((element, index) => ({ ...element, id: `${command.newSceneId}-e${index + 1}` }));
      const elementIds = new Map(project.scenes[sourceIndex].elements.map((element, index) => [element.id, copy.elements[index].id]));
      copy.dialogue = copy.dialogue.map((turn, index) => ({
        ...turn,
        id: `${command.newSceneId}-t${index + 1}`,
        speakerElementId: elementIds.get(turn.speakerElementId),
      }));
      project.scenes.splice(sourceIndex + 1, 0, copy);
      normalizeTransitions(project);
      return;
    }
    case 'delete-scene': {
      if (project.scenes.length === 1) fail('EDITOR_PROJECT_INVALID', 'El proyecto debe conservar al menos una escena.', '/command/sceneId');
      const index = project.scenes.findIndex((scene) => scene.id === command.sceneId);
      if (index < 0) fail('EDITOR_SCENE_NOT_FOUND', `No existe la escena ${command.sceneId}.`, '/command/sceneId');
      project.scenes.splice(index, 1);
      normalizeTransitions(project);
      return;
    }
    case 'set-scene-background': {
      const scene = requireScene(project, command.sceneId);
      const resource = requireResource(resources, command.resourceId, 'background', '/command/resourceId');
      if (!resource.capabilities.cameraPresets.includes(command.cameraPreset)) fail('EDITOR_CAMERA_PRESET_INVALID', 'El fondo no soporta el preset de cámara.', '/command/cameraPreset');
      scene.background = { resourceId: command.resourceId, cameraPreset: command.cameraPreset };
      return;
    }
    case 'set-character-resource': {
      const element = requireElement(requireScene(project, command.sceneId), command.elementId, 'character');
      const resource = requireResource(resources, command.resourceId, 'character', '/command/resourceId');
      if (!resource.capabilities.poses.includes(element.poseId) || !resource.capabilities.animationPresets.includes(element.animationPreset)) {
        fail('EDITOR_CHARACTER_INCOMPATIBLE', 'El personaje seleccionado no soporta la pose o animación actuales.', '/command/resourceId');
      }
      element.resourceId = command.resourceId;
      return;
    }
    case 'set-character-animation': {
      const element = requireElement(requireScene(project, command.sceneId), command.elementId, 'character');
      const resource = requireResource(resources, element.resourceId, 'character', '/command/elementId');
      if (!resource.capabilities.animationPresets.includes(command.animationPreset)) {
        fail('EDITOR_ANIMATION_INVALID', 'El personaje no soporta la animación seleccionada.', '/command/animationPreset');
      }
      element.animationPreset = command.animationPreset;
      return;
    }
    case 'add-character': {
      const scene = requireScene(project, command.sceneId);
      portableId(command.elementId, '/command/elementId');
      if (scene.elements.length >= 20) fail('EDITOR_PROJECT_INVALID', 'La escena admite hasta 20 elementos.', '/command');
      if (scene.elements.some((element) => element.id === command.elementId)) fail('EDITOR_PROJECT_INVALID', 'El ID del elemento ya existe.', '/command/elementId');
      const resource = requireResource(resources, command.resourceId, 'character', '/command/resourceId');
      scene.elements.push({
        id: command.elementId,
        type: 'character',
        resourceId: command.resourceId,
        transform: {
          x: command.x, y: command.y, anchorX: 0.5, anchorY: 0.5,
          scale: command.scale, rotationDegrees: 0, opacity: 1, zIndex: command.zIndex,
        },
        poseId: resource.capabilities.poses.includes('neutral') ? 'neutral' : resource.capabilities.poses[0],
        animationPreset: resource.capabilities.animationPresets[0],
      });
      return;
    }
    case 'add-prop': {
      const scene = requireScene(project, command.sceneId);
      portableId(command.elementId, '/command/elementId');
      if (scene.elements.length >= 20) fail('EDITOR_PROJECT_INVALID', 'La escena admite hasta 20 elementos.', '/command');
      if (scene.elements.some((element) => element.id === command.elementId)) fail('EDITOR_PROJECT_INVALID', 'El ID del elemento ya existe.', '/command/elementId');
      requireResource(resources, command.resourceId, 'prop', '/command/resourceId');
      scene.elements.push({
        id: command.elementId,
        type: 'prop',
        resourceId: command.resourceId,
        transform: {
          x: command.x, y: command.y, anchorX: 0.5, anchorY: 0.5,
          scale: command.scale, rotationDegrees: 0, opacity: 1, zIndex: command.zIndex,
        },
      });
      return;
    }
    case 'add-template': {
      const scene = requireScene(project, command.sceneId);
      portableId(command.elementId, '/command/elementId');
      if (scene.elements.length >= 20) fail('EDITOR_PROJECT_INVALID', 'La escena admite hasta 20 elementos.', '/command');
      if (scene.elements.some((element) => element.id === command.elementId)) fail('EDITOR_PROJECT_INVALID', 'El ID del elemento ya existe.', '/command/elementId');
      const resource = requireResource(resources, command.templateId, 'template', '/command/templateId');
      validateTemplateValues({ word: command.word }, resource, '/command/word');
      scene.elements.push({
        id: command.elementId,
        type: 'template',
        templateId: command.templateId,
        values: { word: command.word },
        // La plantilla cubre el cuadro completo: queda centrada y sin escalar.
        transform: {
          x: project.video.width / 2, y: project.video.height / 2, anchorX: 0.5, anchorY: 0.5,
          scale: 1, rotationDegrees: 0, opacity: 1, zIndex: command.zIndex,
        },
      });
      return;
    }
    case 'set-template-word': {
      const element = requireElement(requireScene(project, command.sceneId), command.elementId, 'template');
      const resource = requireResource(resources, element.templateId, 'template', '/command/elementId');
      validateTemplateValues({ word: command.word }, resource, '/command/word');
      element.values = { ...element.values, word: command.word };
      return;
    }
    case 'set-prop-resource': {
      const element = requireElement(requireScene(project, command.sceneId), command.elementId, 'prop');
      requireResource(resources, command.resourceId, 'prop', '/command/resourceId');
      element.resourceId = command.resourceId;
      return;
    }
    case 'delete-element': {
      const scene = requireScene(project, command.sceneId);
      const index = scene.elements.findIndex((element) => element.id === command.elementId);
      if (index < 0) fail('EDITOR_ELEMENT_NOT_FOUND', `No existe el elemento ${command.elementId}.`, '/command/elementId');
      if (scene.dialogue.some((turn) => turn.speakerElementId === command.elementId)) {
        fail('EDITOR_ELEMENT_IN_USE', 'Eliminá o reasigná primero los diálogos de este personaje.', '/command/elementId');
      }
      scene.elements.splice(index, 1);
      return;
    }
    case 'place-character-resource': {
      const element = requireElement(requireScene(project, command.sceneId), command.elementId, 'character');
      const resource = requireResource(resources, command.resourceId, 'character', '/command/resourceId');
      if (!resource.capabilities.poses.includes(element.poseId) || !resource.capabilities.animationPresets.includes(element.animationPreset)) {
        fail('EDITOR_CHARACTER_INCOMPATIBLE', 'El personaje seleccionado no soporta la pose o animación actuales.', '/command/resourceId');
      }
      element.resourceId = command.resourceId;
      element.transform.x = command.x;
      element.transform.y = command.y;
      validateEditableTransform(element.transform, '/command/transform');
      return;
    }
    case 'set-character-transform': {
      const element = requireElement(requireScene(project, command.sceneId), command.elementId, 'character');
      const keys = ['x', 'y', 'scale', 'zIndex'].filter((key) => Object.hasOwn(command, key));
      if (keys.length === 0) fail('EDITOR_COMMAND_INVALID', 'Indique al menos una coordenada o escala.', '/command');
      for (const key of keys) element.transform[key] = command[key];
      validateEditableTransform(element.transform, '/command/transform');
      return;
    }
    case 'set-element-transform': {
      const element = requireElement(requireScene(project, command.sceneId), command.elementId);
      if (!['character', 'prop', 'template'].includes(element.type)) {
        fail('EDITOR_ELEMENT_UNSUPPORTED', 'El transform solo puede editar personajes, props o plantillas.', '/command/elementId');
      }
      const keys = ['x', 'y', 'scale', 'rotationDegrees', 'opacity', 'zIndex']
        .filter((key) => Object.hasOwn(command, key));
      if (keys.length === 0) fail('EDITOR_COMMAND_INVALID', 'Indique al menos un cambio de transform.', '/command');
      for (const key of keys) element.transform[key] = command[key];
      validateEditableTransform(element.transform, '/command/transform');
      return;
    }
    case 'set-dialogue-turn': {
      const scene = requireScene(project, command.sceneId);
      const turn = scene.dialogue.find((item) => item.id === command.turnId);
      if (!turn) fail('EDITOR_TURN_NOT_FOUND', `No existe el turno ${command.turnId}.`, '/command/turnId');
      const keys = ['text', 'voiceId', 'gestureId', 'gestureAtWord', 'pace', 'layoutPreset', 'gapAfterSeconds'].filter((key) => Object.hasOwn(command, key));
      if (keys.length === 0) fail('EDITOR_COMMAND_INVALID', 'Indique al menos un cambio para el turno.', '/command');
      if (Object.hasOwn(command, 'voiceId')) requireResource(resources, command.voiceId, 'voice', '/command/voiceId');
      for (const key of keys) turn[key] = command[key];
      return;
    }
    case 'add-dialogue-turn': {
      const scene = requireScene(project, command.sceneId);
      portableId(command.turnId, '/command/turnId');
      if (scene.dialogue.length >= 20) fail('EDITOR_PROJECT_INVALID', 'La escena admite hasta 20 turnos.', '/command');
      if (scene.dialogue.some((turn) => turn.id === command.turnId)) fail('EDITOR_PROJECT_INVALID', 'El ID del turno ya existe.', '/command/turnId');
      requireElement(scene, command.speakerElementId, 'character');
      requireResource(resources, command.voiceId, 'voice', '/command/voiceId');
      const turn = {
        id: command.turnId,
        speakerElementId: command.speakerElementId,
        text: command.text,
        voiceId: command.voiceId,
        gestureId: command.gestureId,
        ...(command.gestureAtWord !== undefined ? { gestureAtWord: command.gestureAtWord } : {}),
        ...(command.pace !== undefined ? { pace: command.pace } : {}),
        ...(command.layoutPreset !== undefined ? { layoutPreset: command.layoutPreset } : {}),
        gapAfterSeconds: command.gapAfterSeconds,
      };
      const index = command.afterTurnId
        ? scene.dialogue.findIndex((item) => item.id === command.afterTurnId) + 1
        : scene.dialogue.length;
      if (command.afterTurnId && index === 0) fail('EDITOR_TURN_NOT_FOUND', `No existe el turno ${command.afterTurnId}.`, '/command/afterTurnId');
      scene.dialogue.splice(index, 0, turn);
      return;
    }
    case 'split-dialogue-turn': {
      const scene = requireScene(project, command.sceneId);
      portableId(command.newTurnId, '/command/newTurnId');
      if (scene.dialogue.length >= 20) fail('EDITOR_PROJECT_INVALID', 'La escena admite hasta 20 turnos.', '/command');
      if (scene.dialogue.some((turn) => turn.id === command.newTurnId)) fail('EDITOR_PROJECT_INVALID', 'El ID del turno ya existe.', '/command/newTurnId');
      const index = scene.dialogue.findIndex((turn) => turn.id === command.turnId);
      if (index < 0) fail('EDITOR_TURN_NOT_FOUND', `No existe el turno ${command.turnId}.`, '/command/turnId');
      const turn = scene.dialogue[index];
      // Mismo criterio de palabra que usa la validación de `gestureAtWord`: el
      // texto de autoría, no el normalizado para Piper.
      const words = turn.text.trim().split(/\s+/u).filter(Boolean);
      integerInRange(command.atWord, 1, 99, '/command/atWord');
      if (command.atWord > words.length - 1) {
        fail('EDITOR_SPLIT_INVALID', 'El corte debe dejar al menos una palabra de cada lado.', '/command/atWord');
      }
      // La pausa era posterior al enunciado completo, así que sigue al final: el
      // primer turno queda pegado al segundo y el segundo conserva la pausa. Lo
      // contrario insertaría un silencio en medio de una frase continua.
      const second = {
        ...cloneJson(turn),
        id: command.newTurnId,
        text: words.slice(command.atWord).join(' '),
        gapAfterSeconds: turn.gapAfterSeconds,
      };
      delete second.gestureAtWord;
      turn.text = words.slice(0, command.atWord).join(' ');
      turn.gapAfterSeconds = 0;
      // El gesto acompaña a la palabra que lo dispara: si cae en la segunda
      // mitad viaja con ella y su índice se rebasa al turno nuevo.
      if (turn.gestureAtWord !== undefined && turn.gestureAtWord >= command.atWord) {
        second.gestureAtWord = turn.gestureAtWord - command.atWord;
        delete turn.gestureAtWord;
      }
      scene.dialogue.splice(index + 1, 0, second);
      return;
    }
    case 'delete-dialogue-turn': {
      const scene = requireScene(project, command.sceneId);
      const index = scene.dialogue.findIndex((turn) => turn.id === command.turnId);
      if (index < 0) fail('EDITOR_TURN_NOT_FOUND', `No existe el turno ${command.turnId}.`, '/command/turnId');
      scene.dialogue.splice(index, 1);
      return;
    }
    case 'set-dialogue-speaker': {
      const scene = requireScene(project, command.sceneId);
      const turn = scene.dialogue.find((item) => item.id === command.turnId);
      if (!turn) fail('EDITOR_TURN_NOT_FOUND', `No existe el turno ${command.turnId}.`, '/command/turnId');
      requireElement(scene, command.speakerElementId, 'character');
      turn.speakerElementId = command.speakerElementId;
      return;
    }
    case 'set-transition': {
      const index = project.scenes.findIndex((scene) => scene.id === command.sceneId);
      if (index < 0) fail('EDITOR_SCENE_NOT_FOUND', `No existe la escena ${command.sceneId}.`, '/command/sceneId');
      if (index === project.scenes.length - 1) fail('EDITOR_TRANSITION_INVALID', 'La última escena no admite transición de salida.', '/command/sceneId');
      const transition = { preset: command.preset, durationSeconds: command.durationSeconds };
      validateTransition(transition, '/command');
      project.scenes[index].transitionToNext = transition;
      return;
    }
    case 'reorder-scenes': {
      if (!Array.isArray(command.sceneIds) || command.sceneIds.length !== project.scenes.length || new Set(command.sceneIds).size !== project.scenes.length) {
        fail('EDITOR_SCENE_ORDER_INVALID', 'El orden debe contener cada escena exactamente una vez.', '/command/sceneIds');
      }
      const byId = new Map(project.scenes.map((scene) => [scene.id, scene]));
      if (command.sceneIds.some((id) => !byId.has(id))) fail('EDITOR_SCENE_ORDER_INVALID', 'El orden contiene una escena desconocida.', '/command/sceneIds');
      const transitions = project.scenes.slice(0, -1).map((scene) => scene.transitionToNext);
      project.scenes = command.sceneIds.map((id, index) => {
        const scene = byId.get(id);
        delete scene.transitionToNext;
        if (index < command.sceneIds.length - 1) scene.transitionToNext = transitions[Math.min(index, transitions.length - 1)] || { preset: 'cut', durationSeconds: 0 };
        return scene;
      });
      return;
    }
    case 'split-scene': {
      if (project.scenes.length >= 8) fail('EDITOR_PROJECT_INVALID', 'El proyecto admite hasta ocho escenas.', '/command');
      portableId(command.newSceneId, '/command/newSceneId');
      if (project.scenes.some((scene) => scene.id === command.newSceneId)) fail('EDITOR_PROJECT_INVALID', 'El ID de la escena ya existe.', '/command/newSceneId');
      const index = project.scenes.findIndex((scene) => scene.id === command.sceneId);
      if (index < 0) fail('EDITOR_SCENE_NOT_FOUND', `No existe la escena ${command.sceneId}.`, '/command/sceneId');
      const scene = project.scenes[index];
      const turnIndex = scene.dialogue.findIndex((turn) => turn.id === command.atTurnId);
      // Cada escena necesita al menos dos turnos para poder renderizarse, así que el corte
      // (el turno indicado inicia la segunda escena) debe dejar >= 2 turnos a cada lado.
      if (turnIndex < 2 || turnIndex > scene.dialogue.length - 2) {
        fail('EDITOR_SPLIT_INVALID', 'El corte debe dejar al menos dos turnos a cada lado.', '/command/atTurnId');
      }
      const moved = scene.dialogue.slice(turnIndex);
      const copy = cloneJson(scene);
      copy.id = command.newSceneId;
      copy.title = `${`${scene.title}`.slice(0, 112).trim()} · 2`;
      copy.elements = copy.elements.map((element, position) => ({ ...element, id: `${command.newSceneId}-e${position + 1}` }));
      const elementIds = new Map(scene.elements.map((element, position) => [element.id, copy.elements[position].id]));
      copy.dialogue = moved.map((turn, position) => ({
        ...cloneJson(turn),
        id: `${command.newSceneId}-t${position + 1}`,
        speakerElementId: elementIds.get(turn.speakerElementId) ?? turn.speakerElementId,
      }));
      // La escena original conserva sus primeros turnos; la nueva hereda la transición de
      // salida (copy ya la clonó) y el corte entre ambas es un cut.
      scene.dialogue = scene.dialogue.slice(0, turnIndex);
      scene.transitionToNext = { preset: 'cut', durationSeconds: 0 };
      project.scenes.splice(index + 1, 0, copy);
      normalizeTransitions(project);
      return;
    }
    case 'apply-animation-preset': {
      const element = requireAnimatedElement(project, command);
      if (command.offsetSeconds !== undefined) {
        numberInRange(command.offsetSeconds, -5, 5, '/command/offsetSeconds');
      }
      const expanded = expandAnimationPreset(command.presetId, {
        anchor: command.anchor,
        intensity: command.intensity,
        offsetSeconds: command.offsetSeconds,
        // La base se lee UNA vez, al aplicar. Si después se mueve el elemento la
        // pista no se mueve sola: eso reescribiría puntos que el usuario ya editó.
        baseValue: baseValueFor(element, ANIMATION_PRESETS[command.presetId]?.parameterId),
      });
      element.tracks ||= [];
      const existing = findTrack(element, expanded.parameterId);
      if (existing) {
        // Una pista personalizada a mano no se pisa sin avisar; el usuario decide
        // si la elimina antes de volver a aplicar el preset.
        if (existing.source.kind === 'manual' || existing.source.customized) {
          fail('EDITOR_TRACK_CUSTOMIZED', 'Esa pista fue editada a mano; eliminala antes de aplicar un preset encima.', '/command/presetId');
        }
        element.tracks = element.tracks.filter((candidate) => candidate !== existing);
      }
      element.tracks.push(expanded);
      return;
    }
    case 'create-track': {
      // Atómico a propósito: el primer rombo crea una pista armada con un único
      // punto y el segundo punto define recién el primer tramo interpolado.
      const element = requireAnimatedElement(project, command);
      element.tracks ||= [];
      if (findTrack(element, command.parameterId)) {
        fail('EDITOR_TRACK_INVALID', 'El elemento ya tiene una pista para ese parámetro.', '/command/parameterId');
      }
      const track = {
        parameterId: command.parameterId,
        source: cloneJson(command.source ?? { kind: 'manual' }),
        keyframes: cloneJson(command.keyframes),
      };
      element.tracks.push(track);
      sortKeyframes(track);
      return;
    }
    case 'add-keyframe': {
      const element = requireAnimatedElement(project, command);
      const track = findTrack(element, command.parameterId);
      if (!track) fail('EDITOR_TRACK_NOT_FOUND', 'La pista no existe; usá create-track para agregar el primer keyframe.', '/command/parameterId');
      if (track.source.kind === 'preset') {
        // Editar a mano una pista que vino de un preset no la regenera: queda
        // marcada y sigue siendo editable, como fijó la Fase 0.
        track.source.customized = true;
      }
      track.keyframes.push({
        id: command.keyframeId,
        anchor: cloneJson(command.anchor),
        offsetSeconds: command.offsetSeconds,
        value: command.value,
        interpolation: command.interpolation,
      });
      sortKeyframes(track);
      return;
    }
    case 'set-keyframe': {
      const element = requireAnimatedElement(project, command);
      const track = findTrack(element, command.parameterId);
      if (!track) fail('EDITOR_TRACK_NOT_FOUND', 'El elemento no tiene una pista para ese parámetro.', '/command/parameterId');
      const keyframe = track.keyframes.find((candidate) => candidate.id === command.keyframeId);
      if (!keyframe) fail('EDITOR_KEYFRAME_NOT_FOUND', 'El keyframe no existe en la pista.', '/command/keyframeId');
      if (command.anchor !== undefined) keyframe.anchor = cloneJson(command.anchor);
      if (command.offsetSeconds !== undefined) keyframe.offsetSeconds = command.offsetSeconds;
      if (command.value !== undefined) keyframe.value = command.value;
      if (command.interpolation !== undefined) keyframe.interpolation = command.interpolation;
      if (track.source.kind === 'preset') track.source.customized = true;
      sortKeyframes(track);
      return;
    }
    case 'delete-keyframe': {
      const element = requireAnimatedElement(project, command);
      const track = findTrack(element, command.parameterId);
      if (!track) fail('EDITOR_TRACK_NOT_FOUND', 'El elemento no tiene una pista para ese parámetro.', '/command/parameterId');
      const index = track.keyframes.findIndex((candidate) => candidate.id === command.keyframeId);
      if (index < 0) fail('EDITOR_KEYFRAME_NOT_FOUND', 'El keyframe no existe en la pista.', '/command/keyframeId');
      track.keyframes.splice(index, 1);
      // Borrar el único punto elimina también la pista armada.
      if (track.keyframes.length < ANIMATION_LIMITS.minimumKeyframesPerTrack) {
        element.tracks = element.tracks.filter((candidate) => candidate !== track);
      } else {
        sortKeyframes(track);
      }
      if (element.tracks.length === 0) delete element.tracks;
      return;
    }
    case 'delete-track': {
      const element = requireAnimatedElement(project, command);
      const track = findTrack(element, command.parameterId);
      if (!track) fail('EDITOR_TRACK_NOT_FOUND', 'El elemento no tiene una pista para ese parámetro.', '/command/parameterId');
      element.tracks = element.tracks.filter((candidate) => candidate !== track);
      if (element.tracks.length === 0) delete element.tracks;
      return;
    }
    case 'remove-animation': {
      const element = requireAnimatedElement(project, command);
      const track = findTrack(element, command.parameterId);
      if (!track) fail('EDITOR_TRACK_NOT_FOUND', 'El elemento no tiene una animación para ese parámetro.', '/command/parameterId');
      const customized = track.source.kind === 'manual'
        || (track.source.kind === 'preset' && track.source.customized);
      if (customized && command.confirmCustomized !== true) {
        fail(
          'EDITOR_TRACK_CUSTOMIZED',
          'La animación fue creada o editada a mano; confirmá explícitamente para quitarla.',
          '/command/confirmCustomized',
        );
      }
      element.tracks = element.tracks.filter((candidate) => candidate !== track);
      if (element.tracks.length === 0) delete element.tracks;
      return;
    }
    case 'reorder-dialogue-turns': {
      const scene = requireScene(project, command.sceneId);
      if (!Array.isArray(command.turnIds) || command.turnIds.length !== scene.dialogue.length || new Set(command.turnIds).size !== scene.dialogue.length) {
        fail('EDITOR_TURN_ORDER_INVALID', 'El orden debe contener cada turno exactamente una vez.', '/command/turnIds');
      }
      const byId = new Map(scene.dialogue.map((turn) => [turn.id, turn]));
      if (command.turnIds.some((id) => !byId.has(id))) fail('EDITOR_TURN_ORDER_INVALID', 'El orden contiene un turno desconocido.', '/command/turnIds');
      scene.dialogue = command.turnIds.map((id) => byId.get(id));
      return;
    }
    default:
      fail('EDITOR_COMMAND_UNSUPPORTED', `Comando no soportado: ${String(command.type)}.`, '/command/type');
  }
}

/**
 * Los campos de una plantilla son cerrados: el catálogo declara cuáles existen y
 * la definición fija su longitud. El editor solo admite los que el recurso expone.
 */
function validateTemplateValues(values, resource, path) {
  if (!values || typeof values !== 'object') fail('EDITOR_VALUE_INVALID', 'Faltan los valores de la plantilla.', path);
  const declared = new Set(resource.capabilities.fields);
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) fail('EDITOR_VALUE_INVALID', `La plantilla no declara el campo ${key}.`, path);
  }
  if (!declared.has('word')) return;
  const word = values.word;
  if (typeof word !== 'string' || word.trim().length === 0 || word.length > 24) {
    fail('EDITOR_VALUE_INVALID', 'La palabra de la plantilla debe tener entre 1 y 24 caracteres.', path);
  }
}

function validateEditableTransform(transform, path) {
  if (!transform) fail('EDITOR_VALUE_INVALID', 'Falta el transform del elemento.', path);
  numberInRange(transform.x, -1080, 2160, `${path}/x`);
  numberInRange(transform.y, -1920, 3840, `${path}/y`);
  numberInRange(transform.anchorX, 0, 1, `${path}/anchorX`);
  numberInRange(transform.anchorY, 0, 1, `${path}/anchorY`);
  numberInRange(transform.scale, Number.MIN_VALUE, 10, `${path}/scale`);
  numberInRange(transform.rotationDegrees, -180, 180, `${path}/rotationDegrees`);
  numberInRange(transform.opacity, 0, 1, `${path}/opacity`);
  integerInRange(transform.zIndex, -1000, 1000, `${path}/zIndex`);
}

function validateTransition(transition, path) {
  if (!transition || !['cut', 'fade'].includes(transition.preset)) fail('EDITOR_TRANSITION_INVALID', 'La transición debe ser cut o fade.', `${path}/preset`);
  numberInRange(transition.durationSeconds, 0, 2, `${path}/durationSeconds`);
  if (transition.preset === 'cut' && transition.durationSeconds !== 0) fail('EDITOR_TRANSITION_INVALID', 'Un corte debe durar 0 segundos.', `${path}/durationSeconds`);
  if (transition.preset === 'fade' && transition.durationSeconds <= 0) fail('EDITOR_TRANSITION_INVALID', 'Un fundido debe durar más de 0 segundos.', `${path}/durationSeconds`);
}

function requireScene(project, id) {
  const scene = project.scenes.find((item) => item.id === id);
  if (!scene) fail('EDITOR_SCENE_NOT_FOUND', `No existe la escena ${String(id)}.`, '/command/sceneId');
  return scene;
}

function requireElement(scene, id, type) {
  const element = scene.elements.find((item) => item.id === id);
  if (!element || (type !== undefined && element.type !== type)) {
    const suffix = type === undefined ? '' : ` de tipo ${type}`;
    fail('EDITOR_ELEMENT_NOT_FOUND', `No existe el elemento ${String(id)}${suffix}.`, '/command/elementId');
  }
  return element;
}

function requireResource(resources, id, type, path) {
  const resource = resources.get(id);
  if (!resource || resource.type !== type) fail('EDITOR_RESOURCE_INVALID', `El recurso debe existir y ser de tipo ${type}.`, path);
  return resource;
}

function assertEditorState(state) {
  if (!state || state.version !== 1 || !state.project || !state.catalog || !Array.isArray(state.past) || !Array.isArray(state.future)) {
    fail('EDITOR_STATE_INVALID', 'El estado del editor no es compatible.', '/');
  }
}

function assertCommandShape(command) {
  const shapes = {
    'select-scene': { required: ['type', 'sceneId'], optional: [] },
    'set-project-title': { required: ['type', 'title'], optional: [] },
    'set-scene-title': { required: ['type', 'sceneId', 'title'], optional: [] },
    'add-scene': { required: ['type', 'scene'], optional: [] },
    'duplicate-scene': { required: ['type', 'sceneId', 'newSceneId', 'title'], optional: [] },
    'delete-scene': { required: ['type', 'sceneId'], optional: [] },
    'set-scene-background': { required: ['type', 'sceneId', 'resourceId', 'cameraPreset'], optional: [] },
    'set-character-resource': { required: ['type', 'sceneId', 'elementId', 'resourceId'], optional: [] },
    'set-character-animation': { required: ['type', 'sceneId', 'elementId', 'animationPreset'], optional: [] },
    'add-character': { required: ['type', 'sceneId', 'elementId', 'resourceId', 'x', 'y', 'scale', 'zIndex'], optional: [] },
    'add-prop': { required: ['type', 'sceneId', 'elementId', 'resourceId', 'x', 'y', 'scale', 'zIndex'], optional: [] },
    'add-template': { required: ['type', 'sceneId', 'elementId', 'templateId', 'word', 'zIndex'], optional: [] },
    'set-template-word': { required: ['type', 'sceneId', 'elementId', 'word'], optional: [] },
    'set-prop-resource': { required: ['type', 'sceneId', 'elementId', 'resourceId'], optional: [] },
    'delete-element': { required: ['type', 'sceneId', 'elementId'], optional: [] },
    'place-character-resource': { required: ['type', 'sceneId', 'elementId', 'resourceId', 'x', 'y'], optional: [] },
    'set-character-transform': { required: ['type', 'sceneId', 'elementId'], optional: ['x', 'y', 'scale', 'zIndex'] },
    'set-element-transform': { required: ['type', 'sceneId', 'elementId'], optional: ['x', 'y', 'scale', 'rotationDegrees', 'opacity', 'zIndex'] },
    'set-dialogue-turn': { required: ['type', 'sceneId', 'turnId'], optional: ['text', 'voiceId', 'gestureId', 'gestureAtWord', 'pace', 'layoutPreset', 'gapAfterSeconds'] },
    'add-dialogue-turn': { required: ['type', 'sceneId', 'turnId', 'speakerElementId', 'text', 'voiceId', 'gestureId', 'gapAfterSeconds'], optional: ['gestureAtWord', 'pace', 'layoutPreset', 'afterTurnId'] },
    'delete-dialogue-turn': { required: ['type', 'sceneId', 'turnId'], optional: [] },
    'set-dialogue-speaker': { required: ['type', 'sceneId', 'turnId', 'speakerElementId'], optional: [] },
    'set-transition': { required: ['type', 'sceneId', 'preset', 'durationSeconds'], optional: [] },
    'reorder-scenes': { required: ['type', 'sceneIds'], optional: [] },
    'split-scene': { required: ['type', 'sceneId', 'atTurnId', 'newSceneId'], optional: [] },
    'split-dialogue-turn': { required: ['type', 'sceneId', 'turnId', 'atWord', 'newTurnId'], optional: [] },
    'reorder-dialogue-turns': { required: ['type', 'sceneId', 'turnIds'], optional: [] },
    'apply-animation-preset': { required: ['type', 'sceneId', 'elementId', 'presetId'], optional: ['anchor', 'offsetSeconds', 'intensity'] },
    'create-track': { required: ['type', 'sceneId', 'elementId', 'parameterId', 'keyframes'], optional: ['source'] },
    'add-keyframe': { required: ['type', 'sceneId', 'elementId', 'parameterId', 'keyframeId', 'anchor', 'offsetSeconds', 'value', 'interpolation'], optional: [] },
    'set-keyframe': { required: ['type', 'sceneId', 'elementId', 'parameterId', 'keyframeId'], optional: ['anchor', 'offsetSeconds', 'value', 'interpolation'] },
    'delete-keyframe': { required: ['type', 'sceneId', 'elementId', 'parameterId', 'keyframeId'], optional: [] },
    'delete-track': { required: ['type', 'sceneId', 'elementId', 'parameterId'], optional: [] },
    'remove-animation': { required: ['type', 'sceneId', 'elementId', 'parameterId'], optional: ['confirmCustomized'] },
  };
  const shape = shapes[command.type];
  if (!shape) fail('EDITOR_COMMAND_UNSUPPORTED', `Comando no soportado: ${String(command.type)}.`, '/command/type');
  const allowed = new Set([...shape.required, ...shape.optional]);
  const unknown = Object.keys(command).find((key) => !allowed.has(key));
  if (unknown) fail('EDITOR_COMMAND_INVALID', `El comando contiene el campo no permitido ${unknown}.`, `/command/${unknown}`);
  const missing = shape.required.find((key) => !Object.hasOwn(command, key));
  if (missing) fail('EDITOR_COMMAND_INVALID', `Falta el campo obligatorio ${missing}.`, `/command/${missing}`);
}

/**
 * Reglas de pista dentro del proyecto editable.
 *
 * El vocabulario y los límites salen de `shared/animation-contract.js`: acá no se
 * repiten, se aplican. Un parámetro que necesita soporte del recurso solo se
 * admite si el recurso lo declara, que en V1 es el caso de `armRaise`.
 */
function validateEditableTracks(element, resource, path) {
  if (element.tracks === undefined) return;
  if (!Array.isArray(element.tracks)) fail('EDITOR_PROJECT_INVALID', 'Las pistas deben ser una lista.', path);
  if (element.tracks.length > ANIMATION_LIMITS.tracksPerElement) {
    fail('EDITOR_TRACK_INVALID', `Un elemento admite hasta ${ANIMATION_LIMITS.tracksPerElement} pistas.`, path);
  }
  const seenParameters = new Set();
  const seenKeyframes = new Set();
  for (const [trackIndex, track] of element.tracks.entries()) {
    const trackPath = `${path}/${trackIndex}`;
    const parameter = ANIMATION_PARAMETERS[track.parameterId];
    if (!parameter) fail('EDITOR_TRACK_INVALID', 'El parámetro no existe en el vocabulario V1.', `${trackPath}/parameterId`);
    if (!parameter.elementTypes.includes(element.type)) {
      fail('EDITOR_TRACK_INVALID', 'El parámetro no admite este tipo de elemento.', `${trackPath}/parameterId`);
    }
    if (seenParameters.has(track.parameterId)) {
      fail('EDITOR_TRACK_INVALID', 'Hay dos pistas sobre el mismo parámetro.', `${trackPath}/parameterId`);
    }
    seenParameters.add(track.parameterId);
    if (parameter.requiresResourceSupport && !(resource.capabilities.parameters || []).includes(track.parameterId)) {
      fail('EDITOR_TRACK_INVALID', 'El recurso no declara ese parámetro animable.', `${trackPath}/parameterId`);
    }
    if (!Array.isArray(track.keyframes) || track.keyframes.length < ANIMATION_LIMITS.minimumKeyframesPerTrack) {
      fail('EDITOR_TRACK_INVALID', 'Una pista necesita al menos un keyframe.', `${trackPath}/keyframes`);
    }
    if (track.keyframes.length > ANIMATION_LIMITS.keyframesPerTrack) {
      fail('EDITOR_TRACK_INVALID', `Una pista admite hasta ${ANIMATION_LIMITS.keyframesPerTrack} keyframes.`, `${trackPath}/keyframes`);
    }
    const offsets = new Map();
    for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
      const keyframePath = `${trackPath}/keyframes/${keyframeIndex}`;
      if (seenKeyframes.has(keyframe.id)) fail('EDITOR_TRACK_INVALID', 'Los IDs de keyframe deben ser únicos en el elemento.', `${keyframePath}/id`);
      seenKeyframes.add(keyframe.id);
      const belowMinimum = parameter.exclusiveMinimum !== undefined
        ? keyframe.value <= parameter.exclusiveMinimum
        : keyframe.value < parameter.minimum;
      if (belowMinimum || keyframe.value > parameter.maximum) {
        fail('EDITOR_TRACK_INVALID', 'El valor del keyframe cae fuera del rango del parámetro.', `${keyframePath}/value`);
      }
      const key = anchorKey(keyframe.anchor);
      if (offsets.get(key) === keyframe.offsetSeconds) {
        fail('EDITOR_TRACK_INVALID', 'Dos keyframes de la pista caen en el mismo punto.', keyframePath);
      }
      offsets.set(key, keyframe.offsetSeconds);
    }
  }
}

/** Pista de un parámetro dentro de un elemento, o null. */
function findTrack(element, parameterId) {
  return (element.tracks || []).find((track) => track.parameterId === parameterId) ?? null;
}

/**
 * Orden de guardado dentro de una pista: por ancla y desplazamiento. El orden
 * definitivo lo fija el frame resuelto, que no se conoce hasta medir el audio,
 * pero guardar ordenado deja la lista legible en el inspector.
 */
function sortKeyframes(track) {
  track.keyframes.sort((a, b) => {
    const left = anchorKey(a.anchor);
    const right = anchorKey(b.anchor);
    if (left < right) return -1;
    if (left > right) return 1;
    return a.offsetSeconds - b.offsetSeconds;
  });
}

function requireAnimatedElement(project, command) {
  const scene = requireScene(project, command.sceneId);
  const element = scene.elements.find((candidate) => candidate.id === command.elementId);
  if (!element) fail('EDITOR_ELEMENT_NOT_FOUND', 'El elemento no existe en la escena.', '/command/elementId');
  if (!['character', 'prop'].includes(element.type)) {
    fail('EDITOR_ELEMENT_UNSUPPORTED', 'Solo los personajes y props admiten pistas por ahora.', '/command/elementId');
  }
  return element;
}

function normalizeTransitions(project) {
  for (const [index, scene] of project.scenes.entries()) {
    if (index === project.scenes.length - 1) delete scene.transitionToNext;
    else if (!scene.transitionToNext) scene.transitionToNext = { preset: 'cut', durationSeconds: 0 };
  }
}

function stringInRange(value, min, max, path) {
  if (typeof value !== 'string' || value.length < min || value.length > max) fail('EDITOR_VALUE_INVALID', `Debe ser texto de ${min} a ${max} caracteres.`, path);
}

function numberInRange(value, min, max, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('EDITOR_VALUE_INVALID', `Debe ser un número entre ${min} y ${max}.`, path);
}

function integerInRange(value, min, max, path) {
  if (!Number.isInteger(value) || value < min || value > max) fail('EDITOR_VALUE_INVALID', `Debe ser un entero entre ${min} y ${max}.`, path);
}

function portableId(value, path) {
  if (typeof value !== 'string' || !PORTABLE_ID.test(value)) fail('EDITOR_VALUE_INVALID', 'Debe ser un ID portable válido.', path);
}

function assertObjectKeys(value, allowedKeys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('EDITOR_COMMAND_INVALID', 'Debe ser un objeto.', path);
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) fail('EDITOR_COMMAND_INVALID', `El objeto contiene el campo no permitido ${unknown}.`, `${path}/${unknown}`);
}

function fail(code, message, path) {
  throw new ProjectEditorError(code, message, path);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeState(state) {
  return deepFreeze(state);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
