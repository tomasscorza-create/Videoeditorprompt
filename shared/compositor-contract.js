// Fase 3 del plan de capacidades creativas editables — contrato de compositor.
//
// Un compositor recibe un FRAME ya resuelto y devuelve una imagen. El frame es
// una lista plana de sprites con su cadena de transformaciones, ordenada por
// orden de dibujo. Nada de manifests, nada de tiempo, nada de anclas: eso ya se
// resolvió antes.
//
// Que el frame sea plano es lo que hace intercambiables a los backends: el mismo
// frame lo dibuja PixiJS en el navegador (vista previa y compositor headless) o
// cualquier otro motor, sin reinterpretar la jerarquía de piezas.
//
// Módulo puro: lo usan Node y el navegador.

/**
 * Valor de un canal para un valor de parámetro, según el mapeo lineal declarado
 * en el manifest v3. Fuera de rango se sujeta a los extremos; no extrapola.
 */
export function resolveBindingChannel(parameter, binding, value) {
  const clamped = Math.max(parameter.minimum, Math.min(parameter.maximum, value));
  const ratio = (clamped - parameter.minimum) / (parameter.maximum - parameter.minimum);
  return binding.from + (binding.to - binding.from) * ratio;
}

/**
 * Rotación efectiva de una pieza.
 *
 * Si un parámetro con binding la controla, ese valor REEMPLAZA la rotación de la
 * pose, con la misma regla que la Fase 0 fijó para las pistas: la animación
 * reemplaza la base, no se suma. Sin binding activo manda la pose.
 */
export function partRotationDegrees(manifest, partId, params, poseId) {
  const binding = (manifest.bindings ?? []).find((candidate) => candidate.partId === partId
    && candidate.channel === 'rotationDegrees'
    && params?.[candidate.parameterId] !== undefined);
  if (binding) {
    const parameter = manifest.parameters.find((candidate) => candidate.id === binding.parameterId);
    return resolveBindingChannel(parameter, binding, params[binding.parameterId]);
  }
  const pose = (manifest.poses ?? []).find((candidate) => candidate.id === poseId);
  return pose?.parts.find((item) => item.partId === partId)?.rotationDegrees ?? 0;
}

/** Cadena de ancestros de una pieza, de la raíz hacia la pieza. */
function ancestryOf(parts, partId) {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const chain = [];
  let current = byId.get(partId);
  while (current) {
    chain.unshift(current);
    current = current.parentId === null ? null : byId.get(current.parentId);
  }
  return chain;
}

/**
 * Sprites de un recurso v3 en un instante, listos para dibujar.
 *
 * Cada sprite lleva su cadena de rotaciones de la raíz hacia adentro: una pieza
 * hija hereda la rotación de su padre, que es lo que hace que el antebrazo
 * acompañe al hombro sin recalcular nada.
 *
 * `states` selecciona las capas que se intercambian en vez de transformarse:
 * `{ eyes: 'open', mouth: 'closed' }`. Un prop no las tiene.
 */
export function buildResourceSprites(manifest, options = {}) {
  const { params = {}, poseId = null, states = {} } = options;
  const sprites = [];

  for (const part of [...manifest.parts].sort((a, b) => a.zIndex - b.zIndex)) {
    if (part.layer === undefined) continue;
    const transforms = [];
    for (const ancestor of ancestryOf(manifest.parts, part.id)) {
      const degrees = partRotationDegrees(manifest, ancestor.id, params, poseId);
      if (degrees !== 0) transforms.push({ kind: 'rotate', degrees, x: ancestor.pivot.x, y: ancestor.pivot.y });
    }
    sprites.push({ id: part.id, src: part.layer, zIndex: part.zIndex, opacity: 1, transforms });
  }

  if (manifest.kind !== 'character') return sprites;

  // Las capas de estado se dibujan encima de todas las piezas y no rotan: en V1
  // ojos y boca viven en el plano de la cara, sin articulación propia.
  const top = Math.max(...manifest.parts.map((part) => part.zIndex)) + 1;
  const eyes = states.eyes ?? 'open';
  const mouth = states.mouth ?? 'closed';
  if (manifest.states.eyes[eyes]) {
    sprites.push({ id: `eyes:${eyes}`, src: manifest.states.eyes[eyes], zIndex: top, opacity: 1, transforms: [] });
  }
  if (manifest.states.mouth[mouth]) {
    sprites.push({ id: `mouth:${mouth}`, src: manifest.states.mouth[mouth], zIndex: top + 1, opacity: 1, transforms: [] });
  }
  return sprites;
}

/**
 * Frame completo para el compositor: sprites de todos los recursos ya colocados
 * en el lienzo, con el transform de la instancia aplicado por fuera de la
 * jerarquía de piezas.
 *
 * `placements` describe qué recursos entran y con qué transform e instantánea de
 * parámetros: `[{ manifest, basePath, transform, params, poseId, states }]`.
 */
export function buildFrame(video, placements) {
  const sprites = [];
  for (const [index, placement] of placements.entries()) {
    const { manifest, basePath = '', transform = {}, params, poseId, states } = placement;
    const instance = {
      x: transform.x ?? 0,
      y: transform.y ?? 0,
      scale: transform.scale ?? 1,
      rotationDegrees: transform.rotationDegrees ?? 0,
      opacity: transform.opacity ?? 1,
      zIndex: transform.zIndex ?? index,
    };
    for (const sprite of buildResourceSprites(manifest, { params, poseId, states })) {
      const transforms = [];
      // El transform de la instancia envuelve a la jerarquía: primero mueve y
      // escala el personaje entero, después rotan sus piezas.
      if (instance.x !== 0 || instance.y !== 0) {
        transforms.push({ kind: 'translate', x: instance.x, y: instance.y });
      }
      if (instance.scale !== 1) {
        transforms.push({ kind: 'scale', factor: instance.scale, x: manifest.pivot.x, y: manifest.pivot.y });
      }
      if (instance.rotationDegrees !== 0) {
        transforms.push({ kind: 'rotate', degrees: instance.rotationDegrees, x: manifest.pivot.x, y: manifest.pivot.y });
      }
      sprites.push({
        id: `${manifest.id}:${sprite.id}`,
        src: basePath ? `${basePath}/${sprite.src}` : sprite.src,
        // El orden de dibujo respeta primero la instancia y después la pieza.
        zIndex: instance.zIndex * 1000 + sprite.zIndex,
        opacity: instance.opacity * sprite.opacity,
        transforms: [...transforms, ...sprite.transforms],
      });
    }
  }
  sprites.sort((a, b) => (a.zIndex - b.zIndex) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { width: video.width, height: video.height, sprites };
}
