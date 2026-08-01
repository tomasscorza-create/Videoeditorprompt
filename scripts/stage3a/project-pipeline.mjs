import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ensureDirectory, ffprobe, isMain, projectRoot, readJson, run, writeJson } from '../stage1/common.mjs';
import { PipelineError, serializeError } from '../stage1/errors.mjs';
import { createJobContext } from '../stage1/job-context.mjs';
import { runPipeline } from '../stage1/pipeline.mjs';
import { createProgressReporter } from '../stage1/progress.mjs';
import { compileVideoProject } from './compile-video-project.mjs';
import { createProjectCompilationContext } from './project-compilation-context.mjs';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRenderedProjectSchema = ajv.compile(readJson(path.join(projectRoot, 'schema', 'rendered-project.schema.json')));

export async function runProjectPipeline(context) {
  const verificationMode = context.args?.['verification-mode'] === 'interactive' ? 'interactive' : 'full';
  const report = createProgressReporter(context);
  try {
    const compiled = compileVideoProject(context, { report, emitCompleted: false });
    const sceneRuns = await renderCompiledScenes(context, compiled.manifest, report, verificationMode);
    const assemblyPlan = buildAssemblyPlan(sceneRuns.map((scene, index) => ({
      id: scene.id,
      renderDurationSeconds: scene.renderDurationSeconds,
      transitionToNext: compiled.manifest.scenes[index].transitionToNext,
    })));
    const runNumbers = verificationMode === 'full' ? [1, 2] : [1];
    const outputs = runNumbers.map((runNumber) => assembleProjectRun(context, sceneRuns, assemblyPlan, runNumber, report));
    const verification = verifyProjectRender(context, compiled.manifest, sceneRuns, assemblyPlan, outputs, verificationMode);
    const manifest = {
      version: 2,
      jobId: context.jobId,
      projectId: compiled.manifest.projectId,
      compiledProject: 'compiled/compiled-project.json',
      compiledSemanticHash: compiled.manifest.semanticHash,
      verificationMode,
      video: compiled.manifest.video,
      timeline: {
        durationSeconds: assemblyPlan.durationSeconds,
        scenes: assemblyPlan.scenes.map((timelineScene, index) => ({
          index,
          id: timelineScene.id,
          sceneJobId: sceneRuns[index].sceneJobId,
          config: sceneRuns[index].config,
          runtime: sceneRuns[index].runtime,
          render1: sceneRuns[index].render1,
          ...(sceneRuns[index].render2 ? { render2: sceneRuns[index].render2 } : {}),
          audioDurationSeconds: sceneRuns[index].audioDurationSeconds,
          renderDurationSeconds: sceneRuns[index].renderDurationSeconds,
          startSeconds: timelineScene.startSeconds,
          endSeconds: timelineScene.endSeconds,
          turns: buildRenderedTurnTimeline(
            sceneRuns[index].turns,
            timelineScene.startSeconds,
            sceneRuns[index].audioDurationSeconds,
          ),
          verificationPassed: sceneRuns[index].verificationPassed,
          ...(timelineScene.transitionToNext ? { transitionToNext: timelineScene.transitionToNext } : {}),
        })),
      },
      outputs: outputs.map(({ probe, ...output }) => output),
      deterministic: verificationMode === 'full' && outputs[0].sha256 === outputs[1].sha256,
      verification: 'verification.json',
    };
    assertRenderedManifest(manifest);
    writeJson(path.join(context.resultRoot, 'project-manifest.json'), manifest);
    report('completed', {
      stage: 'project_pipeline',
      result: 'project-manifest.json',
      scenes: sceneRuns.length,
      durationSeconds: assemblyPlan.durationSeconds,
      deterministic: manifest.deterministic,
      passed: verification.passed,
    });
    return { manifest, verification };
  } catch (error) {
    report('failed', serializeError(error, 'project_pipeline'));
    throw error;
  }
}

