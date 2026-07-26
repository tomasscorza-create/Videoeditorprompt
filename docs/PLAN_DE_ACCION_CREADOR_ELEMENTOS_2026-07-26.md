# Plan de acción Creador de elementos — 26 de julio de 2026

> Documento operativo para ejecución por agente (Claude Opus). Objetivo: convertir
> `CREAR → Personajes` en un **creador de elementos** con control real de formas,
> jerarquía y precisión, y dotar a esos elementos de un **contrato de parámetros
> conectable a datos de control** para la animación. Regla rectora: no exponer
> nunca un control que el motor no pueda renderizar de verdad en la exportación.

## Auditoría: qué existe hoy (no redescubrir)

**Tres formatos encadenados**, todos validados por schema:

| Nivel | Archivo | Contenido |
| --- | --- | --- |
| Diseño | `design.json` | Piezas con rol semántico; lista plana, orden = z |
| Definición | `definition.json` / `public/assets/character-definitions/*.json` | Primitivas (`ellipse`, `rect`, `path`, `polygon`) por capa + joints + poses + paleta |
| Rig compilado | `character.manifest.json` v2 | Rutas a 10 PNG + joints + poses |

- `shared/character-design-presets.js` (~266 líneas) traduce diseño → definición
  de forma determinista: ojos → `eyes.open`/`eyes.closed`; boca → `closed`/
  `medium`/`open`; `arm-right` → `hands.neutral`/`hands.point` (mismo brazo
  desplazado −32 % de su alto y rotado −55°); el resto se aplana en `body`.
  Joints generados: `root`, `head`, `shoulder_left`, `shoulder_right`.
- `scripts/stage2f/parametric-character.mjs` rasteriza cada capa a PNG con Chrome
  headless (`--screenshot`), **un proceso por SVG**: 8 capas + 2 miniaturas = 10
  lanzamientos por variante. Valida jerarquía de joints (root único, sin ciclos) y
  exige las poses `neutral` y `point`.
- `shared/scene-evaluator.js` es el evaluador temporal compartido. `evaluateScene`
  devuelve un **struct fijo**: `{ character: {x,y,scale,opacity}, eyes, mouth,
  gesture, background, subtitleVisible }`. `mulberry32` + `buildBlinkSchedule` ya
  aportan aleatoriedad sembrada y determinista.
- **Dos consumidores del evaluador, semánticamente idénticos**:
  - `src/preview/dialogue.ts` (PixiJS): carga las 8 capas como `Sprite` dentro de
    un `Container` por personaje y **alterna `visible`**.
  - `scripts/stage1/export-scene.mjs` / `export-dialogue.mjs`: construye un
    **frame plan** (`Array.from({length: frameCount})` con `evaluateScene(...,
    frameIndex/fps)`), lo hashea (`temporalHash`), lo persiste como
    `frame-plan-N.json`, y **lo colapsa** a expresiones
    `overlay=...:enable='between(n,a,b)+...'`. FFmpeg escribe
    `frames/frame_%04d.png` y después encodea.
- `src/ui/character-creator.ts` (~590 líneas) ya renderiza SVG vivo en el
  navegador con `renderShape`, **duplicando** la implementación de
  `parametric-character.mjs:231`. Arrastre de piezas por `data-part-id`.
- Biblioteca: paquete maestro en `%LOCALAPPDATA%\DisenadorVideosLocal\library\
  assets\characters\<id>`, publicación regenerable en `public/assets/library/
  characters/<id>`, ID = `personaje-local-<sha256[0..12]>` del diseño canónico.

**Los cuatro techos reales:**

1. **El horneado a PNG.** Cada estado posible debe existir como archivo; el
   movimiento continuo es imposible por construcción, no por falta de UI.
2. **Los joints son metadatos.** Se validan y se ignoran: ambos consumidores solo
   encienden y apagan capas planas.
3. **La anatomía es obligatoria y plana.** `REQUIRED_CUSTOM_ROLES` exige las 9
   piezas humanoides, una por rol; sin jerarquía y con rotación siempre alrededor
   del centro de la forma (`partToShape`). Un prop o un decorado no puede existir.
4. **Los datos de control están cableados.** Parpadeo (semilla), boca (RMS) y
   gesto (turno) son tres casos especiales incrustados, no un mecanismo general.

