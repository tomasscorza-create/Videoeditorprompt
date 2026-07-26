# Auditoría de la integración IA (Director) — 24 de julio de 2026

Pregunta que responde: ¿el sistema interno ofrece más de lo que la IA puede usar?
¿Cómo está conectada la IA local, se puede reemplazar, y se pueden conectar
varias IAs (local + API web) reaprovechando el mismo sistema?

Solo auditoría; no se modificó código.

---

## 1. Cómo está conectada la IA hoy

**Por API HTTP, no embebida.** Ollama corre como servicio en `http://127.0.0.1:11434`
y el repo le habla por HTTP (`/api/chat` para generar, `/api/version` + `/api/tags`
para salud). El modelo (`qwen3:8b` por defecto), la URL, la temperatura y el timeout
son opciones, no constantes del sistema.

Hay **dos caminos de IA**, ambos sin estado y con caché por hash de contenido:

| Camino | Entrada | Salida | Archivo |
| --- | --- | --- | --- |
| **Propuesta** (prompt → video completo) | idea + restricciones (tono, duración, nº escenas) | plan `ai-video-plan` v1 → normalizado a `video-project` v1 | `scripts/director/ollama-director.mjs` |
| **Edición** (instrucción → cambios) | frase en lenguaje natural + proyecto actual | lote de ≤12 comandos del editor, aplicados por `applyProjectEditorCommand` | `scripts/director/project-editor-director.mjs` |

Lo mejor del diseño: **la IA nunca escribe el proyecto directamente.** En ambos
caminos produce JSON forzado por schema (Ollama `format`) cuyos `enum` se construyen
en tiempo real desde el catálogo y desde los IDs reales del proyecto; después pasa
por el mismo embudo de validación que una edición humana (normalizador + Ajv +
editor + compilador, con prueba de equivalencia entre ellos). Un plan alucinado no
puede llegar al render.

El catálogo que ve la IA es el **fusionado** (`library.catalog()` = recursos del
repo + biblioteca durable del usuario): los personajes que creás en el Creador ya
son elegibles por el Director sin tocar código.

Guardas deliberadas: URL restringida a loopback (`normalizeLoopbackUrl` rechaza
cualquier host no local), una sola operación de Director en vuelo por servidor,
cancelación por `AbortController`, timeout 240 s.

---

## 2. La brecha: qué ofrece el motor que la IA no puede usar

Confirmada la hipótesis: **el sistema interno ya soporta bastante más de lo que la
IA tiene permitido expresar.** El editor define 19 comandos; la IA alcanza una
fracción, y la propuesta inicial fija por código varias decisiones creativas.

### 2.1 En la propuesta (prompt → video)

El plan solo puede expresar: elenco de 2, 1–4 escenas, y por escena fondo + cámara
+ 1 de 3 layouts fijos + transición cut/fade + 2–6 turnos (texto ≤300, gesto
`neutral|point`, pausa ≤2 s). Todo lo demás lo decide el normalizador con valores
duros (`director-plan.mjs`):

| Capacidad del motor | Qué hace hoy el normalizador |
| --- | --- |
| Transform libre x/y/escala/zIndex por personaje | 3 layouts congelados (`LAYOUTS`, líneas 16-29) |
| `animationPreset` (`idle-calm`, `talk-calm`, + presets de movimiento nuevos del 24-jul) | hardcodeado `talk-calm` para todos (línea 133) |
| `poseId` por elemento | hardcodeado `neutral` (línea 132) |
| Duración de transición configurable | fade fijo en 0.35 s (línea 156) |
| Cámara `static` | prohibida en el schema de la IA y coercionada a `slow-pan` (línea 141) |
| Elenco variable por escena | mismos 2 personajes en todas las escenas |

### 2.2 En la edición (instrucción → comandos)

El schema de edición (`commandBatchSchema`) expone 9 formas de comando. Quedan fuera,
aunque el editor los soporta:

- **Todo lo estructural**: `add-scene`, `delete-scene`, `duplicate-scene`,
  `add-dialogue-turn`, `delete-dialogue-turn`, `add-character`, `delete-element`,
  `place-character-resource`, `reorder-scenes`, `set-dialogue-speaker`.
  “Agregá una escena de cierre” o “borrá el turno 3” no se pueden pedir por IA
  aunque el humano lo haga con un clic.
- `set-character-transform` solo acepta x/y — sin `scale` ni `zIndex`.
- `set-dialogue-turn` solo texto o voz — sin gesto ni pausa.
- Inconsistencia menor: texto ≤500 en edición vs ≤300 en propuesta.

### 2.3 Lo que limita la calidad y NO es el modelo

En orden de impacto estimado:

1. **El vocabulario del catálogo integrado**: 2 personajes, 2 voces, 1 fondo,
   2 gestos, 2 presets de animación. Con ese espacio creativo, `qwen3:70b` y
   `qwen3:8b` producen casi lo mismo. La biblioteca ya lo amplía sin código:
   cada personaje/fondo que crees se vuelve elegible al instante.
2. **La brecha de expresividad** de §2.1/§2.2.
3. **Una sola pasada, sin reparación**: si el guion excede el presupuesto de
   palabras (`DIRECTOR_DURATION_BUDGET_EXCEEDED`) el plan se descarta con error;
   no hay reintento automático con feedback (“recortá ~12 palabras”). Es el modo
   de fallo más frecuente porque el schema ya previene los demás.
