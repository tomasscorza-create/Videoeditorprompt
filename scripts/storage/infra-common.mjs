import { createHash, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';
import { storageError } from './contracts.mjs';

export const composeFile = path.join(projectRoot, 'compose.yaml');

export function runCompose(args, options = {}) {
  const result = spawnSync(
    'docker',
    ['compose', '-f', composeFile, ...args],
    {
      cwd: projectRoot,
      shell: false,
      encoding: 'utf8',
      input: options.input,
      maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    throw infraError(
      options.code || 'INFRA_DOCKER_COMMAND_FAILED',
      options.message || 'Falló una operación de infraestructura local.',
      boundedDetail(result.stderr || result.stdout || result.error?.message),
    );
  }
  return String(result.stdout || '').trim();
}

export function containerEnvironment(service, name) {
  return runCompose(
    ['exec', '-T', service, 'printenv', name],
    {
      code: 'INFRA_ENVIRONMENT_UNAVAILABLE',
      message: `No se pudo leer ${name} dentro de ${service}.`,
    },
  );
}

export function postgresContext() {
  return {
    user: containerEnvironment('postgres', 'POSTGRES_USER'),
    database: containerEnvironment('postgres', 'POSTGRES_DB'),
  };
}

export function runPsql(sql, options = {}) {
  const context = options.context || postgresContext();
  const args = [
    'exec',
    '-T',
    'postgres',
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    context.user,
    '-d',
    context.database,
  ];
  if (options.tuplesOnly) args.push('-A', '-t');
  args.push('-f', '-');
  return runCompose(args, {
    input: sql,
    code: 'INFRA_POSTGRES_QUERY_FAILED',
    message: 'PostgreSQL rechazó una operación de infraestructura.',
  });
}

export function s3Context() {
  const published = runCompose(
    ['port', 'seaweedfs', '8333'],
    {
      code: 'INFRA_S3_PORT_UNAVAILABLE',
      message: 'No se pudo resolver el puerto S3 local.',
    },
  );
  const match = published.match(/^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/u);
  if (!match) {
    throw infraError('INFRA_S3_PORT_INVALID', 'Docker devolvió un puerto S3 inválido.');
  }
  return {
    hostname: match[1] || match[2],
    port: Number(match[3]),
    accessKey: containerEnvironment('seaweedfs', 'AWS_ACCESS_KEY_ID'),
    secretKey: containerEnvironment('seaweedfs', 'AWS_SECRET_ACCESS_KEY'),
    bucket: containerEnvironment('seaweedfs', 'S3_BUCKET'),
    region: 'us-east-1',
  };
}

export async function signedS3Request({
  context = s3Context(),
  method,
  key = '',
  body = Buffer.alloc(0),
}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');
  const shortDate = amzDate.slice(0, 8);
  const host = `${context.hostname}:${context.port}`;
  const objectPath = [context.bucket, ...String(key).split('/').filter(Boolean)]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const canonicalUri = `/${objectPath}`;
  const payloadHash = sha256(payload);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${shortDate}/${context.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(Buffer.from(canonicalRequest)),
  ].join('\n');
  const dateKey = hmac(`AWS4${context.secretKey}`, shortDate);
  const regionKey = hmac(dateKey, context.region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${context.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: context.hostname,
      port: context.port,
      method,
      path: canonicalUri,
      headers: {
        authorization,
        host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        ...(payload.length > 0 ? { 'content-length': payload.length } : {}),
      },
      timeout: 5000,
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= 1024 * 1024) chunks.push(chunk);
      });
      response.on('end', () => resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.on('timeout', () => request.destroy(infraError(
      'INFRA_S3_TIMEOUT',
      'El endpoint S3 no respondió dentro del límite.',
    )));
    request.on('error', (error) => reject(infraError(
      error.code === 'INFRA_S3_TIMEOUT' ? error.code : 'INFRA_S3_REQUEST_FAILED',
      error.message,
    )));
    request.end(payload);
  });
}

export function assertS3Success(response, action) {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw infraError(
      'INFRA_S3_REQUEST_REJECTED',
      `S3 rechazó ${action}.`,
      `status=${response.statusCode}`,
    );
  }
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function infraError(code, message, technicalDetail) {
  const error = storageError(code, message, technicalDetail);
  error.stage = 'infrastructure';
  return error;
}

export function serializeInfraError(error) {
  return {
    version: 1,
    state: 'failed',
    stage: error.stage || 'infrastructure',
    code: error.code || 'UNEXPECTED_ERROR',
    message: error.message,
    technicalDetail: error.technicalDetail,
  };
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function boundedDetail(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 1000) : undefined;
}
