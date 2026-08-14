import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot } from './common.mjs';
import { PipelineError } from './errors.mjs';
import { resolveAsset } from './job-context.mjs';
import { validateResourceManifestV3 } from '../stage2f/resource-manifest.mjs';
import { parseVideoTemplateDefinition } from '../../shared/video-template-definition.js';

export const SCENE_LIMITS = Object.freeze({
  maxAudioDurationSeconds: 120,
  maxFrameCount: 3600,
  maxGestures: 10,
  maxDialogueTurns: 20,
});

const directCharacterKeys = ['body', 'eyesOpen', 'eyesClosed', 'mouthClosed', 'mouthMedium', 'mouthOpen'];
const handKeys = ['handNeutral', 'handPoint'];
const ajv = new Ajv2020({ allErrors: true, strict: true });
// El contrato de animación se registra por su $id para que la escena v2 pueda
// referenciar su definición de pista en vez de repetirla.
ajv.addSchema(readSchema('animation-scene.schema.json'));
const validateSchemaV1 = ajv.compile(readSchema('scene-config.schema.json'));
const validateSchemaV2 = ajv.compile(readSchema('scene-config-v2.schema.json'));
const validateCharacterSchemaV1 = ajv.compile(readSchema('character-manifest.schema.json'));
const validateCharacterSchemaV2 = ajv.compile(readSchema('character-manifest-v2.schema.json'));
const validateAssetCatalogSchema = ajv.compile(readSchema('asset-catalog.schema.json'));

export function loadAndValidateJobConfig(context) {
  if (context.config) return context.config;
  let config;
  try {
    config = JSON.parse(readFileSync(context.jobConfigPath, 'utf8'));
  } catch (error) {
    throw new PipelineError({
      code: 'CONFIG_JSON_INVALID',
      stage: 'validating_config',
      message: 'La configuración de escena no contiene JSON válido.',
      technicalDetail: error instanceof SyntaxError ? error.message : undefined,
      suggestedAction: 'Corrija la sintaxis de scene.config.json y vuelva a ejecutar el trabajo.',
    });
  }
  validateSceneConfig(config, context);
  context.config = config;
  return config;
}

export function validateSceneConfig(config, context) {
  const validateSchema = config?.version === 2 ? validateSchemaV2 : validateSchemaV1;
  assertSchema(validateSchema, config, {
    code: 'CONFIG_SCHEMA_INVALID',
    message: `La configuración de escena no cumple el contrato versión ${config?.version ?? 'desconocida'}.`,
    suggestedAction: 'Revise los campos requeridos, tipos y límites indicados por el validador.',
  });

  if (config.version === 2) {
    validateDialogueSemantics(config);
    resolveDialogueAssets(config, context);
  } else {
    if (config.blink.minIntervalSeconds > config.blink.maxIntervalSeconds) {
      semanticError('/blink/minIntervalSeconds', 'no puede ser mayor que /blink/maxIntervalSeconds');
    }
    validateGestureOrder(config.gestures || []);
    resolveConfiguredAssets(config, context);
  }
  if (config.mouth.silenceThresholdNormalized >= config.mouth.openThresholdNormalized) {
    semanticError('/mouth/silenceThresholdNormalized', 'debe ser menor que /mouth/openThresholdNormalized');
  }
  return config;
}

