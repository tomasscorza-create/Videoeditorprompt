# Plan de acción IA — 24 de julio de 2026

> Documento operativo derivado de `AUDITORIA_IA_DIRECTOR_2026-07-24.md`. Para
> ejecución por agente (Claude Opus). Objetivo en dos partes, en este orden:
>
> 1. **Maximizar lo que la IA local (Ollama, tal como está conectada) puede
>    expresar al crear** — sin conectar ninguna API externa.
> 2. **Dejar el sistema preparado** para que futuras IAs se integren de forma
>    simple, cuando el usuario lo decida — sin conectarlas todavía.

## Contexto mínimo

- Dos caminos de IA, ambos Ollama HTTP loopback (`scripts/director/`):
  `ollama-director.mjs` (propuesta prompt→plan) y `project-editor-director.mjs`
  (instrucción→lote de comandos del editor). Ambos con salida forzada por JSON
  Schema con `enum` cerrados, caché por hash, y validación completa aguas abajo.
- El catálogo que ve la IA ya es el fusionado (repo + biblioteca del usuario) vía
  `library.catalog()` en `server.mjs`.
- Verificación estándar tras cada tarea: `npx tsc --noEmit` + `npm test` +
  `npm run build`, todo verde.

## Reglas duras (no negociables)

1. **Nada de APIs externas en este plan.** La guarda de loopback
   (`normalizeLoopbackUrl`) no se levanta ni se debilita.
2. **Schemas cerrados siempre**: cada campo nuevo que la IA pueda emitir lleva
   `enum`/rangos construidos desde el catálogo o el proyecto real. Ningún string
   libre nuevo salvo texto de guion con `maxLength`.
3. **Cualquier cambio en el schema del plan o el normalizador exige bump de
   `DIRECTOR_PIPELINE_VERSION`** (`scripts/director/version.mjs`) — invalida
   caché y semanticHash viejos de forma coherente. Un solo bump por lote de
   cambios, no uno por tarea.
4. La IA sigue sin escribir el proyecto directamente: todo pasa por
   `normalizeDirectorPlan` o `applyProjectEditorCommand`.
5. No tocar límites del compilador (`exactamente 2 personajes`, `≥2 turnos`):
   son contrato del motor, fuera de alcance.
6. Sin dependencias nuevas. Determinismo del normalizador intacto.
7. Cada tarea amplía sus suites (`director:test-plan`, `director:test-ollama`,
   `director:test-editor`) y `stage3b:test-contracts` debe seguir verde.

---

## Fase A — Expresividad de la propuesta (prompt → video)

Fuente: auditoría §2.1. Hoy el normalizador decide por código cosas que el motor
soporta. Cada tarea abre una decisión al modelo, siempre validada contra
`capabilities` del catálogo.

### A1 · La IA elige la animación de cada personaje
- **Qué:** agregar `animationPreset` al plan (por miembro del cast o por escena;
  elegir la granularidad que el motor ya soporte sin cambios). Enum construido
  desde `capabilities.animationPresets` del personaje elegido (incluye los presets
  de movimiento deterministas del 24-jul). Eliminar el hardcode `talk-calm`
  (`director-plan.mjs:133`).
- **Archivos:** `schema/ai-video-plan.schema.json`, `director-plan.mjs`
  (normalizeScene + validateDirectorPlan), `ollama-director.mjs`
  (buildOllamaPlanSchema), suites.
- **Cierre:** un plan con preset inválido para ese personaje es rechazado con
  `DIRECTOR_RESOURCE_UNSUPPORTED`; uno válido llega al proyecto normalizado.

### A2 · Pose inicial elegible
- **Qué:** exponer `poseId` (hoy hardcodeado `neutral`, `director-plan.mjs:132`)
  con enum desde `capabilities.poses` del personaje.
- **Cierre:** igual patrón que A1.

### A3 · Duración de transición elegible
- **Qué:** `transitionDurationSeconds` en la escena del plan (rango cerrado, p. ej.
  0.15–1.0 para `fade`; `cut` sigue 0). Reemplaza el 0.35 fijo
  (`director-plan.mjs:156`). El editor ya acepta duraciones (`set-transition`).
- **Cierre:** fade de 0.6 s pedido por la IA sobrevive hasta el proyecto validado.

### A4 · Vocabulario de layouts como datos, no como código
- **Qué:** mover `LAYOUTS` (`director-plan.mjs:16-29`) a un archivo de datos
  validado por schema (p. ej. `public/assets/catalog/layout-presets.json`) y
  ampliar el vocabulario con 3–5 composiciones nuevas útiles para vertical
  (p. ej. `close-up-a`, `close-up-b`, `wide`, `stacked`). El plan sigue eligiendo
  por ID de preset — **no** x/y libres, que arriesgan composiciones rotas.
- **Cierre:** agregar un layout nuevo = editar el JSON, sin tocar código; la IA
  lo ve en el enum en la siguiente propuesta.