**El hallazgo que ordena todo el plan:** el pipeline **ya pasa por un directorio
de frames PNG**. El frame plan es un artefacto de datos, hasheado y persistido.
Ese es el punto de corte natural: cambiar *quién compone los frames* no toca ni
el encoder, ni el audio, ni el muxeo, ni el evaluador.

## Reglas duras (no negociables)

1. **Nada de controles muertos.** Ningún parámetro continuo se expone en la UI
   antes de que la exportación pueda renderizarlo. Hasta la Fase D verde, el
   creador solo edita lo que el runtime de capas ya sabe hacer.
2. **Preview y exportación siguen usando el mismo evaluador** (invariante de
   `AGENTS.md` §3). Este plan lo refuerza: la Fase D los reduce a **un solo
   compositor**, no a dos implementaciones sincronizadas a mano.
3. **JSON de proyecto es datos, no código.** Los drivers son un **grafo de nodos
   cerrado con `enum` y rangos**, nunca un lenguaje de expresiones ni nada
   evaluable. No se admite SVG crudo, rutas, scripts ni strings libres nuevos
   salvo nombres con `maxLength`.
4. **Determinismo intacto.** Todo driver aleatorio usa `mulberry32` con semilla
   del contrato. Todo frame se evalúa con `frameIndex / fps`; jamás acumulando
   deltas. Sin `Date.now`, `Math.random` ni `requestAnimationFrame` en el camino
   de exportación.
5. **No se reemplaza PixiJS, FFmpeg ni Piper.** La Fase D reemplaza el
   *compositor* (filtergraph → PixiJS headless), conservando FFmpeg como encoder,
   mezclador y muxer, y detrás de un contrato con fallback.
6. **Compatibilidad no destructiva.** Manifest v3 aditivo; v2 se sigue leyendo vía
   adaptador; cada edición guarda variante nueva (ID por hash) como hoy. Ningún
   proyecto existente se rompe.
7. **La IA no gana keyframes.** El Director sigue dirigiendo planes semánticos
   (`AGENTS.md` §1). Los parámetros continuos y keyframes son autoría humana; el
   enum que ve el modelo sigue construyéndose desde `capabilities`.
8. **Verificación estándar por tarea:** `npx tsc --noEmit` + `npm test` +
   `npm run build`. Las tareas **[motor]** van en commits separados, con bump de
   versión de contrato cuando cambie un manifiesto, y con
   `stage2f:test-parametric`, `stage3a:test-compiler`, `stage3b:test-contracts` y
   `local:test-library` verdes. La lógica pura nueva se cubre en
   `ui:test-modules`.

## Mapa: lo que pediste → equivalente honesto aquí

| Pedido | Equivalente en este sistema | Fase |
| --- | --- | --- |
| Más control de formas | Bézier con nodos acotados (la definición ya soporta `path`; lo prohíbe el schema del editor), grupos, gradientes | A4, F3 |
| Mejor manipulación | Pivote propio, jerarquía padre/hijo, multi-selección, snap, simetría, nudge | A2, A3, A5 |
| Más precisión | Sin horneado no hay redondeo: sub-píxel real y nitidez a cualquier escala | D2 |
| Más control de movimiento | Rotación continua por joint con jerarquía real + IK de 2 huesos | E1, E2 |
| Conexión con datos de control | Parámetros tipados + bindings + drivers deterministas | B2, C2, C3 |
| «Creador de elementos», no solo personajes | Tipo de elemento + slots de capacidad en vez de anatomía obligatoria | B1 |

## Arquitectura objetivo

Separar tres cosas hoy fundidas en un JSON:

```
GEOMETRÍA               PARÁMETROS                  DRIVERS
(formas + árbol)   ←    (contrato tipado)      ←    (datos de control)
partes, pivotes         mouth: enum                 audio.rms
jerarquía               headTurn: float -1..1       clock.blink (semilla)
orden de dibujo         armRaise: float 0..1        dialogue.turn
                        blink: float 0..1           timeline.keyframes
                                                    lfo / noise (mulberry32)
```

El elemento **declara** qué parámetros expone. Los *bindings* mapean parámetro →
propiedad de una parte (rotación de joint, visibilidad de un grupo de capas,
opacidad, posición) a través de una curva o una tabla de estados. Los *drivers*
escriben valores por frame. El gesto `point` deja de ser un PNG alternativo y
pasa a ser `armRaise = 1`: continuo, interpolable y combinable.

