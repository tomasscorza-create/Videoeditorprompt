# Plan de acción Timeline profesional — 25 de julio de 2026

> Documento operativo para ejecución por agente (Claude Opus). Objetivo: convertir
> la timeline en un panel de edición profesional, integrado y directo — al nivel
> visual de un NLE (referencias del usuario: CapCut, DaVinci Resolve) — **sin
> simular nunca capacidades que el motor no tiene**. Mantener lo intuitivo como
> criterio de aceptación, no como adorno.

## Auditoría: qué existe hoy (no redescubrir)

`src/ui/timeline.ts` (~670 líneas) + `src/ui/editor-workspace.ts` (fuente única de
modo/superficie/tiempo/vigencia). Ya funciona:

- **Dos modos honestos**: editorial (sin render vigente: anchos proporcionales a
  palabras, sin tiempos inventados) y medido (alineado al último MP4; se invalida
  con `stale` ante cualquier cambio de contenido).
- **Pistas**: regla, divisor VISUAL, pista BG (una por escena), V1..Vn por
  personaje, divisor AUDIO, A1..An por voz (un clip por turno, ancho por palabras).
- **Interacción**: reordenar escenas por drag & drop (`reorder-scenes`), duplicar
  y eliminar desde toolbar (`duplicate-scene`/`delete-scene`/`delete-element`/
  `delete-dialogue-turn`), selección integrada con el inspector
  (`projectSelection`), playhead con clic en regla + snap a fronteras de escena,
  seguimiento en reproducción, zoom/fit, mute global, undo/redo.
- **Atajos**: Espacio, ←/→ (±0.5/5 s), ↑/↓ (fronteras), Home/End, S (snap),
  M (mute), J/K/L, F (fit), +/−, Supr.
- **Datos medidos disponibles** (`MeasuredScene`): `startSeconds`/`endSeconds` por
  escena, `audioDurationSeconds`, y transición con `preset`, `durationSeconds`,
  `startSeconds`, `endSeconds`. **No hay tiempos por turno** en el manifiesto final.

Lo que falta respecto a las referencias: capa de lectura (ondas de audio,
miniaturas de frames, transiciones visibles, silencios) y capa de manipulación en
el lienzo mismo (editar uniones, ajustar pausas arrastrando, menú contextual,
insertar desde la timeline, soltar recursos sobre clips).

## Reglas duras

1. **Honestidad temporal**: prohibido el arrastre libre de clips en el tiempo, el
   estirado y el recorte por frames. En este motor la duración nace del TTS
   medido; “recortar” se expresa editando contenido (turnos, pausas, splits).
   Nada de affordances que prometan lo contrario (sin manijas de trim en los
   clips de video, sin cursor de estirado).
2. **Todo cambio pasa por `store.dispatch`** (comandos del editor). La timeline
   no escribe el proyecto por otra vía.
3. **Paridad**: ninguna acción exclusiva de la timeline; todo lo que se pueda
   hacer ahí debe poder hacerse desde el inspector, y viceversa cuando aplique.
4. **Sin dependencias nuevas**: ondas con Web Audio API, miniaturas con
   `<video>` + canvas — todo nativo.
5. Trabajo pesado (decodificar audio, extraer frames) **async, fuera del hilo de
   render de la UI, y cacheado por `output.url`** — nunca se recalcula en cada
   `notify()` (hoy `renderLayerStack` reconstruye todo el DOM en cada cambio;
   las cachés deben sobrevivir a eso).
6. Los dos modos (editorial/medido) y el marcado `stale` se conservan tal cual.
7. Verificación estándar por tarea: `npx tsc --noEmit` + `npm test` +
   `npm run build`. Ampliar `ui:test-modules` con la lógica pura nueva
   (geometría de clips, mapeo tiempo↔turno, picos de onda).
8. Tareas marcadas **[motor]** tocan `shared/`/`scripts/` y contratos: van en
   commits separados, con bump de versión de contrato si cambia el manifiesto, y
   sus suites (`stage3a`, `stage3b:test-contracts`) verdes.

## Mapa de referencias → equivalente honesto aquí

