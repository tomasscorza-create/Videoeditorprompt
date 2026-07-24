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

Calidad de generación:

- **Bucle de reparación**: ante `DIRECTOR_DURATION_BUDGET_EXCEEDED` se reintenta
  hasta 2 veces reinyectando el error como feedback. Solo se cachea el resultado
  final válido; el resultado expone `repairAttempts`.
- **think**: opción (default `false`). `think: true` activa el razonamiento del
  modelo (mejor plan, más lento en CPU). Entra en la clave de caché y se refleja
  en `usage.think`.
- **System prompt**: guía por tono, estructura gancho→desarrollo→cierre con un
  ejemplo mínimo, y reglas de ritmo para TTS.

## Edición (instrucción → comandos) · `project-editor-director.mjs`

El schema de edición cubre todo el editor (20 comandos). IDs existentes como enum
del proyecto real; IDs nuevos como patrón portable.

- **Estructura**: `add-scene`, `delete-scene`, `duplicate-scene`,
  `add-dialogue-turn`, `delete-dialogue-turn`, `reorder-scenes`,
  `set-dialogue-speaker`.
- **Campos**: `set-character-transform` acepta `x/y/scale/zIndex`;
  `set-dialogue-turn` acepta `text/voiceId/gestureId/gapAfterSeconds`; el texto de
  diálogo se unifica en ≤300 en ambos caminos.
- **Resumen para la IA** (`summarizeProject`): incluye pose, animación, escala,
  profundidad, gesto, pausa y transición por escena, compacto para el modelo 8B.

## Reglas duras

- Sin APIs externas: la guarda de loopback (`normalizeLoopbackUrl`) no se levanta.
- Schemas cerrados: nada de x/y/escala libres en la **propuesta** (solo presets);
  las coordenadas libres solo existen en la **edición**, validadas por rango.
- Cualquier cambio de schema/prompt/normalizador va con un bump de
  `DIRECTOR_PIPELINE_VERSION` (`scripts/director/version.mjs`), uno por lote, que
  invalida caché y `semanticHash` viejos de forma coherente.
