export interface CompositorTransform {
  kind: 'translate' | 'scale' | 'rotate';
  x: number;
  y: number;
  factor?: number;
  degrees?: number;
}

export interface CompositorSprite {
  id: string;
  src: string;
  zIndex: number;
  opacity: number;
  transforms: CompositorTransform[];
}

export function buildResourceSprites(
  manifest: any,
  options?: {
    params?: Record<string, number>;
    poseId?: string | null;
    states?: Record<string, string>;
  },
): CompositorSprite[];

export function buildFrame(video: any, placements: any[]): {
  width: number;
  height: number;
  sprites: CompositorSprite[];
};

export function resolveBindingChannel(parameter: any, binding: any, value: number): number;
export function partRotationDegrees(
  manifest: any,
  partId: string,
  params: Record<string, number>,
  poseId: string | null,
): number;