export function validateMeasuredDuration(config, durationSeconds) {
  const frameCount = Math.ceil(durationSeconds * config.video.fps);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > SCENE_LIMITS.maxAudioDurationSeconds) {
    throw new PipelineError({
      code: 'AUDIO_DURATION_OUT_OF_RANGE',
      stage: 'analyzing_audio',
      message: `El audio debe durar más de 0 y como máximo ${SCENE_LIMITS.maxAudioDurationSeconds} segundos.`,
      technicalDetail: `durationSeconds=${durationSeconds}`,
      suggestedAction: 'Reduzca el texto, las pausas o ajuste la velocidad de la voz.',
    });
  }
  if (frameCount > SCENE_LIMITS.maxFrameCount) {
    throw new PipelineError({
      code: 'FRAME_LIMIT_EXCEEDED',
      stage: 'analyzing_audio',
      message: `El trabajo supera el límite de ${SCENE_LIMITS.maxFrameCount} frames.`,
      technicalDetail: `frameCount=${frameCount}`,
      suggestedAction: 'Reduzca la duración del audio.',
    });
  }
  if (config.version === 1 && config.subtitle.startSeconds > durationSeconds) {
    throw new PipelineError({
      code: 'SUBTITLE_START_AFTER_AUDIO',
      stage: 'analyzing_audio',
      message: 'El subtítulo comienza después de que termina el audio.',
      technicalDetail: `startSeconds=${config.subtitle.startSeconds}; durationSeconds=${durationSeconds}`,
      suggestedAction: 'Ajuste subtitle.startSeconds dentro de la duración medida del WAV.',
    });
  }
  for (const [index, gesture] of (config.version === 1 ? config.gestures || [] : []).entries()) {
    if (gesture.startSeconds + gesture.durationSeconds > durationSeconds) {
      throw new PipelineError({
        code: 'GESTURE_OUTSIDE_AUDIO',
        stage: 'analyzing_audio',
        message: 'Un gesto termina después del audio medido.',
        technicalDetail: `/gestures/${index} endSeconds=${gesture.startSeconds + gesture.durationSeconds}; durationSeconds=${durationSeconds}`,
        suggestedAction: 'Mueva o acorte el gesto para que quede dentro de la duración del WAV.',
      });
    }
  }
  return { durationSeconds, frameCount };
}

function resolveConfiguredAssets(config, context) {
  const hasManifest = Boolean(config.characterManifest);
  const directKeysPresent = directCharacterKeys.filter((key) => config.assets[key]);
  if (hasManifest && directKeysPresent.length > 0) {
    semanticError('/assets', 'no debe duplicar capas de personaje cuando se usa /characterManifest');
  }
  const resolvedAssets = { background: config.assets.background };
  let characterRig = null;

  if (hasManifest) {
    const resolved = resolveCharacterManifest(context, config.characterManifest, '/characterManifest');
    Object.assign(resolvedAssets, resolved.assets);
    characterRig = resolved.characterRig;
  } else {
    for (const key of directCharacterKeys) resolvedAssets[key] = config.assets[key];
    const presentHands = handKeys.filter((key) => config.assets[key]);
    if (presentHands.length === 1) semanticError('/assets', 'debe definir handNeutral y handPoint juntos');
    for (const key of presentHands) resolvedAssets[key] = config.assets[key];
  }

  if ((config.gestures || []).length > 0 && (!resolvedAssets.handNeutral || !resolvedAssets.handPoint)) {
    semanticError('/gestures', 'requiere capas handNeutral y handPoint');
  }
  for (const [name, assetPath] of Object.entries(resolvedAssets)) {
    assertPortableRelativePath(assetPath, `/resolvedAssets/${name}`);
    resolveAsset(context, assetPath, name);
  }
  context.resolvedAssets = resolvedAssets;
  context.characterRig = characterRig;
  context.resolvedCharacters = null;
}

function validateDialogueSemantics(config) {
  const characterIds = new Set();
  const elementIds = new Set();
  for (const [index, character] of config.characters.entries()) {
    if (characterIds.has(character.id)) semanticError(`/characters/${index}/id`, 'debe ser único');
    characterIds.add(character.id);
    elementIds.add(character.id);
    if (character.blink.minIntervalSeconds > character.blink.maxIntervalSeconds) {
      semanticError(`/characters/${index}/blink/minIntervalSeconds`, 'no puede ser mayor que maxIntervalSeconds');
    }
  }
  for (const [index, prop] of (config.props ?? []).entries()) {
    if (elementIds.has(prop.id)) semanticError(`/props/${index}/id`, 'debe ser único en la escena');
    elementIds.add(prop.id);
  }
  for (const [index, template] of (config.templates ?? []).entries()) {
    if (elementIds.has(template.id)) semanticError(`/templates/${index}/id`, 'debe ser único en la escena');
    elementIds.add(template.id);
  }
  const turnIds = new Set();
  for (const [index, turn] of config.dialogue.entries()) {
    if (turnIds.has(turn.id)) semanticError(`/dialogue/${index}/id`, 'debe ser único');
    turnIds.add(turn.id);
    const speakerType = turn.speakerType ?? 'character';
    if (speakerType === 'voiceover') {
      if (turn.speakerId !== undefined) semanticError(`/dialogue/${index}/speakerId`, 'no se usa en una voz fuera de campo');
      if ((turn.gesture ?? 'neutral') !== 'neutral') semanticError(`/dialogue/${index}/gesture`, 'debe ser neutral en una voz fuera de campo');
      if (turn.gestureAtWord !== undefined) semanticError(`/dialogue/${index}/gestureAtWord`, 'no se usa en una voz fuera de campo');
      if (turn.layout !== undefined) semanticError(`/dialogue/${index}/layout`, 'no se usa en una voz fuera de campo');
    } else if (!characterIds.has(turn.speakerId)) {
      semanticError(`/dialogue/${index}/speakerId`, 'debe referenciar un personaje existente');
    }
  }
  const soundEffectIds = new Set();
  for (const [index, effect] of (config.soundEffects ?? []).entries()) {
    if (soundEffectIds.has(effect.id)) semanticError(`/soundEffects/${index}/id`, 'debe ser único');
    soundEffectIds.add(effect.id);
    if (effect.anchor.kind === 'turn' && !turnIds.has(effect.anchor.turnId)) {
      semanticError(`/soundEffects/${index}/anchor/turnId`, 'debe referenciar un turno existente');
    }
  }
  const backgroundIds = new Set();
  for (const [index, layer] of (config.backgroundAnimation?.layers || []).entries()) {
    if (backgroundIds.has(layer.id)) semanticError(`/backgroundAnimation/layers/${index}/id`, 'debe ser único');
    backgroundIds.add(layer.id);
  }
}

