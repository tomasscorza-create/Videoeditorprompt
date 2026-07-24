# Auditoría de la interfaz vs. el motor + propuesta de reorganización

Fecha: 23 de julio de 2026 · Carril: UX/UI · **Solo auditoría y propuesta: no se tocó
código.** El trabajo en curso de Codex (Etapa 4A, sin commitear) quedó intacto.

Alcance: `index.html`, `src/main.ts`, `src/ui/**`, `src/preview/**` contra lo que el motor
realmente expone (`shared/project-editor.js`, `schema/*.json`, `scripts/director/`,
`scripts/local-app/`, `scripts/stage3a/`).

---

# Parte A — Mapa de cableado

## A.1 La interfaz son hoy dos aplicaciones superpuestas

```
MUNDO A — “trabajo publicado” (lectura)        MUNDO B — “proyecto de autoría” (edición)
main.ts                                        ui/index.ts → project/store.ts
  /generated/index.json                          /projects/index.json
  scene.config.json + scene-runtime.json         project.json + authoring-resources.json
  ▼                                              ▼
  preview PixiJS (1 escena, ya renderizada)      shared/project-editor.js (estado inmutable)
  ▼                                              ▼
  visor central · timeline · atajos · galería    inspector derecho · Director IA
```

**No hay un solo punto de contacto entre las dos columnas.** El visor central reproduce el
job `X` publicado por la CLI; el inspector edita el proyecto `Y`; el Director genera el
proyecto `Z`. Ninguno se entera de los otros. Esta es la causa raíz de casi todo lo que
sigue.

## A.2 Controles conectados de verdad

| Control (id) | Módulo | Llega al motor como | Estado |
| --- | --- | --- | --- |
| `#director-prompt` + `#director-generate` | `director/panel.ts:33` | `POST /api/director/proposals` → `createDirectorProposal` | ✅ |
| `#director-render` | `panel.ts:63` | `POST /api/render-jobs` → `project-pipeline.mjs` | ✅ |
| `#director-cancel` | `panel.ts:85` | `POST …?action=cancel` | ✅ (mata solo el Node hijo) |
| `#project-title` | `project/panel.ts:37` | `set-project-title` | ✅ |
| Título de escena | `panel.ts:143` | `set-scene-title` | ✅ |
| Fondo + cámara | `panel.ts:155` | `set-scene-background` (presets leídos de `capabilities`) | ✅ |
| Transición + duración | `panel.ts:176` | `set-transition` | ✅ |
| Personaje por elemento | `panel.ts:228` | `set-character-resource` | ✅ |
| X / Y / Escala / zIndex | `panel.ts:254` | `set-character-transform` | ✅ (sin feedback visual) |
| Texto / Voz / Gesto / Pausa por turno | `panel.ts:278` | `set-dialogue-turn` | ✅ |
| Mover escena ◀ ▶ | `panel.ts:65` | `reorder-scenes` | ⚠️ reasigna transiciones por posición |
| Deshacer / Rehacer (4 botones) | `panel.ts:42` | `undo/redoProjectEditor` | ✅ |
| Validar / Exportar JSON | `panel.ts:49` | `validateEditableProject` / `exportEditorProject` | ✅ |
| Play/Pause/Reiniciar/Seek/Velocidad/Loop | `playback.ts` | evaluador compartido vía `handle.render()` | ✅ |
| Selector de job + galería | `main.ts:73`, `gallery.ts` | `/generated/index.json` | ✅ (recarga la página) |
| Tema visual | `theme.ts` | `localStorage` | ✅ |

**Balance:** el cableado que existe es honesto y correcto. El problema no es lo que está
mal conectado, sino **lo que no está conectado a nada** y **lo que el motor ofrece y la
interfaz no muestra**.

---

# Parte B — Hallazgos

Severidad: **A** = rompe el flujo principal · **M** = confunde o limita · **B** = pulido.

## B.1 Desconexiones (piezas que faltan cablear)

### B1.1 [A] El visor no muestra nunca lo que estás editando

