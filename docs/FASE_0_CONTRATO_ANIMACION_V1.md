# Fase 0 — contrato y prototipo de interacción de animación V1

Fecha: 27 de julio de 2026
Estado: ejecutada
Plan de origen: `docs/PLAN_CAPACIDADES_CREATIVAS_EDITABLES_V1.md`, Fase 0
Nivel de pruebas: 2 (lógica de módulo aislada; no toca pipeline ni evaluador)

## 1. Qué congela esta fase y qué no toca

Congela, en datos verificables y no solo en prosa:

- el vocabulario de parámetros animables, anclas, interpolaciones y procedencia;
- los límites de pistas y keyframes;
- la regla de cuantización de un instante de autoría a `frameIndex`;
- el catálogo cerrado de errores con mensaje humano y acción sugerida;
- la definición del estado «requiere revisión»;
- el estado visible de timeline, inspector y lienzo;
- fixtures válidos e inválidos que prueban todo lo anterior.

No toca, deliberadamente:

- `schema/video-project.schema.json` ni `schema/editor-command.schema.json`;
- `shared/scene-evaluator.js`, `shared/project-editor.js` ni el compilador;
- la interfaz: los dibujos de la sección 6 son especificación, no implementación;
- la expansión concreta de los seis presets, que pertenece a la Fase 5.

El contrato vive aislado en `schema/animation-scene.schema.json`. La Fase 4 lo
incorpora al proyecto editable; hasta entonces no puede romper nada porque
nadie lo consume todavía.

## 2. Vocabulario congelado

### 2.1 Parámetros animables

| `parameterId` | Unidad | Rango | Aplica a | Base de la que parte |
| --- | --- | --- | --- | --- |
| `position.x` | px | −1080 … 2160 | `character`, `prop` | `transform.x` |
| `position.y` | px | −1920 … 3840 | `character`, `prop` | `transform.y` |
| `scale` | factor | > 0 … 10 | `character`, `prop` | `transform.scale` |
| `rotationDegrees` | grados | −180 … 180 | `character`, `prop` | `transform.rotationDegrees` |
| `opacity` | normalizado | 0 … 1 | `character`, `prop` | `transform.opacity` |
| `armRaise` | normalizado | 0 … 1 | solo `character` que declare el joint | `0` |

Los rangos son exactamente los de `transform` en `schema/video-project.schema.json`.
Cualquier divergencia entre las dos tablas es un error de contrato, no una
diferencia de criterio.

**No son animables en V1:** `zIndex`, `anchorX`, `anchorY`, color, texto,
recurso, pose, cámara y fondo. `position.x` y `position.y` son pistas
independientes: no existe una pista `position` conjunta.

### 2.2 Anclas

```json
{ "kind": "scene", "edge": "start" | "end" }
{ "kind": "turn", "turnId": "escena-1-t2", "edge": "start" | "end" }
{ "kind": "word", "turnId": "escena-1-t2", "wordIndex": 3 }
```

- `wordIndex` es base 0 y se muestra en base 1 («palabra 4»). Límite 0 … 99,
  igual que `gestureAtWord` en el contrato vigente.
- Un ancla de palabra resuelve al **comienzo** de esa palabra. No tiene `edge`.
- `offsetSeconds` va de −5 a 5. Para distancias mayores se elige un ancla más
  cercana; ese es justamente el punto del modelo. Un desplazamiento grande es
  señal de que el keyframe está colgado del sitio equivocado.

### 2.3 Interpolaciones

`linear`, `ease` (`inOutSine`, versionada) y `hold`. No hay curvas libres.

Tres reglas que estaban implícitas y ahora son parte del contrato:

1. **La interpolación de un keyframe describe el tramo que sale de él** hacia el
   siguiente, no el que entra.
2. **El último keyframe de una pista debe declarar `hold`.** Después de él el
   valor queda congelado hasta el final de la escena. Que esté escrito en los
   datos evita que «qué pasa al final» dependa de leer el evaluador.
3. **Antes del primer keyframe se sostiene el valor del primer keyframe.** No se
   extrapola hacia atrás ni se mezcla con la base.

