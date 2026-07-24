export const CHARACTER_PALETTE_KEYS = [
  'outline', 'fur', 'lightFur', 'suit', 'shirt',
  'accent', 'white', 'mouthDark', 'tongue', 'shadow',
];

export const CHARACTER_PALETTE_PRESETS = {
  azul: {
    outline: '#24150f', fur: '#9a5636', lightFur: '#d89a69', suit: '#24385f',
    shirt: '#f4e9d9', accent: '#e35b55', white: '#fffaf0', mouthDark: '#3a1720',
    tongue: '#ef7c78', shadow: '#0a102059',
  },
  ciruela: {
    outline: '#20151c', fur: '#68453d', lightFur: '#c78c72', suit: '#5a294f',
    shirt: '#fff1d6', accent: '#f2b84b', white: '#fffaf0', mouthDark: '#351923',
    tongue: '#ef8085', shadow: '#0a102059',
  },
};

export const CUSTOM_PART_ROLE_LABELS = {
  body: 'Cuerpo',
  head: 'Cabeza',
  'eye-left': 'Ojo izquierdo',
  'eye-right': 'Ojo derecho',
  mouth: 'Boca',
  'arm-left': 'Brazo izquierdo',
  'arm-right': 'Brazo derecho',
  'leg-left': 'Pierna izquierda',
  'leg-right': 'Pierna derecha',
  garment: 'Ropa',
  accessory: 'Accesorio',
};

export const REQUIRED_CUSTOM_ROLES = [
  'body', 'head', 'eye-left', 'eye-right', 'mouth',
  'arm-left', 'arm-right', 'leg-left', 'leg-right',
];

const CUSTOM_PART_DEFAULTS = {
  body: { shape: 'ellipse', x: 540, y: 1160, width: 420, height: 540, fill: '#3f6f91' },
  head: { shape: 'ellipse', x: 540, y: 620, width: 390, height: 390, fill: '#d7976a' },
  'eye-left': { shape: 'ellipse', x: 475, y: 590, width: 72, height: 92, fill: '#fffaf0' },
  'eye-right': { shape: 'ellipse', x: 605, y: 590, width: 72, height: 92, fill: '#fffaf0' },
  mouth: { shape: 'ellipse', x: 540, y: 735, width: 125, height: 38, fill: '#401a25' },
  'arm-left': { shape: 'rect', x: 300, y: 1110, width: 125, height: 390, fill: '#d7976a', rotationDegrees: 12 },
  'arm-right': { shape: 'rect', x: 780, y: 1110, width: 125, height: 390, fill: '#d7976a', rotationDegrees: -12 },
  'leg-left': { shape: 'rect', x: 450, y: 1510, width: 145, height: 390, fill: '#27465e', rotationDegrees: 3 },
  'leg-right': { shape: 'rect', x: 630, y: 1510, width: 145, height: 390, fill: '#27465e', rotationDegrees: -3 },
  garment: { shape: 'rect', x: 540, y: 1130, width: 330, height: 330, fill: '#62437a' },
  accessory: { shape: 'ellipse', x: 650, y: 1080, width: 70, height: 70, fill: '#f0bb48' },
};

const ACCESSORY_SHAPES = {
  none: [],
  glasses: [
    { type: 'ellipse', cx: 475, cy: 620, rx: 66, ry: 72, fill: 'none', stroke: '$accent', strokeWidth: 13 },
    { type: 'ellipse', cx: 605, cy: 620, rx: 66, ry: 72, fill: 'none', stroke: '$accent', strokeWidth: 13 },
    { type: 'path', d: 'M541 615 Q540 600 539 615', fill: 'none', stroke: '$accent', strokeWidth: 13, lineCap: 'round' },
  ],
  badge: [
    { type: 'ellipse', cx: 655, cy: 1085, rx: 43, ry: 43, fill: '$accent', stroke: '$outline', strokeWidth: 10 },
    { type: 'path', d: 'M637 1085 L650 1098 L676 1068', fill: 'none', stroke: '$white', strokeWidth: 9, lineCap: 'round', lineJoin: 'round' },
  ],
};

const HEADWEAR_SHAPES = {
  none: [],
  cap: [
    { type: 'path', d: 'M367 505 C405 365 645 335 718 475 L697 520 C610 477 463 473 382 530 Z', fill: '$accent', stroke: '$outline', strokeWidth: 18, lineJoin: 'round' },
    { type: 'path', d: 'M560 480 C660 455 752 472 815 520 C730 522 650 530 585 550 Z', fill: '$accent', stroke: '$outline', strokeWidth: 16, lineJoin: 'round' },
  ],
};

export function createCustomPart(role, index = 0) {
  const preset = CUSTOM_PART_DEFAULTS[role] || CUSTOM_PART_DEFAULTS.accessory;
  return {
    id: `${role.replace(/[^a-z0-9]+/gu, '-')}-${index + 1}`,
    name: `${CUSTOM_PART_ROLE_LABELS[role] || 'Pieza'} ${index + 1}`,
    role,
    shape: preset.shape,
    x: preset.x,
    y: preset.y,
    width: preset.width,
    height: preset.height,
    rotationDegrees: preset.rotationDegrees || 0,
    fill: preset.fill,
    stroke: '#24150f',
    strokeWidth: 12,
  };
}

export function createDefaultCustomCharacterDesign() {
  return {
    version: 2,
    mode: 'from-scratch',
    name: 'Mi personaje desde cero',
    parts: REQUIRED_CUSTOM_ROLES.map((role, index) => createCustomPart(role, index)),
  };
}

export function createEmptyCustomCharacterDesign() {
  return {
    version: 2,
    mode: 'from-scratch',
    name: 'Mi personaje desde cero',
    parts: [],
  };
}