`src/main.ts:37-50` monta el preview desde `scene-runtime.json` de un job ya renderizado.
El proyecto editable no tiene runtime hasta pasar por Piper y FFprobe. Consecuencia
concreta: cambiás la X de un personaje, cambiás el fondo, reescribís un diálogo — **el
visor central no se inmuta**. El editor es un formulario JSON con vista previa de otra
cosa. Es el hueco más grande entre interfaz y motor.

Qué falta: un modo de preview que compile el proyecto editable en el navegador (assets del
catálogo + transform + fondo) mostrando pose estática y encuadre, con la advertencia de
que la duración y la boca llegan del render. El evaluador temporal seguiría siendo del
motor; sería un “preview de composición”, no de tiempo.

### B1.2 [A] Seleccionar una escena no mueve nada

`select-scene` (`project/panel.ts:101`) solo repinta el inspector. No mueve el playhead, no
cambia el clip de la timeline, no altera el visor. La tira de escenas y la barra de tiempo
inferior son dos representaciones del mismo proyecto que se ignoran.

### B1.3 [A] El video que hace la app no queda en ningún lado

El render lanzado desde el Director corre `project-pipeline.mjs` **sin `--publish-dir`**
(`render-job-manager.mjs:64-71`), así que no se publica en `public/generated/`. Resultado:

- no aparece en “Trabajos renderizados” (esa galería lee `/generated/index.json`);
- solo se puede ver por `/api/render-jobs/:id/video` mientras la pestaña siga viva;
- **al recargar la página se pierde el acceso al video** y también el proyecto que lo
  generó, porque la propuesta vive solo en memoria del navegador (`store.replaceProject`,
  sin persistencia ni `localStorage`).

El único rescate es acordarse de pulsar *Exportar JSON* y *Descargar video final* antes de
recargar.

### B1.4 [A] El Director no arranca si no hay proyecto publicado

`src/ui/index.ts:30-45` — `initDirectorUi(store)` solo se llama después de que
`loadProjectStore()` tenga éxito. Sin `public/projects/index.json`, el `catch` pinta el
error y **el panel Director nunca se inicializa** (queda `hidden`). El flujo prompt→video,
que no necesita ningún proyecto previo, está bloqueado justo en la primera ejecución.

### B1.5 [M] Terminado el render, nada se refresca

`panel.ts:139-163` pinta un mensaje y el `<video>`. No recarga la galería, ni el índice de
proyectos, ni ofrece “abrir en el visor”.

### B1.6 [M] Datos del motor que llegan a la UI y se tiran

- `health.renderBusy` (`server.mjs:48`): la UI lo ignora; podría avisar “hay un render en
  curso” en vez de dejar el botón activo.
- `health` se consulta **una sola vez** al cargar (`panel.ts:31`). Si levantás Ollama
  después, hay que recargar la página.
- `job.progress` trae `sceneId`, `sceneIndex` y `stage` por escena; la UI los aplasta en
  una línea de texto en vez de una barra “escena 2 de 3 · generando voces”.
- `job.error.technicalDetail` / `.cause` / `.code`: nunca se muestran (`panel.ts:195`
  solo usa `message` + `suggestedAction`).
- `budget.maximumWords`: se muestra el total de palabras pero no el presupuesto, que es lo
  que explica un rechazo por duración.

## B.2 Promesas que la interfaz hace y el motor no puede cumplir

### B2.1 [A] Barra de herramientas: 5 de 7 botones son decorado

`index.html:154-180` + `toolbar.ts` — Seleccionar, Cortar/Dividir, Añadir Texto, Añadir
Audio y Eliminar están deshabilitados con el título “— prototipo, sin conectar”. El módulo
es honesto, pero ocupan el lugar más visible de la barra inferior. Peor: **el motor rechaza
explícitamente** texto e imágenes (`project-editor.js:130`), así que “Añadir Texto” no es
un pendiente de UI sino una función que no existe en el contrato.

### B2.2 [A] La timeline es una maqueta