### 2.4 Relación entre base y pista

> Una pista **reemplaza** el valor base de su parámetro durante toda la escena.
> No se suma a él.

Consecuencia deliberada: al aplicar `enter-left`, la expansión lee la base
vigente en ese momento y la escribe como valor del último keyframe. Si después
movés el personaje en el lienzo con el modo base, **la pista no se mueve sola**.
La alternativa —que la pista siguiera a la base— haría que un cambio de base
reescribiera keyframes que el usuario ya editó a mano, que es exactamente lo que
el plan prohíbe. La UI debe advertirlo cuando la base y el último keyframe de
una pista de entrada dejan de coincidir.

Los parámetros sin base en `transform` (`armRaise`) parten del valor por defecto
que declara el recurso, `0` en V1.

### 2.5 Procedencia

```json
{ "kind": "preset", "presetId": "enter-left", "version": 1, "customized": false }
{ "kind": "manual" }
```

`customized` **solo existe en pistas de preset**, donde es obligatorio. Una
pista manual es personalizada por definición y no lleva el campo: así no hay dos
maneras de representar el mismo hecho. Presets cerrados en V1: `enter-left`,
`enter-right`, `fade-in`, `fade-out`, `emphasis-pulse`, `arm-raise`.

### 2.6 Límites

| Límite | Valor | Dónde se comprueba |
| --- | --- | --- |
| Pistas por elemento | 8 | schema |
| Keyframes por pista | 32 | schema |
| Keyframes por escena | 256 | validador |
| Keyframes mínimos por pista | 2 | schema |
| Elementos animados por escena | 20 | schema |
| Pistas por parámetro y elemento | 1 | validador |

Nota honesta sobre el límite de 8 pistas: en V1 solo hay seis parámetros y no se
admite más de una pista por parámetro, así que **el techo real es 6**. El 8 del
plan queda como margen para los parámetros que se agreguen después, no como una
restricción activa. Un elemento lleno son 6 × 32 = 192 keyframes, de modo que
dos elementos llenos superan el límite de escena: el tope de 256 es el que
efectivamente muerde.

Un valor estático **no es una pista de un keyframe**: eso pertenece al transform
base. Por eso el mínimo son dos.

### 2.7 Cuantización a frame

```text
frameIndex = max(0, round(segundosResueltos × fps))
```

Redondeo al frame **más cercano**, no truncamiento. Es distinto del `Math.ceil`
que usa `scripts/stage1/export-dialogue.mjs` para contar los frames de una
duración: allí se mide un tramo, acá se ubica un punto. El invariante de
evaluación sigue siendo `frameIndex / fps`.

### 2.8 Colisión de nombre con `animationPreset`

El proyecto ya tiene un campo llamado `animationPreset` en `characterElement`,
con valores `idle-calm` y `talk-calm`. **No es lo mismo** que un preset de
animación de esta fase: es el movimiento continuo de fondo (bob y pulso de
escala) que `scripts/stage3a/compile-video-project.mjs` resuelve en
`MOTION_PRESETS`, y que la timeline ya rotula «movimiento base».

Decisión congelada:

- el campo vigente se llama **«movimiento base»** en toda la interfaz y
  documentación nueva;
- lo de esta fase se llama **«preset de animación»** y vive en
  `track.source.presetId`;
- ningún texto de interfaz nuevo puede decir solo «animación» para referirse al
  campo viejo;
- el renombre del campo a `baseMotionId` queda anotado como deuda para la Fase 4,
  cuando `tracks` entre al proyecto y haga falta un adaptador de lectura de
  todos modos. Renombrarlo ahora rompería proyectos, catálogo y publicaciones
  vigentes sin ganar nada.

## 3. Catálogo de errores

Todos los códigos viven en `ANIMATION_ERROR_CATALOG`
(`scripts/animation/animation-contract.mjs`) con su mensaje humano y su acción
sugerida. La interfaz de la Fase 4 debe tomarlos de ahí, no reescribirlos.

### 3.1 Autoría — comprobables sin medir el audio

