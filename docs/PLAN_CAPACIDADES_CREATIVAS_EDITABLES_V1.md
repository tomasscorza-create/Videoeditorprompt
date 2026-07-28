# Plan de acción — capacidades creativas editables V1

Fecha: 27 de julio de 2026 · última actualización: 28 de julio de 2026  
Estado: **en ejecución.** Ver «Estado de ejecución» abajo antes de retomar  
Ámbito: aplicación local, motor, Editor, Creador, timeline y Director IA  
Documento relacionado: `docs/PLAN_DE_ACCION_CREADOR_ELEMENTOS_2026-07-26.md`

> **Para quien retoma:** la sección 0 alcanza para arrancar. Tiene el estado por
> fase, el próximo paso, el mapa de archivos, los invariantes que no hay que
> romper, las trampas que ya costaron caro, los comandos y las recetas de
> verificación. El resto del documento es el plan original con el detalle de cada
> fase, y solo hace falta para entender por qué algo está decidido como está.


## 0. Estado de ejecución y por dónde seguir

Actualizado el 28 de julio de 2026. Cada fase tiene su propio bloque de estado más
abajo con el detalle; esto es el mapa.

| Fase | Estado | Commits |
| --- | --- | --- |
| 0 · Contrato y prototipo | Hecha | `1a0d996` |
| 1 · Creador y recurso v3 | **Hecha: personaje y prop completan el recorrido** | `8c54fd9`, `a947387`, `20dfbda`, `9896d66` |
| 2 · Evaluador paramétrico | Hecha | `94a3163` |
| 3 · Compositor | **Hecha: selección por escena integrada y verificada** | `e459a32`, `75d2a87`, `c424f63`, `9896d66` |
| 4 · Edición visible | **Hecha** | `5b83df4`, `e7a0364`, `c55ce80`, `45d1774`, `f31bcee`, `df543d8` |
| 5 · Presets editables | **Hecha** | `a709442`, `c55ce80`, `df543d8`, `9896d66` |
| 6 · Director IA | **Hecha** | `9896d66`, `4e93720`, pendiente de commit |
| 7 · Gate humano | Sin empezar | — |

### El próximo paso

**Fase 7 — gate humano.** La integración del Director quedó cerrada: recibe un
resumen compacto por elemento, propone animaciones, explica el lote antes de
aplicarlo, exige una aprobación adicional para eliminar trabajo personalizado y
guarda el lote aceptado como un único undo.

El render integral de 235 frames verificó en el mismo MP4 el rig articulado y el
prop con una pista de rotación de **-8° a 8°**. PixiJS/WebGL compuso los frames y
FFmpeg produjo H.264/AAC de 7.833 s. Las escenas sin recursos v3 conservan el
camino FFmpeg.

La Fase 4 está cerrada: se anima desde la interfaz, se previsualiza en el lienzo
y **lo animado llega al MP4 por el mismo evaluador**, con la posición y la escala
como expresión continua y la opacidad por rangos de frames.

### Pendientes concretos, en orden de dependencia

1. **Fase 7 — video de entrada/salida.**
2. **Fase 7 — presentación de un prop.**
3. **Fase 7 — gesto articulado anclado a una palabra.**
4. Registrar tiempos de autoría, ajustes posteriores y render de los tres casos.

### Deudas anotadas que no bloquean

- Renombrar `animationPreset` (`idle-calm` / `talk-calm`) a `baseMotionId`: es
  **movimiento base** continuo, no un preset de keyframes. La interfaz ya lo
  rotula «movimiento base» en todos lados; falta el renombre del campo, que
  conviene hacer junto con el adaptador de lectura del render.
- Los compiladores v1 → v2 y v3 fusionan el catálogo por ID; regenerar un tipo
  de recurso no debe borrar entradas ajenas.
- El ancla de palabra es un **prorrateo** por cantidad de palabras sobre la
  duración medida del turno, no alineación real: Piper no devuelve tiempos por
  palabra.
- **Dos criterios de conteo de palabras.** La autoría cuenta sobre el texto del
  proyecto (`shared/project-editor.js` ya lo hacía para `gestureAtWord`, y la
  interfaz usa el mismo criterio); el evaluador cuenta sobre el texto normalizado
  para Piper. Un turno con «50%» difiere en dos palabras. Se unifica moviendo
  `normalizeSpanishTtsText` a `shared/`, o midiendo las palabras en el render.
- **«Personalizar» una pista sin editarla no tiene comando.** El motor marca
  `customized` como efecto de una edición; para el botón de la Fase 0 haría falta
  un comando propio. Fingirlo con una edición vacía dejaría una mentira en el
  historial de deshacer, así que el botón no existe todavía.
- **El trabajo de render no guarda la revisión de tiempo.** Se deriva cuando el
  render corresponde al proyecto abierto; una sesión restaurada vuelve a la regla
  estricta y pierde la medición hasta el próximo render.
- Arrastrar un personaje en el modo animación escribe dos comandos (`position.x`
  y `position.y`), así que deshacerlo son dos pasos.
- **La opacidad animada se cuantiza a 1/64 en el MP4.** El compositor de FFmpeg
  no acepta una expresión de alfa, así que se aplica por rangos de frames con el
  valor del plan. El error máximo es de 2 niveles sobre 255 y acota cuántos
  filtros se encadenan; con el compositor de la Fase 3 deja de hacer falta.
- El límite de 8 pistas por elemento es letra muerta mientras haya 6 parámetros y
  una sola pista por parámetro; el que muerde es el de 256 keyframes por escena.

### Mapa de archivos: qué hace cada pieza

Contrato y vocabulario (congelados en la Fase 0, nadie los reescribe):

| Archivo | Qué es |
| --- | --- |
| `schema/animation-scene.schema.json` | Contrato de pistas y keyframes. `$id` = `https://local-video.invalid/schema/animation-scene-v1.json` |
| `shared/animation-contract.js` | Vocabulario, límites, catálogo de errores, cuantización a frame, estado «requiere revisión». Puro: lo importan Node y el navegador |
| `scripts/animation/animation-contract.mjs` | Validación contra el schema (necesita ajv, o sea Node). Reexporta todo lo de `shared/` |

Motor temporal:

| Archivo | Qué hace |
| --- | --- |
| `shared/animation-evaluator.js` | Resuelve anclas a segundos (`buildSceneTiming`, `resolveAnchorSeconds`, `resolveAnimationScene`) y evalúa pistas (`evaluateTrack`) |
| `shared/animation-presets.js` | Los seis presets como DATO versionado y su expansión pura |
| `shared/scene-evaluator.js` | Estado por frame (`evaluateScene`) y expresiones de FFmpeg (`createFfmpegMotionExpressions`, `createFfmpegTrackExpression`) |
| `shared/project-editor.js` | Comandos de edición con undo/redo, incluidas las cinco de pistas y `apply-animation-preset` |
| `shared/project-fingerprint.js` | `projectFingerprint` (todo el proyecto) y `projectTimingFingerprint` (solo lo que mueve un tiempo) |

Render:

| Archivo | Qué hace |
| --- | --- |
| `scripts/stage3a/compile-video-project.mjs` | Proyecto editable → `scene.config.json`. Copia las pistas y rechaza los parámetros que el compositor no lleva al MP4 (`RENDERABLE_PARAMETERS`) |
| `scripts/stage1/export-dialogue.mjs` | Resuelve el tiempo, llama al compositor, encodea y mide. **Ya no compone** |
| `scripts/compositor/ffmpeg-compositor.mjs` | Compositor vigente: overlays de FFmpeg. `composeFramesWithFfmpeg(...)` |
| `scripts/compositor/pixi-compositor.mjs` | Compositor headless con PixiJS. `composeFramesWithPixi(...)`, misma forma de entrada y salida |
| `shared/compositor-contract.js` | Recurso v3 + instancia → lista plana de sprites con su cadena de transformaciones |

Interfaz (todo bajo `src/ui/`):

| Archivo | Qué hace |
| --- | --- |
| `timeline-animation.ts` | Módulo PURO: pistas → filas dibujables, estado por keyframe, comandos del modo animación. Se prueba en `ui:test-modules` |
| `timeline.ts` | Fila «Animación», diamantes, arrastre, menú y atajos |
| `project/panel.ts` | Ficha de keyframe y bloque de animación por personaje |
| `project/composition.ts` | Vista previa en el cabezal y modo animación del lienzo |
| `project/animation-mode.ts` | Modo por elemento, derivado de la selección |
| `editor-workspace.ts` | `measuredTimelineFor` (cuándo hay tiempo real) y `editorPlayhead` (el cabezal compartido) |

### Invariantes que no hay que romper

Cada uno está puesto ahí por una razón concreta; si un test falla por uno de
estos, se revisa el cambio, no se afloja el test.

1. **`BASELINE_TEMPORAL_HASH`** (`195bcd1b…`, en
   `scripts/animation/test-animation-evaluator.mjs`) se capturó **antes** de
   introducir la animación. Si falla, el plan temporal de una escena v2 cambió.
2. **`evaluateScene` agrega la clave `elements` solo cuando recibe animación.**
   Agregarla siempre cambiaría el `temporalHash` de todos los pilotos v2 sin que
   nada haya cambiado de verdad.
3. **Las pistas viajan en coordenadas de AUTORÍA** y se trasladan al espacio
   centrado del runtime **una sola vez**, en `resolveSceneAnimation`
   (`export-dialogue.mjs`). Si se traslada en el compilador además, se resta dos
   veces media pantalla.
4. **`createFfmpegTrackExpression` tiene que dar exactamente lo mismo que
   `evaluateTrack`.** Hay una prueba que las compara por 120 muestras y hoy la
   divergencia es **0**. No emitir `${to.value}-${from.value}` en la expresión:
   con un valor negativo produce `--`, que JavaScript no parsea (FFmpeg sí). La
   diferencia se precalcula en JS.
5. **Los conjuntos renderizables viven en compilador y UI y tienen que
   coincidir.** FFmpeg conserva `position.x`, `position.y`, `scale` y `opacity`;
   un recurso v3 enruta la escena a PixiJS y habilita además
   `rotationDegrees` y los parámetros declarados, hoy `armRaise`.
6. **Medir y reproducir son cosas distintas.** `measuredTimelineFor` conserva la
   medición mientras no cambie `projectTimingFingerprint`, aunque el MP4 esté
   vencido; el transporte sigue exigiendo `currentEditorOutput()`. **No volver a
   atar la medición al fingerprint completo**: sin esto no se puede editar un
   keyframe dos veces seguidas, porque el primero lo saca de la regla.
7. **Sin medición no se dibuja un diamante.** La fila dice cuántos keyframes hay
   y que están pendientes de voz. Nunca una posición estimada por palabras.
8. **`create-track` es atómico** y el último keyframe de una pista **siempre**
   queda en `hold`. Una pista de un solo keyframe no cumple el contrato ni como
   paso intermedio.
9. **`scene-config-v2` referencia el contrato de animación por `$id`**, no lo
   repite. Por eso `scripts/stage1/validate-scene-config.mjs` hace
   `ajv.addSchema(readSchema('animation-scene.schema.json'))` antes de compilar.
10. **Los dos compositores tienen la misma firma y la misma forma de salida**
    (`{ backend, renderer, frameCount, files, framePattern, seconds }`). Es lo
    que permite elegir uno u otro por escena sin tocar el exportador.
11. **Los frames dorados se regeneran a mano**, con `npm run compositor:golden`.
    Nunca automáticamente al fallar la comparación: eso convierte la prueba en un
    espejo de lo que sea que el compositor esté haciendo hoy.
12. **`pose_neutral.png` del mono articulado es byte a byte idéntico al del mono
    v2** y `stage2f:test-resource` lo verifica. Si deja de coincidir, la
    composición por piezas dejó de ser fiel.
13. **Los props no cuentan como personajes ni hablantes.** Una escena sigue
    requiriendo exactamente dos personajes para renderizar; los props son
    elementos visuales adicionales y fuerzan PixiJS sin alterar el diálogo.

### Trampas que ya costaron caro

- **`--default-background-color=00000000` cuelga Chrome 151.** La página muere al
  primer uso del canvas, sin error y sin traza. No agregarlo de nuevo: los frames
  salen de leer el canvas de Pixi, que ya tiene su propio alfa.
- **El `setTimeout` del presupuesto del compositor hay que cancelarlo.** Si queda
  vivo, Node no termina aunque el render haya salido bien: con el presupuesto por
  omisión son cuatro segundos por frame, o sea quince minutos colgado.
