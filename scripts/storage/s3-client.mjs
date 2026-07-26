import http from 'node:http';
import https from 'node:https';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import {
  readCertificateAuthority,
  resolveConfiguredSecret,
} from './configuration-secrets.mjs';
import { storageError } from './contracts.mjs';

export function createLocalS3Client(options = {}) {
  const config = buildS3Config(options);
  const requestHandler = new NodeHttpHandler({
    connectionTimeout: config.connectionTimeoutMillis,
    requestTimeout: config.requestTimeoutMillis,
    socketTimeout: config.socketTimeoutMillis,
    throwOnRequestTimeout: true,
    httpAgent: new http.Agent({ keepAlive: true, maxSockets: config.maxSockets }),
    httpsAgent: new https.Agent({
      keepAlive: true,
      maxSockets: config.maxSockets,
      rejectUnauthorized: true,
      ...(config.ca ? { ca: config.ca } : {}),
    }),
  });
  const client = new S3Client({
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    ...(config.credentials ? { credentials: config.credentials } : {}),
    maxAttempts: config.maxAttempts,
    requestHandler,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    logger: {
      trace() {},
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
  });
  return {
    client,
    bucket: config.bucket,
    endpoint: config.endpoint,
    diagnostic: config.diagnostic,
    close() {
      client.destroy();
    },
  };
}

export function buildS3Config(options = {}) {
  const environment = options.environment || process.env;
  const deployment = deploymentMode(options.deployment || environment.LOCAL_VIDEO_DEPLOYMENT);
  const provider = String(
    options.provider || environment.LOCAL_VIDEO_S3_PROVIDER || 'seaweedfs',
  );
  if (!['aws-s3', 'cloudflare-r2', 's3-compatible', 'seaweedfs'].includes(provider)) {
    throw storageError('S3_CONFIG_INVALID', 'El proveedor S3 no es válido.');
  }
  const configuredEndpoint = options.endpoint || environment.LOCAL_VIDEO_S3_ENDPOINT;
  const endpoint = provider === 'aws-s3' && !configuredEndpoint
    ? null
    : validateEndpoint(
      configuredEndpoint || `http://127.0.0.1:${environment.LOCAL_VIDEO_S3_PORT || 8333}`,
    );
  if (deployment === 'remote' && endpoint && endpoint.protocol !== 'https:') {
    throw storageError('S3_TLS_REQUIRED', 'El despliegue remoto exige un endpoint S3 HTTPS.');
  }
  const bucket = validateBucket(
    options.bucket || environment.LOCAL_VIDEO_S3_BUCKET || 'local-video-private',
  );
  const credentialsMode = String(
    options.credentialsMode
      || environment.LOCAL_VIDEO_S3_CREDENTIALS
      || (deployment === 'remote' && provider === 'aws-s3' ? 'ambient' : 'static'),
  );
  if (!['ambient', 'static'].includes(credentialsMode)) {
    throw storageError('S3_CONFIG_INVALID', 'El modo de credenciales S3 no es válido.');
  }
  const accessKeyId = options.accessKeyId ?? resolveConfiguredSecret({
    environment,
    valueName: 'LOCAL_VIDEO_S3_ACCESS_KEY',
    fileName: 'LOCAL_VIDEO_S3_ACCESS_KEY_FILE',
    fallback: deployment === 'local' ? 'local-video-dev' : undefined,
    required: credentialsMode === 'static',
    label: 'la access key S3',
  });
  const secretAccessKey = options.secretAccessKey ?? resolveConfiguredSecret({
    environment,
    valueName: 'LOCAL_VIDEO_S3_SECRET_KEY',
    fileName: 'LOCAL_VIDEO_S3_SECRET_KEY_FILE',
    fallback: deployment === 'local' ? 'local-video-dev-only-change-me' : undefined,
    required: credentialsMode === 'static',
    label: 'la secret key S3',
  });
  const forcePathStyle = booleanValue(
    options.forcePathStyle ?? environment.LOCAL_VIDEO_S3_FORCE_PATH_STYLE,
    provider === 'seaweedfs' || provider === 's3-compatible',
  );
  const maxSockets = boundedInteger(
    options.maxSockets ?? environment.LOCAL_VIDEO_S3_MAX_SOCKETS,
    1,
    32,
    8,
  );
  const ca = readCertificateAuthority(
    options.caFile || environment.LOCAL_VIDEO_S3_TLS_CA_FILE,
  );
  return {
    provider,
    endpoint: endpoint?.toString(),
    bucket,
    region: options.region || environment.LOCAL_VIDEO_S3_REGION || 'us-east-1',
    forcePathStyle,
    credentials: credentialsMode === 'static' ? { accessKeyId, secretAccessKey } : undefined,
    maxAttempts: boundedInteger(options.maxAttempts, 1, 3, 2),
    connectionTimeoutMillis: boundedInteger(options.connectionTimeoutMillis, 100, 30_000, 5_000),
    requestTimeoutMillis: boundedInteger(options.requestTimeoutMillis, 1_000, 10 * 60_000, 120_000),
    socketTimeoutMillis: boundedInteger(options.socketTimeoutMillis, 1_000, 10 * 60_000, 120_000),
    maxSockets,
    ca,
    diagnostic: {
      version: 1,
      provider,
      tls: endpoint ? endpoint.protocol === 'https:' : true,
      credentials: credentialsMode,
      forcePathStyle,
    },
  };
}

function validateEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value));
  } catch {
    throw storageError('S3_CONFIG_INVALID', 'El endpoint S3 no es válido.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol)
    || endpoint.username
    || endpoint.password
    || endpoint.pathname !== '/'
    || endpoint.search
    || endpoint.hash
  ) {
    throw storageError('S3_CONFIG_INVALID', 'El endpoint S3 no es válido.');
  }
  return endpoint;
}

function validateBucket(value) {
  const bucket = String(value || '');
  if (
    bucket.length < 3
    || bucket.length > 63
    || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(bucket)
    || bucket.includes('..')
  ) {
    throw storageError('S3_CONFIG_INVALID', 'El bucket S3 no es válido.');
  }
  return bucket;
}

function boundedInteger(value, minimum, maximum, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw storageError('S3_CONFIG_INVALID', 'La configuración S3 no es válida.');
  }
  return parsed;
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw storageError('S3_CONFIG_INVALID', 'La opción booleana S3 no es válida.');
}

function deploymentMode(value) {
  const mode = String(value || 'local');
  if (!['local', 'remote'].includes(mode)) {
    throw storageError('DEPLOYMENT_MODE_INVALID', 'El modo de despliegue no es válido.');
  }
  return mode;
}