`index.html:188-202` + `timeline.ts` — pistas fijas V1/A1, clips con clase `clip-dummy`, no
se pueden arrastrar, cortar, seleccionar ni redimensionar. Los datos que sí son reales
(duración medida, turnos con `startSeconds`/`endSeconds` de FFprobe) pertenecen **al job
publicado**, no al proyecto que estás editando. Una barra de tiempo tipo NLE sobre un motor
que no tiene edición temporal libre promete algo que no se puede entregar hoy.

### B2.3 [M] Atajos anunciados que no existen

Los tooltips dicen “Deshacer (Ctrl+Z)” y “Rehacer (Ctrl+Y)” (`index.html:144-149`), pero
`shortcuts.ts` solo implementa Espacio, L, M, ← y →. **Ctrl+Z no hace nada.**

### B2.4 [M] Dos controles para cada cosa

- Reproducción: `#play`/`#pause`/`#restart` en el panel izquierdo **y**
  `#viewer-play-btn` en la barra del visor.
- Elegir job: `<select id="job-select">` **y** la galería de tarjetas.
- Deshacer/rehacer: `#project-undo`/`#project-redo` **y** `#tool-undo`/`#tool-redo`.
- Descargar: `#download` (MP4 del job) **y** `#director-result-download` (MP4 del render).

Cuatro duplicaciones que obligan a aprender dos caminos para la misma acción.

### B2.5 [B] Título de la pestaña desfasado

`index.html:6`: “Etapa 1 · Escena animada”. La app ya es un editor con Director IA.

## B.3 Capacidades del motor que la interfaz no expone

Todo esto **ya existe en los contratos** y no tiene ningún control en pantalla:

| Capacidad | Dónde vive | Estado en la UI |
| --- | --- | --- |
| Miniaturas de personaje (`pose_neutral.png` por variante) | `assets/catalog/index.json` → `thumbnail` | No se usan: solo `<select>` de texto |
| `tags` de cada recurso (`geometrico`, `presentador`, `estudio`, `parallax`, `vertical`) | `authoring-resources.json` | Sin filtros ni búsqueda |
| `provenance` + `license` por recurso | `authoring-resources.json` | Invisible, pese a ser requisito de AGENTS §8 |
| `animationPresets` (`idle-calm`, `talk-calm`) | `capabilities` del personaje | Validado por el motor, **sin control en la UI** |
| `tone` del plan (5 valores) | `ai-video-plan.schema.json:12` | No editable: lo elige el modelo |
| `targetDurationSeconds` (8–90) | `ai-video-plan.schema.json:15` | **No editable** — es justo el control “rígido” que pediste |
| `layoutPreset` (`balanced`, `focus-a`, `focus-b`) | `director-plan.mjs:12-25` | No editable |
| `variant` (regenerar distinto) | `api.ts:59`, `server.mjs:56` | Se manda un contador invisible; no hay “otra variante” |
| Temperatura / modelo del Director | `ollama-director.mjs:24` | Sin configuración |
| `deterministic`, `verificationPassed` por job | `/generated/index.json` | Solo un “✓” en la miniatura |
| Duración de cada turno medida por FFprobe | `dialoguePath` del runtime | Se ve en la timeline del job, no en el editor |

Nota importante para el plan: **`tone`, `targetDurationSeconds` y `layoutPreset` existen en
el schema del plan pero no se pueden inyectar desde fuera** — `createDirectorProposal` solo
acepta `prompt`, `variant`, `model`, `temperature` y hoy el modelo decide la duración. Para
que el control “Duración objetivo” de la UI sea real hace falta un parámetro nuevo en el
motor (pasar restricciones al prompt/schema). Es trabajo del carril de Codex, no de UX; en
la propuesta va marcado como tal.

## B.4 Deuda de UX en el estado actual

### B4.1 [A] Todo el trabajo real vive en una sola columna con scroll infinito

`aside.sidebar-right` apila: Director IA (prompt + 3 botones + estado + propuesta + video +
descarga) → galería de trabajos → editor de proyecto (título + 4 botones + estado + tira de
escenas + inspector con 5 grupos + **N turnos × 4 campos cada uno**). Con 3 escenas de 4
turnos, el inspector solo ya son ~50 controles apilados verticalmente. Nada colapsa, nada
se agrupa en pestañas, no hay más jerarquía que el orden del DOM.

