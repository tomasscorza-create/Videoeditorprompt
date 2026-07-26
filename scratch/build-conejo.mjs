import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCharacterDesign } from '../shared/character-design-presets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, '..');

const design = {
  version: 2,
  mode: 'from-scratch',
  name: 'Conejo de Traje',
  parts: [
    {
      id: 'accessory-ear-left',
      name: 'Oreja Izquierda',
      role: 'accessory',
      shape: 'ellipse',
      x: 440, y: 380, width: 80, height: 300,
      rotationDegrees: -15,
      fill: '#f0f0f0', stroke: '#111111', strokeWidth: 12
    },
    {
      id: 'accessory-ear-right',
      name: 'Oreja Derecha',
      role: 'accessory',
      shape: 'ellipse',
      x: 640, y: 380, width: 80, height: 300,
      rotationDegrees: 15,
      fill: '#f0f0f0', stroke: '#111111', strokeWidth: 12
    },
    {
      id: 'body',
      name: 'Cuerpo Traje',
      role: 'body',
      shape: 'ellipse',
      x: 540, y: 1160, width: 450, height: 550,
      rotationDegrees: 0,
      fill: '#1a1c23', stroke: '#111111', strokeWidth: 12
    },
    {
      id: 'garment-shirt',
      name: 'Camisa Blanca',
      role: 'garment',
      shape: 'rect',
      x: 540, y: 1050, width: 120, height: 280,
      rotationDegrees: 0,
      fill: '#ffffff', stroke: '#111111', strokeWidth: 12
    },
    {
      id: 'garment-tie',
      name: 'Corbata Roja',
      role: 'garment',
      shape: 'rect',
      x: 540, y: 1080, width: 40, height: 220,
      rotationDegrees: 0,
      fill: '#cc2233', stroke: '#111111', strokeWidth: 10
    },
    {
      id: 'head',
      name: 'Cabeza',
      role: 'head',
      shape: 'ellipse',
      x: 540, y: 620, width: 380, height: 420,
      rotationDegrees: 0,
      fill: '#f0f0f0', stroke: '#111111', strokeWidth: 12
    },
    {
      id: 'eye-left',
      name: 'Ojo izquierdo',
      role: 'eye-left',
      shape: 'ellipse',
      x: 475, y: 570, width: 45, height: 70,
      rotationDegrees: 0,
      fill: '#111111', stroke: '#111111', strokeWidth: 0
    },
    {
      id: 'eye-right',
      name: 'Ojo derecho',
      role: 'eye-right',
      shape: 'ellipse',
      x: 605, y: 570, width: 45, height: 70,
      rotationDegrees: 0,
      fill: '#111111', stroke: '#111111', strokeWidth: 0
    },
    {
      id: 'mouth',
      name: 'Boca Conejo',
      role: 'mouth',
      shape: 'ellipse',
      x: 540, y: 740, width: 60, height: 25,
      rotationDegrees: 0,
      fill: '#ff8899', stroke: '#111111', strokeWidth: 8
    },
    {
      id: 'arm-left',
      name: 'Manga Izquierda',
      role: 'arm-left',
      shape: 'rect',
      x: 280, y: 1100, width: 120, height: 400,
      rotationDegrees: 12,
      fill: '#1a1c23', stroke: '#111111', strokeWidth: 12
    },
    {
      id: 'arm-right',
      name: 'Manga Derecha',
      role: 'arm-right',
      shape: 'rect',
      x: 800, y: 1100, width: 120, height: 400,
      rotationDegrees: -12,
      fill: '#1a1c23', stroke: '#111111', strokeWidth: 12
    },
    {
      id: 'leg-left',
      name: 'Pantalón Izquierdo',
      role: 'leg-left',
      shape: 'rect',
      x: 440, y: 1550, width: 130, height: 380,
      rotationDegrees: 4,
      fill: '#1a1c23', stroke: '#111111', strokeWidth: 12
    },
    {
      id: 'leg-right',
      name: 'Pantalón Derecho',
      role: 'leg-right',
      shape: 'rect',
      x: 640, y: 1550, width: 130, height: 380,
      rotationDegrees: -4,
      fill: '#1a1c23', stroke: '#111111', strokeWidth: 12
    }
  ]
};

// Generate the definition
const definition = applyCharacterDesign(null, design, 'conejo-traje-v1');

// Save it to character-definitions
const destPath = path.join(repositoryRoot, 'public', 'assets', 'character-definitions', 'conejo-traje-v1.json');
if (!fs.existsSync(path.dirname(destPath))) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
}
fs.writeFileSync(destPath, JSON.stringify(definition, null, 2), 'utf8');
console.log('Definition saved to', destPath);
