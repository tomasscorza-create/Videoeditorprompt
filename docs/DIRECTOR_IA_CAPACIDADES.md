# Capacidades del Director IA — referencia viva

> Qué puede expresar la IA local (Ollama) en cada camino, tras ejecutar
> `PLAN_DE_ACCION_IA_2026-07-24.md`. Documento vivo: si cambia el schema o el
> normalizador, se actualiza acá. Todo pasa por el mismo embudo de validación
> (schema cerrado → normalizador/editor → Ajv → compilador); la IA nunca escribe
> el proyecto directamente.

## Propuesta (prompt → video) · `scripts/director/`

Por miembro del cast:

- **characterResourceId / voiceId**: IDs del catálogo fusionado (repo + biblioteca).
- **poseId**: elegido entre `capabilities.poses` del personaje (antes fijo `neutral`).
- **animationPreset**: elegido entre `capabilities.animationPresets` (antes fijo `talk-calm`).

Por escena:

- **backgroundResourceId** y **cameraPreset**: la cámara se valida contra
  `capabilities.cameraPresets` del fondo. `static` es una **elección legítima**
  de la IA (el compilador la soporta); ya no se coerciona a `slow-pan`.
- **layoutPreset**: se elige por **ID de preset**, no por coordenadas libres. El
  vocabulario es un dato validado por schema en
  `public/assets/catalog/layout-presets.json` (`schema/layout-presets.schema.json`).
  Agregar una composición nueva = editar ese JSON; la IA la ve en el enum en la
  próxima propuesta. Presets actuales: `balanced`, `focus-a`, `focus-b`,
  `close-up-a`, `close-up-b`, `wide`, `stacked`.
- **transitionPreset** (`cut`/`fade`) y **transitionDurationSeconds**: el fundido
  usa una duración elegida por la IA en el rango cerrado `0.15–1.0 s`; `cut` es 0.
- **dialogue**: 2–6 turnos, texto ≤300, gesto validado por personaje, pausa ≤2 s.
  Cada turno puede elegir `pace` (`slow|normal|fast`), `gestureAtWord` y un
  `layoutPreset` dinámico. Los layouts interpolan durante 0,35 s.
- **musicResourceId**: pista opcional por video, elegida entre recursos `music`.
  El runtime la repite y mezcla a -14 dB durante voz y -6 dB en pausas/colas.

Expresión y runtime:

- **Boca**: seis estados (`closed`, `medium`, `open`, `round`, `labiodental`,
  `bilabial`). El alineador vigente combina grafemas españoles con límites de
  actividad RMS; conserva fallback RMS. No equivale todavía a tiempos fonéticos
  entregados por Piper/espeak-ng.
- **Gestos**: `neutral`, `point`, `celebrate`, `doubt` y `deny`; un gesto no
  neutral dura como máximo 1,2 s y puede comenzar en una palabra indicada.
- **Idle**: perfiles `breathing`, `sway` y `organic`, elegidos por seed.
  Preview y FFmpeg derivan sus curvas del evaluador temporal compartido.

Calidad de generación:

- **Contexto acotado**: antes de llamar al modelo, una búsqueda local puntúa
  etiquetas, nombres y capacidades. La selección inicial admite hasta 6
  personajes, 4 voces, 4 fondos y 3 músicas. El JSON Schema de esa petición solo
  admite esos IDs. Al editar se anexan los recursos ya usados por el proyecto,
  aunque excepcionalmente superen esos límites.
- **Plantillas narrativas**: el Director recibe tres candidatas y una recomendada
  entre explicación, contraste, problema-solución, lista progresiva y
  transformación. Son beats combinables, no guiones rígidos; la selección queda
  registrada como `narrativeTemplateId`.
- **Observabilidad**: propuesta y edición exponen `context` con selección,
  puntajes y relación shortlist/inventario. La selección entra en caché.
- **Bucle de reparación**: ante `DIRECTOR_DURATION_BUDGET_EXCEEDED` se reintenta
  hasta 2 veces reinyectando el error como feedback. Solo se cachea el resultado
  final válido; el resultado expone `repairAttempts`.
- **think**: opción (default `false`). `think: true` activa el razonamiento del
  modelo (mejor plan, más lento en CPU). La UI lo expone como «Calidad máxima»;
  entra en la clave de caché y se refleja en `usage.think`.
- **Best-of-N**: la UI permite generar 1–3 variantes secuenciales. Con 2 o 3, un
  juez estructurado puntúa gancho, naturalidad, cierre y variedad; código
  determinista elige el mayor total y el índice menor en empates. La clave de
  caché incluye `bestOf` y la versión del juez.
- **System prompt**: guía por tono, estructura gancho→desarrollo→cierre, dos
  ejemplos breves por tono, aperturas variadas y reglas de ritmo para TTS.
- **Ollama caliente**: el proveedor conserva el modelo cargado 10 minutos por
  defecto. Puede ajustarse con `LOCAL_VIDEO_OLLAMA_KEEP_ALIVE` usando `0` o una
  duración acotada como `30s`, `10m` o `1h`.

## Edición (instrucción → comandos) · `project-editor-director.mjs`

El schema de edición cubre todo el editor (20 comandos). IDs existentes como enum
del proyecto real; IDs nuevos como patrón portable.

- **Estructura**: `add-scene`, `delete-scene`, `duplicate-scene`,
  `add-dialogue-turn`, `delete-dialogue-turn`, `reorder-scenes`,
  `set-dialogue-speaker`.
- **Campos**: `set-character-transform` acepta `x/y/scale/zIndex`;
  `set-dialogue-turn` acepta
  `text/voiceId/gestureId/gestureAtWord/pace/layoutPreset/gapAfterSeconds`; el
  texto de diálogo se unifica en ≤300 en ambos caminos.
- **Resumen para la IA** (`summarizeProject`): incluye pose, animación, escala,
  profundidad, gesto, timing, ritmo, layout, pausa y transición por escena,
  compacto para el modelo 8B.

## Reglas duras

- Sin APIs externas: la guarda de loopback (`normalizeLoopbackUrl`) no se levanta.
- Schemas cerrados: nada de x/y/escala libres en la **propuesta** (solo presets);
  las coordenadas libres solo existen en la **edición**, validadas por rango.
- Cualquier cambio de schema/prompt/normalizador va con un bump de
  `DIRECTOR_PIPELINE_VERSION` (`scripts/director/version.mjs`), uno por lote, que
  invalida caché y `semanticHash` viejos de forma coherente.