| Código | Se dispara cuando | Acción sugerida |
| --- | --- | --- |
| `ANIM_DOCUMENT_INVALID` | La estructura no cumple el schema v1 | Revisar contra `schema/animation-scene.schema.json` |
| `ANIM_ELEMENT_DUPLICATED` | Un elemento aparece dos veces en la escena | Unificar sus pistas en una entrada |
| `ANIM_PARAMETER_UNSUPPORTED` | El elemento no admite ese parámetro (`armRaise` en un prop) | Elegir un parámetro que el recurso declare |
| `ANIM_PARAMETER_DUPLICATED` | Dos pistas sobre el mismo parámetro | Convertirlas en una sola |
| `ANIM_TRACK_LIMIT_EXCEEDED` | Más de 8 pistas en un elemento | Eliminar pistas |
| `ANIM_KEYFRAME_LIMIT_EXCEEDED` | Más de 256 keyframes en la escena | Simplificar la animación |
| `ANIM_KEYFRAME_ID_DUPLICATED` | Dos keyframes con el mismo id | Asignar ids únicos |
| `ANIM_KEYFRAME_COLLISION` | Dos keyframes de una pista en la misma ancla y offset | Separarlos o borrar el duplicado |
| `ANIM_KEYFRAME_ORDER_INVALID` | Offsets no crecientes dentro de la misma ancla | Ordenarlos antes de guardar |
| `ANIM_INTERPOLATION_INVALID` | El último keyframe no usa `hold` | Cambiarlo a `hold` |

### 3.2 Compilación — solo después de FFprobe (Fase 2)

| Código | Se dispara cuando |
| --- | --- |
| `ANIM_ANCHOR_UNRESOLVED` | Un keyframe apunta a un turno o palabra que ya no existe |
| `ANIM_FRAME_COLLISION` | Dos keyframes distintos resolvieron al mismo frame |
| `ANIM_TRACK_OUT_OF_SCENE` | Un keyframe resolvió fuera de los límites de su escena |

Están definidos ahora para que la Fase 2 no invente vocabulario nuevo, pero
todavía nadie los emite.

Una colisión de frames **nunca** se resuelve por descarte silencioso. Dos
keyframes que terminan en el mismo frame son un error visible.

## 4. Estado «requiere revisión»

Es un estado **derivado**, no un campo persistido. Se calcula comparando las
anclas contra el diálogo vigente (`listAnchorsRequiringReview`) y nunca lanza
excepción: una referencia rota es algo que el usuario tiene que resolver, no un
documento corrupto.

Reglas:

- un keyframe anclado a `scene` **nunca** se rompe al editar el diálogo;
- un keyframe anclado a `turn` se marca si el turno desapareció;
- un keyframe anclado a `word` se marca si el turno desapareció o si el turno ya
  no tiene esa palabra;
- **nunca** se reasigna en silencio a otro turno ni a otra palabra;
- el render se bloquea con `ANIM_ANCHOR_UNRESOLVED` mientras quede uno pendiente.

Lo que la interfaz debe mostrar, en tres niveles, para que el estado se
descubra sin tener el elemento seleccionado:

1. **Keyframe:** diamante hueco en color de advertencia (`◇` en los dibujos).
2. **Fila del elemento:** insignia agregada `⚠ n` con la cantidad pendiente.
3. **Proyecto:** el botón de exportar queda deshabilitado y explica cuántas
   referencias hay que revisar y en qué escena, antes de que el usuario intente
   renderizar.

El inspector ofrece exactamente dos salidas por keyframe roto: **reanclar** a
una referencia vigente o **eliminar** el keyframe. No hay «arreglar
automáticamente».

## 5. Estado visible — timeline

La fila «Animación» es plegable y cuelga de la pista del elemento
(`V1`, `V2`…), dentro del bloque `VISUAL` que ya existe. No es un carril nuevo
de primer nivel: la organización canónica de `docs/ESTRUCTURA_VISUAL_CANONICA.md`
no cambia.

