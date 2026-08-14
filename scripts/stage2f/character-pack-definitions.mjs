import path from 'node:path';
import { ensureDirectory, writeJson } from '../stage1/common.mjs';

const ellipse = (cx, cy, rx, ry, fill, extra = {}) => ({ type: 'ellipse', cx, cy, rx, ry, fill, ...extra });
const rect = (x, y, width, height, fill, extra = {}) => ({ type: 'rect', x, y, width, height, fill, ...extra });
const pathShape = (d, fill, extra = {}) => ({ type: 'path', d, fill, ...extra });
const polygon = (points, fill, extra = {}) => ({ type: 'polygon', points, fill, ...extra });

const canvas = Object.freeze({ width: 1080, height: 1920 });
const pivot = Object.freeze({ x: 540, y: 960 });
const provenance = Object.freeze({
  source: 'Diseño geométrico y rig articulado original del paquete interno de personajes V1.',
  license: 'Asset propietario original habilitado para uso comercial en el producto.',
});

function arm(id, shoulderX, shoulderY, handX, handY, sleeve, skin, direction) {
  return {
    id,
    parentId: 'torso',
    pivot: { x: shoulderX, y: shoulderY },
    zIndex: direction === 'right' ? 15 : 5,
    shapes: [
      pathShape(`M${shoulderX} ${shoulderY} Q${(shoulderX + handX) / 2} ${shoulderY + 145} ${handX} ${handY}`, 'none', {
        stroke: sleeve, strokeWidth: 92, lineCap: 'round', lineJoin: 'round',
      }),
      ellipse(handX, handY, 48, 54, skin, { stroke: '$outline', strokeWidth: 10 }),
    ],
  };
}

function poses() {
  return [
    { id: 'neutral', parts: [{ partId: 'arm_right', rotationDegrees: 0 }, { partId: 'arm_left', rotationDegrees: 0 }] },
    { id: 'point', parts: [{ partId: 'arm_right', rotationDegrees: -48 }, { partId: 'arm_left', rotationDegrees: 0 }] },
    { id: 'celebrate', parts: [{ partId: 'arm_right', rotationDegrees: -100 }, { partId: 'arm_left', rotationDegrees: 100 }] },
    { id: 'doubt', parts: [{ partId: 'arm_right', rotationDegrees: -22 }, { partId: 'arm_left', rotationDegrees: 38 }] },
    { id: 'deny', parts: [{ partId: 'arm_right', rotationDegrees: -15 }, { partId: 'arm_left', rotationDegrees: 15 }] },
  ];
}

function animationContract() {
  return {
    parameters: [
      { id: 'armRaise', minimum: 0, maximum: 1, default: 0 },
      { id: 'leftArmRaise', minimum: 0, maximum: 1, default: 0 },
      { id: 'headTilt', minimum: -1, maximum: 1, default: 0 },
      { id: 'headNod', minimum: 0, maximum: 1, default: 0 },
      { id: 'bodyLean', minimum: -1, maximum: 1, default: 0 },
      { id: 'bodyBounce', minimum: 0, maximum: 1, default: 0 },
    ],
    bindings: [
      { parameterId: 'armRaise', partId: 'arm_right', channel: 'rotationDegrees', from: 0, to: -100 },
      { parameterId: 'leftArmRaise', partId: 'arm_left', channel: 'rotationDegrees', from: 0, to: 100 },
      { parameterId: 'headTilt', partId: 'head', channel: 'rotationDegrees', from: -12, to: 12 },
      { parameterId: 'headNod', partId: 'head', channel: 'offsetY', from: 0, to: 24 },
      { parameterId: 'bodyLean', partId: 'torso', channel: 'rotationDegrees', from: -8, to: 8 },
      { parameterId: 'bodyBounce', partId: 'torso', channel: 'offsetY', from: 0, to: -34 },
    ],
  };
}

