export interface ShapeCanvas {
  width: number;
  height: number;
}

export interface PrimitiveShapeBase {
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
}

export interface EllipseShape extends PrimitiveShapeBase {
  type: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotationDegrees?: number;
}

export interface RectShape extends PrimitiveShapeBase {
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  rotationDegrees?: number;
}

export interface PathShape extends PrimitiveShapeBase {
  type: 'path';
  d: string;
}

export interface PolygonShape extends PrimitiveShapeBase {
  type: 'polygon';
  points: { x: number; y: number }[];
}

export type PrimitiveShape = EllipseShape | RectShape | PathShape | PolygonShape;

/** Par `[nombre, valor]` de un atributo SVG ya resuelto. */
export type ShapeAttribute = [string, string | number | undefined];

export function shapeAttributes(
  shape: PrimitiveShape | Record<string, any>,
  palette?: Record<string, string>,
): ShapeAttribute[];

export function shapeToMarkup(
  shape: PrimitiveShape | Record<string, any>,
  palette?: Record<string, string>,
): string;

export function shapesToSvgDocument(
  canvas: ShapeCanvas,
  shapes: readonly (PrimitiveShape | Record<string, any>)[],
  palette?: Record<string, string>,
): string;

export interface ShapeGroup {
  shapes: readonly (PrimitiveShape | Record<string, any>)[];
  rotation?: { degrees: number; x: number; y: number } | null;
}

export function shapeGroupsToSvgDocument(
  canvas: ShapeCanvas,
  groups: readonly ShapeGroup[],
  palette?: Record<string, string>,
): string;
