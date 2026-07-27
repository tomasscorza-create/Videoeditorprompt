# Plan de mejora del Director IA

> Instrucción ejecutable. Origen: auditoría del sistema de IA del 2026-07-26.
> Tercer plan de la serie: `PLAN_ARREGLO_CARGA_LENTA.md` (rendimiento) y
> `PLAN_LIMPIEZA_Y_ANTIBASURA.md` (residuos). Independiente de ambos; ninguna fase
> toca `.local-video/` ni el almacenamiento de proyectos.

## Diagnóstico (resumen)

Modelo actual: **qwen3:8b** vía Ollama (único instalado), salida estructurada por
JSON Schema. La conclusión central de la auditoría: **el modelo no es el techo
principal** — el techo es que la IA decide muy poco del video:

- La IA elige: guion (texto), reparto (2 personajes exactos), voces, gesto por turno
  (solo `neutral`/`point`), pausas (0-2 s), y por escena: fondo, cámara (3 presets),
  layout (7 presets fijos), transición (`cut`/`fade`).
- Todo lo demás está prearmado y es determinista: posiciones (x/y/escala hardcodeados
  en `public/assets/catalog/layout-presets.json`), boca por energía RMS de 3 estados
  (no fonemas), parpadeo por agenda seeded, idle = seno puro, gesto aplicado al turno
  completo, prosodia fija por voz, subtítulos de estilo fijo, 1080×1920@30, sin música
  ni SFX.

Agravantes verificados en el motor:

1. `keep_alive: 0` en `scripts/director/providers/ollama.mjs:27` → el modelo se
   descarga de RAM tras cada request; cada propuesta paga recargar 5,2 GB.
2. La UI nunca envía `think` (`src/ui/director/api.ts` solo manda
   prompt/variant/constraints) → el modo razonamiento de qwen3, que el backend ya
   soporta (opción C3 en `ollama-director.mjs`), está inaccesible.
3. Un solo intento por propuesta: el primer plan válido gana; el bucle de reparación
   solo corrige presupuesto de palabras, nunca calidad. Con seed determinista +
   caché, regenerar sin subir `variant` devuelve lo mismo.
4. System prompt con un solo ejemplo few-shot para 5 tonos
   (`buildSystemPrompt` en `scripts/director/ollama-director.mjs:196`).

> Nota transversal: la clave de caché del Director incluye `DIRECTOR_PIPELINE_VERSION`
> (`scripts/director/version.mjs`). **Cada cambio de prompt, schema o normalización
> de este plan debe subir esa versión** para invalidar `.local-video/director-cache`.

---

## Fase 1 — Motor de IA: mejoras baratas de alto retorno

**Estado: implementada y verificada técnicamente el 2026-07-26.**

**1a. Mantener el modelo cargado.** En `scripts/director/providers/ollama.mjs:27`
cambiar `keep_alive: 0` → `keep_alive: '10m'`. Una línea; elimina la recarga de
5,2 GB por request. Verificar: dos propuestas seguidas — la segunda debe tardar
segundos, no minutos.

**1b. Exponer «modo calidad» (think) en la UI.**
- `src/ui/director/api.ts` (`createProposal`): aceptar y enviar `think: boolean`
  en el body (el servidor ya lo reenvía: `server.mjs` pasa `body.think`).
- `src/ui/director/panel.ts` + `index.html`: checkbox «Calidad máxima (más lento)»
  junto a los parámetros editoriales.
- El backend ya ajusta timeout (300 s con think). Verificar con
  `npm run director:test-ollama`.

**1c. Few-shots por tono en el system prompt.** En `buildSystemPrompt`
(`scripts/director/ollama-director.mjs`): agregar 2 ejemplos buenos por tono
(gancho + cierre), con aperturas variadas (pregunta, afirmación provocadora,
estadística, escena cotidiana) y prohibición explícita de aperturas repetidas tipo
«¿Sabías que…?». Subir `DIRECTOR_PIPELINE_VERSION`.

**1d. Generación con juez (best-of-N).** Nuevo módulo
`scripts/director/plan-judge.mjs`:
- Generar N=2-3 planes con `variant` distinto (secuencial en CPU; con 1a hecho,
  el costo marginal es solo generación).
- Pasada de juez con el mismo modelo: recibe los guiones (solo texto de diálogo,
  sin IDs) y un rubric corto — gancho (0-3), naturalidad para voz (0-3), cierre
  (0-3), variedad entre turnos (0-3) — y devuelve el índice del mejor
  (salida estructurada con schema mínimo).
- Integrarlo en `createDirectorProposal` detrás de una opción `bestOf` (default 1
  para no romper tests ni tiempos actuales; la UI puede ofrecerlo junto a 1b).
- Cachear el resultado final igual que hoy.

## Fase 2 — Ampliar lo que la IA puede decidir (sube el techo visual)

**Estado: implementada y verificada técnicamente el 2026-07-26.**

La boca usa seis visemas deterministas derivados del texto español y ajustados a
los límites de actividad medidos por RMS. Esta máquina no dispone de `espeak-ng`
ni de una build de Piper que entregue tiempos fonéticos, por lo que no se declara
alineación fonética real: `hybrid-grapheme-rms-v1` es la fuente primaria y
`rms-fallback` conserva compatibilidad ante una entrada no utilizable. El contrato
queda preparado para sustituir el alineador sin cambiar el evaluador temporal.

