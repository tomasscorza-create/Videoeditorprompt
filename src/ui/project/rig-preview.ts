import {
  buildResourceSprites,
  type CompositorSprite,
  type CompositorTransform,
} from '../../../shared/compositor-contract.js';

export interface RigPreviewOptions {
  params?: Record<string, number>;
  poseId?: string | null;
  eyes?: string;
  mouth?: string;
}

interface CachedImage {
  image: HTMLImageElement;
  ready: boolean;
  failed: boolean;
}

const imageCache = new Map<string, CachedImage>();

/**
 * Vista compositable de un manifest v2 o v3.
 *
 * Es el mismo adaptador estructural que usa el pipeline: un v2 conserva cuerpo,
 * ojos, bocas y manos como capas; un v3 conserva sus piezas articuladas. No se
 * inventan parámetros continuos para un v2 porque sus brazos están horneados.
 */
export function previewResourceManifest(manifest: any): any {
  if (manifest?.version === 3) return manifest;
  if (manifest?.version !== 2) throw new Error(`Manifest de recurso no soportado: ${String(manifest?.version)}`);
  const rootJointId = manifest.joints.find((joint: any) => joint.parentId === null)?.id ?? null;
  return {
    version: 3,
    id: manifest.id,
    kind: 'character',
    canvas: manifest.canvas,
    pivot: manifest.pivot,
    sourceDefinition: manifest.sourceDefinition,
    variant: manifest.variant,
    parts: manifest.joints.map((joint: any, index: number) => ({
      id: joint.id,
      parentId: joint.parentId,
      pivot: { x: joint.pivotX, y: joint.pivotY },
      zIndex: index,
      ...(joint.id === rootJointId ? { layer: manifest.layers.body } : {}),
    })),
    states: {
      eyes: manifest.layers.eyes,
      mouth: manifest.layers.mouth,
      hands: manifest.layers.hands,
      thumbnails: manifest.layers.thumbnails,
    },
    poses: manifest.poses.map((pose: any) => ({
      id: pose.id,
      handState: pose.handState,
      parts: pose.joints.map((item: any) => ({
        partId: item.jointId,
        rotationDegrees: item.rotationDegrees,
      })),
    })),
    parameters: [],
    bindings: [],
    provenance: manifest.provenance,
  };
}

export function rigSpritePlan(
  manifest: any,
  manifestPath: string,
  options: RigPreviewOptions = {},
): CompositorSprite[] {
  const basePath = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
  return buildResourceSprites(previewResourceManifest(manifest), {
    params: options.params ?? {},
    poseId: options.poseId ?? 'neutral',
    states: { eyes: options.eyes ?? 'open', mouth: options.mouth ?? 'closed' },
  }).map((sprite) => ({ ...sprite, src: `/${basePath}${sprite.src}` }));
}

/**
 * Dibuja el plan plano con la misma jerarquía de transformaciones del
 * compositor Pixi. El canvas trabaja a media resolución para que el preview sea
 * liviano; todas las coordenadas siguen en el lienzo canónico 1080×1920.
 */
export function drawRigPreview(
  canvas: HTMLCanvasElement,
  sprites: readonly CompositorSprite[],
  requestRepaint: () => void,
): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(canvas.width / 1080, canvas.height / 1920);
  for (const sprite of sprites) {
    const cached = previewImage(sprite.src, requestRepaint);
    if (!cached?.ready || cached.failed) continue;
    context.save();
    context.globalAlpha = sprite.opacity;
    for (const transform of sprite.transforms) applyCanvasTransform(context, transform);
    context.drawImage(cached.image, 0, 0, 1080, 1920);
    context.restore();
  }
  context.restore();
}

function applyCanvasTransform(context: CanvasRenderingContext2D, transform: CompositorTransform): void {
  if (transform.kind === 'translate') {
    context.translate(transform.x, transform.y);
    return;
  }
  context.translate(transform.x, transform.y);
  if (transform.kind === 'scale') context.scale(transform.factor ?? 1, transform.factor ?? 1);
  else context.rotate((transform.degrees ?? 0) * Math.PI / 180);
  context.translate(-transform.x, -transform.y);
}

function previewImage(src: string, requestRepaint: () => void): CachedImage | null {
  const cached = imageCache.get(src);
  if (cached) return cached;
  if (typeof Image === 'undefined') return null;
  const image = new Image();
  const entry = { image, ready: false, failed: false };
  imageCache.set(src, entry);
  image.addEventListener('load', () => {
    entry.ready = true;
    requestRepaint();
  }, { once: true });
  image.addEventListener('error', () => {
    entry.failed = true;
    requestRepaint();
  }, { once: true });
  image.src = src;
  return entry;
}
