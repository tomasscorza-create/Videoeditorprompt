import assert from 'node:assert/strict';

export async function runRepositoryContractSuite({
  backend,
  createProjectRepository,
  createResourceRepository,
  createRenderJobRepository,
  prefix,
}) {
  let passed = 0;
  const check = (condition, message) => {
    assert.ok(condition, `${backend}: ${message}`);
    passed += 1;
  };

  const projectRepository = await createProjectRepository();
  const project = sampleProject(`${prefix}-project`);
  const created = await projectRepository.save(project);
  check(created.created === true, 'proyecto creado');
  check(/^[a-f0-9]{64}$/u.test(created.revision), 'revisión SHA-256');
  const edited = await projectRepository.save(
    { ...project, title: 'Proyecto editado' },
    created.revision,
  );
  check(edited.created === false, 'proyecto actualizado');
  check(edited.revision !== created.revision, 'revisión optimista actualizada');
  check((await projectRepository.get(project.id)).project.title === 'Proyecto editado', 'proyecto recuperado');
  check(
    (await projectRepository.list()).some((summary) => (
      summary.id === project.id
      && summary.scenes === 1
      && summary.revision === edited.revision
    )),
    'resumen de proyecto listado',
  );
  await assert.rejects(
    () => projectRepository.save({ ...project, title: 'Conflicto' }, created.revision),
    (error) => error.code === 'PROJECT_REVISION_CONFLICT',
  );
  passed += 1;
  const concurrentProjectWrites = await Promise.allSettled([
    projectRepository.save({ ...project, title: 'Concurrente A' }, edited.revision),
    projectRepository.save({ ...project, title: 'Concurrente B' }, edited.revision),
  ]);
  check(
    concurrentProjectWrites.filter((result) => result.status === 'fulfilled').length === 1
      && concurrentProjectWrites.filter((result) => (
        result.status === 'rejected'
        && result.reason?.code === 'PROJECT_REVISION_CONFLICT'
      )).length === 1,
    'una sola escritura concurrente gana la revisión optimista',
  );
  await assert.rejects(
    () => projectRepository.get('../escape'),
    (error) => error.code === 'PROJECT_ID_INVALID',
  );
  passed += 1;
  const currentProject = await projectRepository.get(project.id);
  check(await projectRepository.remove(project.id, currentProject.revision) === true, 'proyecto eliminado');
  check(await projectRepository.remove(project.id) === false, 'eliminación ausente idempotente');

  const resourceRepository = await createResourceRepository();
  const resource = {
    id: `${prefix}-voice`,
    contentHash: hashFor(prefix, '1'),
    registeredAt: '2026-07-25T00:00:00.000Z',
    entry: { id: `${prefix}-voice`, type: 'voice' },
  };
  check((await resourceRepository.register(resource)).created, 'recurso creado');
  check(
    (await resourceRepository.get(resource.id)).contentHash === resource.contentHash,
    'recurso recuperado',
  );
  const alias = {
    ...resource,
    id: `${prefix}-alias`,
    entry: { ...resource.entry, id: `${prefix}-alias` },
  };
  check(!(await resourceRepository.register(alias)).created, 'recurso deduplicado por hash');
  await assert.rejects(
    () => resourceRepository.register({ ...resource, contentHash: hashFor(prefix, '2') }),
    (error) => error.code === 'LIBRARY_RESOURCE_ID_CONFLICT',
  );
  passed += 1;
  check(
    (await resourceRepository.list()).some((record) => record.id === resource.id),
    'recurso listado',
  );
  const sharedHash = hashFor(prefix, '3');
  const concurrentResources = await Promise.all([
    resourceRepository.register({
      ...resource,
      id: `${prefix}-race-a`,
      contentHash: sharedHash,
      entry: { ...resource.entry, id: `${prefix}-race-a` },
    }),
    resourceRepository.register({
      ...resource,
      id: `${prefix}-race-b`,
      contentHash: sharedHash,
      entry: { ...resource.entry, id: `${prefix}-race-b` },
    }),
  ]);
  check(
    concurrentResources.filter((result) => result.created).length === 1
      && concurrentResources[0].record.id === concurrentResources[1].record.id,
    'registro concurrente deduplicado por hash',
  );

  const jobRepository = await createRenderJobRepository();
  const queuedJob = {
    version: 1,
    jobId: `${prefix}-job`,
    projectId: `${prefix}-project`,
    state: 'queued',
    stage: 'queueing',
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    progress: null,
    error: null,
  };
  await jobRepository.reserve(queuedJob);
  check((await jobRepository.get(queuedJob.jobId)).state === 'queued', 'job reservado y recuperado');
  await assert.rejects(
    () => jobRepository.reserve(queuedJob),
    (error) => error.code === 'RENDER_JOB_CONFLICT',
  );
  passed += 1;
  const raceJob = { ...queuedJob, jobId: `${prefix}-race-job` };
  const concurrentReservations = await Promise.allSettled([
    jobRepository.reserve(raceJob),
    jobRepository.reserve(raceJob),
  ]);
  check(
    concurrentReservations.filter((result) => result.status === 'fulfilled').length === 1
      && concurrentReservations.filter((result) => (
        result.status === 'rejected'
        && result.reason?.code === 'RENDER_JOB_CONFLICT'
      )).length === 1,
    'reserva concurrente de jobId atómica',
  );
  const renderingJob = await jobRepository.transition(
    queuedJob.jobId,
    'queued',
    {
      state: 'rendering',
      stage: 'rendering_frames',
      updatedAt: '2026-07-25T00:00:01.000Z',
    },
  );
  check(renderingJob.state === 'rendering', 'transición atómica aplicada');
  await assert.rejects(
    () => jobRepository.transition(queuedJob.jobId, 'queued', { state: 'failed' }),
    (error) => error.code === 'RENDER_JOB_STATE_CONFLICT',
  );
  passed += 1;
  check(
    (await jobRepository.list({ states: ['rendering'] }))
      .some((job) => job.jobId === queuedJob.jobId),
    'filtro de jobs',
  );
  await assert.rejects(
    () => jobRepository.transition(queuedJob.jobId, 'rendering', {
      technicalDetail: 'C:\\datos\\privados\\archivo.json',
    }),
    (error) => error.code === 'RENDER_JOB_PATH_INVALID',
  );
  passed += 1;

  return { version: 1, backend, passed, failed: 0 };
}

function sampleProject(id) {
  return {
    version: 1,
    id,
    title: 'Proyecto de prueba',
    video: { width: 1080, height: 1920, fps: 30 },
    seed: 1,
    resourceCatalog: 'assets/catalog/authoring-resources.json',
    scenes: [{
      id: 'escena-01',
      title: 'Escena 1',
      background: { resourceId: 'fondo', cameraPreset: 'static' },
      elements: [],
      dialogue: [],
    }],
  };
}

function hashFor(prefix, suffix) {
  const seed = Buffer.from(`${prefix}:${suffix}`).toString('hex');
  return seed.padEnd(64, suffix).slice(0, 64);
}
