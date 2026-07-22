import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, isMain, projectRoot, readJson, sha256, writeJson } from '../stage1/common.mjs';
import { PipelineError, serializeError } from '../stage1/errors.mjs';
import { createProgressReporter } from '../stage1/progress.mjs';
import { validateSceneConfig } from '../stage1/validate-scene-config.mjs';
import { createProjectCompilationContext } from './project-compilation-context.mjs';
import { loadAndValidateVideoProject, resolveAuthoringAsset } from './validate-video-project.mjs';

const MOUTH_DEFAULTS = Object.freeze({
  windowMs: 30,
  smoothing: 0.42,
  silenceThresholdNormalized: 0.12,
  openThresholdNormalized: 0.46,
  minStateDurationMs: 90,
});

const SUBTITLE_DEFAULTS = Object.freeze({ fontSize: 46, bottomMargin: 135 });

const MOTION_PRESETS = Object.freeze({
  'idle-calm': { bobAmplitude: 4, bobPeriodSeconds: 3.6, scalePulse: 0.003 },
  'talk-calm': { bobAmplitude: 5, bobPeriodSeconds: 3.1, scalePulse: 0.004 },
});

const CAMERA_PRESETS = Object.freeze({
  static: { fromX: 0, toX: 0, fromY: 0, toY: 0, fromZoom: 1, toZoom: 1 },
  'slow-pan': { fromX: -20, toX: 20, fromY: 3, toY: -5, fromZoom: 1, toZoom: 1.02 },
  'slow-zoom': { fromX: -2, toX: 2, fromY: 2, toY: -4, fromZoom: 1, toZoom: 1.03 },
});

const BACKGROUND_LAYER_PRESETS = Object.freeze({
  far: { baseScale: 1.08, parallaxX: 0.15, parallaxY: 0.12 },
  mid: { baseScale: 1.12, parallaxX: 0.5, parallaxY: 0.4 },
  front: { baseScale: 1.18, parallaxX: 1, parallaxY: 0.85 },
});

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateCompiledProjectSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'compiled-project.schema.json')));

export function compileVideoProject(context, options = {}) {
  const report = options.report || createProgressReporter(context);
  if (options.emitProgress !== false) report('preparing', { stage: 'compiling_project', project: 'input/project.json' });
  const loaded = loadAndValidateVideoProject({ projectPath: context.jobProjectPath, assetsRoot: context.assetsRoot });
  const { project, catalog, resources } = loaded;
  const scenesRoot = ensureDirectory(path.join(context.compiledRoot, 'scenes'));
  const compiledScenes = [];
  const pendingOutputs = [];

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const compiled = compileScene({ project, scene, sceneIndex, resources, assetsRoot: context.assetsRoot });
    validateSceneConfig(compiled.config, { assetsRoot: context.assetsRoot });
    const sceneDirectoryName = `${String(sceneIndex + 1).padStart(3, '0')}-${scene.id}`;
    const sceneRoot = path.join(scenesRoot, sceneDirectoryName);
    const configPath = path.join(sceneRoot, 'scene.config.json');
    const configSha256 = sha256(JSON.stringify(compiled.config));
    pendingOutputs.push({ sceneRoot, configPath, config: compiled.config });
    compiledScenes.push({
      index: sceneIndex,
      id: scene.id,
      title: scene.title,
      config: toPortable(path.relative(context.jobRoot, configPath)),
      configSha256,
      bindings: compiled.bindings,
      ...(scene.transitionToNext ? { transitionToNext: scene.transitionToNext } : {}),
    });
  }

  const sourceHashes = collectSourceHashes(project, resources, context.assetsRoot);
  const projectSha256 = fileHash(context.jobProjectPath);
  const catalogSha256 = fileHash(loaded.catalogPath);
  const semanticHash = sha256(JSON.stringify({
    projectSha256,
    catalogSha256,
    sourceHashes,
    scenes: compiledScenes.map(({ id, configSha256, transitionToNext }) => ({ id, configSha256, transitionToNext: transitionToNext || null })),
  }));
  const manifest = {
    version: 1,
    jobId: context.jobId,
    projectId: project.id,
    projectVersion: project.version,
    project: 'input/project.json',
    resourceCatalog: project.resourceCatalog,
    video: project.video,
    projectSha256,
    catalogSha256,
    sourceHashes,
    semanticHash,
    scenes: compiledScenes,
    compiler: {
      version: 1,
      supportedElements: ['character'],
      supportedCharacterCount: 2,
      supportedTransitions: ['cut', 'fade'],
    },
  };
  assertCompiledManifest(manifest);
  const manifestPath = path.join(context.compiledRoot, 'compiled-project.json');
  if (existsSync(manifestPath)) {
    const existing = readJson(manifestPath);
    if (existing.semanticHash !== manifest.semanticHash) {
      throw new PipelineError({
        code: 'JOB_COMPILATION_CONFLICT',
        stage: 'compiling_project',
        message: `El jobId ${context.jobId} ya conserva una compilación diferente.`,
        technicalDetail: `existing=${existing.semanticHash}; requested=${manifest.semanticHash}`,
        suggestedAction: 'Use un jobId nuevo cuando cambien el proyecto, catálogo, recursos o compilador.',
      });
    }
  }
  for (const output of pendingOutputs) {
    ensureDirectory(output.sceneRoot);
    writeJson(output.configPath, output.config);
  }
  writeJson(manifestPath, manifest);
  if (options.emitCompleted !== false) report('completed', { stage: 'compiling_project', result: 'compiled/compiled-project.json', scenes: compiledScenes.length, semanticHash });
  return { manifest, manifestPath };
}

