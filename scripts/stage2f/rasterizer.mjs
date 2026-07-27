// Rasterizado de SVG a PNG con Chrome/Edge headless.
//
// Extraído de `parametric-character.mjs` cuando apareció el segundo consumidor
// real: el compilador de recursos v3. Antes había un solo usuario y no
// correspondía abstraerlo.
//
// El determinismo del PNG depende de estos flags, así que no se tocan sin
// verificar la guardia `stage2f:test-hash-baseline`.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';

export function resolveBrowserExecutable() {
  const executable = [
    process.env.LOCAL_VIDEO_CHROMIUM,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new PipelineError({
    code: 'BROWSER_RUNTIME_NOT_FOUND', stage: 'generating_assets',
    message: 'No se encontró Chrome/Edge para rasterizar los SVG.',
    suggestedAction: 'Configure LOCAL_VIDEO_CHROMIUM con un navegador compatible.',
  });
  return executable;
}

export function rasterizeSvg(browserExecutable, browserProfile, svgPath, pngPath, canvas) {
  run(browserExecutable, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${canvas.width},${canvas.height}`,
    // Flags de estabilidad para entornos headless/CI: sin ellos, Chrome intenta
    // registro GCM, actualización de componentes y modelos on-device por red, lo que
    // cuelga el runner hasta el timeout. No afectan el output rasterizado (determinismo).
    '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', '--disable-component-update',
    '--disable-default-apps', '--disable-extensions', '--metrics-recording-only',
    '--disable-features=OptimizationGuideModelDownloading,Translate,MediaRouter,DialMediaRouteProvider',
    `--user-data-dir=${browserProfile}`, `--screenshot=${pngPath}`, pathToFileURL(svgPath).href,
  ], { stage: 'generating_assets', errorCode: 'BROWSER_ASSET_GENERATION_FAILED' });
}

/** Ejecuta el trabajo con un perfil de navegador temporal y lo limpia siempre. */
export function withBrowserProfile(work) {
  const browserExecutable = resolveBrowserExecutable();
  const browserProfile = mkdtempSync(path.join(tmpdir(), 'local-video-stage2f-'));
  try {
    return work({ browserExecutable, browserProfile });
  } finally {
    rmSync(browserProfile, { recursive: true, force: true });
  }
}