function resolveDialogueAssets(config, context) {
  assertPortableRelativePath(config.assets.background, '/assets/background');
  resolveAsset(context, config.assets.background, 'background');
  if (config.assets.music) {
    assertPortableRelativePath(config.assets.music, '/assets/music');
    resolveAsset(context, config.assets.music, 'music');
  }
  for (const [index, effect] of (config.soundEffects ?? []).entries()) {
    assertPortableRelativePath(effect.asset, `/soundEffects/${index}/asset`);
    resolveAsset(context, effect.asset, `soundEffect/${effect.id}`);
  }
  context.resolvedAssets = {
    background: config.assets.background,
    ...(config.assets.music ? { music: config.assets.music } : {}),
  };
  context.resolvedBackgroundAnimation = config.backgroundAnimation ? {
    camera: config.backgroundAnimation.camera,
    layers: config.backgroundAnimation.layers.map((layer, index) => {
      assertPortableRelativePath(layer.asset, `/backgroundAnimation/layers/${index}/asset`);
      resolveAsset(context, layer.asset, `backgroundAnimation/${layer.id}`);
      return { ...layer };
    }),
  } : null;
  context.characterRig = null;
  const catalog = config.assetCatalog ? resolveAssetCatalog(context, config.assetCatalog) : null;
  context.assetCatalog = catalog;
  context.resolvedCharacters = config.characters.map((character, index) => {
    let manifestPath = character.characterManifest;
    let catalogEntry = null;
    if (character.characterAssetId) {
      if (!catalog) semanticError(`/characters/${index}/characterAssetId`, 'requiere /assetCatalog');
      catalogEntry = catalog.entries.find((entry) => entry.id === character.characterAssetId);
      if (!catalogEntry) semanticError(`/characters/${index}/characterAssetId`, 'debe existir en /assetCatalog');
      manifestPath = catalogEntry.manifest;
    }
    const resolved = resolveCharacterManifest(context, manifestPath, character.characterAssetId
      ? `/characters/${index}/characterAssetId`
      : `/characters/${index}/characterManifest`);
    return {
      id: character.id,
      assets: resolved.assets,
      characterRig: resolved.characterRig,
      transform: character.transform,
      ...(character.visibility ? { visibility: character.visibility } : {}),
      blink: character.blink,
      ...(catalogEntry ? { catalogEntry: { id: catalogEntry.id, thumbnail: catalogEntry.thumbnail } } : {}),
    };
  });
  context.resolvedProps = (config.props ?? []).map((prop, index) => {
    const resolved = resolvePropManifest(context, prop.resourceManifest, `/props/${index}/resourceManifest`);
    return {
      id: prop.id,
      resourceRig: resolved.resourceRig,
      transform: prop.transform,
      ...(prop.visibility ? { visibility: prop.visibility } : {}),
    };
  });
  context.resolvedTemplates = (config.templates ?? []).map((template, index) => {
    assertPortableRelativePath(template.definition, `/templates/${index}/definition`);
    const definitionFile = resolveAsset(context, template.definition, `templates/${index}/definition`);
    let definition;
    try {
      definition = parseVideoTemplateDefinition(JSON.parse(readFileSync(definitionFile, 'utf8')));
    } catch (error) {
      semanticError(
        `/templates/${index}/definition`,
        `no cumple el contrato de plantilla: ${error instanceof Error ? error.message : 'formato inválido'}`,
      );
    }
    const field = definition.fields.find((candidate) => candidate.id === 'word');
    if (template.word.length > field.maxLength) {
      semanticError(`/templates/${index}/word`, `supera el máximo de ${field.maxLength} caracteres de la plantilla`);
    }
    return {
      id: template.id,
      definition: template.definition,
      word: template.word,
      transform: template.transform,
      ...(template.visibility ? { visibility: template.visibility } : {}),
    };
  });
}