Mientras tanto **la columna izquierda contiene un panel de diagnóstico** (selector de job,
3 botones de reproducción y un `<details>` con boca/ojos/gesto). El espacio está repartido
al revés de la importancia de cada cosa.

### B4.2 [M] Telemetría de desarrollo presentada como interfaz de producto

`index.html:33-45` — “Boca: closed”, “Ojos: open”, “Gesto: neutral”, “Renderer”. Es
instrumentación de las Etapas 1–2, valiosa para depurar, invisible de significado para
alguien que quiere hacer un video.

### B4.3 [M] Cada cambio repinta el inspector completo

`project/panel.ts:326-338` — `render()` reconstruye tira e inspector en cada `notify()`.
Con `change` (no `input`) el foco se pierde al terminar de editar cada campo, y el scroll
del panel salta. En una lista larga de turnos es incómodo de forma acumulativa.

### B4.4 [M] La galería reordena el DOM para simular scroll

`gallery.ts:76-102` — las flechas mueven el primer/último hijo al otro extremo. El orden
visible deja de ser el orden real, `aria-selected` no se actualiza y no hay indicación de
cuántos trabajos hay ni en qué punto estás.

### B4.5 [M] Cambiar de job recarga la página entera

`main.ts:82-86` y `gallery.ts:65-70` (`window.location.assign`). Ya estaba anotado como
deuda diferida en `docs/UX_DEUDA_TECNICA_Y_PLAN.md`; con el Director en pantalla ahora
cuesta más caro: **la recarga borra la propuesta y las ediciones no exportadas** (B1.3).

### B4.6 [M] “duración pendiente” en todas las escenas, siempre

`project/panel.ts:97-99`. Coherente con el invariante (la duración la mide FFprobe), pero
deja al usuario sin ninguna noción de longitud hasta terminar un render de minutos. El dato
para una estimación *rotulada como aproximada* ya se calcula: `budget.totalWords` y la
regla de 3,2 palabras/segundo de `director-plan.mjs:72`.

### B4.7 [B] Accesibilidad incompleta

- `role="option"` en las tarjetas (`gallery.ts:24`) sin un contenedor `role="listbox"`.
- `aria-pressed` en la tira de escenas ✅, pero los grupos del inspector no son navegables
  por regiones ni colapsables por teclado.
- El `<dialog>` de configuración no devuelve el foco al botón que lo abrió.
- Contenido nuevo en `#director-status` es `aria-live="polite"` ✅; los errores del
  inspector comparten la misma región y pueden pisarse.

### B4.8 [B] La configuración solo tiene tema visual

`index.html:206-223`. No hay dónde ver ni ajustar: raíz de Piper, modelo de Ollama, estado
del servicio, carpeta de trabajos, espacio en disco — todo dato que la API `/api/health` ya
devuelve o podría devolver.

---

# Parte C — Propuesta de reorganización

Misma arquitectura de datos, mismo motor, cero comandos nuevos: **solo redistribución,
agrupación y jerarquía**. Sigue el reparto que pediste.