Boceto del contrato (todos los `type`, `source`, `kind` y `curve` son `enum`
cerrados; los `map` tienen rangos validados):

```json
{
  "parameters": [
    { "id": "mouth", "type": "enum", "values": ["closed","medium","open"], "default": "closed" },
    { "id": "headTurn", "type": "float", "min": -1, "max": 1, "default": 0 },
    { "id": "armRaise", "type": "float", "min": 0, "max": 1, "default": 0 }
  ],
  "bindings": [
    { "param": "mouth", "target": { "kind": "layerSet", "group": "mouth" } },
    { "param": "headTurn", "target": { "kind": "joint", "id": "head", "property": "rotationDegrees" },
      "map": { "type": "linear", "outMin": -18, "outMax": 18 } },
    { "param": "armRaise", "target": { "kind": "joint", "id": "shoulder_right", "property": "rotationDegrees" },
      "map": { "type": "ease", "curve": "inOutSine", "outMin": -12, "outMax": -67 } }
  ],
  "drivers": [
    { "param": "mouth", "source": "audio.rms", "speaker": "$self" },
    { "param": "headTurn", "source": "noise", "seed": 72011, "frequency": 0.15, "amplitude": 0.4 },
    { "param": "armRaise", "source": "timeline.keyframes" }
  ]
}
```

Parpadeo, boca y gesto pasan a ser tres drivers estándar en lugar de tres
excepciones del pipeline.

---

## Fase A — Editor de elementos (sin tocar el motor)

Valor inmediato y riesgo bajo: el compilador sigue aplanando a las mismas 10
capas, así que todo lo existente sigue funcionando igual.

### A1 · Unificar `renderShape` en `shared/`
- **Qué:** extraer una única implementación del vocabulario de formas a
  `shared/shape-renderer.js` (+ `.d.ts`), consumida por
  `src/ui/character-creator.ts` y `scripts/stage2f/parametric-character.mjs`. Hoy
  son dos implementaciones que pueden divergir en silencio; toda la Fase A agrega
  primitivas, y agregarlas dos veces garantiza divergencia.
- **Archivos:** `shared/shape-renderer.js`, `shared/shape-renderer.d.ts`,
  `src/ui/character-creator.ts:462`, `scripts/stage2f/parametric-character.mjs:231`.
- **Cierre:** una sola definición de `ellipse`/`rect`/`path`/`polygon`; los PNG
  compilados antes y después del cambio tienen el mismo SHA-256.

### A2 · Pivote propio por pieza
- **Qué:** campo `pivotX`/`pivotY` normalizado (0..1, default 0.5/0.5) en el
  diseño; `partToShape` deja de rotar siempre alrededor del centro geométrico.
  Manija de pivote arrastrable en el lienzo del creador.
- **Archivos:** `schema/local-character-design.schema.json`,
  `shared/character-design-presets.js` (`partToShape`, `partToEllipse`),
  `src/ui/character-creator.ts`.
- **Cierre:** rotar un brazo alrededor del hombro y no de su centro; diseños v2
  sin el campo se leen con el default y compilan idéntico a hoy.

### A3 · Jerarquía padre/hijo en el diseño
- **Qué:** `parentId` opcional por pieza (mismo modelo de validación que los
  joints: un solo root implícito, sin ciclos — reusar la lógica de
  `validateRigSemantics`). La transformación del padre se propaga en el editor.
  Orden de dibujo explícito (`drawOrder`), desacoplado del árbol.
- **Archivos:** `schema/local-character-design.schema.json`,
  `shared/character-design-presets.js`, `src/ui/character-creator.ts`.
- **Cierre:** mover el hombro arrastra antebrazo y mano en el editor; el aplanado
  a `body`/`eyes`/`mouth`/`hands` respeta `drawOrder` y sigue produciendo el mismo
  contrato v2.

### A4 · Formas Bézier acotadas
- **Qué:** habilitar `path` en el editor con un modelo de nodos declarativo
  (nodo + dos manijas, todo numérico y con rangos), serializado al `d` que la
  definición ya acepta. **No** se ingiere SVG del usuario: el editor construye el
  `d`, el schema valida los nodos. Herramienta de pluma con clic-arrastre.
- **Archivos:** `schema/local-character-design.schema.json`,
  `shared/shape-renderer.js`, `src/ui/character-creator.ts`.