function humanStates({ eyeY, leftEyeX, rightEyeX, mouthY, glasses = false }) {
  const glassesShapes = glasses ? [
    ellipse(leftEyeX, eyeY, 62, 48, 'none', { stroke: '$outline', strokeWidth: 12 }),
    ellipse(rightEyeX, eyeY, 62, 48, 'none', { stroke: '$outline', strokeWidth: 12 }),
    pathShape(`M${leftEyeX + 62} ${eyeY} H${rightEyeX - 62}`, 'none', { stroke: '$outline', strokeWidth: 12, lineCap: 'round' }),
  ] : [];
  return {
    eyes: {
      open: [
        ellipse(leftEyeX, eyeY, 19, 27, '$eye'),
        ellipse(rightEyeX, eyeY, 19, 27, '$eye'),
        ellipse(leftEyeX - 5, eyeY - 8, 5, 7, '#ffffff'),
        ellipse(rightEyeX - 5, eyeY - 8, 5, 7, '#ffffff'),
        ...glassesShapes,
      ],
      closed: [
        pathShape(`M${leftEyeX - 28} ${eyeY} Q${leftEyeX} ${eyeY + 18} ${leftEyeX + 28} ${eyeY}`, 'none', { stroke: '$outline', strokeWidth: 11, lineCap: 'round' }),
        pathShape(`M${rightEyeX - 28} ${eyeY} Q${rightEyeX} ${eyeY + 18} ${rightEyeX + 28} ${eyeY}`, 'none', { stroke: '$outline', strokeWidth: 11, lineCap: 'round' }),
        ...glassesShapes,
      ],
    },
    mouth: mouthStates(mouthY),
  };
}

function mouthStates(y) {
  return {
    closed: [pathShape(`M485 ${y} Q540 ${y + 25} 595 ${y}`, 'none', { stroke: '$outline', strokeWidth: 13, lineCap: 'round' })],
    medium: [
      ellipse(540, y + 8, 55, 29, '$mouthDark', { stroke: '$outline', strokeWidth: 10 }),
      pathShape(`M505 ${y + 15} Q540 ${y + 35} 575 ${y + 15}`, 'none', { stroke: '$tongue', strokeWidth: 9, lineCap: 'round' }),
    ],
    open: [
      ellipse(540, y + 10, 58, 52, '$mouthDark', { stroke: '$outline', strokeWidth: 11 }),
      pathShape(`M503 ${y + 30} Q540 ${y + 62} 577 ${y + 30}`, '$tongue', { stroke: '$tongue', strokeWidth: 8, lineCap: 'round' }),
    ],
    round: [ellipse(540, y + 10, 32, 42, '$mouthDark', { stroke: '$outline', strokeWidth: 11 })],
    labiodental: [
      pathShape(`M490 ${y - 2} Q540 ${y - 20} 590 ${y - 2} Q540 ${y + 27} 490 ${y - 2} Z`, '$mouthDark', { stroke: '$outline', strokeWidth: 9 }),
      pathShape(`M500 ${y - 1} H580`, 'none', { stroke: '#ffffff', strokeWidth: 9, lineCap: 'round' }),
    ],
    bilabial: [pathShape(`M490 ${y} Q540 ${y - 14} 590 ${y} Q540 ${y + 16} 490 ${y} Z`, '$tongue', { stroke: '$outline', strokeWidth: 10 })],
  };
}

