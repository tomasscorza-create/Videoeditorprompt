// Renderizador de primitivas compartido entre el Creador y el compilador de
// assets (Fase 1 del plan de capacidades creativas editables).
//
// Antes existían dos implementaciones: una en `scripts/stage2f/parametric-character.mjs`
// que escribía SVG como texto para rasterizar, y otra en `src/ui/character-creator.ts`
// que creaba nodos DOM para la vista previa. Divergían en `opacity`, que el
// compilador aplicaba y la vista previa ignoraba: el personaje se veía sólido en
// el Creador y translúcido en el video.
//
// La única fuente de verdad es ahora `shapeAttributes`. Cada consumidor decide
// cómo materializar esos atributos: texto para rasterizar, nodos para la vista
// previa. El orden de los atributos es parte del contrato porque la salida SVG
// tiene que seguir siendo idéntica byte a byte para no invalidar los hashes de
// los recursos ya publicados.

/** Orden congelado de los atributos de pintura, después de la geometría. */
const PAINT_ORDER = ['fill', 'stroke', 'stroke-width', 'opacity', 'stroke-linecap', 'stroke-linejoin'];

function resolvePaint(value, palette) {
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  return palette[value.slice(1)];
}

function geometryAttributes(shape) {
  if (shape.type === 'ellipse') {
    return [['cx', shape.cx], ['cy', shape.cy], ['rx', shape.rx], ['ry', shape.ry]];
  }
  if (shape.type === 'rect') {
    // `rx` se emite siempre, incluso en 0: así lo hacía el compilador y de eso
    // dependen los hashes vigentes.
    return [['x', shape.x], ['y', shape.y], ['width', shape.width], ['height', shape.height], ['rx', shape.rx || 0]];
  }
  if (shape.type === 'path') return [['d', shape.d]];
  if (shape.type === 'polygon') {
    return [['points', shape.points.map((point) => `${point.x},${point.y}`).join(' ')]];
  }
  throw new Error(`Primitiva no soportada: ${shape.type}`);
}

function rotationCenter(shape) {
  if (shape.type === 'rect') return [shape.x + shape.width / 2, shape.y + shape.height / 2];
  if (shape.type === 'ellipse') return [shape.cx, shape.cy];
  // `path` y `polygon` no declaran rotación en el contrato de primitivas.
  return null;
}

/**
 * Atributos SVG de una primitiva, en orden congelado: geometría, pintura y
 * transformación. Devuelve pares `[nombre, valor]` para que el consumidor los
 * escriba como texto o los aplique sobre un nodo.
 */
export function shapeAttributes(shape, palette = {}) {
  const attributes = geometryAttributes(shape);
  const paint = {
    fill: resolvePaint(shape.fill, palette),
    stroke: shape.stroke !== undefined ? resolvePaint(shape.stroke, palette) : undefined,
    'stroke-width': shape.strokeWidth,
    opacity: shape.opacity,
    // Truthy y no `!== undefined`: una punta o unión vacía no se emite.
    'stroke-linecap': shape.lineCap || undefined,
    'stroke-linejoin': shape.lineJoin || undefined,
  };
  for (const name of PAINT_ORDER) {
    // `fill` va siempre porque el contrato de primitivas lo exige.
    if (name === 'fill' || paint[name] !== undefined) attributes.push([name, paint[name]]);
  }
  const center = shape.rotationDegrees ? rotationCenter(shape) : null;
  if (center) attributes.push(['transform', `rotate(${shape.rotationDegrees} ${center[0]} ${center[1]})`]);
  return attributes;
}

/** Una primitiva como etiqueta SVG autocontenida. */
export function shapeToMarkup(shape, palette = {}) {
  const attributes = shapeAttributes(shape, palette)
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
  return `<${shape.type} ${attributes}/>`;
}

/** Documento SVG completo con las primitivas ya resueltas. */
export function shapesToSvgDocument(canvas, shapes, palette = {}) {
  const body = shapes.map((shape) => `  ${shapeToMarkup(shape, palette)}`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">\n${body}\n</svg>\n`;
}
