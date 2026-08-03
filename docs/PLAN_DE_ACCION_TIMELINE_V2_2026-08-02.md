# Plan de acción — Timeline y montaje V2 — 2 de agosto de 2026

Origen: auditoría completa del sistema de timeline (núcleo, servidor, dos motores de UI) pedida el 2 de agosto de 2026.

## 1. Por qué este plan

`docs/FASES_2_9_MONTAJE_PROFESIONAL_V2.md` declara el montaje V2 **«implementado y verificado»** y su gate pasa en verde. Lo verifiqué: `timeline:test-clip-core`, `timeline:test-media`, `timeline:test-stress`, `ui:test-modules` (319 casos), `ui:check-ids` y `tsc --noEmit` pasan sin fallos.

El problema no es el gate: es **dónde mira**. Todo lo que el gate cubre es puro y determinista (el núcleo, el ingest, el exportador, los módulos de geometría). Las 3358 líneas de capa DOM —`src/ui/timeline.ts` y `src/ui/timeline-v2.ts`— no tienen ninguna prueba de comportamiento; de ellas `ui:test-modules` solo lee el texto fuente (`scripts/ui/test-ui-modules.mjs:207`). Los defectos de este plan viven todos ahí, y tres de ellos rompen funciones que las Fases 6 y 7 dan por cerradas (selección múltiple, duplicado, arrastre).

Este plan no propone capacidades nuevas. Cierra la distancia entre lo declarado y lo que hace el código.

## 2. Qué existe hoy (mapa, para no redescubrir)

| Capa | Archivo | Líneas | Estado |
|---|---|---|---|
| Núcleo de clips | `shared/timeline-clip-core.js` | 693 | Sólido. Ticks enteros 48 kHz, validación cerrada, 13 comandos, lotes atómicos, export canónico, automatización en tiempo de fuente. |
| Contrato TS | `shared/timeline-clip-core.d.ts` | 103 | Al día con el núcleo. |
| Ingest | `scripts/timeline/media-library.mjs` | 176 | Dedupe por content-hash, FFprobe, límite 2 GB, rutas contenidas. |
| Persistencia | `scripts/timeline/timeline-project-repository.mjs` | 71 | Escritura atómica + concurrencia optimista por revisión SHA-256. |
| Exportación | `scripts/timeline/timeline-exporter.mjs` | 165 | Caché de segmentos por hash; `adelay=<ticks>S` aprovecha que 1 tick = 1 muestra. |
| Rutas HTTP | `scripts/local-app/server.mjs:356-436` | — | 8 endpoints. `GET /api/timeline/projects/:id` existe y **nadie lo llama**. |
| UI autoría | `src/ui/timeline.ts` | 2583 | Sin pruebas de comportamiento. |
| UI montaje V2 | `src/ui/timeline-v2.ts` | 775 | Sin pruebas de comportamiento. |
| Puros de UI | `timeline-geometry.ts`, `timeline-animation.ts`, `timeline-frames.ts`, `timeline-waveform.ts` | 972 | Geometría y animación cubiertas por `ui:test-modules`; frames y onda son capa DOM. |

**El hecho estructural que explica la mitad de los hallazgos:** los dos motores de UI comparten el mismo DOM. Quince botones `#timeline-*`, el contenedor `#timeline-layer-stack` y el panel `#editing-tool-host` los escriben los dos. El único árbitro son cuatro guardias `if (document.body.classList.contains('timeline-v2-active')) return` en `timeline.ts` (líneas 145, 164, 2221, 2308) y un listener en fase de captura con `stopImmediatePropagation` en `timeline-v2.ts:130`. Donde falta una guardia, hay un defecto.

## 3. Datos medidos

Todo lo de abajo se midió en este repo, no se estimó.

**Costo de `timelineDurationTicks` (revalida el documento entero: fuentes, pistas, clips, automatización y colisiones con ordenamiento):**

| clips | ms por llamada |
|---|---|
| 50 | 0,12 |
| 200 | 0,30 |
| 800 | 0,76 |
| 2000 | 1,81 |

Se invoca una vez por frame de reproducción desde `renderPlayheadOnly` (`timeline-v2.ts:645`) y dos veces más en cada `render()` (líneas 203 y 216).

**Colisión reproducible al duplicar** (ejecutado contra el núcleo real, replicando `duplicateSelection` + `findAvailableStart`):

