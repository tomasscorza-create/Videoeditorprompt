import http from 'node:http';
import https from 'node:https';
import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { storageError } from './contracts.mjs';

export function createLocalS3Client(options = {}) {
  const environment = options.environment || process.env;
  const endpoint = validateEndpoint(
    options.endpoint
      || environment.LOCAL_VIDEO_S3_ENDPOINT
      || `http://127.0.0.1:${environment.LOCAL_VIDEO_S3_PORT || 8333}`,
  );
  const bucket = validateBucket(
    options.bucket || environment.LOCAL_VIDEO_S3_BUCKET || 'local-video-private',
  );
  const accessKeyId = options.accessKeyId
    || environment.LOCAL_VIDEO_S3_ACCESS_KEY
    || 'local-video-dev';
  const secretAccessKey = options.secretAccessKey
    || environment.LOCAL_VIDEO_S3_SECRET_KEY
    || 'local-video-dev-only-change-me';
  if (!accessKeyId || !secretAccessKey) {
    throw storageError('S3_CONFIG_INVALID', 'Las credenciales S3 no están completas.');
  }
  const maxSockets = boundedInteger(
    options.maxSockets ?? environment.LOCAL_VIDEO_S3_MAX_SOCKETS,
    1,
    32,
    8,
  );
  const requestHandler = new NodeHttpHandler({
    connectionTimeout: boundedInteger(options.connectionTimeoutMillis, 100, 30_000, 5_000),
    requestTimeout: boundedInteger(options.requestTimeoutMillis, 1_000, 10 * 60_000, 120_000),
    socketTimeout: boundedInteger(options.socketTimeoutMillis, 1_000, 10 * 60_000, 120_000),
    throwOnRequestTimeout: true,
    httpAgent: new http.Agent({ keepAlive: true, maxSockets }),
    httpsAgent: new https.Agent({ keepAlive: true, maxSockets }),
  });
  const client = new S3Client({
    endpoint: endpoint.toString(),
    region: options.region || environment.LOCAL_VIDEO_S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: boundedInteger(options.maxAttempts, 1, 3, 2),
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
    bucket,
    endpoint: endpoint.toString(),
    close() {
      client.destroy();
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