- **`chrome --headless=new <url>` sin trabajo termina al instante**, con código 0
  y sin imprimir nada. Lo que lo mantiene vivo es el puerto de depuración.
- **El `webSocketDebuggerUrl` de `/json/version` es el endpoint del navegador**,
  no de una pestaña: contra él `Page.enable` no existe. Hay que crear el target y
  hablar por `sessionId`. (El compositor actual no usa CDP y por eso lo evita.)
- **El store reescribe `resourceCatalog`** de `assets/catalog/…` a
  `assets/library/…` al abrir un proyecto, así que el fingerprint de un render
  viejo nunca coincide con el del proyecto restaurado.

### Comandos

```bash
npm test                          # 40 suites; la central
npm run build                     # tsc + vite
npm run anim:test-contract        # contrato de la Fase 0
npm run anim:test-evaluator       # evaluador, paridad con la expresión de FFmpeg y opacidad
npm run anim:test-presets         # los seis presets
npm run stage3b:test-keyframes    # comandos de pista con undo/redo
npm run stage3a:test-compiler     # las pistas llegan al runtime y se rechaza lo no renderizable
npm run compositor:test-contract  # sprites y jerarquía de piezas
npm run compositor:test-headless  # el compositor headless, contra frames dorados
npm run compositor:compare-v2     # SSIM FFmpeg vs PixiJS sobre la misma escena v2
npm run compositor:test-pipeline  # render real de rig v3 + prop; fuera de la suite por costo
npm run ui:test-modules           # 218 comprobaciones de módulos puros de UI
npm run compositor:golden         # regenerar frames dorados (a mano, a propósito)
npm run compositor:benchmark      # números del checkpoint; acepta --frames=N
```

Render de punta a punta de un proyecto con animación (necesita Piper y FFmpeg):

```bash
node scripts/stage3a/project-pipeline.mjs --job-id=prueba-01 --project=pilots/animacion-render-01/project.json --assets-dir=public
```

### Recetas de verificación

**Comprobar que un refactor del render no cambió nada.** Es la prueba que exige
la sección 8 antes de tocar el compositor. Se rinde el mismo proyecto antes y
después, y se comparan los MP4 de cada escena, los `temporalHash` y los
`frameContentHash` de `export-metrics-{1,2}.json`, que están en
`.local-video/work/<job-id>/scene-output/<escena>/`. Los dos MP4 de una misma
escena (`render-1` y `render-2`) ya vienen comparados por el pipeline, que
reporta `deterministic: true`.

**Ver la interfaz en estado medido sin renderizar.** El fingerprint de un render
viejo nunca coincide (ver «trampas»), así que hay que forzarlo:

1. tomar `.local-video/app-input/<job>/project.json`, que es el proyecto exacto
   que se renderizó;
2. ponerle `resourceCatalog: 'assets/library/authoring-resources.json'` y pasarlo
   por `repairMissingVoiceReferences`;
3. calcular `projectFingerprint` de eso y escribirlo en `projectRevision` dentro
   de `.local-video/app-jobs/<job>.json`;
4. sembrar `localStorage['local-video.editor-session']` con
   `{ version: 1, project, catalogRevision: 'x', lastJobId: '<job>', savedAt }`.

Hacer copia del archivo del trabajo y del `localStorage` antes, y restaurarlos al
terminar.

## 1. Decisión de producto

El próximo incremento creativo debe introducir animación paramétrica y keyframes
sin separar la creación por IA de la edición manual.

La regla principal es:

> Toda capacidad creativa que llegue al render debe tener una representación
> visible, seleccionable, modificable y reversible en la interfaz.

La capacidad pertenece al motor, se autoriza manualmente desde el Editor/Creador
y luego se expone al Director mediante comandos semánticos pequeños. El Director
no genera frames ni listas extensas de keyframes.

El flujo objetivo es:

```text
Director: intención compacta
        ↓
comando semántico validado
        ↓
expansión determinista a pocos keyframes
        ↓
timeline + inspector editables
        ↓
evaluador temporal compartido
        ↓
preview y MP4 equivalentes
```

## 2. Qué entra en este primer plan

### 2.1 Tipos de recurso

- `character`: personaje animable.
- `prop`: objeto visual sin anatomía obligatoria.

`decor`, texto animado, imágenes arbitrarias y grupos complejos se dejan para un
incremento posterior. El primer prop piloto debe ser un objeto sencillo y
reutilizable, por ejemplo un cartel o un teléfono.

### 2.2 Parámetros animables V1

Parámetros comunes por instancia:

- `position.x`
- `position.y`
- `scale`
- `rotationDegrees`
- `opacity`

Prueba de articulación para un personaje v3:

- `armRaise`, rango normalizado `0..1`.

No se agregan más articulaciones hasta probar que un parámetro de joint conserva
paridad entre preview, exportación y UI.

### 2.3 Interpolaciones

- `linear`
- `ease`
- `hold`

No se incluye un editor libre de curvas Bézier en V1. `ease` usa una curva
versionada y determinista (`inOutSine` inicialmente).

### 2.4 Presets iniciales

- `enter-left`
- `enter-right`
- `fade-in`
- `fade-out`
- `emphasis-pulse`
- `arm-raise`

Cada preset se define como datos versionados y se expande a entre dos y cuatro
keyframes. No contiene código ni expresiones.

### 2.5 Transiciones

- Se conservan `cut` y `fade` entre escenas.
- La transición de escena se vuelve visible como bloque editable en la timeline.
- Las entradas y salidas de elementos son presets/keyframes, no nuevas
  transiciones de escena.

## 3. Dónde se edita cada cosa

| Superficie | Responsabilidad |
| --- | --- |
| Creador | Geometría del recurso, piezas, pivotes, jerarquía, orden de dibujo y parámetros que el recurso declara |
| Editor/lienzo | Posición base de la instancia, selección visual, manipulación directa y preview en el playhead |
| Inspector | Valor exacto, referencia temporal, interpolación, preset de origen y controles para agregar/eliminar keyframes |
| Timeline | Pistas, puntos de keyframe, bloques de transición, selección, arrastre, snap y navegación temporal |
| Director IA | Elegir recurso, preset, objetivo y referencia semántica; nunca emitir keyframes individuales |
| Motor | Resolver referencias, evaluar parámetros por frame y producir el mismo estado para preview y exportación |