```
pista V1: clip-a[0,10)  clip-b[50,60)  clip-c[110,130)
selección: clip-a + clip-b (ctrl+clic)
start elegido por findAvailableStart: 60
destinos calculados: clip-a-copy[60,70)   clip-b-copy[110,120)
→ TIMELINE_COLLISION — Los clips clip-b-copy-1 y clip-c se solapan
```

**Gate actual:** `npm test` encadena 44 comandos; 3 son de timeline V2 y ninguno instancia DOM.

## 4. Reglas duras de este plan

- Una sola rama: `main`. Sin ramas, worktrees ni ramas de integración. Commitear apenas cierra cada bloque.
- Carriles: `src/ui/`, `src/style.css` e `index.html` son carril UI. `shared/`, `schema/` y `scripts/` son carril motor y van marcados **[motor]**; no se tocan sin coordinar.
- No se crea un segundo modelo de datos ni se duplica lógica del núcleo. Las correcciones usan los comandos que ya existen.
- No se inventan tiempos: toda duración sigue naciendo de FFprobe/Piper o del documento V2.
- Ninguna tarea agrega dependencias.
- Prioridad de `AGENTS.md` §2: correctitud > no romper lo existente > determinismo > sincronía preview/export > simplicidad.

## 5. Tareas

### Bloque A — Correctitud (alto)

#### A1 · Duplicar con selección múltiple lanza excepción y no se ve nada · carril UI

- **Síntoma:** el usuario selecciona dos clips con ctrl+clic, aprieta Duplicar y no pasa absolutamente nada. Ni copia ni mensaje.
- **Causa:** `findAvailableStart` (`timeline-v2.ts:729`) solo busca hueco para `max(duración)`, pero `duplicateSelection` (`timeline-v2.ts:363`) pega conservando los offsets relativos, que se extienden mucho más allá de esa ventana. Cuando el segundo clip cae sobre uno existente, el núcleo rechaza el lote entero con `TIMELINE_COLLISION`.
- **Evidencia:** repro de la sección 3.
- **Arreglo:** que la búsqueda de hueco use el span completo del grupo (`max(offset + duración)` sobre los clips seleccionados, por cada pista involucrada), no solo la duración máxima.
- **Verificación:** el caso `a+b` con `c` en `[110,130)` duplica a `[130,140)` y `[180,190)` sin excepción.

#### A2 · Duplicar y borrar se tragan cualquier error · carril UI

- **Síntoma:** cualquier fallo del núcleo en esas dos acciones muere en la consola; la barra de estado queda como estaba.
- **Causa:** `duplicateSelection` (`timeline-v2.ts:363`) y `deleteSelection` (`timeline-v2.ts:384`) llaman a `dispatchBatch` sin `try/catch`, a diferencia de `cutClip` (`timeline-v2.ts:341`) y del arrastre (`timeline-v2.ts:313`), que sí capturan y llaman a `setStatus`.
- **Arreglo:** mismo patrón que `cutClip` — capturar, `setStatus(messageOf(error), true)` y `render()`. Conviene centralizarlo en `dispatch`/`dispatchBatch` para que ningún comando futuro nazca mudo.
- **Verificación:** forzar una colisión y comprobar que aparece el mensaje del catálogo de errores en `#timeline-v2-status`.
- **Nota:** A1 y A2 son independientes. A2 debe entrar aunque A1 se posponga: convierte un fallo invisible en uno explicado.

#### A3 · Un fallo de `localStorage` desincroniza estado y pantalla · carril UI

- **Síntoma:** con un montaje grande, una edición se aplica al documento pero la pantalla no se actualiza. El siguiente clic parte de un estado que el usuario no ve.
- **Causa:** `changed()` (`timeline-v2.ts:415`) hace `localStorage.setItem` sin `try/catch`, y `dispatch()` asigna `state` **antes** de llamarlo. Un `QuotaExceededError` aborta antes de `render()`. Un documento cercano al límite del contrato (2048 clips) ronda los 400 KB serializados, contra ~5 MB de cuota compartida con el resto de la app.
- **Arreglo:** envolver el `setItem`, degradar a solo-servidor con aviso en `#timeline-v2-status`, y garantizar que `render()` corra siempre (`finally`).
- **Verificación:** simular la excepción y comprobar que la timeline se repinta y avisa.

#### A4 · La concurrencia optimista del servidor está anulada desde el cliente · carril UI