- **Cierre:** una silueta no reducible a elipses y rectángulos se puede dibujar,
  guardar y compilar; el schema sigue rechazando cualquier string de path que no
  provenga del modelo de nodos.

### A5 · Manipulación profesional
- **Qué:** multi-selección con caja de transformación (escala proporcional con
  Shift, rotación alrededor del pivote elegido), snap a guías y a otras piezas,
  alinear/distribuir, eje de simetría con espejado, nudge con flechas (±1 px,
  ±10 px con Shift), zoom fuerte con rejilla, entrada numérica directa de
  `x`/`y`/`width`/`height`/`rotationDegrees`.
- **Archivos:** `src/ui/character-creator.ts`, `src/style.css`; geometría pura en
  un módulo aparte cubierto por `ui:test-modules`.
- **Cierre:** colocar una pieza con precisión de píxel sin pelear con el mouse;
  la lógica de snap/alineación es pura y testeada.

## Fase B — Contrato de elemento v3 **[motor]**

### B1 · Tipo de elemento y slots de capacidad
- **Qué:** reemplazar el enum rígido `REQUIRED_CUSTOM_ROLES` por *tipo de
  elemento* (`character` | `prop` | `decor`) + *slots de capacidad declarados*.
  Un personaje declara `eyes`, `mouth`, `gesture`; un prop no declara ninguno. La
  validación pasa de «todo elemento necesita dos piernas» a «si declarás la
  capacidad X, atá las piezas que X necesita». Los roles quedan como **binding de
  pieza a capacidad**, no como anatomía obligatoria.
- **Archivos:** `schema/local-character-design.schema.json`,
  `shared/character-design-presets.js` (`customCharacterDesignIssues`),
  `scripts/local-app/resource-library.mjs`, `src/ui/character-creator.ts`.
- **Cierre:** se puede crear y guardar un prop sin piernas ni ojos; un personaje
  incompleto sigue reportando exactamente qué capacidad le falta y por qué.

### B2 · Parámetros y bindings en el manifest v3
- **Qué:** `schema/character-manifest-v3.schema.json` aditivo sobre v2: agrega
  `parameters[]` y `bindings[]` con el contrato del boceto de arriba. `version`
  pasa a `3`. Los `capabilities` del catálogo pasan a listar los parámetros
  expuestos, no solo `poses`/`animationPresets`.
- **Archivos:** `schema/character-manifest-v3.schema.json`,
  `schema/authoring-resource-catalog.schema.json`,
  `scripts/stage2f/parametric-character.mjs`.
- **Cierre:** un manifest v3 valida contra el schema y declara sus parámetros;
  ningún campo admite strings libres ni expresiones.

### B3 · Compilador dual
- **Qué:** `compileParametricCharacter` emite el rig v3 **y** las 10 capas PNG v2
  compatibles. Camino secundario de rendimiento: rasterizar en un solo proceso
  Chrome en vez de diez (hoy `rasterizeSvg` hace un `run()` por archivo), lo que
  acorta cada guardado del creador.
- **Archivos:** `scripts/stage2f/parametric-character.mjs`,
  `scripts/local-app/resource-library.mjs`.
- **Cierre:** `stage2f:test-parametric` verde; los PNG resultantes conservan sus
  hashes; el tiempo de guardado de un personaje baja de forma medible.

### B4 · Adaptador de lectura v2 → v3
- **Qué:** leer un manifest v2 como un rig v3 con tres parámetros enum fijos
  (`eyes`, `mouth`, `gesture`), sin jerarquía y con bindings de tipo `layerSet`.
  Los proyectos y personajes existentes no se recompilan ni se tocan.
- **Archivos:** `shared/` (módulo nuevo de lectura de rigs),
  `scripts/stage3a/compile-video-project.mjs`.
- **Cierre:** los 9 personajes del repo y los locales ya guardados renderizan
  byte a byte igual que antes del cambio.

## Fase C — Evaluador y datos de control **[motor]**

### C1 · El evaluador emite parámetros, no un struct fijo
- **Qué:** `evaluateScene` pasa a devolver, además de lo actual, un mapa
  `elements[id].params` con los valores resueltos de ese frame. El struct viejo se
  conserva como vista derivada para no romper a nadie durante la transición.
- **Archivos:** `shared/scene-evaluator.js`, `src/preview/dialogue.ts`,
  `scripts/stage1/export-scene.mjs`, `scripts/stage1/export-dialogue.mjs`.