function presenterDefinition() {
  const contract = animationContract();
  return {
    version: 3,
    id: 'def-presentadora-modular-v1',
    kind: 'character', canvas, pivot,
    variants: [
      { id: 'coral', outputId: 'presentadora-coral-v1', label: 'Presentadora coral', palette: {
        skin: '#d99b76', hair: '#3b2431', outfit: '#e45b62', outfitDark: '#a83e50', shirt: '#f7e8d4', pants: '#253252', shoes: '#171c2d', outline: '#241c2a', eye: '#30223a', mouthDark: '#4c2131', tongue: '#d96776', accent: '#f2c14e',
      } },
      { id: 'indigo', outputId: 'presentadora-indigo-v1', label: 'Presentadora índigo', palette: {
        skin: '#8d5c45', hair: '#171722', outfit: '#4355b9', outfitDark: '#293674', shirt: '#efe8da', pants: '#1e293b', shoes: '#111827', outline: '#151827', eye: '#171722', mouthDark: '#3d2026', tongue: '#c75a69', accent: '#5eead4',
      } },
    ],
    parts: [
      { id: 'legs', parentId: 'torso', pivot: { x: 540, y: 1160 }, zIndex: -10, shapes: [
        rect(405, 1110, 118, 410, '$pants', { rx: 54, stroke: '$outline', strokeWidth: 12 }),
        rect(557, 1110, 118, 410, '$pants', { rx: 54, stroke: '$outline', strokeWidth: 12 }),
        ellipse(455, 1510, 115, 55, '$shoes', { stroke: '$outline', strokeWidth: 12 }),
        ellipse(625, 1510, 115, 55, '$shoes', { stroke: '$outline', strokeWidth: 12 }),
      ] },
      { id: 'torso', parentId: null, pivot, zIndex: 0, shapes: [
        pathShape('M360 850 Q540 770 720 850 L760 1190 Q540 1280 320 1190 Z', '$outfit', { stroke: '$outline', strokeWidth: 15, lineJoin: 'round' }),
        pathShape('M470 835 L540 950 L610 835 L650 1165 H430 Z', '$shirt', { stroke: '$outline', strokeWidth: 10, lineJoin: 'round' }),
        pathShape('M360 855 L475 835 L540 950 L445 1015 Z', '$outfitDark', { stroke: '$outline', strokeWidth: 9 }),
        pathShape('M720 855 L605 835 L540 950 L635 1015 Z', '$outfitDark', { stroke: '$outline', strokeWidth: 9 }),
        ellipse(540, 1080, 18, 18, '$accent'),
      ] },
      arm('arm_left', 380, 900, 285, 1190, '$outfit', '$skin', 'left'),
      arm('arm_right', 700, 900, 795, 1190, '$outfit', '$skin', 'right'),
      { id: 'head', parentId: 'torso', pivot: { x: 540, y: 650 }, zIndex: 20, shapes: [
        rect(505, 800, 70, 85, '$skin', { rx: 30, stroke: '$outline', strokeWidth: 10 }),
        ellipse(540, 645, 190, 218, '$hair', { stroke: '$outline', strokeWidth: 15 }),
        ellipse(540, 675, 160, 178, '$skin', { stroke: '$outline', strokeWidth: 13 }),
        pathShape('M385 610 Q420 410 570 430 Q690 445 705 610 Q610 545 520 530 Q445 540 385 610 Z', '$hair', { stroke: '$outline', strokeWidth: 10 }),
        pathShape('M400 650 Q370 820 440 855', 'none', { stroke: '$hair', strokeWidth: 54, lineCap: 'round' }),
        pathShape('M680 650 Q710 820 640 855', 'none', { stroke: '$hair', strokeWidth: 54, lineCap: 'round' }),
        pathShape('M500 760 Q540 785 580 760', 'none', { stroke: '$skin', strokeWidth: 8, lineCap: 'round' }),
      ] },
    ],
    stateParentPartId: 'head',
    states: humanStates({ eyeY: 660, leftEyeX: 485, rightEyeX: 595, mouthY: 765 }),
    poses: poses(), parameters: contract.parameters, bindings: contract.bindings, provenance,
  };
}

