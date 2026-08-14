import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMain, parseArguments, projectRoot, writeJson } from '../stage1/common.mjs';
import { rasterizeSvg, withBrowserProfile } from '../stage2f/rasterizer.mjs';

const CANVAS = Object.freeze({ width: 1080, height: 1920 });
const PROVENANCE = Object.freeze({
  source: 'Creación vectorial determinista original del proyecto; SVG incluido en source/.',
  license: 'Asset propietario original habilitado para uso comercial dentro del producto.',
});

const svg = (content) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
${content.trim()}
</svg>
`;

export const BACKGROUND_PACK = Object.freeze([
  Object.freeze({
    id: 'interior-creativo-v1',
    resourceId: 'fondo-interior-creativo-v1',
    label: 'Interior creativo cálido',
    tags: Object.freeze(['interior', 'creativo', 'calido', 'parallax', 'vertical']),
    layers: Object.freeze({
      far: svg(`
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#332744"/><stop offset="1" stop-color="#19172a"/></linearGradient>
    <linearGradient id="sunset" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffcf82"/><stop offset="1" stop-color="#e36b70"/></linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#wall)"/>
  <rect x="82" y="170" width="430" height="610" rx="34" fill="#17182b" stroke="#75618b" stroke-width="12"/>
  <rect x="112" y="200" width="370" height="550" rx="18" fill="url(#sunset)"/>
  <circle cx="380" cy="350" r="112" fill="#ffe6a6" opacity=".9"/>
  <path d="M112 585 L215 470 L305 565 L390 430 L482 535 L482 750 L112 750 Z" fill="#6f4165"/>
  <path d="M112 665 L235 560 L328 645 L420 535 L482 600 L482 750 L112 750 Z" fill="#3f3157"/>
  <rect y="1240" width="1080" height="680" fill="#171522"/>
  <path d="M0 1240 H1080" stroke="#65506f" stroke-width="14"/>
  <circle cx="860" cy="250" r="170" fill="#6d537e" opacity=".25"/>
  <circle cx="925" cy="1010" r="230" fill="#e77b61" opacity=".08"/>`),
      mid: svg(`
  <rect x="620" y="210" width="360" height="720" rx="36" fill="#282039" stroke="#6f5c7e" stroke-width="9"/>
  <path d="M655 405 H945 M655 620 H945 M655 835 H945" stroke="#7d6787" stroke-width="10"/>
  <rect x="685" y="300" width="68" height="96" rx="12" fill="#f29b72"/>
  <rect x="770" y="268" width="48" height="128" rx="10" fill="#80c7be"/>
  <rect x="835" y="325" width="76" height="71" rx="10" fill="#f2d47c"/>
  <circle cx="718" cy="555" r="60" fill="#705784"/><path d="M680 555 H756 M718 517 V593" stroke="#dfc9ef" stroke-width="10"/>
  <path d="M830 592 C830 500 928 500 928 592 Z" fill="#d96f6b"/><rect x="866" y="592" width="25" height="28" fill="#9a4e5b"/>
  <rect x="125" y="895" width="325" height="250" rx="32" fill="#252137" stroke="#6f5c7e" stroke-width="8"/>
  <circle cx="230" cy="1010" r="62" fill="#73bdb8"/><path d="M320 965 H410 M320 1020 H390 M320 1075 H365" stroke="#d8cbe2" stroke-width="15" stroke-linecap="round"/>`),
      front: svg(`
  <path d="M-30 1510 Q250 1435 545 1505 T1110 1490 L1110 1920 H-30 Z" fill="#100f19"/>
  <path d="M-30 1510 Q250 1435 545 1505 T1110 1490" fill="none" stroke="#b37675" stroke-width="12"/>
  <ellipse cx="535" cy="1590" rx="415" ry="82" fill="#2a2131"/>
  <rect x="180" y="1570" width="710" height="275" rx="38" fill="#211a28"/>
  <path d="M65 1600 C45 1500 80 1410 155 1365 C205 1450 205 1540 165 1620 Z" fill="#4b8a78"/>
  <path d="M1015 1580 C1028 1475 990 1385 918 1350 C880 1440 888 1535 930 1610 Z" fill="#5ca08a"/>
  <rect x="48" y="1590" width="150" height="92" rx="30" fill="#8f5c58"/><rect x="885" y="1580" width="155" height="95" rx="30" fill="#8f5c58"/>`),
    }),
  }),
  Object.freeze({
    id: 'gradiente-editorial-v1',
    resourceId: 'fondo-gradiente-editorial-v1',
    label: 'Gradiente editorial',
    tags: Object.freeze(['gradiente', 'editorial', 'limpio', 'parallax', 'vertical']),
    layers: Object.freeze({
      far: svg(`
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#172554"/><stop offset=".48" stop-color="#4338ca"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs>
  <rect width="1080" height="1920" fill="url(#g)"/>
  <circle cx="900" cy="180" r="310" fill="#f9a8d4" opacity=".18"/>
  <circle cx="120" cy="1540" r="390" fill="#67e8f9" opacity=".14"/>
  <path d="M0 950 C250 770 445 1130 680 925 S980 700 1080 790 V1920 H0 Z" fill="#111b46" opacity=".34"/>`),
      mid: svg(`
  <g fill="none" stroke="#ffffff" opacity=".18" stroke-width="3">
    <path d="M90 0 V1920 M270 0 V1920 M450 0 V1920 M630 0 V1920 M810 0 V1920 M990 0 V1920"/>
    <path d="M0 180 H1080 M0 420 H1080 M0 660 H1080 M0 900 H1080 M0 1140 H1080 M0 1380 H1080 M0 1620 H1080"/>
  </g>
  <rect x="85" y="235" width="430" height="245" rx="46" fill="#ffffff" opacity=".11" stroke="#ffffff" stroke-width="5"/>
  <rect x="610" y="610" width="380" height="315" rx="52" fill="#ffffff" opacity=".09" stroke="#fbcfe8" stroke-width="5"/>
  <circle cx="285" cy="1065" r="150" fill="none" stroke="#67e8f9" stroke-width="28" opacity=".5"/>
  <circle cx="285" cy="1065" r="82" fill="#ffffff" opacity=".12"/>`),
      front: svg(`
  <path d="M-80 1640 C170 1420 400 1730 665 1515 S1010 1450 1160 1540 V1920 H-80 Z" fill="#0c153c" opacity=".92"/>
  <path d="M-80 1640 C170 1420 400 1730 665 1515 S1010 1450 1160 1540" fill="none" stroke="#f9a8d4" stroke-width="13" opacity=".65"/>
  <circle cx="970" cy="1320" r="95" fill="#fde68a" opacity=".22"/>
  <path d="M50 1765 H1030" stroke="#ffffff" stroke-width="5" opacity=".15"/>`),
    }),
  }),
  Object.freeze({
    id: 'escenario-abstracto-v1',
    resourceId: 'fondo-escenario-abstracto-v1',
    label: 'Escenario abstracto claro',
    tags: Object.freeze(['abstracto', 'claro', 'presentacion', 'parallax', 'vertical']),
    layers: Object.freeze({
      far: svg(`
  <rect width="1080" height="1920" fill="#f4efe5"/>
  <circle cx="875" cy="275" r="285" fill="#ff8a65" opacity=".78"/>
  <circle cx="875" cy="275" r="190" fill="#ffd27d" opacity=".9"/>
  <path d="M0 780 C235 610 375 885 575 735 S880 540 1080 695 V0 H0 Z" fill="#243b6b" opacity=".96"/>
  <path d="M0 1160 C250 1010 440 1280 690 1090 S980 1040 1080 1120 V1920 H0 Z" fill="#d8e9df"/>`),
      mid: svg(`
  <rect x="95" y="255" width="365" height="440" rx="70" fill="#fffaf0" stroke="#ef6f61" stroke-width="12"/>
  <path d="M150 580 L245 465 L330 535 L415 390" fill="none" stroke="#243b6b" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="245" cy="465" r="23" fill="#ffb85c"/><circle cx="415" cy="390" r="23" fill="#ef6f61"/>
  <path d="M725 640 C820 520 1010 585 1000 750 C990 925 760 950 675 815 C630 742 658 690 725 640 Z" fill="#56a88b" opacity=".8"/>
  <g fill="#243b6b"><circle cx="155" cy="940" r="18"/><circle cx="230" cy="940" r="18"/><circle cx="305" cy="940" r="18"/></g>
  <path d="M620 1100 h350 M670 1180 h260 M720 1260 h160" stroke="#243b6b" stroke-width="18" stroke-linecap="round" opacity=".35"/>`),
      front: svg(`
  <path d="M-40 1580 C170 1470 300 1660 515 1550 S850 1420 1120 1570 V1920 H-40 Z" fill="#233b69"/>
  <path d="M-40 1580 C170 1470 300 1660 515 1550 S850 1420 1120 1570" fill="none" stroke="#ef6f61" stroke-width="14"/>
  <path d="M70 1810 C155 1630 275 1625 350 1810 Z" fill="#ffb85c" opacity=".9"/>
  <path d="M780 1920 C815 1710 945 1640 1085 1780 V1920 Z" fill="#56a88b"/>`),
    }),
  }),
  Object.freeze({
    id: 'ciudad-nocturna-v1',
    resourceId: 'fondo-ciudad-nocturna-v1',
    label: 'Ciudad nocturna',
    tags: Object.freeze(['ciudad', 'noche', 'urbano', 'parallax', 'vertical']),
    layers: Object.freeze({
      far: svg(`
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#070d2b"/><stop offset=".62" stop-color="#26356d"/><stop offset="1" stop-color="#6b4778"/></linearGradient></defs>
  <rect width="1080" height="1920" fill="url(#sky)"/>
  <circle cx="825" cy="260" r="125" fill="#ffe9b0"/><circle cx="870" cy="225" r="125" fill="#10183c"/>
  <g fill="#b9f3ff"><circle cx="105" cy="205" r="5"/><circle cx="245" cy="350" r="7"/><circle cx="410" cy="175" r="5"/><circle cx="570" cy="390" r="6"/><circle cx="960" cy="455" r="5"/></g>
  <path d="M0 1040 L115 900 L230 1010 L355 810 L500 965 L650 760 L800 935 L930 835 L1080 970 V1320 H0 Z" fill="#151e48"/>
  <rect y="1280" width="1080" height="640" fill="#10162f"/>`),
      mid: svg(`
  <g fill="#111a38" stroke="#3e4e82" stroke-width="6">
    <path d="M35 1390 V620 H245 V1390 Z"/><path d="M265 1390 V810 H455 V1390 Z"/><path d="M475 1390 V500 H735 V1390 Z"/><path d="M755 1390 V720 H1045 V1390 Z"/>
  </g>
  <g fill="#ffd77d" opacity=".82">
    <rect x="75" y="690" width="48" height="70" rx="8"/><rect x="155" y="690" width="48" height="70" rx="8"/><rect x="75" y="810" width="48" height="70" rx="8"/><rect x="155" y="930" width="48" height="70" rx="8"/>
    <rect x="310" y="875" width="45" height="65" rx="8"/><rect x="380" y="995" width="45" height="65" rx="8"/>
    <rect x="525" y="575" width="55" height="75" rx="8"/><rect x="625" y="700" width="55" height="75" rx="8"/><rect x="525" y="840" width="55" height="75" rx="8"/>
    <rect x="805" y="790" width="55" height="70" rx="8"/><rect x="900" y="910" width="55" height="70" rx="8"/>
  </g>
  <path d="M605 500 V380 M555 380 H655" stroke="#72d7e4" stroke-width="12"/>`),
      front: svg(`
  <path d="M0 1510 C240 1460 410 1575 610 1515 S920 1455 1080 1515 V1920 H0 Z" fill="#080d20"/>
  <path d="M0 1510 C240 1460 410 1575 610 1515 S920 1455 1080 1515" fill="none" stroke="#f06a9b" stroke-width="12" opacity=".8"/>
  <path d="M-40 1710 H1120" stroke="#263664" stroke-width="46"/><path d="M-40 1710 H1120" stroke="#9fe8ee" stroke-width="5" opacity=".7"/>
  <circle cx="125" cy="1685" r="22" fill="#ffd77d"/><circle cx="930" cy="1685" r="22" fill="#f06a9b"/>`),
    }),
  }),
]);

export function generateBackgroundPack({ assetBase = path.join(projectRoot, 'public', 'assets', 'backgrounds') } = {}) {
  return withBrowserProfile(({ browserExecutable, browserProfile }) => BACKGROUND_PACK.map((definition) => {
    const assetRoot = path.join(assetBase, definition.id);
    const sourceRoot = path.join(assetRoot, 'source');
    mkdirSync(sourceRoot, { recursive: true });
    for (const [name, content] of Object.entries(definition.layers)) {
      const source = path.join(sourceRoot, `${name}.svg`);
      writeFileSync(source, content, 'utf8');
      rasterizeSvg(browserExecutable, browserProfile, source, path.join(assetRoot, `${name}.png`), CANVAS);
    }
    writeJson(path.join(assetRoot, 'background.manifest.json'), {
      version: 1,
      id: definition.id,
      canvas: CANVAS,
      layers: { far: 'far.png', mid: 'mid.png', front: 'front.png' },
      provenance: PROVENANCE,
    });
    return { id: definition.id, resourceId: definition.resourceId, assetRoot };
  }));
}

if (isMain(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const generated = generateBackgroundPack({
    assetBase: path.resolve(projectRoot, String(args['asset-dir'] || 'public/assets/backgrounds')),
  });
  process.stdout.write(`${JSON.stringify({ version: 1, generated: generated.length, backgrounds: generated }, null, 2)}\n`);
}