## C.1 Wireframe

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◆ Editor de video local     [proyecto: Dos miradas sobre la IA ▾]   ⏻ listo  ⚙   │  56 px
├────────────────┬───────────────────────────────────────────────┬─────────────────┤
│ IA · DIRECTOR  │                                               │  RECURSOS       │
│                │                                               │ ┌────┬────┬────┐│
│ ┌────────────┐ │            ┌───────────────────┐              │ │Pers│Fond│Voc ││
│ │ Idea       │ │            │                   │              │ └────┴────┴────┘│
│ │ [        ] │ │            │                   │              │ ┌────┐ ┌────┐   │
│ │ [        ] │ │            │      VISOR        │              │ │ 🐵 │ │ 🐵 │   │
│ └────────────┘ │            │    1080 × 1920    │              │ │azul│ │cir.│   │
│                │            │                   │              │ └────┘ └────┘   │
│ Tono   [▾]     │            │                   │              │ 🔍 buscar/tags  │
│ Duración ○──○  │            │                   │              ├─────────────────┤
│ Encuadre [▾]   │            │                   │              │  INSPECTOR      │
│                │            └───────────────────┘              │ ▸ Escena        │
│ ⚡ Crear         │      ▶  0:04 ────●─────── 0:21  1x ⟳         │ ▾ Personajes    │
│ ⟳ Otra variante │                                               │   A [🐵][x][y]  │
│                │                                               │   B [🐵][x][y]  │
│ ─── RENDER ─── │                                               │ ▸ Diálogo (4)   │
│ ▶ Renderizar    │                                               │ ▸ Fondo/cámara  │
│ ▮▮▮▮▯▯ esc 2/3 │                                               │ ▸ Transición    │
│ ⛔ Cancelar     │                                               │                 │
│ ⬇ Descargar     │                                               │ ↶ ↷  ✓ Validar  │
├────────────────┴───────────────────────────────────────────────┴─────────────────┤
│ 0s      2s      4s      6s      8s     10s     12s     14s     16s     18s       │
│ V ▐ Escena 1 ▐▐ Escena 2 ▐▐▐ Escena 3 ▐                          [+][-] zoom     │  160 px
│ A ▐ A ▐ B ▐ A ▐ B ▐  ▐ A ▐ B ▐                                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## C.2 Zona izquierda — Director IA (ancho fijo ~300 px, sin scroll en estado normal)

Todo lo que sea *pedirle algo a la IA* y *obtener el video*, en el orden real del flujo.

**1 · Idea** — textarea (el actual), contador de caracteres visible (0/2000).

**2 · Parámetros rígidos** — los controles preestablecidos que pediste:

| Control | Valores | Origen | Requiere motor |
| --- | --- | --- | --- |
| Tono | educational · ironic · serious · energetic · inspirational | `ai-video-plan.schema.json:12` | sí (pasar como restricción) |
| Duración objetivo | slider 8–90 s con marcas en 15/30/60 | `targetDurationSeconds` | sí (idem) |
| Encuadre | balanced · focus-a · focus-b, con 3 iconos | `LAYOUTS` en `director-plan.mjs` | sí (idem) |
| Escenas | 1–4 | `maxItems: 4` del schema | sí (idem) |

Mientras el motor no acepte esos parámetros, se muestran **como lectura del plan devuelto**
(“el Director eligió: irónico · 22 s · balanced”), no como controles falsos. Es la
diferencia entre informar y mentir.

**3 · Acciones** — `⚡ Crear propuesta` (primaria) y `⟳ Otra variante` (secundaria, hoy es
el contador `variant` que ya existe pero está oculto). Durante la generación: barra
indeterminada + `⛔ Detener` + tiempo transcurrido, porque la espera llega a 4 minutos.

**4 · Resultado de la propuesta** — título, escenas, palabras **sobre presupuesto**
(`46 / 90`), y `caché local` o el modelo usado. Un aviso claro cuando la propuesta va a
reemplazar ediciones manuales, con confirmación (arregla B1.3/§4.4 de la otra auditoría).

**5 · Bloque Render** — separado por regla: botón `▶ Renderizar`, barra con
**escena N de M + etapa legible** (los datos ya vienen en `job.progress`), `⛔ Cancelar`,
y al terminar `⬇ Descargar MP4` + `↗ Abrir en el visor`. Los errores muestran mensaje,
acción sugerida y un `▸ detalle técnico` colapsado.

**6 · Estado del servicio** — una línea con tres semáforos compactos: `Ollama ●`
`Piper ●` `Render ●` (este último usa `renderBusy`, hoy ignorado). Reintento automático
cada 15 s en vez de exigir recargar la página.

## C.3 Zona central — Visor (elástico, es la pieza dominante)