- **Cierre:** el `temporalHash` del frame plan de los pilotos no cambia; ambos
  consumidores leen del mapa nuevo.

### C2 · Drivers deterministas (grafo de nodos cerrado)
- **Qué:** refactorizar parpadeo, boca y gesto como drivers estándar y sumar los
  nuevos: `clock.blink` (reusa `buildBlinkSchedule`), `audio.rms`,
  `dialogue.turn`, `timeline.keyframes`, `lfo`, `noise` (mulberry32),
  `remap`, `curve`. Grafo dirigido sin ciclos, con la misma detección que ya
  existe para joints. **Sin lenguaje de expresiones** (regla dura 3).
- **Archivos:** `shared/drivers.js` (+ `.d.ts`), `shared/scene-evaluator.js`,
  `schema/video-project.schema.json`, `schema/scene-config-v2.schema.json`.
- **Cierre:** eliminar el hardcode de parpadeo/boca/gesto sin cambiar un solo
  frame de salida de los pilotos; un grafo con ciclo se rechaza con error
  estructurado.

### C3 · Keyframes en el proyecto, la timeline y el inspector
- **Qué:** pista de parámetros por elemento en el contrato de proyecto, comandos
  de editor (`set-parameter-keyframe`, `remove-parameter-keyframe`) con undo/redo,
  y carril en la timeline. Interpolación `linear` | `ease` | `hold`.
- **Archivos:** `schema/video-project.schema.json`,
  `schema/editor-command.schema.json`, `shared/project-editor.js`,
  `src/ui/timeline.ts`, `src/ui/project/panel.ts`.
- **Cierre:** `stage3b:test-editor` y `stage3b:test-contracts` verdes; paridad
  timeline ↔ inspector conservada. **Gate:** solo se exponen en la UI los
  parámetros que el compositor vigente sabe renderizar (regla dura 1).

## Fase D — Compositor unificado **[motor — GATE DE USUARIO]**

**Esta fase requiere autorización explícita antes de empezar.** Es la decisión
arquitectónica del plan y toca una invariante declarada: hoy el compositor de
exportación es FFmpeg puro y `AGENTS.md` §3 pide que el pipeline funcione
headless sin navegador.

**Argumento a favor:** el frame plan ya existe como dato hasheado y el pipeline ya
escribe `frames/frame_%04d.png`. Cambiar quién produce esos PNG no toca el
evaluador, el encoder, el audio ni el muxeo. Y convierte «dos implementaciones
sincronizadas a mano» (PixiJS en preview, filtergraph en export) en **una sola**,
que es la prioridad #4 del repositorio. Chrome ya es dependencia dura del
pipeline de assets (`resolveBrowserExecutable`) y ya resuelve rutas Linux.

**Argumento en contra:** agrega un navegador al camino de render del motor, no
solo al de assets. Mitigación: contrato reemplazable con fallback (D1, D4), en
línea con «render y storage deben evolucionar hacia contratos reemplazables».

**Sin esta fase, las Fases E1–E3 no son realizables** y los parámetros continuos
de C2/C3 quedan permanentemente bloqueados por la regla dura 1.

### D1 · Extraer el compositor a un contrato
- **Qué:** interfaz `composeFrames(framePlan, assets, outputDir)` con la
  implementación actual (filtergraph) detrás. Cambio puramente estructural.
- **Cierre:** `stage1:verify` y `stage3a:test-assembly` verdes sin cambios de
  salida.

### D2 · Compositor PixiJS headless
- **Qué:** segunda implementación del contrato: una página que arma el grafo de
  escena con PixiJS, consume el frame plan y emite un PNG por frame vía Chrome
  headless. Tiempo por índice de frame explícito, sin `rAF`, sin `Date.now`,
  fuentes embebidas. Comparte el código de escena con `src/preview/dialogue.ts`.
- **Cierre:** produce frames visualmente equivalentes a los del filtergraph para
  los pilotos; FFmpeg sigue encodeando, mezclando y muxeando sin cambios.

### D3 · Tests de frame dorado y determinismo
- **Qué:** hash de frames representativos por piloto; ejecución doble del mismo
  job debe dar hashes idénticos; comparación filtergraph vs PixiJS dentro de una
  tolerancia declarada.
- **Cierre:** suite nueva integrada a `npm test`.