function compileScene({ project, scene, sceneIndex, resources, assetsRoot }) {
  const unsupported = scene.elements.filter((element) => element.type !== 'character');
  if (unsupported.length > 0) {
    unsupportedScene(sceneIndex, `contiene elementos todavía no soportados por el runtime: ${unsupported.map((item) => `${item.id}:${item.type}`).join(', ')}`);
  }
  const characterElements = scene.elements.filter((element) => element.type === 'character');
  if (characterElements.length !== 2) unsupportedScene(sceneIndex, 'debe contener exactamente dos personajes para el runtime v2 actual');
  if (scene.dialogue.length < 2) unsupportedScene(sceneIndex, 'debe contener al menos dos turnos para el runtime v2 actual');

  const orderedCharacters = characterElements
    .map((element, sourceIndex) => ({ element, sourceIndex }))
    .sort((left, right) => left.element.transform.zIndex - right.element.transform.zIndex || left.sourceIndex - right.sourceIndex);
  const technicalCatalogs = new Set();
  const characters = orderedCharacters.map(({ element }, characterIndex) => {
    assertCompatibleCharacterTransform(element, sceneIndex);
    if (element.poseId !== 'neutral') unsupportedScene(sceneIndex, `el personaje ${element.id} usa pose inicial ${element.poseId}; el runtime actual solo conserva neutral fuera de los turnos`);
    const resource = resources.get(element.resourceId);
    technicalCatalogs.add(resource.characterRef.catalog);
    const motion = MOTION_PRESETS[element.animationPreset];
    if (!motion) unsupportedScene(sceneIndex, `el preset ${element.animationPreset} no tiene compilación disponible`);
    const toX = element.transform.x - project.video.width / 2;
    return {
      id: element.id,
      characterAssetId: resource.characterRef.entryId,
      transform: {
        fromX: element.transform.x <= project.video.width / 2 ? -510 : 510,
        toX,
        baseY: element.transform.y - project.video.height / 2,
        entrySeconds: [0.7, 0.85][characterIndex],
        ...motion,
        baseScale: element.transform.scale,
      },
      blink: {
        seed: stableSeed(project.seed, scene.id, element.id),
        firstSeconds: [1.1, 1.7][characterIndex],
        minIntervalSeconds: [2.4, 2.7][characterIndex],
        maxIntervalSeconds: [4.3, 4.7][characterIndex],
        durationSeconds: 0.12,
      },
    };
  });
  if (technicalCatalogs.size !== 1) unsupportedScene(sceneIndex, 'todos los personajes deben provenir del mismo catálogo técnico en 3A.1');

  const backgroundResource = resources.get(scene.background.resourceId);
  const manifestPath = resolveAuthoringAsset(assetsRoot, backgroundResource.backgroundManifest, `manifest de fondo ${backgroundResource.id}`);
  const backgroundManifest = readJson(manifestPath);
  const backgroundDirectory = path.posix.dirname(backgroundResource.backgroundManifest);
  const backgroundLayers = ['far', 'mid', 'front'].map((id) => ({
    id,
    asset: path.posix.join(backgroundDirectory, backgroundManifest.layers[id]),
    ...BACKGROUND_LAYER_PRESETS[id],
  }));
  const camera = CAMERA_PRESETS[scene.background.cameraPreset];
  if (!camera) unsupportedScene(sceneIndex, `el preset de cámara ${scene.background.cameraPreset} no tiene compilación disponible`);

  const dialogue = scene.dialogue.map((turn) => {
    const voiceResource = resources.get(turn.voiceId);
    return {
      id: turn.id,
      speakerId: turn.speakerElementId,
      text: turn.text,
      voice: {
        model: voiceResource.voice.model,
        lengthScale: voiceResource.voice.lengthScale,
        volume: voiceResource.voice.volume,
      },
      gesture: turn.gestureId,
      gapAfterSeconds: turn.gapAfterSeconds,
    };
  });
  const config = {
    version: 2,
    video: project.video,
    assets: { background: backgroundLayers[0].asset },
    assetCatalog: [...technicalCatalogs][0],
    backgroundAnimation: { layers: backgroundLayers, camera },
    characters,
    dialogue,
    mouth: { ...MOUTH_DEFAULTS },
    subtitleStyle: { ...SUBTITLE_DEFAULTS },
  };
  return {
    config,
    bindings: characters.map((character) => {
      const source = characterElements.find((element) => element.id === character.id);
      return { elementId: source.id, resourceId: source.resourceId, characterAssetId: character.characterAssetId };
    }),
  };
}

