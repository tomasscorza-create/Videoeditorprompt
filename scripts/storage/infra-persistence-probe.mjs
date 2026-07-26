import {
  assertS3Success,
  runPsql,
  s3Context,
  serializeInfraError,
  sha256,
  signedS3Request,
} from './infra-common.mjs';

const operation = process.argv[2];
const key = 'infra/persistence-probe-v1.txt';
const payload = Buffer.from('local-video-infra-persistence-v1\n');

try {
  if (operation === 'write') {
    const response = await signedS3Request({
      context: s3Context(),
      method: 'PUT',
      key,
      body: payload,
    });
    assertS3Success(response, 'la escritura del probe');
  } else if (operation === 'verify') {
    const migrations = Number(runPsql(
      'SELECT count(*) FROM public.local_video_schema_migrations;',
      { tuplesOnly: true },
    ).trim());
    if (migrations < 1) {
      throw probeError('INFRA_POSTGRES_PERSISTENCE_FAILED', 'No persistieron las migraciones.');
    }
    const response = await signedS3Request({
      context: s3Context(),
      method: 'GET',
      key,
    });
    assertS3Success(response, 'la lectura del probe');
    if (sha256(response.body) !== sha256(payload)) {
      throw probeError('INFRA_S3_PERSISTENCE_FAILED', 'El probe S3 cambió después del reinicio.');
    }
  } else {
    throw probeError('INFRA_PROBE_OPERATION_INVALID', 'Use write o verify.');
  }
  process.stdout.write(`${JSON.stringify({
    version: 1,
    state: 'completed',
    operation,
    key,
    sha256: sha256(payload),
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify(serializeInfraError(error))}\n`);
  process.exitCode = 1;
}

function probeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.stage = 'infrastructure_persistence';
  return error;
}
