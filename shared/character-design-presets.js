export const CHARACTER_PALETTE_KEYS = [
  'outline',
  'fur',
  'lightFur',
  'suit',
  'shirt',
  'accent',
  'white',
  'mouthDark',
  'tongue',
  'shadow',
];

export const CHARACTER_PALETTE_PRESETS = {
  azul: {
    outline: '#24150f',
    fur: '#9a5636',
    lightFur: '#d89a69',
    suit: '#24385f',
    shirt: '#f4e9d9',
    accent: '#e35b55',
    white: '#fffaf0',
    mouthDark: '#3a1720',
    tongue: '#ef7c78',
    shadow: '#0a102059',
  },
  ciruela: {
    outline: '#20151c',
    fur: '#68453d',
    lightFur: '#c78c72',
    suit: '#5a294f',
    shirt: '#fff1d6',
    accent: '#f2b84b',
    white: '#fffaf0',
    mouthDark: '#351923',
    tongue: '#ef8085',
    shadow: '#0a102059',
  },
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

export function applyCharacterDesign(baseDefinition, design, outputId) {
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
  definition.provenance = {
    source: 'Creado con el diseñador local de personajes a partir de primitivas declarativas.',
    license: 'Creación local del usuario.',
  };
  return definition;
}