- Canvas vertical 1080×1920 centrado, escalado al alto disponible, fondo neutro.
- **Un solo control de reproducción**: la barra del visor. Se eliminan
  `#play`/`#pause`/`#restart` del panel lateral (B2.4).
- Barra: `▶` · tiempo actual · scrubber · duración · `1x` · `⟳` · `⛶` pantalla completa.
- **Selector de fuente del visor** arriba a la derecha, tres pestañas pequeñas:
  `Composición` (proyecto editable, estático) · `Preview` (job publicado, animado) ·
  `Video final` (MP4 del último render). Hoy esas tres cosas viven en tres lugares
  distintos de la pantalla; ponerlas como fuentes del mismo visor es lo que cierra la
  desconexión B1.1/B1.3.
- Chip de estado sobre el visor: `1080×1920 · 30 fps · determinista ✓`, en vez del
  `<details>` de telemetría. La telemetría de boca/ojos/gesto pasa a Configuración →
  “Modo diagnóstico”, apagada por defecto.

## C.4 Zona derecha — Recursos + inspector (ancho fijo ~340 px, dos bloques)

**Bloque superior — Biblioteca (alto fijo, ~40 % del panel)**

Pestañas con icono: `Personajes` · `Fondos` · `Voces` · `Plantillas`.

- Rejilla de tarjetas con **miniatura real** (`thumbnail` del catálogo compilado, ya existe
  y no se usa), etiqueta y `tags` como chips.
- Buscador + filtro por tag (los `tags` ya están en el catálogo).
- Aplicar = clic en la tarjeta con el elemento seleccionado, o arrastrar sobre el visor.
- `i` en cada tarjeta abre procedencia y licencia (requisito de AGENTS §8, hoy invisible).
- `Voces` incluye botón de escucha de una frase de muestra cuando exista caché de audio.
- `Plantillas`: por ahora los tres `layoutPreset` + los presets de cámara y transición, con
  vista previa esquemática. Es lo único “plantilla” que el motor tiene hoy; el panel deja
  el hueco preparado para cuando haya más.

**Bloque inferior — Inspector (scroll solo aquí, acordeón)**

Secciones colapsables, **una abierta a la vez**, con recuento en el encabezado:
`▸ Escena` · `▾ Personajes (2)` · `▸ Diálogo (4)` · `▸ Fondo y cámara` · `▸ Transición`.

- Personajes: miniatura + nombre + X/Y/Escala/zIndex compactos en una fila de 4 campos con
  iconos, no cuatro filas etiquetadas.
- Diálogo: un turno por tarjeta plegada, mostrando `hablante · primeras palabras`, que se
  despliega para editar texto/voz/gesto/pausa. Esto solo ya elimina la mayor parte del
  scroll infinito de B4.1.
- Los avisos de “fuera de alcance” (texto, imágenes, pose inicial) pasan a un icono `ⓘ`
  discreto en vez de párrafos repetidos por elemento.
- Pie fijo del inspector: `↶ ↷ ✓ Validar ⬇ Exportar`. Se eliminan los duplicados de la
  barra inferior (B2.4).

## C.5 Zona inferior — Barra de tiempo (alto fijo ~160 px, colapsable)

- **Se elimina la barra de herramientas de 5 botones muertos** (B2.1). Cortar, texto, audio
  y eliminar no existen en el contrato; cuando existan, vuelven.
- Pista `V` = **una barra por escena del proyecto**, no un `clip-dummy`: ancho proporcional
  a la duración medida si ya se renderizó, o ancho igual con trama diagonal y etiqueta
  `≈ estimado` si todavía no. Clic = seleccionar escena (cierra B1.2). Arrastrar = reordenar
  (usa `reorder-scenes`, ya existe), con aviso explícito de que las transiciones se
  mantienen por posición (B4.6 / §4.6 de la otra auditoría).
- Marcadores de transición entre escenas: `✂` para cut, `◇` para fade con su duración.
- Pista `A` = un bloque por turno de diálogo, con el hablante; tiempos reales cuando existe
  runtime medido, proporcionales al conteo de palabras y **rotulados como aproximados**
  cuando no.