| Lo que el usuario vio en CapCut/Resolve | Equivalente en este sistema | Fase |
| --- | --- | --- |
| Onda de audio visible, silencios identificables | Onda real decodificada del MP4 renderizado (modo medido); marcas de pausa desde `gapAfterSeconds` (dato exacto, mejor que detectar silencio) | A1, A4 |
| Frames del video sobre los clips | Miniaturas extraídas del MP4 (medido) y póster de composición por escena (editorial) | A2 |
| Transiciones arrastradas a las uniones | Chip de unión entre escenas: clic cicla cut/fade, popover para duración (`set-transition` ya existe); los datos medidos ya traen inicio/fin de cada transición | A3, B1 |
| Recortar/dividir clips | Split de escena en frontera de turno + ajuste de pausas arrastrando + borrar turnos — recorte por contenido, no por frames | B2, C1–C3 |
| Bajar el sonido desde la barra | Mute global hoy; ganancia por escena/turno requiere motor (mezcla FFmpeg) — no simular con un slider muerto | D3 |
| Acomodar/duplicar desde la timeline | Ya existe (drag reorder, duplicar, eliminar); se completa con menú contextual e inserción in situ | B3, B4 |

---

## Fase A — Lectura profesional (la timeline se ve como un NLE)

### A1 · Onda de audio real en modo medido
- **Qué:** decodificar el audio del MP4 vigente (`output.url`) con
  `AudioContext.decodeAudioData`, reducir a picos por ventana (p. ej. 200/s), y
  dibujar la onda en canvas dentro de los clips de las pistas A. Caché de picos
  por `output.url`; invalidar al cambiar de output. En editorial no hay onda (no
  hay audio): mantener el bloque actual con etiqueta honesta.
- **Cierre:** con render vigente se ven las ondas y los silencios entre frases a
  simple vista; sin render, nada cambia; scroll/zoom fluidos (la onda se redibuja
  desde picos cacheados, no re-decodifica).

### A2 · Miniaturas de frames en los clips visuales
- **Qué:** en medido, extraer N miniaturas por escena (proporcional al ancho del
  clip) con un `<video>` oculto (seek + `drawImage` a canvas), async y cacheado
  por `output.url` + escena. En editorial, un póster estático por escena desde el
  preview de composición (`src/ui/project/composition.ts`) o, si no es viable
  barato, miniatura del fondo + personajes del catálogo.
- **Cierre:** los clips BG muestran imagen real como en las referencias; la
  extracción no congela la UI (progresiva, primero un frame, luego el resto).

### A3 · Transiciones y pausas visibles
- **Qué:** chip en cada unión de escenas mostrando el preset actual (`✂` cut /
  `◇ 0.35s` fade) usando `transitionToNext`; en medido, ubicado en su tiempo real
  (`transition.startSeconds`). Marcas de pausa (`gapAfterSeconds > 0`) como
  huecos rotulados entre clips de diálogo.
- **Cierre:** transiciones y silencios editoriales son visibles sin abrir el
  inspector.

### A4 · Regla con subdivisiones
- **Qué:** en medido, marcas de segundos (y medios/cuartos según zoom) además de
  las fronteras de escena; en editorial, mantener solo E1/E2… (sin inventar
  tiempos).
- **Cierre:** a zoom alto la regla se lee como en Resolve; el timecode ya existe.

## Fase B — Manipulación directa sobre la timeline

### B1 · Unión editable
- **Qué:** el chip de A3 es interactivo: clic cicla cut↔fade; clic largo o botón
  secundario abre popover con duración (rango del contrato). Despacha
  `set-transition`. Deshabilitado nunca: siempre hay una transición válida entre
  escenas.
- **Cierre:** cambiar una transición no requiere el inspector; undo la revierte.

### B2 · Ajustar pausas arrastrando
- **Qué:** el borde derecho de cada clip de diálogo (la zona del gap) se puede
  arrastrar horizontalmente para ajustar `gapAfterSeconds` (0–2 s, con snap a
  0.1 s), despachando `set-dialogue-turn` al soltar. En editorial el mapeo
  px→segundos usa la escala nominal y se rotula «pausa 0.4 s»; en medido, la
  escala real. Es la única manija de arrastre temporal permitida porque edita un
  dato del contrato, no la duración de la voz.