### A5 · Política de cámara explícita
- **Qué:** hoy `static` está prohibido en el schema de la IA y coercionado a
  `slow-pan` (`director-plan.mjs:141`, `ollama-director.mjs:152`). Decidir una
  política y hacerla coherente: o `static` es válido (quitar coerción y filtro) o
  se documenta por qué no. Preguntar al usuario si hay duda; default sugerido:
  permitir `static` como elección legítima de la IA.
- **Cierre:** schema, normalizador y docs dicen lo mismo.

---

## Fase B — El copiloto de edición alcanza todo el editor

Fuente: auditoría §2.2. El editor tiene 19 comandos; el schema de edición IA
expone 9 formas. Todo esto es ampliar `commandBatchSchema`
(`project-editor-director.mjs`) + suites; el embudo `applyProjectEditorCommand`
ya valida cada comando.

### B1 · Comandos estructurales
- **Qué:** habilitar en el schema de edición: `add-scene`, `delete-scene`,
  `duplicate-scene`, `add-dialogue-turn`, `delete-dialogue-turn`,
  `reorder-scenes`, `set-dialogue-speaker`. Enums de IDs desde el proyecto real,
  como ya se hace. Respetar los límites del contrato (≥2 turnos por escena,
  1–4 escenas): si un comando los violaría, el editor lo rechaza — verificar que
  el error llega legible a la UI.
- **Cierre:** «agregá una escena de cierre con 2 turnos» y «borrá el turno 3 de
  la escena 2» funcionan de punta a punta; instrucciones que dejarían el proyecto
  inválido devuelven error claro, no un proyecto roto.

### B2 · Cobertura completa de campos
- **Qué:** en el schema de edición: `scale` y `zIndex` en
  `set-character-transform` (rangos del contrato del editor); `gestureId` y
  `gapAfterSeconds` como variantes de `set-dialogue-turn`; unificar el límite de
  texto con el plan (hoy 500 vs 300 — elegir uno, sugerido 300, y aplicarlo en
  ambos).
- **Cierre:** «hacé más grande al personaje A» y «poné una pausa después del
  turno 1» funcionan.

### B3 · Resumen de proyecto más rico para la IA
- **Qué:** `summarizeProject` no incluye gestos, pausas, animación, transiciones
  ni duración medida si existe. Agregar lo que B1/B2 vuelven editable, cuidando
  el tamaño del contexto (es un modelo 8B en CPU: mantener el resumen compacto,
  sin campos redundantes).
- **Cierre:** la IA puede referirse a lo que ahora puede editar sin adivinar.

---

## Fase C — Calidad de generación con el mismo modelo

### C1 · Bucle de reparación por presupuesto
- **Qué:** el fallo real más frecuente es `DIRECTOR_DURATION_BUDGET_EXCEEDED`
  (guion más largo que el presupuesto de palabras). Ante ese error, reintentar
  automáticamente (máx. 2 intentos) reinyectando el error como feedback en el
  prompt de usuario («el guion tiene N palabras y el máximo es M: recortá
  manteniendo gancho y cierre»). Solo se cachea el resultado final válido.
- **Archivos:** `ollama-director.mjs` (createDirectorProposal), suite con
  `fetchImpl` falso que devuelve primero un plan excedido y luego uno válido.
- **Cierre:** la suite demuestra reintento → éxito y reintento → fallo definitivo
  con el error original; sin bucles infinitos; el resultado indica
  `repairAttempts`.

### C2 · System prompt con oficio
- **Qué:** hoy son 9 líneas genéricas (`buildSystemPrompt`). Agregar: guía breve
  por tono (qué hace “ironic” distinto de “educational”), estructura
  gancho→desarrollo→cierre con ejemplo mínimo de UN guion bueno (pocas líneas,
  es contexto de un 8B en CPU), y reglas de ritmo (frases cortas, sin
  enumeraciones largas para TTS).
- **Cierre:** bump de versión (regla 3) para que la caché no mezcle; comparación
  manual de 3–5 prompts fijos antes/después usando `variant` (el usuario juzga).

### C3 · Modo «calidad máxima» opcional
- **Qué:** exponer `think` como opción (`think: true` para qwen3 = razonamiento
  activado, más lento en CPU pero mejor plan). Default sigue `false`. Llega como
  opción de la petición del Director (igual que `temperature`), con timeout
  acorde, y la UI puede ofrecerlo como checkbox «propuesta más elaborada
  (lenta)».
- **Cierre:** opción validada, cacheada como parte de la clave, y visible en el
  resultado (`usage`).

### C4 · Tarea del usuario (sin código): ampliar el catálogo
- La palanca de calidad dominante (auditoría §2.3.1): crear personajes y fondos
  en el Creador/biblioteca; instalar más voces Piper si existen para es-AR/es-ES.
  El Director los ve automáticamente. El agente no puede hacer esta tarea; solo
  recordarla al reportar.

---

## Fase D — Preparar la integración simple de futuras IAs (sin conectarlas)

