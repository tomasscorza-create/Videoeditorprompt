const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

function fnv1aOfJson(value) {
  const text = JSON.stringify(canonicalizeJson(value));
  let hash = FNV_OFFSET_64;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
    hash ^= BigInt(code >>> 8);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }
  return `${hash.toString(16).padStart(16, '0')}-${text.length}`;
}

/**
 * PostgreSQL JSONB y otros backends pueden devolver las claves de un objeto en
 * otro orden. La revisión representa el contenido del proyecto, no el orden de
 * serialización incidental con el que llegó al navegador.
 */
function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalizeJson(value[key])]),
  );
}

// Revisión liviana para sincronización de UI. No reemplaza los SHA-256 de
// persistencia ni seguridad; solo permite comparar el JSON exacto enviado a render.
export function projectFingerprint(project) {
  return `project-v1-${fnv1aOfJson(project)}`;
}

/**
 * Revisión de lo que puede mover un milisegundo.
 *
 * La duración de un video local nace del audio: la sintetiza ElevenLabs y la mide
 * FFprobe. Mover un personaje, animarlo, cambiar un fondo o renombrar una escena
 * dejan el MP4 viejo, pero NO cambian ni un tiempo de la medición anterior. Con
 * el fingerprint completo esa distinción se perdía y cualquier edición devolvía
 * la timeline a «sin medir», que es justamente lo que impide editar keyframes:
 * un keyframe se ubica resolviendo su ancla contra el audio medido.
 *
 * Entra en la proyección lo que cambia una duración o el lugar de una escena:
 * el texto que se sintetiza, la voz, el ritmo, la pausa posterior, el orden y la
 * identidad de escenas y turnos, la transición de salida y los fps.
 *
 * NO entra nada visual: transform, pistas de animación, movimiento base, poses,
 * gestos, fondo, cámara, layout ni títulos.
 */
export function projectTimingFingerprint(project) {
  return `timing-v1-${fnv1aOfJson(timingProjection(project))}`;
}

function timingProjection(project) {
  const scenes = Array.isArray(project?.scenes) ? project.scenes : [];
  return {
    fps: project?.video?.fps ?? null,
    scenes: scenes.map((scene) => ({
      id: scene?.id ?? null,
      transition: scene?.transitionToNext
        ? [scene.transitionToNext.preset, scene.transitionToNext.durationSeconds]
        : null,
      turns: (Array.isArray(scene?.dialogue) ? scene.dialogue : []).map((turn) => [
        turn?.id ?? null,
        turn?.text ?? null,
        turn?.voiceId ?? null,
        turn?.pace ?? null,
        turn?.gapAfterSeconds ?? null,
      ]),
    })),
  };
}