- **Cierre:** “achicar los silencios” se hace arrastrando, como pidió el usuario;
  el clip de voz en sí no muestra manijas (regla 1).

### B3 · Menú contextual por clip
- **Qué:** clic derecho en clips de escena (duplicar, eliminar, insertar escena
  antes/después, mover izquierda/derecha, editar transición), de personaje
  (cambiar recurso → abre biblioteca filtrada, quitar), de diálogo (eliminar,
  cambiar hablante — `set-dialogue-speaker` —, insertar turno antes/después).
  Todo con comandos existentes. Cerrable con Esc, navegable por teclado.
- **Cierre:** las acciones frecuentes están a un clic del clip, sin buscar la
  toolbar; paridad con inspector intacta.

### B4 · Insertar desde la timeline
- **Qué:** botón «+» entre clips de escena (aparece al hover/foco) →
  `add-scene` con defaults del contrato; ídem entre turnos de diálogo →
  `add-dialogue-turn`. Respetar límites (1–4 escenas, turnos máx.) mostrando la
  razón real cuando se deshabilita.
- **Cierre:** construir estructura sin salir de la timeline.

### B5 · Soltar recursos de la biblioteca sobre clips
- **Qué:** aceptar drop de tarjetas de la biblioteca: fondo sobre clip BG →
  `set-scene-background`; personaje sobre clip de personaje →
  `set-character-resource`. Feedback de destino válido/ inválido durante el drag.
- **Cierre:** el gesto CapCut de “arrastrar el recurso al clip” funciona con los
  comandos ya existentes.

### B6 · Ctrl+Z / Ctrl+Y reales
- **Qué:** los tooltips ya los prometen y el handler actual ignora `ctrlKey`.
  Implementarlos globalmente (respetando `isTyping` para no pisar el undo nativo
  de los inputs).
- **Cierre:** el tooltip deja de mentir.

### B7 · Seleccionar sin cortar la reproducción
- **Qué:** hoy cualquier clic en un clip detiene la reproducción y vuelve al
  lienzo (contrato de vigencia). Refinar: en modo medido y reproduciendo, clic en
  un clip = seek a su inicio + selección, sin salir de playback; doble clic =
  comportamiento actual (lienzo + inspector). El contrato de vigencia (`stale` al
  editar) no cambia.
- **Cierre:** navegar el video clic a clic se siente como un NLE; editar sigue
  devolviendo al lienzo como hasta ahora.

## Fase C — «Recortes» honestos

### C1 · Recorte por contenido guiado
- **Qué:** acción «Acortar escena» (menú contextual B3): panel compacto que
  muestra los turnos con su conteo de palabras y las pausas, permitiendo borrar
  turnos y reducir pausas en un solo lugar, con el total estimado siempre
  rotulado como aproximado.
- **Cierre:** el flujo “este video quedó largo” tiene una herramienta directa.

### C2 · Dividir escena en la frontera de un turno **[motor]**
- **Qué:** comando nuevo `split-scene` en `shared/project-editor.js` +
  `schema/editor-command.schema.json`: divide una escena en dos a partir de un
  turno dado (la nueva hereda fondo/elencos/transición; reparte los turnos).
  Validar límites (≥2 turnos por lado, máx. escenas). UI: «Dividir aquí» en el
  menú del clip de diálogo, y `Ctrl+B`/tecla `B` con la selección activa.
- **Cierre:** suites `stage3b:test-editor` + `test-contracts` cubren el comando;
  la UI lo expone solo donde el resultado sería válido.

### C3 · Reordenar turnos por arrastre **[motor]**
- **Qué:** comando `reorder-dialogue-turns` (análogo a `reorder-scenes`) +
  drag & drop de clips de diálogo dentro de su escena.
- **Cierre:** ídem C2.