async function renderCompiledScenes(context, compiledManifest, report, verificationMode) {
  const sceneWorkRoot = ensureDirectory(path.join(context.jobRoot, 'scene-work'));
  const sceneOutputRoot = ensureDirectory(path.join(context.jobRoot, 'scene-output'));
  const renderedScenes = [];
  for (const [index, scene] of compiledManifest.scenes.entries()) {
    const sceneJobId = createSceneJobId(index, scene.id);
    const configPath = resolveWithin(context.jobRoot, scene.config, `configuración de ${scene.id}`);
    report('preparing', { stage: 'rendering_scene', sceneId: scene.id, sceneIndex: index, sceneJobId });
    const sceneContext = createJobContext({
      'job-id': sceneJobId,
      config: configPath,
      'assets-dir': context.assetsRoot,
      'work-dir': sceneWorkRoot,
      'output-dir': sceneOutputRoot,
      'tts-root': context.ttsRoot,
    });
    const result = await runPipeline(sceneContext, { verificationMode });
    const runtime = readJson(path.join(sceneContext.runtimeRoot, 'scene-runtime.json'));
    if (runtime.version !== 2 || typeof runtime.dialoguePath !== 'string') {
      renderedTurnError(`la escena ${scene.id} no publicó un runtime de diálogo v2`);
    }
    const dialogue = readJson(resolveWithin(
      sceneContext.generatedRoot,
      runtime.dialoguePath,
      `timeline de diálogo de ${scene.id}`,
    ));
    const metrics = readJson(path.join(sceneContext.resultRoot, 'export-metrics-1.json'));
    if (verificationMode === 'full' && !result.manifest.deterministic) {
      throw new PipelineError({
        code: 'SCENE_RENDER_NOT_DETERMINISTIC',
        stage: 'rendering_scene',
        message: `La escena ${scene.id} no produjo dos renders deterministas.`,
        suggestedAction: 'Revise el evaluador, los assets y las herramientas antes de ensamblar el proyecto.',
      });
    }
    renderedScenes.push({
      index,
      id: scene.id,
      sceneJobId,
      config: toPortable(path.relative(context.jobRoot, sceneContext.jobConfigPath)),
      runtime: toPortable(path.relative(context.jobRoot, path.join(sceneContext.runtimeRoot, 'scene-runtime.json'))),
      render1: toPortable(path.relative(context.jobRoot, path.join(sceneContext.resultRoot, 'render-1.mp4'))),
      ...(verificationMode === 'full' ? { render2: toPortable(path.relative(context.jobRoot, path.join(sceneContext.resultRoot, 'render-2.mp4')))} : {}),
      render1File: path.join(sceneContext.resultRoot, 'render-1.mp4'),
      render2File: path.join(sceneContext.resultRoot, 'render-2.mp4'),
      audioDurationSeconds: runtime.audio.durationSeconds,
      renderDurationSeconds: metrics.renderDurationSeconds,
      turns: dialogue.turns,
      verificationPassed: result.verification.passed,
    });
  }
  return renderedScenes;
}

