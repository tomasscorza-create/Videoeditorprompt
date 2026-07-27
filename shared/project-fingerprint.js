const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

// Revisión liviana para sincronización de UI. No reemplaza los SHA-256 de
// persistencia ni seguridad; solo permite comparar el JSON exacto enviado a render.
export function projectFingerprint(project) {
  const text = JSON.stringify(project);
  let hash = FNV_OFFSET_64;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
    hash ^= BigInt(code >>> 8);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }
  return `project-v1-${hash.toString(16).padStart(16, '0')}-${text.length}`;
}