```text
┌ REGLA ──────────────────────────────────────────────────────────────────────┐
│ 0s        1s        2s        3s        4s        5s        6s      6.40s   │
├ TRANSICIONES ───────────────────────────────────────────────────────────────┤
│                                                                 [ fade 0.4 ]│
├ VISUAL · Capas que forman la imagen ────────────────────────────────────────┤
│ BG │ Estudio parallax · 6.40 s                                              │
│ V1 │ Mono presentador azul · escala 1.00 · movimiento base talk-calm    ⚠ 1 │
│    ▾ Animación · 2 pistas                                                   │
│    position.x │ enter-left │ ◆━━━━━━◆                                       │
│    armRaise   │ arm-raise  │                    ◇┈┈┈┈◇┈┈┈┈◇                 │
│ V2 │ Mono analista ciruela · escala 1.00 · movimiento base idle-calm        │
├ AUDIO · Voces debajo de las capas visuales ─────────────────────────────────┤
│ A1 │ [ t1 «Hoy vemos…» ]      [ t2 «Y ahora el dato» ]                      │
└─────────────────────────────────────────────────────────────────────────────┘

◆ keyframe            ━ tramo ease/linear      [ enter-left ] procedencia
◇ requiere revisión   ┈ tramo hold             ⚠ n  pendientes del elemento
```

Operaciones mínimas sobre un keyframe: seleccionar, agregar en el playhead,
arrastrar, ajustar con teclado frame a frame, cambiar interpolación, duplicar,
eliminar, cambiar el ancla, convertir el tiempo medido en la referencia
semántica más cercana, deshacer y rehacer.

Quedan fuera de V1: editor de curvas, selección masiva, estirar clips,
composición por capas y scripting.

## 6. Estado visible — inspector

Con un keyframe seleccionado:

```text
┌ KEYFRAME ───────────────────────────────────────┐
│ Parámetro      armRaise                         │
│ Valor          1.00              [ ──────●── ]  │
│ Ancla          palabra 4 del turno «Y ahora…»   │
│                [ escena ▾ ] [ turno ▾ ] [palabra]│
│ Desplazamiento +0.15 s          [ − ] [ + ]     │
│ Tiempo resuelto 3.017 s · frame 91   (solo lect.)│
│ Interpolación  ( linear ) (•ease•) ( hold )     │
│ Procedencia    preset arm-raise v1 · sin editar │
│ Estado         Normal                           │
│                                                 │
│ [ Duplicar ]  [ Eliminar ]                      │
└─────────────────────────────────────────────────┘
```

El mismo keyframe con la referencia rota:

```text
│ Estado    ⚠ Requiere revisión                   │
│           El turno «Y ahora el dato» ya no      │
│           tiene una palabra 4.                  │
│           [ Reanclar… ]  [ Eliminar keyframe ]  │
```

«Tiempo resuelto» solo aparece cuando existe una exportación medida vigente. Sin
medición dice «pendiente de voz», nunca un número estimado: la duración real
viene de Piper y FFprobe, no de una cuenta sobre el texto.

Con un elemento seleccionado y sin keyframe:

```text
┌ ELEMENTO · Mono presentador azul ───────────────┐
│ Base    x 320   y 1180   escala 1.00            │
│         rotación 0°      opacidad 1.00          │
│ Movimiento base   [ talk-calm ▾ ]               │
│                                                 │
│ Presets de animación                            │
│ [ enter-left ] [ enter-right ] [ fade-in ]      │
│ [ fade-out ]   [ emphasis-pulse ] [ arm-raise ] │
│                                                 │
│ [ + Agregar keyframe en el playhead ]           │
│ Pistas   position.x · enter-left  [ Personalizar ]│
└─────────────────────────────────────────────────┘
```

## 7. Estado visible — lienzo

El riesgo principal de toda esta capacidad es un modo global invisible: mover un
personaje y no saber si se cambió la base o se creó un keyframe. El indicador no
puede ser un icono discreto en una barra.

