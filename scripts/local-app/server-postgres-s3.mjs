process.env.LOCAL_VIDEO_PERSISTENCE = 'postgres-s3';
const { createLocalAppServer } = await import('./server.mjs');

try {
  const app = await createLocalAppServer();
  const listening = await app.listen();
  process.stdout.write(`${JSON.stringify({
    version: 1,
    state: 'ready',
    url: listening.url,
    persistence: app.persistence,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    version: 1,
    state: 'failed',
    stage: error.stage || 'local_app',
    code: error.code || 'UNEXPECTED_ERROR',
    message: error.message,
    technicalDetail: error.technicalDetail,
  })}\n`);
  process.exitCode = 1;
}