Se agregaron tres loops musicales originales y deterministas con licencia
`CC0-1.0`, selección opcional por video y mezcla FFmpeg con `-14 dB` durante voz y
`-6 dB` en pausas/colas. El título histórico menciona SFX, pero los pasos de 2b
solo especificaban música; los efectos puntuales siguen fuera de este alcance.

También están operativos `pace`, `gestureAtWord`, cinco gestos, tres perfiles idle
seeded y `layoutPreset` por turno con interpolación de 0,35 s. Preview PixiJS y
exportación consumen el mismo evaluador, y los campos también pueden editarse con
los comandos semánticos. Posteriormente, la capa de recursos/plantillas elevó
`DIRECTOR_PIPELINE_VERSION` a 11.

Orden por impacto percibido:

**2a. Boca por fonemas (visemas).** Reemplazar la clasificación RMS de 3 estados:
- Piper fonetiza con espeak-ng; obtener la secuencia de fonemas + duraciones del
  turno (piper expone `--debug`/phoneme timing; si la build no lo trae, usar
  `espeak-ng --ipa -q` sobre el texto normalizado y repartir tiempos
  proporcionalmente dentro de la duración medida del WAV).
- Mapa fonema→viseme de 5-6 formas (cerrada, semiabierta, abierta, redonda `o/u`,
  labiodental `f/v`, bilabial `m/b/p`).
- Tocar: `scripts/stage1/prepare-dialogue.mjs` (generar cues de visemas en lugar
  de `analyzeWav` como fuente primaria; conservar RMS como fallback),
  `shared/scene-evaluator.js` (estados de boca), y los manifests/generadores de
  personajes (`scripts/stage2f/generate-parametric-character.mjs`) para producir
  las 2-3 formas de boca nuevas.
- El verificador `stage2f:test-quality` (`test-mouth-quality.mjs`) debe
  actualizarse al nuevo contrato de cues.

**2b. Música y SFX de biblioteca.** Lo que más cambia la percepción de «pulido»:
- Nuevo tipo `music` en el catálogo (`schema/authoring-resource-catalog.schema.json`
  + `public/assets/catalog/authoring-resources.json`) con 3-5 pistas locales de
  licencia limpia, etiquetadas por tono.
- El plan elige `musicResourceId` opcional por video (schema + normalización).
- Mezcla: en `composeDialogueAudio` (`scripts/stage1/prepare-dialogue.mjs`),
  agregar la pista bajo el diálogo con ducking simple (-14 dB bajo voz, -6 dB en
  gaps y colas).

**2c. Prosodia por turno.** El contrato compilado ya lleva `lengthScale` por turno
(`scripts/stage3a/compile-video-project.mjs:189`); falta exponerlo:
- Schema del plan: `pace: slow|normal|fast` opcional por turno →
  lengthScale ×1.12 / ×1.0 / ×0.9 en la normalización (`director-plan.mjs`).
- Instrucción de uso en el system prompt (ej.: `fast` para remates irónicos,
  `slow` para cierres inspiracionales).

**2d. Gestos con timing y más gestos.**
- Permitir en el plan `gestureAtWord: <índice>` por turno; en
  `prepare-dialogue.mjs` convertirlo a segundos con la duración medida del turno
  (proporcional por palabra) y acotar el gesto a ~1,2 s en lugar del turno completo
  (`shared/scene-evaluator.js`).
- Sumar 2-3 gestos al rig paramétrico (celebrar, dudar/encogerse, negar) en
  `generate-parametric-character.mjs` + capabilities del catálogo. El enum del
  schema del plan se arma desde capabilities, así que los personajes nuevos los
  exponen solos.

**2e. Idle menos robótico.** En `shared/scene-evaluator.js`: reemplazar el seno
puro por 2-3 perfiles de respiración/sway (curvas compuestas con fase y amplitud
elegidas por seed del proyecto). Determinista igual que hoy (mismo seed → mismo
video), pero sin el vaivén metronómico idéntico en todos los videos.

**2f. Layouts dinámicos (opcional, más caro).** Permitir `layoutPreset` por
*turno* (no solo por escena) con interpolación suave entre slots en el runtime.
Requiere tocar compilador + evaluador + schema; hacerlo al final.

## Fase 3 — Modelo

Recién cuando Fase 1 esté hecha (sin 1a/1d, comparar modelos es engañoso):

- Probar `qwen3:14b` (necesita ~10 GB RAM libres) con el mismo set de 10 prompts
  de prueba, `think` on/off, y comparar con el juez de 1d como árbitro +
  revisión manual.
- Criterio de adopción: mejora clara de guion con latencia aceptable en esta
  máquina. Si no la hay, quedarse con 8b + think + best-of-3.
- El modelo es configurable por request (`options.model` en
  `createDirectorProposal`); no hay código que cambiar para probar, solo
  `ollama pull qwen3:14b` y pasar el modelo en la petición de prueba.

## Criterios de éxito

1. Segunda propuesta consecutiva en < 30 s (hoy paga recarga completa del modelo).
2. Con «calidad máxima» activado: guiones con gancho no repetitivo entre 5 prompts
   distintos (medible con el juez de 1d: promedio ≥ 9/12 en el rubric).
3. Lip-sync: en un diálogo de prueba, las bilabiales (`m/b/p`) cierran la boca y
   las vocales abiertas la abren (verificación visual + `stage2f:test-quality`).
4. Un video generado con música de fondo + prosodia variada sin intervención
   manual del usuario.
5. `npm test` completo en verde tras cada fase (los contratos de schema y los
   tests de director/stage1/stage2f cubren cada pieza tocada).