- **Síntoma:** dos pestañas sobre el mismo montaje se pisan en silencio. El montaje no sobrevive a cambiar de navegador.
- **Causa:** dos huecos que se refuerzan.
  1. `timeline-v2.ts:419` hace `revision = null` cuando falla un guardado, y `saveTimelineProject` manda `expectedRevision: revision || undefined` (`timeline-v2-api.ts:61`). El servidor solo chequea conflicto si el valor llega (`timeline-project-repository.mjs:33`): desde el primer fallo, cada PUT pisa lo que haya.
  2. `restoreLocal` (`timeline-v2.ts:101`) solo lee `localStorage`. `GET /api/timeline/projects/:id` está implementado (`server.mjs:407`) y no lo llama nadie. El servidor es de escritura únicamente.
- **Arreglo:** al arrancar, pedir el montaje al servidor y adoptar su revisión; conservar la última revisión conocida ante un fallo de red en vez de descartarla; ante `TIMELINE_PROJECT_REVISION_CONFLICT` ofrecer una decisión explícita en vez de sobrescribir.
- **Decisión que necesito del usuario:** ante conflicto, ¿gana el servidor, gana la pestaña, o se le pregunta? Sin esa respuesta implemento «se le pregunta», que es lo único que no pierde trabajo.

#### A5 · `Alt` secuestra el botón de tijera en modo montaje · carril UI

- **Síntoma:** apretar `Alt` en modo Montaje enciende visualmente la tijera, pero cortar sigue apagado. El botón miente hasta el siguiente repintado de V2.
- **Causa:** `timeline.ts:102-104` escucha `Alt` **sin la guardia** `timeline-v2-active` que sí tienen `render`, `updateTimelineTime`, `handleShortcut` y `updateToolbar`. `setCutMode` pinta `#timeline-cut` y agrega `is-cut-mode` al `<body>`, ambos propiedad de V2 en ese momento.
- **Arreglo:** aplicar la misma guardia a los tres listeners de `Alt` (keydown, keyup, blur).
- **Verificación:** en Montaje, `Alt` no cambia `aria-pressed` de `#timeline-cut`.

#### A6 · Dos módulos se disputan `#editing-tool-host` · carril UI

- **Síntoma:** la ficha del clip V2 desaparece sola; y al deseleccionar queda una ficha vieja de un clip que ya no está seleccionado.
- **Causa:** `editing-panel.ts` reescribe ese nodo con `replaceChildren` en cuatro suscripciones sin guardia de V2 (`store.subscribe`, `PROJECT_SELECTION_EVENT`, `EDITOR_PLAYBACK_EVENT`, `EDITOR_WORKSPACE_EVENT`; líneas 1039-1045), y `renderInspector` (`timeline-v2.ts:680`) escribe el mismo nodo. En Montaje se dispara sobre todo al completar una medición automática (`setProjectMeasurement` → `notify()`) y al cambiar de modo. Además `renderInspector` hace `if (!host || !clip) return` (`timeline-v2.ts:682`): nunca limpia.
- **Arreglo:** dar a V2 su propio contenedor dentro del panel derecho, o —más barato— que `editing-panel` respete la guardia `timeline-v2-active` y que `renderInspector` limpie con un estado vacío explícito cuando no hay selección.
- **Verificación:** seleccionar un clip, dejar correr una medición automática, y comprobar que la ficha sigue ahí; deseleccionar y comprobar que se va.

### Bloque B — Rendimiento y coherencia (medio)

#### B1 · Un elemento multimedia por clip, con `preload="auto"` · carril UI

- **Causa:** `rebuildPreview` (`timeline-v2.ts:531`) crea un `<video>` o `<audio>` por cada clip habilitado, apuntando a `/api/timeline/media/<id>/content`. Veinte cortes del mismo MP4 son veinte descargas completas del mismo archivo, veinte decodificadores y veinte buffers.
- **Arreglo:** un elemento por **fuente** (no por clip), reposicionado por `currentTime` según el clip activo. La Fase 7 ya declara un solo reloj `performance.now()`; esto es el equivalente del lado de los medios.
- **Medición previa obligatoria:** contar elementos y bytes de red con un montaje de 20 clips sobre una fuente antes y después.

#### B2 · Validación completa del documento en cada frame · carril UI (variante motor opcional)