function assertCompatibleCharacterTransform(element, sceneIndex) {
  const transform = element.transform;
  if (transform.anchorX !== 0.5 || transform.anchorY !== 0.5) unsupportedScene(sceneIndex, `el personaje ${element.id} requiere ancla 0.5/0.5`);
  if (transform.rotationDegrees !== 0) unsupportedScene(sceneIndex, `el personaje ${element.id} requiere rotación 0`);
  if (transform.opacity !== 1) unsupportedScene(sceneIndex, `el personaje ${element.id} requiere opacidad 1`);
}

function unsupportedScene(sceneIndex, detail) {
  throw new PipelineError({
    code: 'PROJECT_SCENE_UNSUPPORTED',
    stage: 'compiling_project',
    message: 'Una escena usa capacidades que el runtime actual todavía no puede representar.',
    technicalDetail: `/scenes/${sceneIndex} ${detail}`,
    suggestedAction: 'Use dos personajes, diálogo medido y transforms compatibles, o espere el incremento del runtime correspondiente.',
  });
}

function assertCompiledManifest(manifest) {
  if (validateCompiledProjectSchema(manifest)) return;
  const detail = [...(validateCompiledProjectSchema.errors || [])]
    .slice(0, 12)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  throw new PipelineError({
    code: 'COMPILED_PROJECT_SCHEMA_INVALID',
    stage: 'compiling_project',
    message: 'El compilador produjo un manifiesto incompatible con su contrato.',
    technicalDetail: detail,
    suggestedAction: 'Revise el mapeo del compilador y el schema de proyecto compilado.',
  });
}

function collectSourceHashes(project, resources, assetsRoot) {
  const paths = new Set();
  for (const scene of project.scenes) {
    const background = resources.get(scene.background.resourceId);
    paths.add(background.backgroundManifest);
    for (const element of scene.elements) {
      if (element.type === 'character') paths.add(resources.get(element.resourceId).characterRef.catalog);
      if (element.type === 'image') paths.add(resources.get(element.resourceId).asset);
    }
  }
  return [...paths].sort().map((relativePath) => ({
    path: relativePath,
    sha256: fileHash(resolveAuthoringAsset(assetsRoot, relativePath, 'fuente de compilación')),
  }));
}

function stableSeed(seed, sceneId, elementId) {
  const digest = createHash('sha256').update(`${seed}:${sceneId}:${elementId}`).digest('hex');
  return Number.parseInt(digest.slice(0, 8), 16);
}

function fileHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function toPortable(value) {
  return value.split(path.sep).join('/');
}

if (isMain(import.meta.url)) {
  let context;
  let report;
  try {
    context = createProjectCompilationContext();
    report = createProgressReporter(context);
    const result = compileVideoProject(context, { report });
    process.stdout.write(`${JSON.stringify({
      version: 1,
      jobId: context.jobId,
      compiled: true,
      scenes: result.manifest.scenes.length,
      semanticHash: result.manifest.semanticHash,
    })}\n`);
  } catch (error) {
    if (context) (report || createProgressReporter(context))('failed', serializeError(error, 'compiling_project'));
    else process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'compiling_project') })}\n`);
    process.exitCode = 1;
  }
}