4. **Prompting mínimo**: el system prompt son 9 líneas genéricas; sin ejemplos de
   buenos guiones por tono, sin guía de ritmo/gancho. Mejora barata y directa.
5. **Techo de render, independiente del Director**: voces Piper y boca por
   envolvente RMS (no fonemas). Un plan perfecto suena a Piper igual.

Nota sobre el modelo: `qwen3:8b` corre con `think: false` (razonamiento apagado)
para mantener latencia en CPU; probar `qwen3:14b`/`qwen3:32b` u otro modelo local es
cambiar la opción `model` — cero código, y la caché ya separa por modelo.

---

## 3. ¿Se puede reemplazar la IA o sumar otras? Sí — con un adaptador

### 3.1 Qué es agnóstico al proveedor (lo reaprovechable)

Casi todo: schema del plan, construcción de enums desde catálogo, restricciones,
normalización, validación en cadena, presupuesto de palabras, caché por hash
(ya incluye `model` en la clave), taxonomía de errores, endpoints del servidor,
UI. **Ese es el “sistema interno” y está bien construido para múltiples IAs.**

### 3.2 Qué es específico de Ollama (lo que pide adaptador)

Concentrado en ~2 archivos:

- Forma de la petición: `format` (salida estructurada de Ollama), `think`,
  `keep_alive`, `options.seed/num_predict`.
- Forma de la respuesta: `message.content`, `eval_count`, `total_duration`.
- Salud: `/api/version` + `/api/tags`.
- La guarda de loopback, que hoy **rechaza a propósito** cualquier URL no local.

Un proveedor web (Anthropic/OpenAI) ofrece equivalentes de salida estructurada
(tool use / `response_format` con JSON Schema), así que el contrato “devolveme un
JSON que cumpla este schema” se conserva. Sin dependencias nuevas: `fetch` alcanza.

### 3.3 Diseño sugerido para N proveedores

Interfaz mínima `DirectorProvider`: `generatePlan({prompt, schema, constraints,
signal})` y `generateCommands({instruction, schema, projectSummary, signal})` +
`inspect()`. `ollama-director.mjs` se convierte en la primera implementación; una
`anthropic-director.mjs`/`openai-director.mjs` sería la segunda. El servidor agrega
`provider` como opción de la petición (igual que hoy acepta `model`).

Con eso, los tres escenarios que preguntás:

- **Reemplazar**: elegir otro proveedor/modelo por configuración. Trivial dentro
  de Ollama hoy mismo; con adaptador, también hacia web.
- **Dos IAs conviviendo (local + web)**: sí. Como ambos caminos son funciones sin
  estado, pueden coexistir: local para borradores rápidos/privados, web para pasada
  de calidad. La caché no colisiona (clave incluye modelo).
- **Varias en paralelo**: sí, y encaja con una deuda ya declarada del roadmap:
  “comparar variantes”. Pedir el mismo prompt a N proveedores y mostrar las
  propuestas lado a lado reutiliza el embudo de validación tal cual — cualquier
  plan, venga de donde venga, pasa por el mismo control.

### 3.4 Costos y decisiones que implica sumar una IA web (no técnicos)

1. **Privacidad/principio local-first**: hoy el prompt del usuario nunca sale de la
   máquina, y la guarda de loopback lo garantiza por código. Sumar web = decisión
   de producto explícita, opt-in por proveedor, documentada (ROADMAP/AGENTS).
2. **Secretos**: el repo no maneja ninguna clave hoy. Una API web necesita API key
   por variable de entorno (nunca en el repo ni en la UI).
3. **Determinismo**: la propuesta local es reproducible por `seed`; las APIs web no
   garantizan eso. La caché lo mitiga (misma petición → mismo resultado guardado),
   pero el rótulo “determinista” del plan dejaría de aplicar al proveedor web.
4. **Costo por uso**: hoy el costo marginal es cero; con web aparece facturación
   por token. Conviene mostrar el proveedor usado en cada propuesta (la UI ya
   muestra `model`).

---

## 4. Orden sugerido (mayor calidad por esfuerzo)

1. **Ampliar el catálogo usando la biblioteca** (personajes, fondos, voces si hay
   más modelos Piper): cero código, es la palanca de calidad dominante hoy.
2. **Cerrar la brecha de expresividad barata**: dejar que la propuesta elija
   `animationPreset` y pose; exponer duración de transición; agregar gesto/pausa y
   `scale` al schema de edición; unificar 300/500.
3. **Comandos estructurales en el camino de edición** (`add/delete-scene`,
   `add/delete-dialogue-turn`, `reorder-scenes`): convierte “editá esto” en un
   copiloto real. El embudo de validación ya existe; es solo ampliar el schema.
4. **Bucle de reparación**: ante presupuesto excedido, un reintento automático con
   el error como feedback en el prompt (máx. 1–2 intentos, cacheado).
5. **Mejorar el system prompt**: ejemplos por tono, guía de gancho/ritmo. Barato,
   medible con las variantes.
6. **Adaptador de proveedor + primera IA web opt-in**, con las cuatro decisiones
   de §3.4 resueltas por escrito. Después: comparación de variantes multi-proveedor.
7. En paralelo, recordar el techo de render (§2.3.5): si tras 1–5 la calidad
   percibida sigue corta, el siguiente salto es de voces/boca, no del Director.