- **Causa:** `renderPlayheadOnly` (`timeline-v2.ts:645`) llama a `timelineDurationTicks`, que internamente ejecuta `validateTimelineDocument` (`timeline-clip-core.js:199`). A eso se suma que `syncPreview` (`timeline-v2.ts:561`) hace un `clips.find()` dentro del bucle sobre los elementos de preview, o sea O(n²) por frame.
- **Evidencia:** tabla de la sección 3. A 2000 clips son 1,81 ms de un presupuesto de 16,6 ms solo para recalcular un número que únicamente cambia al editar.
- **Arreglo (UI, suficiente):** cachear la duración en `changed()`/`render()` y que el bucle de reproducción lea la caché; indexar los clips por id en un `Map` que se reconstruya en `render()`.
- **Arreglo alternativo [motor]:** exponer en el núcleo una duración sin revalidación para consumidores que ya validaron. Solo si el motor lo quiere; el arreglo de UI no lo necesita.

#### B3 · No se puede mover un clip entre pistas · carril UI

- **Causa:** `moveClip` (`timeline-v2.ts:326`) siempre manda `trackId: clip.trackId`; el arrastre vertical se descarta en `startClipDrag` (`timeline-v2.ts:293`), que solo lee `clientX`.
- **Contexto:** no es una capacidad nueva. `docs/FASE_0_RECORTE_PROFESIONAL_V2.md` §2.5 define `move-clip` como «cambia **pista** y posición», el núcleo lo implementa y la Fase 6 declara «arrastre» cerrado. Es la UI la que no lo expone.
- **Arreglo:** resolver la pista destino por la posición vertical del puntero, validando compatibilidad de tipo (`visual`↔`visual`, `audio`↔`audio`) antes de despachar. Para grupos enlazados, `move-linked` solo desplaza en el tiempo: o se mantiene la pista, o hace falta un lote de `move-clip`.

#### B4 · La exportación incluye la duración de los clips deshabilitados · carril **[motor]**

- **Síntoma:** deshabilitar el último clip deja una cola negra en el MP4. Deshabilitarlos todos exporta un video negro con silencio, sin error.
- **Causa:** `timeline-exporter.mjs:12` filtra los segmentos por `clip.enabled`, pero `timeline-exporter.mjs:33` calcula la duración con `timelineDurationTicks(project)`, que no filtra. El chequeo `durationTicks < 1` nunca dispara.
- **Arreglo:** calcular la duración del plan sobre los clips ya filtrados y rechazar con `TIMELINE_EXPORT_EMPTY` cuando no quede ninguno habilitado.
- **Verificación:** extender `timeline:test-media` con un caso de clip deshabilitado al final.

### Bloque C — Pulido (bajo, agrupables en un commit)

| ID | Hallazgo | Ubicación | Carril |
|---|---|---|---|
| C1 | Montaje V2 arranca **activo por defecto** (`localStorage.getItem(MODE_KEY) !== 'false'`); un usuario nuevo entra a un montaje vacío y no ve la timeline de autoría | `timeline-v2.ts:67` | UI · **necesita decisión del usuario** |
| C2 | El diálogo de atajos documenta solo los de autoría; en Montaje `J/K/L`, `Ctrl+B`, `Alt` y `←/→` no hacen nada | `index.html:633` | UI |
| C3 | La insignia de anclas rotas solo se dibuja en personajes; los props, que también son animables, no avisan | `timeline.ts:309` | UI |
| C4 | La guardia `element.type !== 'character'` está muerta en los tres bucles: siempre falsa en el de personajes, siempre verdadera en los otros dos | `timeline.ts:320`, `:357`, `:391` | UI |
| C5 | `elementClipRect` se llama dos veces por clip (una para `left`, otra para `width`), recalculando `findIndex` + `resolveWindowSeconds` cada vez | `timeline.ts:302`, `:346`, `:380` | UI |
| C6 | `followPlayhead` suma `78` px a mano donde la CSS define `--timeline-label-width: 5rem` (80 px) | `timeline.ts:2528` · `style.css:2226` | UI |
| C7 | El anti-rebote de 250 ms se traga clics rápidos legítimos (zoom, saltos de corte) | `timeline-v2.ts:169` | UI |

C4 y C5 son síntomas de lo mismo: tres bloques de ~30 líneas casi idénticos en `renderLayerStack` (personajes 295-337, props 339-370, plantillas 373-403) que divergieron al copiarse. Unificarlos resuelve C3, C4 y C5 juntos. **Nota verificada:** que el bucle de plantillas no dibuje keyframes **es correcto** —ningún parámetro de `shared/animation-contract.js` incluye `template` en `elementTypes`—; no tocar eso.

### Bloque D — Que no vuelva a pasar

#### D1 · Extraer y probar la lógica pura del montaje · carril UI

