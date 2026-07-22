import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArguments, run, writeJson } from '../stage1/common.mjs';

const args = parseArguments(process.argv.slice(2));
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assetRoot = path.resolve(repositoryRoot, String(args['asset-dir'] || 'public/assets/characters/mono-presentador-v1'));
const sourceRoot = path.join(assetRoot, 'source');
mkdirSync(sourceRoot, { recursive: true });
const browserExecutable = [
  process.env.LOCAL_VIDEO_CHROMIUM,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((candidate) => candidate && existsSync(candidate));
if (!browserExecutable) throw new Error('No se encontró Chrome/Edge. Configure LOCAL_VIDEO_CHROMIUM para generar los PNG.');
const browserProfile = mkdtempSync(path.join(tmpdir(), 'local-video-stage2c-'));

const outline = '#24150f';
const fur = '#9a5636';
const lightFur = '#d89a69';
const suit = '#24385f';
const shirt = '#f4e9d9';
const accent = '#e35b55';

const svg = (content, background = false) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  ${background ? '<rect width="1080" height="1920" fill="#111b36"/>' : ''}
  ${content}
</svg>`;

const layers = {
  background: svg(`
    <rect width="1080" height="1920" fill="#111b36"/>
    <circle cx="870" cy="250" r="290" fill="#1f3568"/>
    <circle cx="150" cy="470" r="250" fill="#172953"/>
    <rect x="70" y="135" width="940" height="1370" rx="58" fill="#16274d" stroke="#6ac6cf" stroke-width="7"/>
    <rect x="115" y="185" width="850" height="480" rx="38" fill="#203a73"/>
    <path d="M160 570 C300 420 395 550 520 375 S750 455 920 290" fill="none" stroke="#7ee1d9" stroke-width="18" stroke-linecap="round"/>
    <circle cx="520" cy="375" r="22" fill="#ffd263"/><circle cx="920" cy="290" r="22" fill="#ffd263"/>
    <rect x="115" y="710" width="255" height="315" rx="30" fill="#1c315f"/>
    <rect x="405" y="710" width="255" height="315" rx="30" fill="#1c315f"/>
    <rect x="695" y="710" width="270" height="315" rx="30" fill="#1c315f"/>
    <path d="M160 865 h160 M450 820 h165 M740 910 h180" stroke="#e35b55" stroke-width="22" stroke-linecap="round"/>
    <path d="M160 925 h115 M450 885 h120 M740 835 h135" stroke="#ffd263" stroke-width="18" stroke-linecap="round"/>
    <rect x="0" y="1505" width="1080" height="415" fill="#0c142a"/>
    <path d="M0 1510 H1080" stroke="#6ac6cf" stroke-width="8"/>
  `, true),
  body: svg(`
    <ellipse cx="540" cy="1440" rx="260" ry="55" fill="#0a1020" opacity="0.35"/>
    <path d="M438 1260 C385 1335 375 1410 405 1450 L490 1450 C500 1380 505 1325 515 1260 Z" fill="${suit}" stroke="${outline}" stroke-width="16"/>
    <path d="M565 1260 C575 1325 585 1380 590 1450 L675 1450 C705 1410 695 1335 642 1260 Z" fill="${suit}" stroke="${outline}" stroke-width="16"/>
    <ellipse cx="447" cy="1452" rx="75" ry="30" fill="${outline}"/>
    <ellipse cx="633" cy="1452" rx="75" ry="30" fill="${outline}"/>
    <path d="M350 950 C315 1050 320 1215 390 1320 C470 1365 610 1365 690 1320 C760 1215 765 1050 730 950 C645 900 435 900 350 950 Z" fill="${suit}" stroke="${outline}" stroke-width="18"/>
    <path d="M470 935 L540 1065 L610 935 C575 920 505 920 470 935 Z" fill="${shirt}" stroke="${outline}" stroke-width="12"/>
    <path d="M520 1055 L560 1055 L582 1195 L540 1240 L498 1195 Z" fill="${accent}" stroke="${outline}" stroke-width="11"/>
    <path d="M365 980 C270 1025 238 1160 290 1250 C320 1298 373 1288 390 1240 C350 1170 365 1090 420 1045 Z" fill="${fur}" stroke="${outline}" stroke-width="18"/>
    <ellipse cx="305" cy="1270" rx="55" ry="62" fill="${lightFur}" stroke="${outline}" stroke-width="15"/>
    <ellipse cx="325" cy="650" rx="115" ry="142" fill="${fur}" stroke="${outline}" stroke-width="18"/>
    <ellipse cx="755" cy="650" rx="115" ry="142" fill="${fur}" stroke="${outline}" stroke-width="18"/>
    <ellipse cx="325" cy="650" rx="63" ry="82" fill="${lightFur}" stroke="${outline}" stroke-width="12"/>
    <ellipse cx="755" cy="650" rx="63" ry="82" fill="${lightFur}" stroke="${outline}" stroke-width="12"/>
    <path d="M365 500 C420 410 650 405 715 500 C780 595 752 815 650 900 C590 950 490 950 430 900 C328 815 300 595 365 500 Z" fill="${fur}" stroke="${outline}" stroke-width="20"/>
    <path d="M405 500 C455 430 625 430 675 500 C635 485 590 480 540 480 C490 480 445 485 405 500 Z" fill="${outline}"/>
    <path d="M390 690 C410 590 670 590 690 690 C715 810 635 895 540 895 C445 895 365 810 390 690 Z" fill="${lightFur}" stroke="${outline}" stroke-width="14"/>
    <ellipse cx="540" cy="740" rx="42" ry="32" fill="#4b2c22"/>
    <path d="M510 743 Q540 770 570 743" fill="none" stroke="${outline}" stroke-width="10" stroke-linecap="round"/>
  `),
  eyes_open: svg(`
    <ellipse cx="475" cy="620" rx="48" ry="58" fill="#fffaf0" stroke="${outline}" stroke-width="12"/>
    <ellipse cx="605" cy="620" rx="48" ry="58" fill="#fffaf0" stroke="${outline}" stroke-width="12"/>
    <circle cx="486" cy="630" r="20" fill="${outline}"/><circle cx="616" cy="630" r="20" fill="${outline}"/>
    <circle cx="492" cy="622" r="6" fill="white"/><circle cx="622" cy="622" r="6" fill="white"/>
    <path d="M430 555 Q475 525 515 550 M565 550 Q610 525 650 555" fill="none" stroke="${outline}" stroke-width="14" stroke-linecap="round"/>
  `),
  eyes_closed: svg(`
    <path d="M430 625 Q475 655 520 625 M560 625 Q605 655 650 625" fill="none" stroke="${outline}" stroke-width="16" stroke-linecap="round"/>
    <path d="M430 555 Q475 525 515 550 M565 550 Q610 525 650 555" fill="none" stroke="${outline}" stroke-width="14" stroke-linecap="round"/>
  `),
  mouth_closed: svg(`<path d="M478 815 Q540 840 602 815" fill="none" stroke="${outline}" stroke-width="15" stroke-linecap="round"/>`),
  mouth_medium: svg(`
    <ellipse cx="540" cy="820" rx="63" ry="30" fill="#481f25" stroke="${outline}" stroke-width="12"/>
    <path d="M498 828 Q540 850 582 828" fill="none" stroke="#ef7c78" stroke-width="10" stroke-linecap="round"/>
  `),
  mouth_open: svg(`
    <ellipse cx="540" cy="825" rx="68" ry="58" fill="#3a1720" stroke="${outline}" stroke-width="13"/>
    <path d="M495 846 Q540 878 585 846" fill="#ef7c78" stroke="#ef7c78" stroke-width="10" stroke-linecap="round"/>
  `),
  hand_neutral: svg(`
    <path d="M710 980 C810 1025 842 1160 790 1250 C760 1298 707 1288 690 1240 C730 1170 715 1090 660 1045 Z" fill="${fur}" stroke="${outline}" stroke-width="18"/>
    <ellipse cx="775" cy="1270" rx="55" ry="62" fill="${lightFur}" stroke="${outline}" stroke-width="15"/>
  `),
  hand_point: svg(`
    <path d="M710 985 C785 965 840 900 875 805 C893 758 855 725 815 755 C775 805 735 855 665 920 Z" fill="${fur}" stroke="${outline}" stroke-width="18" stroke-linejoin="round"/>
    <ellipse cx="866" cy="770" rx="53" ry="58" transform="rotate(-25 866 770)" fill="${lightFur}" stroke="${outline}" stroke-width="14"/>
    <path d="M890 744 L994 690 C1025 675 1045 715 1012 737 L915 800 Z" fill="${lightFur}" stroke="${outline}" stroke-width="14" stroke-linejoin="round"/>
    <path d="M850 765 Q875 820 915 800" fill="none" stroke="${outline}" stroke-width="11" stroke-linecap="round"/>
  `),
};

try {
  for (const [name, content] of Object.entries(layers)) {
    const sourcePath = path.join(sourceRoot, `${name}.svg`);
    const outputPath = path.join(assetRoot, `${name}.png`);
    writeFileSync(sourcePath, content, 'utf8');
    run(browserExecutable, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--default-background-color=00000000', '--window-size=1080,1920',
      `--user-data-dir=${browserProfile}`, `--screenshot=${outputPath}`, pathToFileURL(sourcePath).href,
    ], { stage: 'generating_assets', errorCode: 'BROWSER_ASSET_GENERATION_FAILED' });
  }
} finally {
  rmSync(browserProfile, { recursive: true, force: true });
}

writeJson(path.join(assetRoot, 'character.manifest.json'), {
  version: 1,
  id: 'mono-presentador-v1',
  canvas: { width: 1080, height: 1920 },
  pivot: { x: 540, y: 960 },
  layers: {
    body: 'body.png',
    eyes: { open: 'eyes_open.png', closed: 'eyes_closed.png' },
    mouth: { closed: 'mouth_closed.png', medium: 'mouth_medium.png', open: 'mouth_open.png' },
    hands: { neutral: 'hand_neutral.png', point: 'hand_point.png' },
  },
  provenance: {
    source: 'Creación vectorial determinista del proyecto; fuente SVG incluida en source/.',
    license: 'Asset original para uso interno del proyecto.',
  },
});

process.stdout.write(`${JSON.stringify({ generated: Object.keys(layers).length, assetRoot })}\n`);