Una función no se considera terminada si existe en el JSON o en el render, pero
no puede encontrarse y modificarse desde la UI correspondiente.

## 4. Modelo temporal: puntos de referencia estables

La duración real continúa proviniendo de WAV/FFprobe. Por ello los keyframes de
autoría no deben depender únicamente de segundos absolutos calculados antes de
generar la voz.

Cada keyframe usa una referencia cerrada:

```json
{
  "anchor": {
    "kind": "turn",
    "turnId": "escena-1-t2",
    "edge": "start"
  },
  "offsetSeconds": 0.2,
  "value": 1,
  "interpolation": "ease"
}
```

Referencias admitidas en V1:

- `scene.start`
- `scene.end`
- `turn.start`
- `turn.end`
- `word`, mediante `turnId` + `wordIndex`

El compilador resuelve la referencia después de medir el audio y la cuantiza a
`frameIndex` usando el FPS del proyecto. La UI muestra el tiempo resultante en
segundos cuando existe un render medido.

Si cambia el texto o la voz:

- un keyframe anclado al turno conserva el turno;
- uno anclado a palabra se marca como “requiere revisión” si el índice ya no
  existe;
- nunca se mueve silenciosamente a otra palabra;
- la UI explica el problema antes de permitir renderizar.

## 5. Contrato de pistas

El proyecto editable incorpora pistas por elemento. Boceto orientativo:

```json
{
  "elementId": "escena-1-personaje-a",
  "tracks": [
    {
      "parameterId": "position.x",
      "source": {
        "kind": "preset",
        "presetId": "enter-left",
        "version": 1
      },
      "keyframes": [
        {
          "anchor": { "kind": "scene", "edge": "start" },
          "offsetSeconds": 0,
          "value": -260,
          "interpolation": "ease"
        },
        {
          "anchor": { "kind": "scene", "edge": "start" },
          "offsetSeconds": 0.6,
          "value": 0,
          "interpolation": "hold"
        }
      ]
    }
  ]
}
```

`source` conserva procedencia y permite mostrar “creado desde enter-left”. Al
modificar un punto manualmente la pista sigue siendo editable y se marca
`customized: true`; no se intenta regenerarla automáticamente.

### Límites V1

- Máximo 8 pistas por elemento.
- Máximo 32 keyframes por pista.
- Máximo 256 keyframes por escena.
- Un único valor por parámetro y frame resuelto.
- Valores y offsets siempre acotados por schema.
- Orden canónico por parámetro, frame resuelto e ID.
- Dos keyframes que terminan en el mismo frame son un error visible, no una
  elección implícita.
- No se permiten pistas o presets solapados sobre el mismo parámetro sin
  convertirlos primero en una única pista editable.

Estos límites evitan proyectos gigantes y mantienen pequeño el contexto enviado
al Director.

## 6. Contrato del Director IA

El Director no recibe ni devuelve el contenido completo de las pistas. Ve un
catálogo resumido de capacidades:

```text
personaje-a:
  presets: enter-left, fade-in, emphasis-pulse, arm-raise
  parámetros manuales: position, scale, rotation, opacity, armRaise
```

Comando orientativo:

```json
{
  "type": "apply-animation-preset",
  "sceneId": "escena-1",
  "elementId": "escena-1-personaje-a",
  "presetId": "arm-raise",
  "anchor": {
    "kind": "word",
    "turnId": "escena-1-t2",
    "wordIndex": 3
  },
  "intensity": "medium"
}
```

El núcleo del editor:

1. valida recurso, preset, referencia e intensidad;
2. expande el preset a keyframes mediante una función pura y versionada;
3. simula el lote completo;
4. lo aplica atómicamente;
5. lo deja visible en timeline e inspector;
6. permite deshacerlo como una sola operación.

El Director puede:

- aplicar o quitar un preset;
- cambiar referencia, dirección, intensidad o duración dentro de rangos;
- sustituir un preset por otro;
- explicar qué pista creó o modificó.

El Director no puede:

- crear keyframes individuales;
- emitir coordenadas por frame;
- crear curvas arbitrarias;
- modificar joints o jerarquías;
- generar expresiones o scripts;
- alterar silenciosamente una pista ya personalizada.

Si una pista tiene `customized: true`, el Director debe proponer reemplazarla y
la UI debe pedir una confirmación explícita antes de perder el ajuste manual.

## 7. Experiencia de edición V1

### 7.1 Timeline

Al seleccionar un elemento:

- aparece una fila plegable “Animación”;
- cada parámetro usado tiene su propia pista;
- los keyframes se muestran como diamantes;
- los presets aplicados se identifican con una etiqueta;
- las transiciones de escena aparecen en el límite entre escenas;
- el playhead y el tiempo medido existentes se reutilizan.

Operaciones mínimas:

- seleccionar un keyframe;
- agregar en el playhead;
- mover mediante arrastre;
- ajustar con teclado a un frame;
- cambiar `linear`, `ease` o `hold`;
- duplicar;
- eliminar;
- mover el ancla a escena, turno o palabra;
- convertir el resultado medido en la referencia semántica más cercana;
- deshacer/rehacer.

No entran aún:

- editor de curvas;
- selección masiva avanzada;
- estirar clips;
- composición de animaciones por capas;
- automatización por scripting.

### 7.2 Inspector

Al seleccionar un keyframe muestra:

- parámetro;
- valor;
- ancla;
- offset;
- tiempo resuelto de solo lectura;
- interpolación;
- preset de procedencia;
- estado normal o “requiere revisión”.

Al seleccionar un elemento sin keyframe:

- valores base;
- presets compatibles;
- botón “agregar keyframe en el playhead”;
- botón “personalizar” para una pista creada por preset.

### 7.3 Lienzo

- Las transformaciones base se manipulan como hoy.
- Con el modo “animación” activo, mover el elemento en el playhead crea o
  actualiza un keyframe, nunca cambia accidentalmente la base.
- Un indicador persistente distingue “editando base” de “editando keyframe”.
- El brazo piloto expone una manija acotada para `armRaise`; IK completo queda
  fuera de V1.

### 7.4 Creador

Primera ampliación:

- pivote por pieza;
- jerarquía padre/hijo;
- orden de dibujo separado;
- tipo `character` o `prop`;
- declaración de parámetros soportados;
- preview local con sliders de parámetros;
- guardado no destructivo como nueva variante.

El Creador define qué puede hacer un recurso; no define cuándo ocurre dentro de
un video. El momento pertenece al Editor/timeline.

## 8. Arquitectura de render

Este plan adopta como dirección el compositor PixiJS headless detrás de un
contrato reemplazable, conservando FFmpeg para audio, encode y mux.

Antes de cambiar el compositor predeterminado:

1. extraer `composeFrames(...)` alrededor del camino FFmpeg actual;
2. comprobar que el refactor no cambia outputs;
3. implementar PixiJS headless como segunda opción;
4. comparar frames representativos;
5. conservar el compositor anterior como fallback explícito;
6. habilitar rigs v3 solo cuando preview y MP4 sean equivalentes.

La autorización de este documento aprueba el diseño, pero el cambio de
compositor debe conservar un checkpoint específico antes de convertir PixiJS en
predeterminado.

## 9. Fases ejecutables

### Fase 0 — Contrato y prototipo de interacción

- Congelar vocabulario de parámetros, anchors, interpolaciones y límites.
- Dibujar el estado visible de timeline, inspector y lienzo.
- Definir mensajes de error y estado “requiere revisión”.
- Añadir fixtures JSON válidos e inválidos.

**Gate:** una animación puede seguirse en papel desde intención del Director
hasta controles UI y frame resuelto, sin campos ambiguos.

**Estado: ejecutada el 27 de julio de 2026.** Resultados en
`docs/FASE_0_CONTRATO_ANIMACION_V1.md`. Entregables: contrato aislado en
`schema/animation-scene.schema.json`, validador y catálogo de errores en
`scripts/animation/animation-contract.mjs`, 17 fixtures en
`pilots/animacion-v1/` y 28 comprobaciones en `npm run anim:test-contract`,
registrado en la suite central.

Decisiones que el plan dejaba abiertas y quedaron cerradas en Fase 0:

- La interpolación de un keyframe describe el tramo que **sale** de él, y el
  último keyframe de una pista debe declarar `hold`.
- Una pista **reemplaza** el valor base de su parámetro; no se suma. Mover la
  base después de aplicar un preset no reescribe la pista.
- `customized` solo existe en pistas de preset; una pista manual no lo lleva.
- Mínimo dos keyframes por pista: un valor estático pertenece al transform base.
- Cada keyframe tiene `id` propio, para selección, undo y estado de revisión.
- `frameIndex = max(0, round(segundos × fps))`, distinto del `ceil` que cuenta
  frames de una duración.
- El `animationPreset` vigente (`idle-calm`/`talk-calm`) es **movimiento base** y
  no se renombra en V1; el renombre a `baseMotionId` queda atado a la Fase 4.
- El estado “requiere revisión” es derivado, se muestra en tres niveles
  (keyframe, fila del elemento, proyecto) y bloquea la exportación.
- El modo animación del lienzo es por elemento, se apaga al cambiar de
  selección y no puede activarse sin tiempo medido.

### Fase 1 — Creador y recurso v3 mínimo

- Unificar el renderizador de formas compartido.
- Agregar pivote y jerarquía.
- Agregar tipo `prop`.
- Crear manifest v3 aditivo con parámetros/bindings.
- Implementar adaptador de lectura v2 → v3.
- Crear un personaje articulado piloto y un prop piloto.

**Gate:** recursos existentes conservan sus hashes/salida; los dos pilotos se
guardan, publican y vuelven a abrir desde la biblioteca.

**Estado: hecha al 28 de julio de 2026, incluido el gate de personaje y prop.**

- Renderizador de primitivas unificado entre el Creador y el compilador de assets;
  guardia nueva `stage2f:test-hash-baseline` que compara contra los PNG y manifests
  ya commiteados, porque el test de determinismo vigente comparaba dos corridas
  entre sí y una regresión habría pasado desapercibida.
- Manifest de recurso v3 con piezas, pivote, jerarquía, tipo `prop` y parámetros
  con bindings, más el adaptador de lectura v2 → v3 sin pérdida.
- Dos pilotos generados de verdad: `mono-articulado-azul-v1` (brazo derecho como
  pieza propia, pivote en el hombro, declara `armRaise`) y `cartel-dato-v1`.
- Prueba de fidelidad: con el brazo sin rotar, `pose_neutral.png` del piloto es
  **idéntico byte a byte** al del recurso v2 publicado.

El gate se cerró de forma incremental después de cerrar la Fase 3:
`mono-articulado-azul-v1` y `cartel-dato-v1` se publican y renderizan mediante
PixiJS. El prop tiene representación propia en proyecto, comandos, lienzo,
timeline y runtime; no se finge como personaje ni como imagen.

### Fase 2 — Evaluador paramétrico compatible

- Introducir `elements[id].params` en `shared/scene-evaluator.js`.
- Mantener la vista v2 derivada.
- Implementar resolución de anchors después de FFprobe.
- Implementar evaluación de pistas e interpolaciones.
- Rechazar colisiones, referencias rotas y límites excedidos.

**Gate:** pilotos v2 no cambian su `temporalHash`; fixtures V1 producen valores
idénticos en dos ejecuciones.

**Estado: ejecutada el 27 de julio de 2026.** `shared/animation-evaluator.js` y
`shared/animation-contract.js`; 18 comprobaciones en `npm run anim:test-evaluator`.

- El `temporalHash` de una escena v2 se congeló en una constante del test,
  capturada **antes** de introducir la animación. `elements` solo aparece cuando
  se evalúa con animación resuelta: agregar la clave siempre habría cambiado el
  hash de todos los pilotos sin que nada cambiara de verdad.
- La vista v2 se deriva de los parámetros, no de un cálculo aparte: primero se
  arma `params` (entrada, layout de turno y movimiento base), después la pista
  reemplaza el valor, y de ahí sale `characters[].character`.
- El ancla de palabra se prorratea por cantidad de palabras sobre la duración
  medida del turno, con el mismo criterio que `prepare-dialogue.mjs` ya usa para
  los gestos. No hay alineación palabra por palabra: la precisión es la de un
  prorrateo, y por eso el contrato empuja a anclar al turno cuando alcanza.