export function buildAssemblyPlan(scenes) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new PipelineError({
      code: 'PROJECT_SCENES_EMPTY',
      stage: 'assembling_project',
      message: 'No hay escenas para ensamblar.',
      suggestedAction: 'Compile un proyecto con al menos una escena.',
    });
  }
  const filters = [];
  for (let index = 0; index < scenes.length; index += 1) {
    filters.push(`[${index}:v]fps=30,scale=1080:1920:flags=lanczos,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
    filters.push(`[${index}:a]aresample=22050,aformat=sample_fmts=fltp:sample_rates=22050:channel_layouts=mono,asetpts=PTS-STARTPTS[a${index}]`);
  }
  const timelineScenes = [{
    id: scenes[0].id,
    startSeconds: 0,
    endSeconds: roundSeconds(scenes[0].renderDurationSeconds),
  }];
  let videoLabel = 'v0';
  let audioLabel = 'a0';
  let durationSeconds = Number(scenes[0].renderDurationSeconds);

  for (let index = 1; index < scenes.length; index += 1) {
    const previous = scenes[index - 1];
    const transition = previous.transitionToNext;
    if (!transition) assemblyError(index - 1, 'falta la transición hacia la escena siguiente');
    const nextDuration = Number(scenes[index].renderDurationSeconds);
    let nextStart;
    if (transition.preset === 'fade') {
      const fadeDuration = Number(transition.durationSeconds);
      if (!(fadeDuration > 0 && fadeDuration < durationSeconds && fadeDuration < nextDuration)) {
        assemblyError(index - 1, 'el fundido debe ser menor que ambas duraciones conectadas');
      }
      nextStart = durationSeconds - fadeDuration;
      filters.push(`[${videoLabel}][v${index}]xfade=transition=fade:duration=${formatNumber(fadeDuration)}:offset=${formatNumber(nextStart)}[vj${index}]`);
      filters.push(`[${audioLabel}][a${index}]acrossfade=d=${formatNumber(fadeDuration)}:c1=tri:c2=tri[aj${index}]`);
      durationSeconds += nextDuration - fadeDuration;
    } else if (transition.preset === 'cut') {
      if (transition.durationSeconds !== 0) assemblyError(index - 1, 'un corte debe durar 0 segundos');
      nextStart = durationSeconds;
      filters.push(`[${videoLabel}][v${index}]concat=n=2:v=1:a=0[vj${index}]`);
      filters.push(`[${audioLabel}][a${index}]concat=n=2:v=0:a=1[aj${index}]`);
      durationSeconds += nextDuration;
    } else {
      assemblyError(index - 1, `transición desconocida: ${transition.preset}`);
    }
    const previousTimeline = timelineScenes[index - 1];
    previousTimeline.transitionToNext = {
      ...transition,
      startSeconds: roundSeconds(nextStart),
      endSeconds: roundSeconds(nextStart + transition.durationSeconds),
    };
    timelineScenes.push({
      id: scenes[index].id,
      startSeconds: roundSeconds(nextStart),
      endSeconds: roundSeconds(nextStart + nextDuration),
    });
    videoLabel = `vj${index}`;
    audioLabel = `aj${index}`;
  }
  return {
    filters,
    videoLabel,
    audioLabel,
    durationSeconds: roundSeconds(durationSeconds),
    scenes: timelineScenes,
  };
}

export function buildRenderedTurnTimeline(turns, sceneStartSeconds, audioDurationSeconds) {
  if (!Array.isArray(turns) || turns.length < 2 || turns.length > 20) {
    renderedTurnError('la escena debe contener entre 2 y 20 turnos medidos');
  }
  if (!Number.isFinite(sceneStartSeconds) || sceneStartSeconds < 0) {
    renderedTurnError('el inicio de escena no es válido');
  }
  if (!Number.isFinite(audioDurationSeconds) || audioDurationSeconds <= 0) {
    renderedTurnError('la duración de audio de escena no es válida');
  }

  let expectedStart = 0;
  const renderedTurns = turns.map((turn, index) => {
    const startSeconds = Number(turn.startSeconds);
    const endSeconds = Number(turn.endSeconds);
    const durationSeconds = Number(turn.durationSeconds);
    const gapAfterSeconds = Number(turn.gapAfterSeconds);
    if (
      typeof turn.id !== 'string'
      || typeof turn.speakerId !== 'string'
      || !Number.isFinite(startSeconds)
      || !Number.isFinite(endSeconds)
      || !Number.isFinite(durationSeconds)
      || !Number.isFinite(gapAfterSeconds)
      || startSeconds < 0
      || durationSeconds <= 0
      || gapAfterSeconds < 0
      || gapAfterSeconds > 5
      || Math.abs(startSeconds - expectedStart) > 1e-6
      || Math.abs(endSeconds - (startSeconds + durationSeconds)) > 1e-6
    ) {
      renderedTurnError(`el turno ${index + 1} tiene tiempos medidos inconsistentes`);
    }
    expectedStart = endSeconds + gapAfterSeconds;
    return {
      id: turn.id,
      speakerId: turn.speakerId,
      startSeconds: roundSeconds(sceneStartSeconds + startSeconds),
      endSeconds: roundSeconds(sceneStartSeconds + endSeconds),
      durationSeconds: roundSeconds(durationSeconds),
      gapAfterSeconds: roundSeconds(gapAfterSeconds),
    };
  });

  if (Math.abs(expectedStart - audioDurationSeconds) > 0.02) {
    renderedTurnError('los turnos medidos no cubren la duración del audio de escena');
  }
  return renderedTurns;
}

function assembleProjectRun(context, sceneRuns, plan, runNumber, report) {
  const renderId = `render-${runNumber}`;
  report('encoding', { stage: 'assembling_project', renderId, scenes: sceneRuns.length, durationSeconds: plan.durationSeconds });
  const inputs = sceneRuns.flatMap((scene) => ['-i', runNumber === 1 ? scene.render1File : scene.render2File]);
  const outputFile = path.join(context.resultRoot, `${renderId}.mp4`);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-y', ...inputs,
    '-filter_complex_threads', '1', '-filter_complex', plan.filters.join(';'),
    '-map', `[${plan.videoLabel}]`, '-map', `[${plan.audioLabel}]`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '22050', '-ac', '1',
    '-r', '30', '-t', formatNumber(plan.durationSeconds), '-map_metadata', '-1', '-movflags', '+faststart', outputFile,
  ], { stage: 'assembling_project', errorCode: 'FFMPEG_PROJECT_ASSEMBLY_EXIT_NONZERO' });
  const probe = ffprobe(outputFile);
  return {
    runNumber,
    file: `${renderId}.mp4`,
    sha256: fileHash(outputFile),
    bytes: statSync(outputFile).size,
    durationSeconds: Number(probe.format.duration),
    probe,
  };
}

function verifyProjectRender(context, compiledManifest, sceneRuns, plan, outputs, verificationMode = 'full') {
  const checks = [];
  const check = (name, condition, evidence) => {
    if (!condition) {
      throw new PipelineError({
        code: 'PROJECT_VERIFICATION_FAILED',
        stage: 'verifying_project',
        message: `Falló la verificación multiescena: ${name}.`,
        technicalDetail: JSON.stringify(evidence),
        suggestedAction: 'Revise los renders de escena, la timeline y el ensamblaje FFmpeg.',
      });
    }
    checks.push({ name, passed: true, evidence });
  };
  check('Cantidad de escenas consistente', sceneRuns.length === compiledManifest.scenes.length && plan.scenes.length === sceneRuns.length, sceneRuns.length);
  check('Escenas verificadas individualmente', sceneRuns.every((scene) => scene.verificationPassed > 0), sceneRuns.map((scene) => scene.verificationPassed));
  check('Duraciones medidas presentes', sceneRuns.every((scene) => scene.audioDurationSeconds > 0 && scene.renderDurationSeconds >= scene.audioDurationSeconds), sceneRuns.map((scene) => ({ audio: scene.audioDurationSeconds, render: scene.renderDurationSeconds })));
  check('Turnos medidos presentes', sceneRuns.every((scene) => Array.isArray(scene.turns) && scene.turns.length >= 2), sceneRuns.map((scene) => scene.turns?.length));
  check('Timeline termina en la duración calculada', Math.abs(plan.scenes.at(-1).endSeconds - plan.durationSeconds) < 1e-8, plan);
  for (const output of outputs) {
    const video = output.probe.streams.find((stream) => stream.codec_type === 'video');
    const audio = output.probe.streams.find((stream) => stream.codec_type === 'audio');
    check(`MP4 ${output.runNumber} H.264/AAC/yuv420p`, video?.codec_name === 'h264' && video?.pix_fmt === 'yuv420p' && audio?.codec_name === 'aac', { video, audio });
    check(`MP4 ${output.runNumber} vertical 30 fps`, video?.width === 1080 && video?.height === 1920 && video?.r_frame_rate === '30/1', video);
    check(`MP4 ${output.runNumber} duración completa`, Math.abs(output.durationSeconds - plan.durationSeconds) <= 0.08, { actual: output.durationSeconds, expected: plan.durationSeconds });
  }
  if (verificationMode === 'full') {
    check('MP4 finales binariamente idénticos', outputs[0].sha256 === outputs[1].sha256, outputs[0].sha256);
  } else {
    check('Modo interactivo produce un MP4 verificado', outputs.length === 1, outputs[0].sha256);
  }
  const result = {
    version: 1,
    jobId: context.jobId,
    verifiedAt: new Date().toISOString(),
    passed: checks.length,
    failed: 0,
    checks,
    outputs: outputs.map((output) => ({ runNumber: output.runNumber, file: output.file, sha256: output.sha256, probe: output.probe })),
  };
  writeJson(path.join(context.resultRoot, 'verification.json'), result);
  return result;
}

function assertRenderedManifest(manifest) {
  if (validateRenderedProjectSchema(manifest)) return;
  const detail = [...(validateRenderedProjectSchema.errors || [])]
    .slice(0, 12)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  throw new PipelineError({
    code: 'RENDERED_PROJECT_SCHEMA_INVALID',
    stage: 'verifying_project',
    message: 'El pipeline produjo un manifiesto multiescena incompatible.',
    technicalDetail: detail,
    suggestedAction: 'Revise el schema y el mapeo del resultado final.',
  });
}

export function resolveWithin(root, relativePath, label) {
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || relativePath.includes('\\') || relativePath.includes(':')) {
    pathError(label, relativePath);
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(resolved)) pathError(label, relativePath);
  return resolved;
}

function pathError(label, value) {
  throw new PipelineError({
    code: 'COMPILED_PROJECT_PATH_INVALID',
    stage: 'preparing',
    message: `La ruta de ${label} no es segura o no existe.`,
    technicalDetail: value,
    suggestedAction: 'Recompile el proyecto dentro del trabajo actual.',
  });
}

function assemblyError(sceneIndex, detail) {
  throw new PipelineError({
    code: 'PROJECT_TRANSITION_INVALID',
    stage: 'assembling_project',
    message: 'No se puede ensamblar una transición del proyecto.',
    technicalDetail: `/scenes/${sceneIndex} ${detail}`,
    suggestedAction: 'Use cut con duración 0 o fade menor que las dos escenas conectadas.',
  });
}

function renderedTurnError(detail) {
  throw new PipelineError({
    code: 'RENDERED_TURN_TIMELINE_INVALID',
    stage: 'verifying_project',
    message: 'No se puede publicar la timeline medida de los turnos.',
    technicalDetail: detail,
    suggestedAction: 'Revise el runtime de diálogo y las duraciones medidas antes de ensamblar el proyecto.',
  });
}

export function createSceneJobId(index, sceneId) {
  return `scene-${String(index + 1).padStart(3, '0')}-${sceneId}`.slice(0, 64);
}

function fileHash(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function formatNumber(value) {
  return String(roundSeconds(value));
}

function roundSeconds(value) {
  return Number(Number(value).toFixed(9));
}

function toPortable(value) {
  return value.split(path.sep).join('/');
}

if (isMain(import.meta.url)) {
  let context;
  try {
    context = createProjectCompilationContext();
    const result = await runProjectPipeline(context);
    process.stdout.write(`${JSON.stringify({
      version: 1,
      jobId: context.jobId,
      completed: true,
      scenes: result.manifest.timeline.scenes.length,
      durationSeconds: result.manifest.timeline.durationSeconds,
      deterministic: result.manifest.deterministic,
      passed: result.verification.passed,
    })}\n`);
  } catch (error) {
    if (!context) process.stderr.write(`${JSON.stringify({ version: 1, state: 'failed', ...serializeError(error, 'project_pipeline') })}\n`);
    process.exitCode = 1;
  }
}