function resolveAssetCatalog(context, catalogPath) {
  assertPortableRelativePath(catalogPath, '/assetCatalog');
  const catalogFile = resolveAsset(context, catalogPath, 'assetCatalog');
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
  } catch (error) {
    throw new PipelineError({
      code: 'ASSET_CATALOG_JSON_INVALID',
      stage: 'validating_config',
      message: 'El catálogo de assets no contiene JSON válido.',
      technicalDetail: error instanceof SyntaxError ? error.message : undefined,
      suggestedAction: 'Corrija o regenere el catálogo local.',
    });
  }
  assertSchema(validateAssetCatalogSchema, catalog, {
    code: 'ASSET_CATALOG_SCHEMA_INVALID',
    message: 'El catálogo de assets no cumple el contrato versión 1.',
    suggestedAction: 'Regenere el catálogo desde definiciones válidas.',
  });
  const ids = new Set();
  assertPortableRelativePath(catalog.generatedFrom, '/assetCatalog/generatedFrom');
  resolveAsset(context, catalog.generatedFrom, 'assetCatalog/generatedFrom');
  for (const [index, entry] of catalog.entries.entries()) {
    if (ids.has(entry.id)) semanticError(`/assetCatalog/entries/${index}/id`, 'debe ser único');
    ids.add(entry.id);
    for (const [name, value] of [['manifest', entry.manifest], ['thumbnail', entry.thumbnail]]) {
      assertPortableRelativePath(value, `/assetCatalog/entries/${index}/${name}`);
      resolveAsset(context, value, `assetCatalog/${entry.id}/${name}`);
    }
  }
  return { path: catalogPath, entries: catalog.entries, generatedFrom: catalog.generatedFrom };
}