- El vocabulario y el catálogo de errores se movieron a `shared/` porque el
  evaluador y la interfaz no pueden importar ajv. La validación contra el schema
  quedó en `scripts/animation/`, que reexporta el resto.
- La comprobación de «fuera de escena» se hace en segundos y no en frames: la
  cuantización sujeta los negativos a cero y taparía el error.

### Fase 3 — Contrato de compositor y PixiJS headless

- Extraer el compositor actual detrás de contrato.
- Agregar compositor PixiJS headless.
- Mantener FFmpeg como encoder/mixer/muxer.
- Agregar frames dorados, comparación visual y doble ejecución.

**Checkpoint de usuario:** revisar calidad, velocidad, consumo de RAM y
equivalencia antes de cambiar el predeterminado para rigs v3.

**Estado: HECHA al 28 de julio de 2026.** Los dos backends funcionan, el
checkpoint eligió enrutamiento selectivo por escena y el pipeline lo aplica.

Hecho:

- `shared/compositor-contract.js`: un recurso v3 y su instancia se traducen a una
  lista plana de sprites con su cadena de transformaciones. La jerarquía de piezas
  se resuelve una sola vez acá, así ningún backend la reinterpreta. 14
  comprobaciones en `npm run compositor:test-contract`.
- Decisión de motor, elegida por el usuario: Chrome headless corriendo el MISMO
  PixiJS que la vista previa, sin dependencias nativas nuevas.
- **El compositor headless compone** (`npm run compositor:test-headless`, en la
  suite central). Cuatro comprobaciones: formato del frame, doble ejecución con
  PNG idénticos, `armRaise` moviendo la pieza articulada con recorrido monótono,
  y comparación por SSIM contra los frames dorados de `pilots/compositor-v3/`.
- Frames dorados versionados y regenerables con `npm run compositor:golden`.
  La comparación es por SSIM con tolerancia (0.995), no por bytes: SwiftShader es
  determinista dentro de una máquina y versión de navegador, pero entre máquinas
  distintas no está garantizado.
- `npm run compositor:benchmark` produce los números del checkpoint.

**Los dos cuelgues que costaron encontrar**, anotados para no repetirlos:

1. El diagnóstico anterior («se cuelga en `fetch('./job.json')`») era incorrecto.
   La página recibía el plan y moría después, al primer uso del canvas, sin error
   y sin traza. La causa era el flag `--default-background-color=00000000`:
   aislando flag por flag con una página mínima se ve que con Chrome 151 ese flag
   deja la página muerta. No hacía falta, porque los frames salen de leer el
   canvas de Pixi —que ya tiene su propio alfa— y nunca se captura la ventana.
2. Con el render ya funcionando, el proceso de Node no terminaba: el temporizador
   del presupuesto no se cancelaba, y con el presupuesto por omisión son cuatro
   segundos por frame, o sea más de quince minutos colgado después de haber
   compuesto bien.

**Medición del checkpoint** (Windows 11, Chrome 151 headless con SwiftShader,
dos personajes v3 articulados en 1080×1920):

| Métrica | Valor |
| --- | --- |
| 235 frames | 49.6 s |
| Por frame | 0.211 s (4.74 fps) |
| PNG generados | 46 MB |
| RAM del navegador | ~870 MB sobre la línea base |
| Comparación: camino FFmpeg vigente | 226 frames en ~21 s |

O sea: **PixiJS headless es unas 2.4 veces más lento que el camino FFmpeg**, y a
cambio dibuja rigs v3 articulados, que FFmpeg no puede componer. La decisión de
cambiar el predeterminado es del checkpoint y no se tomó.

- **El compositor FFmpeg vigente quedó detrás del contrato**
  (`scripts/compositor/ffmpeg-compositor.mjs`), con la misma firma y la misma
  forma de salida que el de PixiJS. No es código nuevo: es el mismo grafo de
  filtros, movido tal cual. El exportador se quedó con lo que no es composición
  —resolver el tiempo, encodear y medir— y pasó de 175 a 123 líneas.
  **Comprobado byte a byte:** el mismo proyecto renderizado antes y después de la
  extracción da MP4 idénticos, y también los `temporalHash` y los
  `frameContentHash` de las dos escenas y de las dos pasadas.

Checkpoint cerrado:

- Comparación cruzada sobre cinco estados de una escena v2: SSIM mínimo
  0.999628 en frame completo y 0.999505 en personajes, con umbral 0.995.
- Decisión: **selectivo por escena**. Los v2 conservan FFmpeg y una escena con
  rig v3 usa PixiJS.
- Integración real: 235 frames con `armRaise`, fondo, subtítulos y audio;
  composición PixiJS/WebGL, encode H.264/AAC con FFmpeg y MP4 verificado.
- `mono-articulado-azul-v1` y `cartel-dato-v1` ya se exponen porque completan
  compilación, UI y render. El test integral también verifica la rotación
  interpolada del prop entre -8° y 8°.

### Fase 4 — Edición visible completa

- Agregar pistas y keyframes al esquema del proyecto.
- Agregar comandos cerrados con undo/redo.
- Implementar timeline, inspector y modo animación del lienzo.
- Mostrar transiciones `cut`/`fade` como bloques editables.
- Persistir selección y pistas sin duplicar estado de negocio en la UI.

**Gate:** cada parámetro V1 se crea, localiza, modifica, elimina, deshace,
previsualiza y exporta desde la interfaz.

**Estado: lote 1 hecho el 27 de julio de 2026** (capa de datos; la interfaz no).

- `tracks` entra al proyecto editable como campo **opcional**: un proyecto sin
  pistas sigue siendo válido.
- Cinco comandos cerrados con undo/redo. `create-track` es **atómico a propósito**:
  una pista de un solo keyframe no cumple el contrato, así que no puede existir ni
  siquiera como paso intermedio de la edición. `add-keyframe` exige que la pista
  ya exista.
- Editar a mano una pista que vino de un preset la marca `customized` y no la
  regenera.
- Borrar keyframes hasta dejar menos de dos elimina la pista entera, en vez de
  dejarla en un estado que el contrato rechaza.
- El último keyframe se fuerza a `hold` después de cada edición.
- El vocabulario y los límites salen de `shared/animation-contract.js`: el editor
  los aplica, no los repite. `armRaise` se rechaza si el recurso no lo declara,
  que es el caso de los ocho personajes v2.
