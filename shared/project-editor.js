const HISTORY_LIMIT_DEFAULT = 50;

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
  if (!['character', 'voice', 'background', 'image'].includes(type)) fail('EDITOR_RESOURCE_TYPE_INVALID', `Tipo de recurso no soportado: ${type}.`, '/type');
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
    let characterCount = 0;
    for (const [elementIndex, element] of scene.elements.entries()) {
      const elementPath = `${scenePath}/elements/${elementIndex}`;
      if (!element || elements.has(element.id)) fail('EDITOR_PROJECT_INVALID', 'Los IDs de elemento deben existir y ser únicos en la escena.', `${elementPath}/id`);
      elements.set(element.id, element);
      if (element.type === 'character') {
        characterCount += 1;
        const resource = requireResource(resources, element.resourceId, 'character', `${elementPath}/resourceId`);
        if (!resource.capabilities.poses.includes(element.poseId)) fail('EDITOR_POSE_INVALID', 'El personaje no soporta la pose seleccionada.', `${elementPath}/poseId`);
        if (!resource.capabilities.animationPresets.includes(element.animationPreset)) fail('EDITOR_ANIMATION_INVALID', 'El personaje no soporta la animación seleccionada.', `${elementPath}/animationPreset`);
        validateEditableTransform(element.transform, `${elementPath}/transform`);
      } else {
        fail('EDITOR_ELEMENT_UNSUPPORTED', '3B.0 solo edita personajes porque el compilador vigente todavía no representa texto o imágenes.', `${elementPath}/type`);
      }
    }
    if (characterCount !== 2) fail('EDITOR_SCENE_UNSUPPORTED', '3B.0 requiere exactamente dos personajes por escena.', `${scenePath}/elements`);
    if (!Array.isArray(scene.dialogue) || scene.dialogue.length < 2) fail('EDITOR_SCENE_UNSUPPORTED', '3B.0 requiere al menos dos turnos por escena.', `${scenePath}/dialogue`);
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
    case 'set-character-transform': {
      const element = requireElement(requireScene(project, command.sceneId), command.elementId, 'character');
      const keys = ['x', 'y', 'scale', 'zIndex'].filter((key) => Object.hasOwn(command, key));
      if (keys.length === 0) fail('EDITOR_COMMAND_INVALID', 'Indique al menos una coordenada o escala.', '/command');
      for (const key of keys) element.transform[key] = command[key];
      validateEditableTransform(element.transform, '/command/transform');
      return;
    }
    case 'set-dialogue-turn': {
      const scene = requireScene(project, command.sceneId);
      const turn = scene.dialogue.find((item) => item.id === command.turnId);
      if (!turn) fail('EDITOR_TURN_NOT_FOUND', `No existe el turno ${command.turnId}.`, '/command/turnId');
      const keys = ['text', 'voiceId', 'gestureId', 'gapAfterSeconds'].filter((key) => Object.hasOwn(command, key));
      if (keys.length === 0) fail('EDITOR_COMMAND_INVALID', 'Indique al menos un cambio para el turno.', '/command');
      if (Object.hasOwn(command, 'voiceId')) requireResource(resources, command.voiceId, 'voice', '/command/voiceId');
      for (const key of keys) turn[key] = command[key];
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
    default:
      fail('EDITOR_COMMAND_UNSUPPORTED', `Comando no soportado: ${String(command.type)}.`, '/command/type');
  }
}

function validateEditableTransform(transform, path) {
  if (!transform || transform.anchorX !== 0.5 || transform.anchorY !== 0.5 || transform.rotationDegrees !== 0 || transform.opacity !== 1) {
    fail('EDITOR_TRANSFORM_UNSUPPORTED', '3B.0 conserva ancla 0.5/0.5, rotación 0 y opacidad 1 para mantener compatibilidad con el compilador.', path);
  }
  numberInRange(transform.x, -1080, 2160, `${path}/x`);
  numberInRange(transform.y, -1920, 3840, `${path}/y`);
  numberInRange(transform.scale, Number.MIN_VALUE, 10, `${path}/scale`);
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
  if (!element || element.type !== type) fail('EDITOR_ELEMENT_NOT_FOUND', `No existe el elemento ${String(id)} de tipo ${type}.`, '/command/elementId');
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
    'set-scene-background': { required: ['type', 'sceneId', 'resourceId', 'cameraPreset'], optional: [] },
    'set-character-resource': { required: ['type', 'sceneId', 'elementId', 'resourceId'], optional: [] },
    'set-character-transform': { required: ['type', 'sceneId', 'elementId'], optional: ['x', 'y', 'scale', 'zIndex'] },
    'set-dialogue-turn': { required: ['type', 'sceneId', 'turnId'], optional: ['text', 'voiceId', 'gestureId', 'gapAfterSeconds'] },
    'set-transition': { required: ['type', 'sceneId', 'preset', 'durationSeconds'], optional: [] },
    'reorder-scenes': { required: ['type', 'sceneIds'], optional: [] },
  };
  const shape = shapes[command.type];
  if (!shape) fail('EDITOR_COMMAND_UNSUPPORTED', `Comando no soportado: ${String(command.type)}.`, '/command/type');
  const allowed = new Set([...shape.required, ...shape.optional]);
  const unknown = Object.keys(command).find((key) => !allowed.has(key));
  if (unknown) fail('EDITOR_COMMAND_INVALID', `El comando contiene el campo no permitido ${unknown}.`, `/command/${unknown}`);
  const missing = shape.required.find((key) => !Object.hasOwn(command, key));
  if (missing) fail('EDITOR_COMMAND_INVALID', `Falta el campo obligatorio ${missing}.`, `/command/${missing}`);
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
