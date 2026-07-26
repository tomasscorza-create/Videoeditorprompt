import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../stage1/common.mjs';
import { runCompose } from './infra-common.mjs';

const compose = readFileSync(path.join(projectRoot, 'compose.yaml'), 'utf8');
const example = readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

check(compose.includes('postgres:17.10-bookworm@sha256:'), 'PostgreSQL fijado por digest');
check(compose.includes('chrislusf/seaweedfs:4.40@sha256:'), 'SeaweedFS fijado por digest');
check(!compose.toLowerCase().includes('minio'), 'MinIO legacy ausente');
check((compose.match(/- "127\.0\.0\.1:/gu) || []).length === 2, 'puertos limitados a loopback');
check(compose.includes('local_video_postgres_data'), 'volumen PostgreSQL nombrado');
check(compose.includes('local_video_seaweed_data'), 'volumen SeaweedFS nombrado');
check((compose.match(/healthcheck:/gu) || []).length === 2, 'dos healthchecks declarados');
check(!compose.includes('down -v') && !compose.includes('volume rm'), 'sin reset destructivo');
check(example.includes('replace-with-local-only'), 'credenciales de ejemplo no reales');
check(!example.includes('local-video-dev-only-change-me'), 'defaults de desarrollo no copiados como secreto');
runCompose(['config', '--quiet'], {
  code: 'INFRA_COMPOSE_INVALID',
  message: 'compose.yaml no es válido.',
});
passed += 1;

process.stdout.write(`${JSON.stringify({ version: 1, passed, failed: 0 })}\n`);