- 14 comprobaciones en `npm run stage3b:test-keyframes`.

**Lote 2, hecho el 28 de julio de 2026** (`c55ce80`): timeline e inspector.

- `src/ui/timeline-animation.ts` traduce las pistas a lo que la interfaz dibuja.
  No reimplementa el contrato: resuelve las anclas con `resolveAnchorSeconds`, la
  misma función del motor, y toma mensajes y límites del catálogo de errores.
- Fila «Animación» plegable colgada del elemento seleccionado, dentro del bloque
  VISUAL. Una pista por parámetro, keyframes como diamantes, tramo punteado
  cuando el valor queda congelado, y la procedencia rotulada en la etiqueta.
- El diamante se selecciona, se arrastra, se corre frame a frame con las flechas
  y abre un menú con interpolación, duplicar, reanclar y eliminar. **Arrastrar
  cambia siempre el desplazamiento sobre el ancla, nunca el ancla**: mover un
  keyframe no puede cambiar en silencio a qué turno pertenece.
- Ficha de keyframe en el inspector con valor, ancla, desplazamiento, tiempo
  resuelto de solo lectura, interpolación, procedencia y estado; y bloque por
  personaje con los presets aplicables, «animar desde el cabezal» y sus pistas.
- **Sin medición no se dibuja un diamante.** La fila dice cuántos keyframes hay y
  que están pendientes de voz, en vez de ubicarlos en un lugar estimado por
  cantidad de palabras.
- El estado «requiere revisión» aparece en los tres niveles que pedía la Fase 0:
  diamante hueco, insignia en el clip del elemento y mensaje en la ficha.

**Lote 3, hecho el 28 de julio de 2026** (`45d1774`, `f31bcee`): medición y lienzo.

- **Medir y reproducir se separaron.** Cualquier edición vencía el MP4 y devolvía
  la timeline a «sin medir», con lo cual un keyframe arrastrado desaparecía de la
  regla y la fase no podía cumplir su gate. `projectTimingFingerprint` cubre solo
  lo que puede mover un milisegundo —texto, voz, ritmo, pausa, identidad y orden
  de escenas y turnos, transición y fps—, así que mover o animar un personaje
  conserva la medición. El transporte sigue exigiendo un render vigente, y el
  badge tiene un tercer estado, «Medido · falta renderizar».
- Modo animación del lienzo, por elemento y derivado de la selección: si la
  selección se va a otro elemento, el modo no existe. Borde teñido, rótulo con el
  frame y botón para volver a base. Con el modo apagado, mover cambia la base y
  nunca un keyframe; con el modo encendido, al revés. Sin tiempo medido no se
  puede activar.
- El lienzo previsualiza la animación en el cabezal con `evaluateTrack`, el mismo
  evaluador del render: una pista reemplaza el valor base de su parámetro.
- Las transiciones `cut`/`fade` ya eran bloques editables en la unión entre
  escenas (chip con clic para alternar y clic derecho para la duración), así que
  ese punto de la fase estaba cubierto de antes.

**Lote 4, hecho el 28 de julio de 2026**: el render lee las pistas.

- Las pistas viajan del proyecto editable a la escena compilada. El contrato no
  se repite: `scene-config-v2` referencia la definición de pista congelada en
  `animation-scene-v1`, y por eso el compilador valida los keyframes con el mismo
  schema que la autoría.
- El exportador las resuelve contra el audio ya medido con `buildSceneTiming` y
  `resolveAnimationScene`, y alimenta con el resultado **tanto el plan de frames
  como las expresiones de FFmpeg**. Preview y MP4 salen del mismo estado temporal,
  que era el punto 9 de la definición de terminado.
- Posición y escala se convierten en una expresión continua sobre `t`
  (`createFfmpegTrackExpression`) que reproduce exactamente `evaluateTrack`:
  `ease` es `inOutSine`, la interpolación describe el tramo que sale del
  keyframe, antes del primero se sostiene su valor y después del último queda
  congelado. Una prueba compara las dos por 120 muestras y la divergencia
  máxima es **0**.
- La opacidad no puede ser una expresión: `overlay` no acepta alfa variable y
  resolverlo por píxel con `geq` costaría mil millones de evaluaciones por
  escena. Se aplica por rangos de frames con el valor cuantizado del plan, el
  mismo idioma con el que la escena ya enciende ojos, boca y gestos.
- Una pista **reemplaza** la expresión de su parámetro; las demás quedan
  intactas. Sin pistas no cambia una sola cadena, y por eso el `temporalHash` de
  los pilotos v2 sigue congelado.
- El compilador FFmpeg rechaza `rotationDegrees` y `armRaise`; una escena con
  recurso v3 o prop usa PixiJS y sí los lleva al MP4. La interfaz ofrece cada
  parámetro solo cuando el recurso y el compositor seleccionado lo soportan.
- Verificado con un render real: `pilots/animacion-render-01` entra un personaje
  por la izquierda y hace aparecer al otro en su turno. El pipeline reporta
  `deterministic: true` (doble pasada con frames idénticos) y los frames
  extraídos del MP4 muestran el desplazamiento y la aparición en los mismos
  frames que el plan.

### Fase 5 — Presets editables

- Crear catálogo versionado de seis presets.
- Expandir cada preset determinísticamente a dos-cuatro keyframes.
- Conservar procedencia y estado `customized`.
- Añadir aplicación desde inspector y biblioteca de recursos.

**Gate:** aplicar un preset y editar uno de sus puntos produce un proyecto
portable y un MP4 verificable.

**Estado: hecho al 28 de julio de 2026.**

- `shared/animation-presets.js`: los seis presets como DATO versionado, sin una
  línea de lógica por preset. Cada uno describe sus pasos en forma relativa
  (`offset` sobre la base, `absolute`, `factor`) y la expansión los resuelve.
- La expansión es pura y determinista, y respeta el rango del parámetro.
- La intensidad (`soft`/`medium`/`strong`) escala amplitud y duración sin
  cambiar la forma ni la cantidad de keyframes.
- La base se lee UNA vez, al aplicar: si después se mueve el elemento, la pista
  no se mueve sola.
- Editar un punto marca `customized` y **conserva la procedencia**; a partir de
  ahí un preset no la pisa sin que el usuario borre la pista primero.
- `arm-raise` solo se ofrece si el recurso declara el parámetro, así que hoy no
  aparece en ningún personaje v2.