function analystDefinition() {
  const contract = animationContract();
  return {
    version: 3,
    id: 'def-analista-modular-v1',
    kind: 'character', canvas, pivot,
    variants: [
      { id: 'menta', outputId: 'analista-menta-v1', label: 'Analista menta', palette: {
        skin: '#c8845f', hair: '#24323a', outfit: '#4da88d', outfitDark: '#28715f', shirt: '#edf7ef', pants: '#334155', shoes: '#18222f', outline: '#1b2730', eye: '#1c2730', mouthDark: '#54282c', tongue: '#d56a72', accent: '#f4c95d',
      } },
      { id: 'mostaza', outputId: 'analista-mostaza-v1', label: 'Analista mostaza', palette: {
        skin: '#744b38', hair: '#171717', outfit: '#d59a2f', outfitDark: '#8d611c', shirt: '#f8f1df', pants: '#293548', shoes: '#141923', outline: '#171b24', eye: '#111827', mouthDark: '#3f2022', tongue: '#bc5864', accent: '#65d6d0',
      } },
    ],
    parts: [
      { id: 'legs', parentId: 'torso', pivot: { x: 540, y: 1170 }, zIndex: -10, shapes: [
        pathShape('M370 1120 H525 L505 1515 H365 Z', '$pants', { stroke: '$outline', strokeWidth: 14, lineJoin: 'round' }),
        pathShape('M555 1120 H710 L715 1515 H575 Z', '$pants', { stroke: '$outline', strokeWidth: 14, lineJoin: 'round' }),
        ellipse(430, 1515, 120, 54, '$shoes', { stroke: '$outline', strokeWidth: 12 }),
        ellipse(650, 1515, 120, 54, '$shoes', { stroke: '$outline', strokeWidth: 12 }),
      ] },
      { id: 'torso', parentId: null, pivot, zIndex: 0, shapes: [
        pathShape('M310 865 Q540 760 770 865 L735 1205 Q540 1285 345 1205 Z', '$outfit', { stroke: '$outline', strokeWidth: 16, lineJoin: 'round' }),
        pathShape('M450 820 H630 L650 1145 Q540 1190 430 1145 Z', '$shirt', { stroke: '$outline', strokeWidth: 10 }),
        pathShape('M420 835 L500 930 L450 1010 L355 875 Z', '$outfitDark', { stroke: '$outline', strokeWidth: 9 }),
        pathShape('M660 835 L580 930 L630 1010 L725 875 Z', '$outfitDark', { stroke: '$outline', strokeWidth: 9 }),
        rect(475, 1035, 130, 88, '$accent', { rx: 18, stroke: '$outline', strokeWidth: 8 }),
      ] },
      arm('arm_left', 340, 910, 255, 1195, '$outfit', '$skin', 'left'),
      arm('arm_right', 740, 910, 825, 1195, '$outfit', '$skin', 'right'),
      { id: 'head', parentId: 'torso', pivot: { x: 540, y: 660 }, zIndex: 20, shapes: [
        rect(500, 800, 80, 90, '$skin', { rx: 28, stroke: '$outline', strokeWidth: 10 }),
        ellipse(540, 660, 205, 205, '$skin', { stroke: '$outline', strokeWidth: 15 }),
        pathShape('M345 610 Q355 420 540 420 Q725 420 735 610 Q665 545 590 525 Q475 555 345 610 Z', '$hair', { stroke: '$outline', strokeWidth: 12 }),
        pathShape('M405 780 Q540 870 675 780 Q635 880 540 895 Q445 880 405 780 Z', '$hair', { stroke: '$outline', strokeWidth: 10 }),
        ellipse(540, 745, 20, 26, '$skin', { stroke: '$outline', strokeWidth: 6 }),
      ] },
    ],
    stateParentPartId: 'head',
    states: humanStates({ eyeY: 650, leftEyeX: 475, rightEyeX: 605, mouthY: 775, glasses: true }),
    poses: poses(), parameters: contract.parameters, bindings: contract.bindings, provenance,
  };
}

function robotStates() {
  return {
    eyes: {
      open: [ellipse(475, 650, 30, 38, '$eye'), ellipse(605, 650, 30, 38, '$eye'), ellipse(466, 638, 8, 11, '#ffffff'), ellipse(596, 638, 8, 11, '#ffffff')],
      closed: [
        pathShape('M440 650 H510', 'none', { stroke: '$eye', strokeWidth: 16, lineCap: 'round' }),
        pathShape('M570 650 H640', 'none', { stroke: '$eye', strokeWidth: 16, lineCap: 'round' }),
      ],
    },
    mouth: {
      closed: [pathShape('M475 760 H605', 'none', { stroke: '$eye', strokeWidth: 14, lineCap: 'round' })],
      medium: [rect(475, 735, 130, 52, '$mouthDark', { rx: 22, stroke: '$outline', strokeWidth: 8 }), rect(505, 758, 70, 9, '$tongue', { rx: 4 })],
      open: [rect(480, 720, 120, 88, '$mouthDark', { rx: 30, stroke: '$outline', strokeWidth: 9 }), rect(505, 774, 70, 13, '$tongue', { rx: 6 })],
      round: [ellipse(540, 760, 37, 45, '$mouthDark', { stroke: '$outline', strokeWidth: 9 })],
      labiodental: [rect(485, 735, 110, 48, '$mouthDark', { rx: 18, stroke: '$outline', strokeWidth: 8 }), pathShape('M500 750 H580', 'none', { stroke: '#ffffff', strokeWidth: 9, lineCap: 'round' })],
      bilabial: [pathShape('M480 755 Q540 735 600 755 Q540 780 480 755 Z', '$tongue', { stroke: '$outline', strokeWidth: 9 })],
    },
  };
}