- **Problema de fondo:** A1 es un error de aritmética de intervalos, exactamente la clase de bug que una prueba pura atrapa en un segundo. Sobrevivió a un gate de nueve fases porque vive dentro de un archivo con DOM.
- **Arreglo:** mover a un módulo sin DOM (`src/ui/timeline-v2-geometry.ts`) las funciones que ya son puras o casi: planificación de pegado (`findAvailableStart` + los offsets de `duplicateSelection`), `snapTick`, `ticksFromPixels`, `pointerTick`, `nextId` y `formatTime`. Registrarlo en la lista de `scripts/ui/test-ui-modules.mjs:16-34`, que ya compila TS a temp y lo importa en Node —el mismo camino que siguen `timeline-geometry.ts` y `timeline-animation.ts`.
- **Casos mínimos:** pegado con selección múltiple y offsets desiguales; pegado con un tercer clip en medio (el repro de A1); snap con y sin grupo enlazado excluido; alineación a frame en clips visuales; `nextId` ante colisión.
- **Efecto:** `npm test` pasa a proteger el invariante que A1 rompe, sin montar un DOM.

#### D2 · Corregir el estado declarado de la documentación · carril UI (docs)

`docs/FASES_2_9_MONTAJE_PROFESIONAL_V2.md` dice «implementado y verificado». Con A1 y B3 abiertos, las Fases 6 y 7 no están cerradas. Al terminar el bloque A, actualizar ese documento con lo que efectivamente quedó cubierto y con el límite honesto de la verificación (el gate no ejerce la capa DOM).

## 6. Orden de ejecución

1. **A2** — un commit corto que convierte todo fallo mudo en un mensaje. Habilita diagnosticar el resto.
2. **A1** + **D1** juntos — el arreglo y la prueba que lo fija, en el mismo commit.
3. **A3**, **A5**, **A6** — tres correcciones de robustez y propiedad del DOM, independientes entre sí.
4. **A4** — después de la decisión del usuario sobre conflictos.
5. **B2**, **B1** — rendimiento, en ese orden: B2 es más barato y se mide igual de fácil.
6. **B3** — el que más cambia la sensación de «editor profesional».
7. **B4** [motor] — coordinado con Codex, junto con su caso de prueba.
8. **Bloque C** — un solo commit, con C3/C4/C5 resueltos por la unificación de los tres bucles.
9. **D2** — al cerrar el bloque A.

Push: una sola vez, con todos los commits juntos, al terminar el plan.

## 7. Gate de verificación

Sin cambios respecto del gate vigente, más el módulo nuevo de D1:

```powershell
npm run timeline:test-clip-core
npm run timeline:test-media
npm run timeline:test-stress
npm run ui:test-modules
npm run local:test-server
npm run build
npm test
```

Verificación manual mínima por bloque (la capa DOM no la cubre ningún script):

- **A:** duplicar dos clips separados con un tercero en medio; forzar un error y ver el mensaje; `Alt` en Montaje; seleccionar un clip y esperar una medición automática.
- **B:** contar elementos multimedia y bytes de red con 20 clips de una fuente; reproducir un montaje de 200+ clips y mirar el perfil de frames; arrastrar un clip de V1 a V2.
- **C:** revisar la barra y el diálogo de atajos en ambos modos.

## 8. Qué NO hacer

- No migrar los montajes V2 existentes ni cambiar el formato del documento: los hallazgos son todos de capa UI y uno de exportación.
- No tocar el timebase, los límites ni el catálogo de errores del núcleo.
- No fusionar los dos motores de timeline en este plan. La separación por clase en el `<body>` es frágil, pero rediseñarla es un plan aparte con su propio gate; acá solo se tapan las fugas concretas (A5, A6).
- No agregar dependencias, ni un segundo modelo de datos, ni lógica del motor duplicada en la UI.
- No calcular duraciones desde texto en ningún caso.

## 9. Traza

- Auditoría y mediciones: 2 de agosto de 2026, sobre `main` en `1e849fe`.
- Verde comprobado antes de proponer cambios: `timeline:test-clip-core`, `timeline:test-media`, `timeline:test-stress`, `ui:test-modules` (319), `ui:check-ids` (271 ok / 11 avisos preexistentes ajenos a timeline), `tsc --noEmit`.
- Benchmark de `timelineDurationTicks` y repro de `TIMELINE_COLLISION`: scripts efímeros contra `shared/timeline-clip-core.js` sin modificarlo; los números de la sección 3 son de esta máquina.
- Decisiones pendientes del usuario: política de conflicto de A4 y modo por defecto de C1.