Fuente: auditoría §3. Objetivo: que sumar un proveedor sea «implementar una
interfaz + registrarla», sin tocar el resto.

### D1 · Extraer la interfaz de proveedor
- **Qué:** definir `DirectorProvider` con tres operaciones:
  `generatePlan({messages|prompt, schema, options, signal})`,
  `generateCommands({instruction, schema, projectSummary, options, signal})`,
  `inspect()` (salud + modelo disponible). Mover TODO lo específico de Ollama
  (forma de petición `format/think/keep_alive/seed/num_predict`, parsing de
  `message.content`, `/api/version`, `/api/tags`, guarda de loopback) a
  `scripts/director/providers/ollama.mjs` como primera implementación.
  `ollama-director.mjs` y `project-editor-director.mjs` quedan agnósticos:
  construyen schema/prompts/caché y delegan la llamada al proveedor.
- **Restricción:** cero cambio de comportamiento observable. Las suites actuales
  (con `fetchImpl` falso) deben pasar sin modificar sus aserciones — solo puede
  cambiar cómo se inyecta el mock.
- **Cierre:** `npm test` verde; `git diff` no toca schema ni normalizador;
  la clave de caché incorpora el proveedor (hoy implícito `ollama`).

### D2 · Registro de proveedores y selección por petición
- **Qué:** un registro simple (`providers/index.mjs`) con `ollama` como único
  registrado. `server.mjs` acepta `provider` opcional en
  `/api/director/proposals` y `/api/director/edits` (default `ollama`; valor no
  registrado → error claro `DIRECTOR_PROVIDER_UNKNOWN`). `/api/health` reporta
  el estado por proveedor registrado.
- **Cierre:** pedir `provider: "ollama"` explícito funciona igual que hoy;
  pedir `provider: "x"` da error legible; la UI no cambia todavía.

### D3 · Prueba de contrato de proveedor
- **Qué:** una suite genérica que recibe cualquier implementación de
  `DirectorProvider` y verifica el contrato: devuelve JSON parseable que cumple
  el schema pedido, respeta `signal` (abortable), propaga errores con la
  taxonomía `PipelineError`, y su `inspect()` responde en la forma esperada.
  Correrla contra el proveedor Ollama mockeado. Esta suite es la que le da al
  futuro integrador la definición ejecutable de «qué tiene que cumplir».
- **Cierre:** registrada en `test-core.mjs`; documentación breve del contrato en
  `docs/PROVEEDORES_IA.md` (interfaz, garantías, qué NO puede asumir un
  proveedor — p. ej. determinismo por seed es opcional y se declara).
- **Nota explícita:** las decisiones de producto para conectar una IA web
  (privacidad/opt-in, API keys por variable de entorno, no-determinismo, costo)
  quedan documentadas como pendientes del usuario en ese mismo doc. **Este plan
  no las implementa.**

---

## Orden de ejecución sugerido

`A1→A2→A3` (un solo bump de versión) → `B1→B2→B3` → `C1` → `C2+C3` (otro bump) →
`A4→A5` → `D1→D2→D3`. Fase D al final a propósito: refactorizar sobre
comportamiento ya probado, no al revés. C4 corre en paralelo (usuario).

## Qué NO hacer

- No conectar ni esbozar clientes de APIs externas (ni siquiera detrás de flags).
- No levantar la guarda de loopback ni manejar API keys.
- No permitir x/y/escala libres en la **propuesta** (solo presets de layout);
  las coordenadas libres existen solo en el camino de **edición**, que ya las
  valida por rango.
- No agregar campos de texto libre a los schemas de IA.
- No tocar compilador, Piper, evaluador de escena ni el render.
- No subir `num_predict`/contexto sin medir latencia en CPU primero.
- No mezclar caché: cada cambio de schema/prompt/normalizador va con su bump de
  `DIRECTOR_PIPELINE_VERSION` (uno por lote).

## Traza

| Tarea | Fuente en auditoría IA | Estado |
| --- | --- | --- |
| A1–A2 | §2.1 (animación/pose hardcodeadas) | hecho (lote 1) |
| A3 | §2.1 (fade fijo 0.35) | hecho (lote 1) |
| A4 | §2.1 (3 layouts congelados) | hecho (lote 5) |
| A5 | §2.1 (static coercionado) | hecho (lote 5, static permitido) |
| B1 | §2.2 (sin comandos estructurales) | hecho (lote 2) |
| B2 | §2.2 (campos faltantes, 300/500) | hecho (lote 2, unificado en 300) |
| B3 | §2.2 (resumen pobre) | hecho (lote 2) |
| C1 | §2.3.3 (sin reparación) | hecho (lote 3) |
| C2 | §2.3.4 (prompting mínimo) | hecho (lote 4); comparación manual pendiente (usuario) |
| C3 | §2.3 (think apagado) | hecho (lote 4) |
| C4 | §2.3.1 (catálogo chico) | pendiente (usuario) |
| D1–D3 | §3.2–§3.3 (adaptador) | hecho (lote 6) |