- 12 comprobaciones en `npm run anim:test-presets`.

Aplicar un preset desde el inspector se hizo en el lote 2 de la Fase 4
(`c55ce80`): los presets aplicables aparecen por personaje, y `arm-raise` sigue
sin aparecer porque ningún personaje v2 declara el parámetro.

El MP4 verificable llegó con el lote 4 de la Fase 4 (`df543d8`):
`pilots/animacion-render-01` aplica `enter-left` y `fade-in` y los dos aparecen
en el video.

La biblioteca de recursos muestra los presets compatibles en la ficha del
recurso correspondiente al elemento seleccionado. Los aplica al inicio de la
escena mediante el mismo comando cerrado del inspector; una pista manual o
personalizada no se sobrescribe silenciosamente.

### Fase 6 — Director IA

- Añadir `apply-animation-preset` y `remove-animation` al contrato cerrado.
- Resumir capacidades por elemento sin enviar pistas completas.
- Proteger pistas personalizadas.
- Mostrar antes de aplicar una explicación humana de los cambios.
- Aplicar el lote de forma atómica y permitir un solo undo.

**Gate:** el Director crea una entrada y un `arm-raise` usando dos comandos
compactos; ambos aparecen inmediatamente en timeline e inspector y pueden
personalizarse manualmente.

**Estado: hecho al 28 de julio de 2026.** Ambos comandos están en el contrato
cerrado y conectados a la edición contextual. El Director recibe por elemento
tipo, recurso, parámetros, presets aplicables y un resumen de pistas con
procedencia, `customized` y `removableByDirector`; nunca recibe los keyframes.
El esquema estructurado solo ofrece combinaciones válidas por escena/elemento y
no permite reemplazar una pista personalizada. La respuesta queda como
propuesta, trae una explicación humana derivada del lote validado y la UI la
muestra antes de despachar los comandos. Si el lote quita una pista manual o
personalizada, una segunda confirmación identifica exactamente esos cambios; la
IA no puede incluir `confirmCustomized` por sí misma. Tras la aprobación, el
lote se valida completo, se aplica de forma atómica y ocupa un único paso de
undo/redo.

### Fase 7 — Gate humano

Producir al menos tres videos locales:

1. entrada/salida de un personaje;
2. presentación de un prop;
3. gesto articulado anclado a una palabra.

Registrar:

- tiempo de autoría manual;
- tiempo con Director;
- cantidad de ajustes posteriores;
- render total;
- RAM y disco;
- divergencias preview/MP4;
- errores de referencias después de editar diálogo.

**Avance al 28 de julio de 2026:** existe un gate integrado preliminar,
`gate-capacidades-v1`, que combina en 18,4 s las tres situaciones y además
fuerza ambos compositores, música, cámara, cinco gestos, cinco layouts, cuatro
voces y los seis parámetros animables. El render interactivo aprobó 9
verificaciones y está documentado en
`docs/GATE_INTEGRADO_CAPACIDADES_V1.md`. Todavía faltan la evaluación humana y
los tres videos separados exigidos por el gate original.

Solo después se decide entre:

- más joints e IK;
- más tipos de elemento;
- texto e imágenes animables;
- más presets;
- editor de curvas;
- composición de animaciones;
- levantar el límite de dos personajes.

## 10. Comandos nuevos orientativos

- `set-element-base-transform`
- `add-parameter-keyframe`
- `update-parameter-keyframe`
- `remove-parameter-keyframe`
- `move-parameter-keyframe`
- `apply-animation-preset`
- `remove-animation`
- `set-transition`

Todos deben:

- existir en `schema/editor-command.schema.json`;
- aplicarse mediante `shared/project-editor.js`;
- participar de undo/redo;
- tener etiqueta humana en `src/ui/command-labels.ts`;
- ser simulables antes de que el Director los aplique;
- rechazar claves desconocidas.

No se crea un segundo sistema de comandos exclusivo para la IA.

## 11. Verificación

Este incremento es Nivel 4 por cambiar contratos, evaluador, preview,
exportación y UI.

Pruebas obligatorias por lote:

- validación normal y límites del schema;
- proyecto v2 sin cambios;
- pista normal y referencia rota;
- colisión de keyframes;
- expansión determinista de presets;
- undo/redo individual y por lote del Director;
- timeline e inspector sobre el mismo estado;
- preview y exportación sobre el mismo evaluador;
- doble render con hashes iguales;
- frames dorados de los dos pilotos v3;
- MP4 final comprobado con FFprobe;
- `npm run stage2f:test-parametric`;
- `npm run stage3a:test-compiler`;
- `npm run stage3b:test-editor`;
- `npm run stage3b:test-contracts`;
- `npm run director:test-editor`;
- `npm run ui:test-modules`;
- `npm test`;
- `npm run build`.

## 12. Fuera de alcance

- Backend remoto o multiusuario.
- React o Electron.
- Timeline estilo Premiere.
- Física y simulaciones.
- IK completo en V1.
- Motion capture.
- Plugins o scripts de usuario.
- Expresiones evaluables.
- Keyframes generados uno por uno por IA.
- Generación de video por frame.
- Lip sync fonético nuevo.
- SFX puntuales editables.
- Editor libre de curvas.
- Mezcla de varias animaciones sobre el mismo parámetro.
- Migración destructiva de personajes o proyectos existentes.

## 13. Definición de terminado

El primer plan termina únicamente cuando:

1. un personaje v3 y un prop pueden crearse y reutilizarse;
2. posición, escala, rotación, opacidad y `armRaise` aceptan keyframes;
3. cada keyframe es visible y editable en timeline e inspector;
4. el lienzo distingue edición base de edición temporal;
5. `cut` y `fade` son visibles y editables en la timeline;
6. el Director aplica presets con comandos compactos, no con keyframes;
7. la expansión del preset queda totalmente editable;
8. editar diálogo conserva anchors válidos o marca referencias rotas;
9. preview y MP4 consumen el mismo estado temporal;
10. proyectos y rigs v2 siguen funcionando mediante fallback;
11. tres videos reales superan el gate humano;
12. build, suites específicas y suite central quedan verdes.

Hasta cumplir los doce puntos, la capacidad se considera experimental y no se
amplía con más parámetros, joints, presets ni tipos de recurso.