function robotDefinition() {
  const contract = animationContract();
  return {
    version: 3,
    id: 'def-robot-asistente-v1',
    kind: 'character', canvas, pivot,
    variants: [
      { id: 'cian', outputId: 'robot-asistente-cian-v1', label: 'Robot asistente cian', palette: {
        body: '#d8e6ed', bodyDark: '#7c95a3', panel: '#17233b', accent: '#22d3ee', outline: '#172033', eye: '#67e8f9', mouthDark: '#101827', tongue: '#f472b6', metal: '#91a9b6', wheels: '#273449',
      } },
      { id: 'lima', outputId: 'robot-asistente-lima-v1', label: 'Robot asistente lima', palette: {
        body: '#e7edd8', bodyDark: '#8f9c68', panel: '#26321d', accent: '#a3e635', outline: '#202719', eye: '#bef264', mouthDark: '#182012', tongue: '#fb7185', metal: '#a7b489', wheels: '#303928',
      } },
    ],
    parts: [
      { id: 'legs', parentId: 'torso', pivot: { x: 540, y: 1200 }, zIndex: -10, shapes: [
        rect(405, 1160, 105, 290, '$metal', { rx: 45, stroke: '$outline', strokeWidth: 13 }),
        rect(570, 1160, 105, 290, '$metal', { rx: 45, stroke: '$outline', strokeWidth: 13 }),
        ellipse(455, 1460, 120, 68, '$wheels', { stroke: '$outline', strokeWidth: 13 }),
        ellipse(625, 1460, 120, 68, '$wheels', { stroke: '$outline', strokeWidth: 13 }),
      ] },
      { id: 'torso', parentId: null, pivot, zIndex: 0, shapes: [
        rect(330, 840, 420, 420, '$body', { rx: 110, stroke: '$outline', strokeWidth: 17 }),
        rect(405, 930, 270, 185, '$panel', { rx: 42, stroke: '$outline', strokeWidth: 12 }),
        ellipse(480, 1015, 25, 25, '$accent'), ellipse(540, 1015, 25, 25, '$bodyDark'), ellipse(600, 1015, 25, 25, '$accent'),
        pathShape('M430 1170 H650', 'none', { stroke: '$bodyDark', strokeWidth: 18, lineCap: 'round' }),
      ] },
      arm('arm_left', 350, 925, 250, 1190, '$metal', '$body', 'left'),
      arm('arm_right', 730, 925, 830, 1190, '$metal', '$body', 'right'),
      { id: 'head', parentId: 'torso', pivot: { x: 540, y: 650 }, zIndex: 20, shapes: [
        rect(485, 805, 110, 85, '$metal', { rx: 30, stroke: '$outline', strokeWidth: 11 }),
        rect(335, 440, 410, 405, '$body', { rx: 115, stroke: '$outline', strokeWidth: 17 }),
        rect(390, 545, 300, 255, '$panel', { rx: 72, stroke: '$outline', strokeWidth: 12 }),
        pathShape('M540 440 V335', 'none', { stroke: '$metal', strokeWidth: 22, lineCap: 'round' }),
        ellipse(540, 315, 42, 42, '$accent', { stroke: '$outline', strokeWidth: 10 }),
        rect(370, 580, 24, 160, '$accent', { rx: 12, opacity: 0.65 }),
        rect(686, 580, 24, 160, '$accent', { rx: 12, opacity: 0.65 }),
      ] },
    ],
    stateParentPartId: 'head',
    states: robotStates(),
    poses: poses(), parameters: contract.parameters, bindings: contract.bindings, provenance,
  };
}

export const CHARACTER_PACK_DEFINITIONS = Object.freeze([
  presenterDefinition(),
  analystDefinition(),
  robotDefinition(),
]);

export function writeCharacterPackDefinitions(definitionsRoot) {
  ensureDirectory(definitionsRoot);
  return CHARACTER_PACK_DEFINITIONS.map((definition) => {
    const file = path.join(definitionsRoot, `${definition.id.replace(/^def-/u, '')}.json`);
    writeJson(file, definition);
    return { definition, file };
  });
}