export function customCharacterDesignIssues(design) {
  if (design?.version !== 2 || design?.mode !== 'from-scratch' || !Array.isArray(design.parts)) {
    return ['El diseño desde cero no tiene una estructura válida.'];
  }
  const issues = [];
  const ids = new Set();
  for (const part of design.parts) {
    if (ids.has(part.id)) issues.push(`La pieza «${part.id}» está duplicada.`);
    ids.add(part.id);
  }
  for (const role of REQUIRED_CUSTOM_ROLES) {
    const count = design.parts.filter((part) => part.role === role).length;
    if (count === 0) {
      issues.push(`Falta la pieza funcional «${CUSTOM_PART_ROLE_LABELS[role]}».`);
    } else if (count > 1) {
      issues.push(`La función «${CUSTOM_PART_ROLE_LABELS[role]}» debe pertenecer a una sola pieza; usá Ropa o Accesorio para formas adicionales.`);
    }
  }
  return issues;
}

export function applyCharacterDesign(baseDefinition, design, outputId) {
  if (design.version === 2 && design.mode === 'from-scratch') {
    return customDesignToDefinition(design, outputId);
  }
  const definition = structuredClone(baseDefinition);
  definition.id = `def-${outputId}`;
  definition.variants = [{
    id: 'custom',
    outputId,
    label: design.name,
    palette: structuredClone(design.palette),
  }];
  definition.layers.body.push(
    ...structuredClone(HEADWEAR_SHAPES[design.headwear] || []),
    ...structuredClone(ACCESSORY_SHAPES[design.accessory] || []),
  );
  definition.provenance = provenance();
  return definition;
}

function customDesignToDefinition(design, outputId) {
  const part = (role) => design.parts.find((candidate) => candidate.role === role);
  const bodyShapes = design.parts
    .filter((candidate) => !['eye-left', 'eye-right', 'mouth', 'arm-right'].includes(candidate.role))
    .map(partToShape);
  const eyeParts = design.parts.filter((candidate) => candidate.role === 'eye-left' || candidate.role === 'eye-right');
  const mouth = part('mouth');
  const rightArm = part('arm-right');
  const head = part('head');
  const leftArm = part('arm-left');
  return {
    version: 1,
    id: `def-${outputId}`,
    canvas: { width: 1080, height: 1920 },
    pivot: { x: 540, y: 960 },
    variants: [{
      id: 'custom',
      outputId,
      label: design.name,
      palette: structuredClone(CHARACTER_PALETTE_PRESETS.azul),
    }],
    joints: [
      joint('root', null, 540, 960),
      joint('head', 'root', head.x, head.y),
      joint('shoulder_left', 'root', leftArm.x, leftArm.y),
      joint('shoulder_right', 'root', rightArm.x, rightArm.y),
    ],
    poses: [
      { id: 'neutral', handState: 'neutral', joints: [{ jointId: 'shoulder_right', rotationDegrees: rightArm.rotationDegrees }] },
      { id: 'point', handState: 'point', joints: [{ jointId: 'shoulder_right', rotationDegrees: clamp(rightArm.rotationDegrees - 55, -180, 180) }] },
    ],
    layers: {
      body: bodyShapes,
      eyes: {
        open: eyeParts.map(partToShape),
        closed: eyeParts.map((eye) => ({
          type: 'path',
          d: `M${round(eye.x - eye.width / 2)} ${round(eye.y)} Q${round(eye.x)} ${round(eye.y + eye.height / 4)} ${round(eye.x + eye.width / 2)} ${round(eye.y)}`,
          fill: 'none',
          stroke: eye.stroke,
          strokeWidth: Math.max(4, eye.strokeWidth),
          lineCap: 'round',
        })),
      },
      mouth: {
        closed: [{
          type: 'path',
          d: `M${round(mouth.x - mouth.width / 2)} ${round(mouth.y)} Q${round(mouth.x)} ${round(mouth.y + mouth.height / 2)} ${round(mouth.x + mouth.width / 2)} ${round(mouth.y)}`,
          fill: 'none',
          stroke: mouth.stroke,
          strokeWidth: Math.max(4, mouth.strokeWidth),
          lineCap: 'round',
        }],
        medium: [partToEllipse(mouth, .6)],
        open: [partToEllipse(mouth, 1.35)],
      },
      hands: {
        neutral: [partToShape(rightArm)],
        point: [partToShape({
          ...rightArm,
          y: clamp(rightArm.y - rightArm.height * .32, 0, 1920),
          rotationDegrees: clamp(rightArm.rotationDegrees - 55, -180, 180),
        })],
      },
    },
    provenance: provenance(),
  };
}

function partToShape(part) {
  if (part.shape === 'ellipse') return partToEllipse(part, 1);
  return {
    type: 'rect',
    x: round(part.x - part.width / 2),
    y: round(part.y - part.height / 2),
    width: round(part.width),
    height: round(part.height),
    rx: round(Math.min(part.width, part.height) * .35),
    fill: part.fill,
    stroke: part.stroke,
    strokeWidth: part.strokeWidth,
    rotationDegrees: part.rotationDegrees,
  };
}

function partToEllipse(part, heightScale) {
  return {
    type: 'ellipse',
    cx: round(part.x),
    cy: round(part.y),
    rx: round(part.width / 2),
    ry: round(part.height * heightScale / 2),
    fill: part.fill,
    stroke: part.stroke,
    strokeWidth: part.strokeWidth,
    rotationDegrees: part.rotationDegrees,
  };
}

function joint(id, parentId, x, y) {
  return { id, parentId, x, y, pivotX: x, pivotY: y };
}

function provenance() {
  return {
    source: 'Creado con el diseñador local de personajes a partir de primitivas declarativas.',
    license: 'Creación local del usuario.',
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
