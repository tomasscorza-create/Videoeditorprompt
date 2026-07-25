import path from 'node:path';

export const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u;
export const JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/u;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * @typedef {object} ProjectRepository
 * @property {() => Promise<object[]>} list
 * @property {(id: string) => Promise<object>} get
 * @property {(project: object, expectedRevision?: string) => Promise<object>} save
 * @property {(id: string, expectedRevision?: string) => Promise<boolean>} remove
 */

/**
 * @typedef {object} ResourceRepository
 * @property {() => Promise<object[]>} list
 * @property {(id: string) => Promise<object|null>} get
 * @property {(record: object) => Promise<object>} register
 */

/**
 * @typedef {object} RenderJobRepository
 * @property {(job: object) => Promise<void>} reserve
 * @property {(jobId: string) => Promise<object|null>} get
 * @property {(filter?: object) => Promise<object[]>} list
 * @property {(jobId: string, expectedState: string, event: object) => Promise<object>} transition
 */

/**
 * @typedef {object} BlobStorage
 * @property {(input: object) => Promise<object>} put
 * @property {(key: string, destination: string, expectedSha256?: string) => Promise<void>} getToFile
 * @property {(key: string) => Promise<object>} stat
 * @property {(key: string) => Promise<void>} delete
 */

export function assertProjectId(id) {
  if (typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id)) {
    throw storageError('PROJECT_ID_INVALID', 'El ID del proyecto no es válido.');
  }
  return id;
}

export function assertJobId(jobId) {
  if (typeof jobId !== 'string' || !JOB_ID_PATTERN.test(jobId)) {
    throw storageError('JOB_ID_INVALID', 'El identificador de trabajo no es válido.');
  }
  return jobId;
}

export function assertSha256(value, code = 'BLOB_HASH_INVALID') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw storageError(code, 'El hash SHA-256 no es válido.');
  }
  return value;
}

export function assertBlobKey(key) {
  if (
    typeof key !== 'string'
    || key.length < 1
    || key.length > 1024
    || key.includes('\\')
    || key.includes(':')
    || key.startsWith('/')
    || path.posix.isAbsolute(key)
  ) {
    throw storageError('BLOB_KEY_INVALID', 'La clave del blob no es portable.');
  }
  const segments = key.split('/');
  if (
    segments.some((segment) => (
      !segment
      || segment === '.'
      || segment === '..'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(segment)
    ))
  ) {
    throw storageError('BLOB_KEY_INVALID', 'La clave del blob contiene segmentos no permitidos.');
  }
  return key;
}

export function storageError(code, message, technicalDetail) {
  const error = new Error(message);
  error.code = code;
  if (technicalDetail) error.technicalDetail = technicalDetail;
  return error;
}