function resolveCharacterManifest(context, manifestPath, jsonPath) {
  assertPortableRelativePath(manifestPath, jsonPath);
  const manifestFile = resolveAsset(context, manifestPath, `${jsonPath}/manifest`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    throw new PipelineError({
      code: 'CHARACTER_MANIFEST_JSON_INVALID',
      stage: 'validating_config',
      message: 'El manifest del personaje no contiene JSON válido.',
      technicalDetail: error instanceof SyntaxError ? error.message : undefined,
      suggestedAction: 'Corrija la sintaxis del manifest del personaje.',
    });
  }
  if (manifest?.version === 3) {
    validateResourceManifestV3(manifest);
    if (manifest.kind !== 'character') {
      characterManifestSemanticError(jsonPath, 'debe ser un recurso v3 de tipo character');
    }
    const manifestDirectory = path.posix.dirname(manifestPath);
    const layerPaths = [
      ...manifest.parts.flatMap((part) => part.layer ? [part.layer] : []),
      ...Object.values(manifest.states.eyes ?? {}),
      ...Object.values(manifest.states.mouth ?? {}),
      ...Object.values(manifest.states.hands ?? {}),
    ];
    for (const [index, relativePath] of layerPaths.entries()) {
      assertPortableRelativePath(relativePath, `${jsonPath}/layers/${index}`);
      resolveAsset(context, path.posix.join(manifestDirectory, relativePath), `${jsonPath}/layers/${index}`);
    }
    assertPortableRelativePath(manifest.sourceDefinition, `${jsonPath}/sourceDefinition`);
    resolveAsset(context, manifest.sourceDefinition, `${jsonPath}/sourceDefinition`);
    return {
      // El backend PixiJS lee las piezas desde el manifest. No se fabrica una
      // vista de capas legacy que el recurso articulado no tiene.
      assets: {},
      characterRig: {
        id: manifest.id,
        version: 3,
        manifestPath,
        pivot: manifest.pivot,
        provenance: manifest.provenance,
        sourceDefinition: manifest.sourceDefinition,
        variant: manifest.variant,
        parts: manifest.parts,
        poses: manifest.poses,
        parameters: manifest.parameters,
        bindings: manifest.bindings,
      },
    };
  }
  const validateCharacterSchema = manifest?.version === 2 ? validateCharacterSchemaV2 : validateCharacterSchemaV1;
  assertSchema(validateCharacterSchema, manifest, {
    code: 'CHARACTER_MANIFEST_SCHEMA_INVALID',
    message: `El manifest del personaje no cumple el contrato versión ${manifest?.version ?? 'desconocida'}.`,
    suggestedAction: 'Revise ID, canvas, pivot, capas y procedencia del personaje.',
  });
  const manifestDirectory = path.posix.dirname(manifestPath);
  const sourceLayers = {
    body: manifest.layers.body,
    eyesOpen: manifest.layers.eyes.open,
    eyesClosed: manifest.layers.eyes.closed,
    mouthClosed: manifest.layers.mouth.closed,
    mouthMedium: manifest.layers.mouth.medium,
    mouthOpen: manifest.layers.mouth.open,
    mouthRound: manifest.layers.mouth.round ?? manifest.layers.mouth.open,
    mouthLabiodental: manifest.layers.mouth.labiodental ?? manifest.layers.mouth.medium,
    mouthBilabial: manifest.layers.mouth.bilabial ?? manifest.layers.mouth.closed,
    handNeutral: manifest.layers.hands.neutral,
    handPoint: manifest.layers.hands.point,
    handCelebrate: manifest.layers.hands.celebrate ?? manifest.layers.hands.point,
    handDoubt: manifest.layers.hands.doubt ?? manifest.layers.hands.neutral,
    handDeny: manifest.layers.hands.deny ?? manifest.layers.hands.neutral,
  };
  const assets = {};
  for (const [name, relativePath] of Object.entries(sourceLayers)) {
    assertPortableRelativePath(relativePath, `${jsonPath}/layers/${name}`);
    assets[name] = path.posix.join(manifestDirectory, relativePath);
    resolveAsset(context, assets[name], `${jsonPath}/${name}`);
  }
  if (manifest.version === 2) {
    validateCharacterRigSemantics(manifest, jsonPath);
    assertPortableRelativePath(manifest.sourceDefinition, `${jsonPath}/sourceDefinition`);
    resolveAsset(context, manifest.sourceDefinition, `${jsonPath}/sourceDefinition`);
  }
  return {
    assets,
    characterRig: {
      id: manifest.id,
      version: manifest.version,
      manifestPath,
      pivot: manifest.pivot,
      provenance: manifest.provenance,
      ...(manifest.version === 2 ? {
        sourceDefinition: manifest.sourceDefinition,
        variant: manifest.variant,
        joints: manifest.joints,
        poses: manifest.poses,
      } : {}),
    },
  };
}

function resolvePropManifest(context, manifestPath, jsonPath) {
  assertPortableRelativePath(manifestPath, jsonPath);
  const manifestFile = resolveAsset(context, manifestPath, `${jsonPath}/manifest`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    throw new PipelineError({
      code: 'RESOURCE_MANIFEST_JSON_INVALID',
      stage: 'validating_config',
      message: 'El manifest del prop no contiene JSON válido.',
      technicalDetail: error instanceof SyntaxError ? error.message : undefined,
      suggestedAction: 'Corrija la sintaxis del manifest del recurso.',
    });
  }
  validateResourceManifestV3(manifest);
  if (manifest.kind !== 'prop') characterManifestSemanticError(jsonPath, 'debe ser un recurso v3 de tipo prop');
  const manifestDirectory = path.posix.dirname(manifestPath);
  for (const [index, part] of manifest.parts.entries()) {
    if (!part.layer) continue;
    assertPortableRelativePath(part.layer, `${jsonPath}/parts/${index}/layer`);
    resolveAsset(context, path.posix.join(manifestDirectory, part.layer), `${jsonPath}/parts/${index}/layer`);
  }
  assertPortableRelativePath(manifest.sourceDefinition, `${jsonPath}/sourceDefinition`);
  resolveAsset(context, manifest.sourceDefinition, `${jsonPath}/sourceDefinition`);
  return {
    resourceRig: {
      id: manifest.id,
      version: 3,
      kind: 'prop',
      manifestPath,
      pivot: manifest.pivot,
      parts: manifest.parts,
      parameters: manifest.parameters,
      bindings: manifest.bindings,
      provenance: manifest.provenance,
      sourceDefinition: manifest.sourceDefinition,
    },
  };
}

