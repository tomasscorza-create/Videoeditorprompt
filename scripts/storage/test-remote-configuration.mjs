import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPostgresConfig } from './postgres-client.mjs';
import { buildS3Config } from './s3-client.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'local-video-p8-config-'));
let passed = 0;

try {
  const passwordFile = path.join(root, 'postgres-password');
  const accessFile = path.join(root, 's3-access');
  const secretFile = path.join(root, 's3-secret');
  const caFile = path.join(root, 'ca.pem');
  await writeFile(passwordFile, 'postgres-from-file\n');
  await writeFile(accessFile, 'access-from-file\n');
  await writeFile(secretFile, 'secret-from-file\n');
  await writeFile(caFile, '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');

  const postgres = buildPostgresConfig({
    environment: {
      LOCAL_VIDEO_DEPLOYMENT: 'remote',
      LOCAL_VIDEO_POSTGRES_HOST: 'db.example.test',
      LOCAL_VIDEO_POSTGRES_USER: 'worker',
      LOCAL_VIDEO_POSTGRES_PASSWORD_FILE: passwordFile,
      LOCAL_VIDEO_POSTGRES_SSL_CA_FILE: caFile,
    },
  });
  assert.equal(postgres.password, 'postgres-from-file');
  assert.equal(postgres.ssl.rejectUnauthorized, true);
  assert.match(postgres.ssl.ca, /BEGIN CERTIFICATE/u);
  passed += 1;

  assert.throws(
    () => buildPostgresConfig({
      environment: {
        LOCAL_VIDEO_DEPLOYMENT: 'remote',
        LOCAL_VIDEO_POSTGRES_PASSWORD: 'secret',
        LOCAL_VIDEO_POSTGRES_SSL_MODE: 'disable',
      },
    }),
    (error) => error.code === 'POSTGRES_TLS_REQUIRED',
  );
  passed += 1;

  assert.throws(
    () => buildPostgresConfig({
      environment: {
        LOCAL_VIDEO_DATABASE_URL: 'postgres://user:secret@db.test/app?sslmode=disable',
      },
    }),
    (error) => error.code === 'POSTGRES_CONFIG_INVALID',
  );
  passed += 1;

  const s3 = buildS3Config({
    environment: {
      LOCAL_VIDEO_DEPLOYMENT: 'remote',
      LOCAL_VIDEO_S3_PROVIDER: 'cloudflare-r2',
      LOCAL_VIDEO_S3_ENDPOINT: 'https://account.r2.example.test',
      LOCAL_VIDEO_S3_BUCKET: 'private-assets',
      LOCAL_VIDEO_S3_ACCESS_KEY_FILE: accessFile,
      LOCAL_VIDEO_S3_SECRET_KEY_FILE: secretFile,
      LOCAL_VIDEO_S3_TLS_CA_FILE: caFile,
    },
  });
  assert.equal(s3.credentials.accessKeyId, 'access-from-file');
  assert.equal(s3.credentials.secretAccessKey, 'secret-from-file');
  assert.equal(s3.diagnostic.tls, true);
  assert.equal(JSON.stringify(s3.diagnostic).includes('secret'), false);
  passed += 1;

  const aws = buildS3Config({
    environment: {
      LOCAL_VIDEO_DEPLOYMENT: 'remote',
      LOCAL_VIDEO_S3_PROVIDER: 'aws-s3',
      LOCAL_VIDEO_S3_CREDENTIALS: 'ambient',
      LOCAL_VIDEO_S3_BUCKET: 'private-assets',
      LOCAL_VIDEO_S3_REGION: 'us-east-2',
    },
  });
  assert.equal(aws.endpoint, undefined);
  assert.equal(aws.credentials, undefined);
  assert.equal(aws.forcePathStyle, false);
  passed += 1;

  assert.throws(
    () => buildS3Config({
      environment: {
        LOCAL_VIDEO_DEPLOYMENT: 'remote',
        LOCAL_VIDEO_S3_PROVIDER: 's3-compatible',
        LOCAL_VIDEO_S3_ENDPOINT: 'http://storage.example.test',
        LOCAL_VIDEO_S3_ACCESS_KEY: 'access',
        LOCAL_VIDEO_S3_SECRET_KEY: 'secret',
      },
    }),
    (error) => error.code === 'S3_TLS_REQUIRED',
  );
  passed += 1;

  assert.throws(
    () => buildS3Config({
      environment: {
        LOCAL_VIDEO_DEPLOYMENT: 'remote',
        LOCAL_VIDEO_S3_PROVIDER: 'cloudflare-r2',
        LOCAL_VIDEO_S3_ENDPOINT: 'https://account.r2.example.test',
        LOCAL_VIDEO_S3_CREDENTIALS: 'static',
      },
    }),
    (error) => error.code === 'SECRET_REQUIRED',
  );
  passed += 1;

  assert.throws(
    () => buildS3Config({
      environment: {
        LOCAL_VIDEO_S3_ACCESS_KEY: 'direct',
        LOCAL_VIDEO_S3_ACCESS_KEY_FILE: accessFile,
      },
    }),
    (error) => error.code === 'SECRET_CONFIG_CONFLICT',
  );
  passed += 1;

  process.stdout.write(`${JSON.stringify({
    version: 1,
    passed,
    failed: 0,
    cases: [
      'postgres-verify-full-secret-file',
      'postgres-remote-tls-required',
      'postgres-url-cannot-override-tls',
      's3-https-static-secret-files',
      'aws-ambient-credentials',
      's3-remote-http-rejected',
      's3-static-credentials-required',
      'secret-source-conflict',
    ],
  })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
