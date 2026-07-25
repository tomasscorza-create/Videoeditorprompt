import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson, clone, ensureDirectory } from './filesystem-utils.mjs';
import { storageError } from './contracts.mjs';

export async function createFileResourceRepository(options) {
  const indexPath = path.resolve(options.indexPath);
  await ensureDirectory(path.dirname(indexPath));
  let registry = await readRegistry(indexPath);
  const normalized = options.normalizeRegistry
    ? options.normalizeRegistry(clone(registry))
    : registry;
  options.validateRegistry?.(normalized);
  if (JSON.stringify(normalized) !== JSON.stringify(registry)) {
    await atomicWriteJson(indexPath, normalized);
  }
  registry = normalized;
  let mutation = Promise.resolve();

  async function list() {
    return clone(registry.entries);
  }

  async function get(id) {
    const record = registry.entries.find((candidate) => candidate.id === id);
    return record ? clone(record) : null;
  }

  async function register(input) {
    return serializeMutation(async () => {
      const record = clone(input);
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        throw storageError('LIBRARY_RESOURCE_INVALID', 'El registro del recurso no es válido.');
      }
      const idConflict = registry.entries.find((candidate) => candidate.id === record.id);
      if (idConflict) {
        if (idConflict.contentHash === record.contentHash) {
          return { created: false, record: clone(idConflict) };
        }
        throw storageError(
          'LIBRARY_RESOURCE_ID_CONFLICT',
          `Ya existe un recurso diferente con el ID «${record.id}».`,
        );
      }
      const duplicate = registry.entries.find(
        (candidate) => candidate.contentHash === record.contentHash,
      );
      if (duplicate) return { created: false, record: clone(duplicate) };
      const next = { version: 1, entries: [...registry.entries, record] };
      options.validateRegistry?.(next);
      await atomicWriteJson(indexPath, next);
      registry = next;
      return { created: true, record: clone(record) };
    });
  }

  function serializeMutation(operation) {
    const result = mutation.then(operation, operation);
    mutation = result.catch(() => {});
    return result;
  }

  return { indexPath, list, get, register };
}

async function readRegistry(indexPath) {
  if (!existsSync(indexPath)) return { version: 1, entries: [] };
  try {
    return JSON.parse(await readFile(indexPath, 'utf8'));
  } catch (error) {
    const wrapped = storageError(
      'LIBRARY_INDEX_INVALID',
      'El índice de la biblioteca local no contiene JSON válido.',
    );
    wrapped.cause = error;
    throw wrapped;
  }
}