- Regla con zoom `[+] [-]` (el `pixelsPerSecond` ya es configurable en `timeline.ts:14`) y
  playhead que sigue la reproducción y se puede arrastrar.
- Botón `⌄` para plegar la barra entera y dejar el visor a pantalla casi completa.

## C.6 Reglas transversales

1. **Un solo scroll en toda la pantalla**: el del inspector. Todo lo demás entra en su zona
   o se colapsa. Ese es el requisito que ordena todas las decisiones anteriores.
2. **Nada deshabilitado sin explicar por qué**: cada control apagado lleva tooltip con la
   razón real (“necesita una propuesta”, “el motor todavía no representa texto”).
3. **Iconos con etiqueta** en las acciones principales; icono solo en las secundarias, y
   siempre con `title` + `aria-label`.
4. **Un control por acción.** Se eliminan las cuatro duplicaciones de B2.4.
5. **Persistencia mínima**: proyecto en curso y último `jobId` en `localStorage`, para que
   recargar deje de destruir el trabajo (B1.3).
6. **Prometer solo lo que el motor hace.** Cuando una capacidad no existe, no hay botón
   apagado: hay una nota en la sección correspondiente.
7. **Atajos reales y documentados**: implementar Ctrl+Z/Ctrl+Y (hoy el tooltip miente,
   B2.3) y mostrar la lista en Configuración.

## C.7 Comparación

| | Hoy | Propuesta |
| --- | --- | --- |
| Columna izquierda | Diagnóstico del preview | Director IA completo |
| Columna derecha | IA + galería + editor entero, un solo scroll larguísimo | Biblioteca (fija) + inspector en acordeón |
| Centro | Visor de un job publicado | Visor con 3 fuentes: composición · preview · video final |
| Abajo | 5 botones muertos + timeline maqueta | Escenas y turnos reales, seleccionables y reordenables |
| Controles duplicados | 4 pares | 0 |
| Botones sin función | 5 | 0 |
| Recursos visibles | `<select>` de texto | Tarjetas con miniatura, tags y licencia |

---

# Parte D — Orden sugerido

Cada bloque es entregable y verificable por separado. Los marcados **[motor]** dependen del
carril de Codex y **no** deberían hacerse desde UX/UI.

**Fase 1 — que el flujo no se pierda (sin tocar el layout)**
1. Inicializar el Director aunque no haya proyecto publicado (B1.4).
2. Persistir proyecto y último job en `localStorage`; confirmar antes de reemplazar por una
   propuesta nueva (B1.3).
3. Errores de transporte legibles y `detalle técnico` colapsable (B1.6).
4. Reintento periódico de `/api/health` + semáforo `renderBusy` (B1.6).

**Fase 2 — reorganización estructural**
5. Mover el Director a la izquierda; sacar diagnóstico y controles duplicados de ahí.
6. Partir la derecha en Biblioteca + Inspector en acordeón; tarjetas con miniatura y tags.
7. Barra inferior sin herramientas muertas; pista V por escena con selección y reordenado.
8. Visor con las tres fuentes y un único juego de controles.

**Fase 3 — cerrar la desconexión de fondo**
9. Preview de composición del proyecto editable (pose estática + encuadre + fondo).
10. Progreso por escena y estimación aproximada de duración a partir del presupuesto de
    palabras, siempre rotulada como aproximada.

**Fase 4 — [motor] habilitar los controles rígidos**
11. Aceptar `tone`, `targetDurationSeconds`, `layoutPreset` y cantidad de escenas como
    entrada de `createDirectorProposal` (hoy solo `prompt` y `variant`).
12. Publicar los renders de la app en `public/generated/` o exponer un índice propio, para
    que aparezcan en la galería y sobrevivan a una recarga.
13. `animationPresets` como comando editable del contrato del editor.

**Fase 5 — pulido**
14. Ctrl+Z/Ctrl+Y reales; `role="listbox"` en la galería; foco de vuelta al cerrar el
    modal; Configuración con estado del servicio, rutas y modo diagnóstico; título de
    pestaña actualizado.