### C4 · Dividir en el playhead **[depende de D1]**
- **Qué:** con tiempos por turno en el manifiesto, «dividir en el playhead»
  mapea el tiempo actual a la frontera de turno más cercana y llama a C2. Hasta
  D1, la opción no aparece (no simular precisión que no existe).

## Fase D — Carril motor (habilitadores, commits separados)

### D1 · Tiempos por turno en el manifiesto final **[motor]**
- **Qué:** incluir inicio/duración medidos de cada turno (ya existen en el
  runtime por escena vía FFprobe) en la timeline que llega a la UI
  (`MeasuredScene.turns[]`). Es el habilitador mayor: clips de audio alineados de
  verdad, silencios exactos, C4, y karaoke del guion en el visor si se quisiera.
- **Cierre:** contrato versionado, suites de publicación y compatibilidad verdes;
  la timeline usa tiempos reales por turno en modo medido y elimina el prorrateo
  por palabras.

### D2 · Ganancia de audio por escena/turno **[motor, candidato]**
- **Qué:** volumen relativo (p. ej. 0.5–1.5) por turno o por escena aplicado en
  la mezcla FFmpeg, como propiedad del contrato + comando del editor. Habilita el
  gesto CapCut “bajar el sonido desde la barra” con un slider real en el clip.
- **Gate:** decidir tras uso real (T4 del plan general); no implementar antes.

### D3 · Pista de música de fondo **[motor, candidato mayor]**
- **Qué:** el motor no tiene concepto de música. Sería: recurso de audio en la
  biblioteca + pista M en el contrato + mezcla con ducking bajo las voces. Es la
  pieza más visible de las referencias (pista verde inferior en Resolve) y la más
  cara. **Gate:** demanda comprobada tras uso real; requiere decisión del usuario
  sobre licencias de música.

## Fase E — Pulido e intuición

- Ctrl+rueda = zoom centrado en el cursor; Shift+rueda = scroll horizontal.
- Colapsar/expandir grupos VISUAL y AUDIO (declutter en proyectos de 4 escenas).
- Todo botón deshabilitado lleva tooltip con la razón real (política ya escrita
  en la propuesta UX del 23-jul, regla 2).
- Clips navegables por teclado (foco visible, ←/→ entre clips con Tab/flechas,
  Enter = seleccionar, menú con tecla de menú contextual); `aria-label` con
  título + tiempos.
- Rendimiento: si A1/A2 muestran jank, memoizar filas por escena (clave:
  ids + anchos) antes de virtualizar — no optimizar de más para ≤4 escenas.

## Orden de ejecución sugerido

`A3→A4` (visibles, baratas) → `A1→A2` (lectura rica) → `B1→B2→B3→B4→B5→B6→B7` →
`C1` → **checkpoint con el usuario** → `C2→C3` [motor] → `D1` [motor] → `C4` →
`E` transversal desde el inicio. D2/D3 quedan gated a uso real.

## Qué NO hacer

- Manijas de trim/estirado en clips de video o voz; arrastre libre en el tiempo.
- Sliders o controles de volumen antes de D2 (nada de controles muertos).
- Detección de silencios por análisis cuando `gapAfterSeconds` ya es el dato.
- Duraciones estimadas presentadas como medidas (el rótulo aproximado se queda).
- Dependencias nuevas (wavesurfer, etc.): Web Audio + canvas alcanzan.
- Tocar el contrato del motor desde tareas de UI (las [motor] van aparte).
- Romper la paridad timeline↔inspector ni el contrato de vigencia (`stale`).

## Traza

| Tarea | Origen | Estado |
| --- | --- | --- |
| A1–A4 | pedido del usuario (ondas, frames, transiciones visibles) | pendiente |
| B1–B7 | pedido (acciones desde la timeline) + deuda B2.3 del 23-jul (Ctrl+Z) | pendiente |
| C1–C4 | pedido («recortes») mapeado al motor real | pendiente |
| D1 | habilitador; ya identificado en auditorías del 24-jul | pendiente |
| D2–D3 | pedido («bajar sonido», pista de música) — gated a uso real | decisión pendiente |
| E | intuición/accesibilidad | transversal |
