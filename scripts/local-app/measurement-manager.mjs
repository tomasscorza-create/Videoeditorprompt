// Medición liviana de un proyecto, para el servicio local.
//
// Es el hermano barato de `render-job-manager.mjs`: no produce un MP4, produce
// los tiempos. Existe porque cambiar una línea de diálogo invalida la medición
// y sin ella la interfaz no puede ubicar el cabezal, un keyframe ni un corte,
// pero recuperarla no necesita un solo cuadro dibujado.
//
// Corre en un proceso aparte, igual que el render, por dos razones: Piper se
// invoca de forma bloqueante y no puede congelar el servicio, y un fallo suyo
// no debe arrastrar al servidor.

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { ensureDirectory, projectRoot, readJson, writeJson } from '../stage1/common.mjs';
import { PipelineError } from '../stage1/errors.mjs';
import { loadAuthoringCatalog } from '../director/director-plan.mjs';
import { validateVideoProjectDocument } from '../stage3a/validate-video-project.mjs';

const MEASUREMENT_TIMEOUT_MS = 5 * 60 * 1000;

export function createMeasurementManager(options = {}) {
  const root = path.resolve(options.root || projectRoot);
  const assetsRoot = path.resolve(options.assetsRoot || path.join(root, 'public'));
  const measureRoot = ensureDirectory(path.resolve(
    options.measureRoot || path.join(root, '.local-video', 'app-measure'),
  ));
  const workRoot = path.resolve(options.workRoot || path.join(root, '.local-video', 'work'));
  const outputRoot = path.resolve(options.outputRoot || path.join(root, '.local-video', 'output'));
  const catalogProvider = options.catalogProvider
    || (() => options.catalog || loadAuthoringCatalog(assetsRoot));
  const measureScript = path.join(root, 'scripts', 'stage3a', 'measure-project.mjs');
  const spawnImpl = options.spawnImpl || spawn;
  // Una medición a la vez: comparte la caché de voz y el árbol de trabajo con el
  // render, y dos procesos escribiendo el mismo WAV no está protegido.
  let running = null;

  async function measure(project) {
    if (running) return running;
    running = run(project).finally(() => { running = null; });
    return running;
  }

  async function run(project) {
    const validated = validateVideoProjectDocument({ project, catalog: catalogProvider(), assetsRoot });
    // Un jobId estable por proyecto: medir de nuevo reaprovecha el árbol y la
    // caché en vez de acumular directorios por cada corte.
    const jobId = `measure-${sanitize(validated.project.id)}`.slice(0, 64);
    const inputDirectory = ensureDirectory(path.join(measureRoot, jobId));
    const projectFile = path.join(inputDirectory, 'project.json');
    writeJson(projectFile, project);
    // El contexto de compilación rechaza reusar un jobId con otro proyecto, y
    // acá el proyecto cambia en cada corte: el árbol anterior ya no sirve.
    rmSync(path.join(workRoot, jobId), { recursive: true, force: true });

    await execute([
      measureScript,
      `--job-id=${jobId}`,
      `--project=${projectFile}`,
      `--assets-dir=${assetsRoot}`,
      `--work-dir=${workRoot}`,
      `--output-dir=${outputRoot}`,
    ]);

    const manifest = readJson(path.join(outputRoot, jobId, 'measurement.json'));
    return {
      projectId: manifest.projectId,
      video: manifest.video,
      timeline: manifest.timeline,
    };
  }

  function execute(args) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl(process.execPath, args, {
        cwd: root,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
      child.stdout?.on('data', () => {});
      const timeout = setTimeout(() => {
        child.kill();
        reject(new PipelineError({
          code: 'MEASUREMENT_TIMEOUT',
          stage: 'measure_project',
          message: 'La medición tardó demasiado y se canceló.',
          suggestedAction: 'Revisá que el runtime de voz local esté disponible.',
        }));
      }, Number(options.measurementTimeoutMs || MEASUREMENT_TIMEOUT_MS));
      child.on('error', (error) => { clearTimeout(timeout); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) { resolve(); return; }
        reject(measurementError(stderr));
      });
    });
  }

  return { measure };
}

// El proceso hijo emite su fallo estructurado por stderr. Se reusa su código y
// su mensaje cuando llegan; si no, se informa un fallo genérico sin volcar la
// salida cruda del proceso.
function measurementError(stderr) {
  const lastLine = String(stderr).trim().split('\n').filter(Boolean).pop();
  try {
    const parsed = JSON.parse(lastLine);
    if (parsed && typeof parsed.message === 'string') {
      return new PipelineError({
        code: typeof parsed.code === 'string' ? parsed.code : 'MEASUREMENT_FAILED',
        stage: 'measure_project',
        message: parsed.message,
        ...(typeof parsed.suggestedAction === 'string' ? { suggestedAction: parsed.suggestedAction } : {}),
      });
    }
  } catch {
    // stderr no estructurado: no se propaga tal cual.
  }
  return new PipelineError({
    code: 'MEASUREMENT_FAILED',
    stage: 'measure_project',
    message: 'No se pudieron medir los tiempos del proyecto.',
    suggestedAction: 'Revisá que el runtime de voz local esté disponible y volvé a intentar.',
  });
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'proyecto';
}
