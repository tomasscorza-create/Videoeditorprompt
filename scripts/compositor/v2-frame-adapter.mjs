// Adaptador de una escena/runtime v2 ya evaluada al contrato plano del
// compositor. No resuelve tiempo ni reinterpreta animación: consume exactamente
// el estado de `evaluateScene` que también alimenta al backend FFmpeg.

import path from 'node:path';
import { buildFrame } from '../../shared/compositor-contract.js';
import { readResourceManifest } from '../stage2f/resource-manifest.mjs';
import { readJson } from '../stage1/common.mjs';

function backgroundSprites(video, runtime, evaluatedFrame) {
  if (!runtime.backgroundAnimation) {
    return [{
      id: 'background',
      src: runtime.assets.background,
      zIndex: -1_000_000,
      opacity: 1,
      transforms: [],
    }];
  }

  return runtime.backgroundAnimation.layers.map((layer, index) => {
    const state = evaluatedFrame.background?.layers?.find((candidate) => candidate.id === layer.id);
    if (!state) throw new Error(`El frame no contiene el estado del fondo ${layer.id}.`);
    const transforms = [];
    if (state.x !== 0 || state.y !== 0) transforms.push({ kind: 'translate', x: state.x, y: state.y });
    if (state.scale !== 1) {
      transforms.push({
        kind: 'scale',
        factor: state.scale,
        x: video.width / 2,
        y: video.height / 2,
      });
    }
    return {
      id: `background:${layer.id}`,
      src: layer.asset,
      zIndex: -1_000_000 + index,
      opacity: 1,
      transforms,
    };
  });
}

function characterManifest(assetsRoot, character, manifestCache) {
  const manifestPath = character.characterRig?.manifestPath;
  if (!manifestPath) throw new Error(`El personaje ${character.id} no conserva manifestPath en el runtime.`);
  if (manifestCache?.has(manifestPath)) return manifestCache.get(manifestPath);
  const resolved = {
    manifest: readResourceManifest(readJson(path.join(assetsRoot, manifestPath))),
    basePath: path.posix.dirname(manifestPath.replaceAll('\\', '/')),
  };
  manifestCache?.set(manifestPath, resolved);
  return resolved;
}

function resourceManifest(assetsRoot, resource, manifestCache) {
  const manifestPath = resource.resourceRig?.manifestPath;
  if (!manifestPath) throw new Error(`El recurso ${resource.id} no conserva manifestPath en el runtime.`);
  if (manifestCache?.has(manifestPath)) return manifestCache.get(manifestPath);
  const resolved = {
    manifest: readResourceManifest(readJson(path.join(assetsRoot, manifestPath))),
    basePath: path.posix.dirname(manifestPath.replaceAll('\\', '/')),
  };
  manifestCache?.set(manifestPath, resolved);
  return resolved;
}

/**
 * Convierte un frame evaluado de runtime v2 en un frame plano para PixiJS.
 *
 * `subtitleSrc` es opcional porque los subtítulos preparados viven fuera de la
 * raíz pública. El pipeline podrá materializarlos bajo la raíz aislada del
 * compositor; la comparación de backends se concentra en las capas compartidas.
 */
export function buildPixiFrameFromV2({
  video,
  runtime,
  evaluatedFrame,
  assetsRoot,
  subtitleSrc = null,
  manifestCache = null,
}) {
  const placements = runtime.characters.map((character, index) => {
    const state = evaluatedFrame.characters.find((candidate) => candidate.id === character.id);
    if (!state) throw new Error(`El frame no contiene el personaje ${character.id}.`);
    const resource = characterManifest(assetsRoot, character, manifestCache);
    const params = evaluatedFrame.elements?.[character.id]?.params ?? {};
    return {
      ...resource,
      transform: {
        x: state.character.x,
        y: state.character.y,
        scale: state.character.scale,
        rotationDegrees: params.rotationDegrees ?? 0,
        opacity: state.character.opacity,
        zIndex: index,
      },
      params,
      poseId: state.gesture,
      states: { eyes: state.eyes, mouth: state.mouth },
    };
  });
  placements.push(...(runtime.props ?? []).map((prop) => {
    const resource = resourceManifest(assetsRoot, prop, manifestCache);
    const params = evaluatedFrame.elements?.[prop.id]?.params ?? {};
    return {
      ...resource,
      transform: {
        x: params['position.x'] ?? prop.transform.x,
        y: params['position.y'] ?? prop.transform.y,
        scale: params.scale ?? prop.transform.scale,
        rotationDegrees: params.rotationDegrees ?? prop.transform.rotationDegrees,
        opacity: params.opacity ?? prop.transform.opacity,
        zIndex: prop.transform.zIndex,
      },
      params,
    };
  }));

  const frame = buildFrame(video, placements);
  frame.sprites.push(...backgroundSprites(video, runtime, evaluatedFrame));
  if (subtitleSrc) {
    frame.sprites.push({
      id: `subtitle:${evaluatedFrame.activeTurnId ?? 'none'}`,
      src: subtitleSrc,
      zIndex: 1_000_000,
      opacity: 1,
      transforms: [],
    });
  }
  frame.sprites.sort((left, right) => (left.zIndex - right.zIndex)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return frame;
}