### D4 · Cambio de predeterminado, filtergraph como fallback
- **Qué:** rigs v3 usan el compositor PixiJS; rigs v2 pueden seguir por
  filtergraph. Selección por configuración, no por detección implícita.
- **Cierre:** rollback a una sola variable; ningún proyecto queda sin camino.

## Fase E — Movimiento real (depende de D)

### E1 · Rotación continua por joint con jerarquía
- **Qué:** los joints dejan de ser metadatos: el compositor aplica la
  transformación jerárquica por frame. Se acaba la explosión combinatoria de
  estados.
- **Cierre:** `armRaise` como float produce movimiento suave en preview y en MP4,
  idénticos.

### E2 · IK de dos huesos para brazos
- **Qué:** arrastrás la mano y hombro/codo se resuelven. Acotado, determinista y
  sin dependencias. Es el mayor salto de calidad en manipulación.
- **Cierre:** el gesto de señalar se autoría arrastrando, no eligiendo un preset.

### E3 · Levantar los límites del runtime
- **Qué:** más de dos personajes por escena y `poseId` distinto de `neutral`
  (`compile-video-project.mjs:142`). Ambos existen porque el runtime de capas los
  necesitaba; con E1 dejan de tener razón de ser. Revisar en paralelo el chequeo
  `characterIds.size !== 2` de `scripts/director/director-plan.mjs:68`.
- **Cierre:** contrato y suites del compilador actualizados; el Director deja de
  asumir exactamente dos roles.

## Fase F — Gated: decisión del usuario

- **F1 · Visemas / lip sync fonético.** Convertiría la boca de «3 estados por
  volumen RMS» a sincronía labial creíble usando fonemas de Piper. **`AGENTS.md`
  §1 lo declara explícitamente fuera del alcance actual**; requiere autorización
  y una etapa propia. No implementar por iniciativa propia.
- **F2 · Track de datos externo.** Driver que lee una pista JSON/CSV validada por
  schema. Habilita animar por datos arbitrarios. Gate: demanda comprobada.
- **F3 · Gradientes, grupos y máscara de recorte.** Solo tienen sentido pleno tras
  D2 (sin horneado). Gate: uso real del creador.

## Orden de ejecución sugerido

`A1 → A2 → A3 → A4 → A5` (todo el valor de autoría, riesgo bajo, motor intacto) →
`B1 → B2 → B3 → B4` [motor] → `C1 → C2` [motor] → **checkpoint con el usuario** →
**gate de la Fase D** → `D1 → D2 → D3 → D4` → `C3` (keyframes, ya renderizables) →
`E1 → E2 → E3`. F queda gated.

## Qué NO hacer

- Exponer parámetros continuos en la UI antes de que la exportación los renderice.
- Un lenguaje de expresiones, `eval`, o cualquier campo evaluable en el JSON de
  proyecto o de elemento.
- Ingerir SVG, paths o rutas aportados por el usuario: el editor construye la
  geometría, el schema la valida.
- Rasterizar por frame con `--screenshot` (10 procesos por variante ya es el
  problema; 1800 sería absurdo). El compositor headless es una página, no N
  capturas.
- Empezar la Fase D sin autorización explícita, ni saltarse D1/D4 (contrato y
  fallback).
- Recompilar o migrar personajes ya guardados: manifest aditivo y adaptador.
- Dar keyframes a la IA (regla dura 7) ni tocar la guarda loopback del Director.
- Dependencias nuevas: PixiJS, FFmpeg y Chrome ya están; alcanzan.
- Implementar F1 sin una etapa autorizada.

## Traza

| Tarea | Origen | Estado |
| --- | --- | --- |
| A1 | deuda detectada: `renderShape` duplicado TS/mjs | pendiente |
| A2–A5 | pedido del usuario (formas, manipulación, precisión) | pendiente |
| B1 | pedido («creador de elementos», no solo personajes) | pendiente |
| B2–B4 | pedido (conexión con datos de control) — habilitador | pendiente |
| C1–C2 | pedido (datos de control) + refactor de 3 casos cableados | pendiente |
| C3 | pedido (control de movimiento) | pendiente, gated por D |
| D1–D4 | habilitador mayor; decisión arquitectónica | **gate de usuario** |
| E1–E3 | pedido (control de movimiento, precisión) | pendiente, depende de D |
| F1 | fuera de alcance por `AGENTS.md` §1 | decisión pendiente |
| F2–F3 | ampliación | gated a uso real |