```text
┌───────────────────────────────────────────────┐
│  ╔═══════════════════════════════════════════╗│   borde teñido en todo el
│  ║ ◆ ANIMANDO · armRaise · frame 91          ║│   lienzo mientras el modo
│  ║   Mover el elemento crea o actualiza un   ║│   animación está activo
│  ║   keyframe aquí.        [ Volver a base ] ║│
│  ╚═══════════════════════════════════════════╝│
│                                               │
│              (personaje seleccionado con      │
│               manija acotada de armRaise)     │
│                                               │
└───────────────────────────────────────────────┘
```

Reglas del modo:

- el modo animación **se activa por elemento y se apaga al cambiar de
  selección**; no es un interruptor global persistente;
- el borde del lienzo cambia de color y el rótulo nombra el parámetro y el frame
  actual, para que el estado se lea sin buscarlo;
- con el modo apagado, mover el elemento cambia la base y **nunca** toca un
  keyframe;
- con el modo encendido, mover el elemento crea o actualiza el keyframe del
  playhead y **nunca** toca la base;
- si el playhead no está sobre un tiempo medido, el modo animación no se puede
  activar: sin medición no hay frame al que anclar el keyframe.

El brazo piloto expone una manija acotada para `armRaise`. IK completo queda
fuera de V1.

## 8. Trazado del gate

> Una animación puede seguirse en papel desde la intención del Director hasta
> los controles de la interfaz y el frame resuelto, sin campos ambiguos.

Medición de referencia: escena `escena-1` a 30 fps, arranca en 0.000 s; el turno
`escena-1-t2` empieza en 2.133 s; su palabra de índice 3 empieza en 2.867 s.

| Paso | Contenido |
| --- | --- |
| 1. Intención | «Que levante el brazo cuando diga *ahora*.» |
| 2. Comando | `apply-animation-preset` · elemento `escena-1-personaje-a` · preset `arm-raise` · ancla `word escena-1-t2 #3` · intensidad `medium` |
| 3. Validación | recurso admite `armRaise`, preset existe, ancla resoluble, no hay otra pista sobre `armRaise` |
| 4. Expansión | tres keyframes deterministas sobre la pista `armRaise`, `source.presetId = arm-raise`, `customized: false` |
| 5. Documento | `pilots/animacion-v1/fixtures/valid/gesto-en-palabra.json` |
| 6. Resolución | 2.767 s → frame **83** · 3.017 s → frame **91** · 3.717 s → frame **112** |
| 7. Timeline | fila `armRaise` con etiqueta `arm-raise` y tres diamantes |
| 8. Inspector | valor, ancla, offset, tiempo resuelto de solo lectura, interpolación, procedencia |
| 9. Deshacer | una sola operación revierte el lote completo |

Los tres frames de la fila 6 están comprobados en
`scripts/animation/test-animation-contract.mjs`; no son un ejemplo escrito a
mano en la documentación.

La expansión de la fila 4 es la del trazado, no la tabla definitiva: el catálogo
versionado de los seis presets pertenece a la Fase 5.

## 9. Fixtures y verificación

```text
pilots/animacion-v1/fixtures/
  valid/    entrada-personaje · gesto-en-palabra · prop-manual · pista-personalizada
  invalid/  trece casos, uno por código de autoría comprobable por fixture
```

```bash
npm run anim:test-contract
```

Cubre 28 comprobaciones: los cuatro documentos válidos, los trece inválidos con
su código exacto, los límites de escena y de pistas construidos en memoria, las
cuatro variantes de «requiere revisión», el trazado completo de la sección 8, la
regla de cuantización y la integridad del catálogo de errores.

Registrada en `scripts/test-core.mjs`; `npm test` pasa de 30 a 31 suites.

## 10. Qué queda abierto para la Fase 1

- El adaptador de lectura v2 → v3 y el manifest con parámetros y bindings: hasta
  que exista, `armRaise` es vocabulario sin recurso que lo declare.
- El renombre de `animationPreset` a `baseMotionId`, atado a la Fase 4.
- La expansión concreta de los seis presets, atada a la Fase 5.
- Los tres códigos de compilación, atados a la Fase 2.

Ninguno bloquea el gate de la Fase 0: los cuatro son trabajo de fases
posteriores que ya tienen vocabulario, límites y errores definidos.