function validateCharacterRigSemantics(manifest, jsonPath) {
  const jointIds = new Set();
  for (const [index, joint] of manifest.joints.entries()) {
    if (jointIds.has(joint.id)) characterManifestSemanticError(`${jsonPath}/joints/${index}/id`, 'debe ser único');
    jointIds.add(joint.id);
  }
  if (manifest.joints.filter((joint) => joint.parentId === null).length !== 1) {
    characterManifestSemanticError(`${jsonPath}/joints`, 'debe contener exactamente una raíz');
  }
  for (const [index, joint] of manifest.joints.entries()) {
    if (joint.parentId !== null && !jointIds.has(joint.parentId)) {
      characterManifestSemanticError(`${jsonPath}/joints/${index}/parentId`, 'debe referenciar un joint existente');
    }
    const visited = new Set([joint.id]);
    let parentId = joint.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) characterManifestSemanticError(`${jsonPath}/joints/${index}`, 'no puede formar un ciclo');
      visited.add(parentId);
      parentId = manifest.joints.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
  }
  const poseIds = new Set();
  for (const [poseIndex, pose] of manifest.poses.entries()) {
    if (poseIds.has(pose.id)) characterManifestSemanticError(`${jsonPath}/poses/${poseIndex}/id`, 'debe ser único');
    poseIds.add(pose.id);
    const poseJoints = new Set();
    for (const [jointIndex, item] of pose.joints.entries()) {
      if (!jointIds.has(item.jointId)) characterManifestSemanticError(`${jsonPath}/poses/${poseIndex}/joints/${jointIndex}/jointId`, 'debe referenciar un joint existente');
      if (poseJoints.has(item.jointId)) characterManifestSemanticError(`${jsonPath}/poses/${poseIndex}/joints/${jointIndex}/jointId`, 'no puede repetirse dentro de la pose');
      poseJoints.add(item.jointId);
    }
  }
  for (const required of ['neutral', 'point']) {
    if (!poseIds.has(required)) characterManifestSemanticError(`${jsonPath}/poses`, `debe incluir ${required}`);
  }
}

function validateGestureOrder(gestures) {
  let previousEnd = 0;
  for (const [index, gesture] of gestures.entries()) {
    if (gesture.startSeconds < previousEnd) {
      semanticError(`/gestures/${index}/startSeconds`, 'debe estar ordenado y no superponerse con el gesto anterior');
    }
    previousEnd = gesture.startSeconds + gesture.durationSeconds;
  }
}

function assertSchema(validate, value, options) {
  if (validate(value)) return;
  const details = [...(validate.errors || [])]
    .slice(0, 12)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  throw new PipelineError({
    code: options.code,
    stage: 'validating_config',
    message: options.message,
    technicalDetail: details,
    suggestedAction: options.suggestedAction,
  });
}

function assertPortableRelativePath(value, jsonPath) {
  const hasTraversal = value.split('/').includes('..') || value.split('\\').includes('..');
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.includes('\\') || value.includes(':') || hasTraversal || value.includes('\0')) {
    throw new PipelineError({
      code: 'ASSET_PATH_INVALID',
      stage: 'validating_config',
      message: `La ruta ${jsonPath} debe ser relativa, portable y permanecer dentro de assets-dir.`,
      technicalDetail: jsonPath,
      suggestedAction: 'Use una ruta relativa con barras normales, por ejemplo assets/personaje.png.',
    });
  }
}

function semanticError(jsonPath, rule) {
  throw new PipelineError({
    code: 'CONFIG_SEMANTIC_INVALID',
    stage: 'validating_config',
    message: 'La configuración contiene valores incompatibles entre sí.',
    technicalDetail: `${jsonPath} ${rule}`,
    suggestedAction: 'Corrija la relación indicada entre los valores.',
  });
}

function characterManifestSemanticError(jsonPath, rule) {
  throw new PipelineError({
    code: 'CHARACTER_MANIFEST_SEMANTIC_INVALID',
    stage: 'validating_config',
    message: 'El rig del personaje contiene referencias incompatibles.',
    technicalDetail: `${jsonPath} ${rule}`,
    suggestedAction: 'Corrija la jerarquía de joints y las poses del manifest.',
  });
}

function readSchema(name) {
  return JSON.parse(readFileSync(path.join(projectRoot, 'schema', name), 'utf8'));
}
