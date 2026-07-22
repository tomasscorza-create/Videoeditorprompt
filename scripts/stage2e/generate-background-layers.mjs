import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArguments, run, writeJson } from '../stage1/common.mjs';

const args = parseArguments(process.argv.slice(2));
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assetRoot = path.resolve(repositoryRoot, String(args['asset-dir'] || 'public/assets/backgrounds/studio-parallax-v1'));
const sourceRoot = path.join(assetRoot, 'source');
mkdirSync(sourceRoot, { recursive: true });
const browserExecutable = [
  process.env.LOCAL_VIDEO_CHROMIUM,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((candidate) => candidate && existsSync(candidate));
if (!browserExecutable) throw new Error('No se encontró Chrome/Edge. Configure LOCAL_VIDEO_CHROMIUM.');
const profile = mkdtempSync(path.join(tmpdir(), 'local-video-stage2e-'));
const svg = (content) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">${content}</svg>`;

const layers = {
  far: svg(`
    <rect width="1080" height="1920" fill="#0b1430"/>
    <circle cx="840" cy="275" r="230" fill="#233d79"/>
    <circle cx="840" cy="275" r="150" fill="#31559a" opacity="0.7"/>
    <path d="M0 1180 L0 740 L150 650 L275 775 L420 555 L590 720 L735 500 L900 660 L1080 545 L1080 1180 Z" fill="#142957"/>
    <path d="M0 1250 L0 930 L190 780 L350 905 L520 720 L685 880 L850 690 L1080 870 L1080 1250 Z" fill="#1a356a"/>
    <circle cx="125" cy="245" r="8" fill="#7ee1d9"/><circle cx="260" cy="365" r="6" fill="#ffd263"/>
    <circle cx="415" cy="205" r="7" fill="#7ee1d9"/><circle cx="620" cy="330" r="6" fill="#ffd263"/>
    <circle cx="965" cy="470" r="8" fill="#7ee1d9"/>
    <rect x="0" y="1180" width="1080" height="740" fill="#111f43"/>
  `),
  mid: svg(`
    <rect x="55" y="180" width="970" height="1050" rx="70" fill="#172d5c" stroke="#6ac6cf" stroke-width="9"/>
    <rect x="105" y="235" width="870" height="520" rx="42" fill="#203f7b" stroke="#315b9e" stroke-width="6"/>
    <path d="M150 650 C270 535 365 610 475 445 S700 540 930 320" fill="none" stroke="#7ee1d9" stroke-width="20" stroke-linecap="round"/>
    <circle cx="475" cy="445" r="23" fill="#ffd263"/><circle cx="930" cy="320" r="23" fill="#ffd263"/>
    <rect x="105" y="805" width="255" height="345" rx="32" fill="#1b376c"/>
    <rect x="410" y="805" width="255" height="345" rx="32" fill="#1b376c"/>
    <rect x="715" y="805" width="260" height="345" rx="32" fill="#1b376c"/>
    <path d="M150 940 h160 M455 900 h165 M760 980 h165" stroke="#e85d58" stroke-width="23" stroke-linecap="round"/>
    <path d="M150 1010 h115 M455 975 h120 M760 905 h125" stroke="#ffd263" stroke-width="19" stroke-linecap="round"/>
  `),
  front: svg(`
    <path d="M0 1530 Q180 1470 360 1530 T720 1530 T1080 1530 L1080 1920 L0 1920 Z" fill="#081127"/>
    <path d="M0 1530 Q180 1470 360 1530 T720 1530 T1080 1530" fill="none" stroke="#6ac6cf" stroke-width="10"/>
    <rect x="0" y="1730" width="1080" height="190" fill="#071022"/>
    <path d="M60 1715 H1020" stroke="#243d73" stroke-width="14"/>
    <circle cx="80" cy="330" r="55" fill="#e85d58" opacity="0.25"/>
    <circle cx="1010" cy="650" r="75" fill="#7ee1d9" opacity="0.20"/>
  `),
};

try {
  for (const [name, content] of Object.entries(layers)) {
    const source = path.join(sourceRoot, `${name}.svg`);
    const output = path.join(assetRoot, `${name}.png`);
    writeFileSync(source, content, 'utf8');
    run(browserExecutable, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--default-background-color=00000000', '--window-size=1080,1920',
      `--user-data-dir=${profile}`, `--screenshot=${output}`, pathToFileURL(source).href,
    ], { stage: 'generating_assets', errorCode: 'BROWSER_ASSET_GENERATION_FAILED' });
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}

writeJson(path.join(assetRoot, 'background.manifest.json'), {
  version: 1,
  id: 'studio-parallax-v1',
  canvas: { width: 1080, height: 1920 },
  layers: { far: 'far.png', mid: 'mid.png', front: 'front.png' },
  provenance: {
    source: 'Creación vectorial determinista del proyecto; SVG incluido en source/.',
    license: 'Asset original para uso interno del proyecto.',
  },
});
process.stdout.write(`${JSON.stringify({ generated: Object.keys(layers).length, assetRoot })}\n`);
