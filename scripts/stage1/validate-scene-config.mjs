import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot } from './common.mjs';
import { PipelineError } from './errors.mjs';
import { resolveAsset } from './job-context.mjs';

export const SCENE_LIMITS = Object.freeze({
  maxAudioDurationSeconds: 120,
  maxFrameCount: 3600,
  maxGestures: 10,
});

const directCharacterKeys = ['body', 'eyesOpen', 'eyesClosed', 'mouthClosed', 'mouthMedium', 'mouthOpen'];
const handKeys = ['handNeutral', 'handPoint'];
const schema = readSchema('scene-config.schema.json');
const characterSchema = readSchema('character-manifest.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema = ajv.compile(schema);
const validateCharacterSchema = ajv.compile(characterSchema);

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
  assertSchema(validateSchema, config, {
    code: 'CONFIG_SCHEMA_INVALID',
    message: 'La configuración de escena no cumple el contrato versión 1.',
    suggestedAction: 'Revise los campos requeridos, tipos y límites indicados por el validador.',
  });

  if (config.blink.minIntervalSeconds > config.blink.maxIntervalSeconds) {
    semanticError('/blink/minIntervalSeconds', 'no puede ser mayor que /blink/maxIntervalSeconds');
  }
  if (config.mouth.silenceThresholdNormalized >= config.mouth.openThresholdNormalized) {
    semanticError('/mouth/silenceThresholdNormalized', 'debe ser menor que /mouth/openThresholdNormalized');
  }
  validateGestureOrder(config.gestures || []);
  resolveConfiguredAssets(config, context);
  return config;
}

export function validateMeasuredDuration(config, durationSeconds) {
  const frameCount = Math.ceil(durationSeconds * config.video.fps);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > SCENE_LIMITS.maxAudioDurationSeconds) {
    throw new PipelineError({
      code: 'AUDIO_DURATION_OUT_OF_RANGE',
      stage: 'analyzing_audio',
      message: `La voz debe durar más de 0 y como máximo ${SCENE_LIMITS.maxAudioDurationSeconds} segundos.`,
      technicalDetail: `durationSeconds=${durationSeconds}`,
      suggestedAction: 'Reduzca el texto o ajuste la velocidad de la voz.',
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
  if (config.subtitle.startSeconds > durationSeconds) {
    throw new PipelineError({
      code: 'SUBTITLE_START_AFTER_AUDIO',
      stage: 'analyzing_audio',
      message: 'El subtítulo comienza después de que termina el audio.',
      technicalDetail: `startSeconds=${config.subtitle.startSeconds}; durationSeconds=${durationSeconds}`,
      suggestedAction: 'Ajuste subtitle.startSeconds dentro de la duración medida del WAV.',
    });
  }
  for (const [index, gesture] of (config.gestures || []).entries()) {
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
    assertPortableRelativePath(config.characterManifest, '/characterManifest');
    const manifestFile = resolveAsset(context, config.characterManifest, 'characterManifest');
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
    assertSchema(validateCharacterSchema, manifest, {
      code: 'CHARACTER_MANIFEST_SCHEMA_INVALID',
      message: 'El manifest del personaje no cumple el contrato versión 1.',
      suggestedAction: 'Revise ID, canvas, pivot, capas y procedencia del personaje.',
    });
    const manifestDirectory = path.posix.dirname(config.characterManifest);
    const layers = {
      body: manifest.layers.body,
      eyesOpen: manifest.layers.eyes.open,
      eyesClosed: manifest.layers.eyes.closed,
      mouthClosed: manifest.layers.mouth.closed,
      mouthMedium: manifest.layers.mouth.medium,
      mouthOpen: manifest.layers.mouth.open,
      handNeutral: manifest.layers.hands.neutral,
      handPoint: manifest.layers.hands.point,
    };
    for (const [name, relativePath] of Object.entries(layers)) {
      assertPortableRelativePath(relativePath, `/characterManifest/layers/${name}`);
      resolvedAssets[name] = path.posix.join(manifestDirectory, relativePath);
    }
    characterRig = {
      id: manifest.id,
      version: manifest.version,
      manifestPath: config.characterManifest,
      pivot: manifest.pivot,
      provenance: manifest.provenance,
    };
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

function readSchema(name) {
  return JSON.parse(readFileSync(path.join(projectRoot, 'schema', name), 'utf8'));
}
