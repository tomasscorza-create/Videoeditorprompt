# Plan de acción 2 — Mejora UX/UI: conectado, entendible, moderno, agradable, usable

Carril: Claude (UX/UI) · Rama: `main` · Estado general: **pendiente; empieza al
cerrar el plan 1**.

> Segundo plan de la serie. El plan 1 (`docs/PLAN_SANEAMIENTO_UX_UI_2026-07-27.md`)
> sanea la deuda técnica del sistema visual; este plan 2 **eleva la experiencia**:
> hace que la aplicación se sienta un solo sistema conectado, que se explique sola,
> y que sea moderna y placentera de usar. No repite nada del plan 1 — lo asume
> hecho (en particular los tokens de tipografía y color, que varios ítems de acá
> reutilizan).

## Principio rector: mejorar mostrando la verdad

La mayor oportunidad detectada en la auditoría no es decorativa: **el sistema ya
produce datos valiosos que la UI descarta**. La API del Director
(`src/ui/director/api.ts`) devuelve reportes de calidad con score e issues,
puntuaciones por candidato, el contexto de recursos que usó la IA, los comandos
exactos que aplicó una edición, la identidad del modelo, y etapas del render — y
casi nada de eso llega hoy a la pantalla. La vía principal de este plan es
**hacer visible lo que el motor ya sabe**, nunca simular lo que no puede hacer
(regla heredada de `docs/PLAN_DE_ACCION_TIMELINE_2026-07-25.md`: honestidad como
criterio de aceptación).

## Reglas duras (heredadas del plan 1, siguen vigentes)

1. Solo presentación y módulos de UI; motor y contratos intactos. Los ítems que
   necesitan un endpoint o dato nuevo del servidor están marcados **[servidor]**
   y no se implementan sin coordinación previa — jamás con datos falsos.
2. HTML aditivo: no renombrar ni eliminar IDs existentes.
3. Estructura canónica de 5 áreas intacta (`docs/ESTRUCTURA_VISUAL_CANONICA.md`).
4. Sin dependencias nuevas: todo con plataforma web nativa (`<dialog>`, View
   Transitions, Popover API si el runtime la soporta, CSS moderno).
5. Ambos temas y todos los breakpoints en cada ítem; `prefers-reduced-motion`
   respetado en toda animación nueva.
6. Accesibilidad como parte del ítem, no como pasada posterior: todo elemento
   nuevo nace con roles, nombres y teclado.
7. Verificación estándar: `npx tsc --noEmit` + `npm test` + `npm run build` +
   `npm run ui:test-modules` + revisión visual en `npm run dev:web`.
8. Un commit por ítem (o grupo pequeño coherente); coordinación con el carril
   activo antes de tocar archivos modificados en `git status`.

---

## Fase C — Conexión: el sistema se siente uno

### C1 · Identidad del proyecto siempre visible — impacto alto, esfuerzo S
- **Problema:** el nombre del proyecto activo no aparece en ninguna parte fija de
  la pantalla; el usuario no sabe qué está editando ni cómo renombrarlo.
- **Qué:** mostrar el título del proyecto en la topbar (junto al estado de
  guardado), editable inline (clic → input → Enter guarda vía el comando de
  edición de título existente en el store). Si no hay proyecto: «Sin proyecto —
  Creá uno con el Director».
- Archivos: `index.html` (topbar, aditivo), `src/ui/index.ts` o módulo nuevo
  `src/ui/project-identity.ts`, `src/style.css`.
- **Aceptación:** título visible y renombrable; el rename dispara el autosave y
  se refleja en «Mis proyectos».

### C2 · Selección espejada completa — impacto alto, esfuerzo M
- **Problema:** timeline, lienzo e inspector comparten selección
  (`projectSelection`), pero la conexión es pasiva: seleccionar en un lugar no
  lleva la vista de los otros hasta el elemento.
- **Qué:** al seleccionar un clip en la timeline, el inspector hace scroll hasta
  el grupo correspondiente y lo destaca (pulso sutil); al seleccionar en el
  lienzo, ídem; hover en un clip resalta el personaje en el lienzo (outline
  suave) y viceversa. Todo con la selección/estado ya existente.
- Archivos: `src/ui/timeline.ts`, `src/ui/project/composition.ts`,
  `src/ui/project/panel.ts`, `src/style.css`.
- **Aceptación:** seleccionar en cualquiera de las tres superficies localiza el
  elemento en las otras dos sin buscar manualmente.

### C3 · «Qué cambió» tras cada edición de IA — impacto alto, esfuerzo M
- **Problema:** al aplicar una edición con IA el proyecto cambia de golpe; el
  usuario no sabe qué tocó el Director.
- **Qué:** la respuesta de `/api/director/edits` ya incluye `commands` (la lista
  exacta de comandos aplicados). Renderizar un resumen legible («Cambió el
  diálogo de la escena 2 · Ajustó la transición 1→2»), como toast persistente
  hasta descartar (ver M1) + pulso breve en los clips/escenas afectados en la
  timeline. Con `status: 'no-change'`, decirlo claramente.
- Archivos: `src/ui/director/panel.ts`, `src/ui/timeline.ts`, `src/style.css`.
  Mapeo comando→texto en módulo puro testeable (`ui:test-modules`).
- **Aceptación:** cada edición IA produce un resumen humano de sus comandos;
  nunca un cambio silencioso.

### C4 · El Director muestra su contexto — impacto medio, esfuerzo S
- **Problema:** `DirectorContextSummary` (recursos considerados, plantilla
  recomendada, shortlist) se descarta; el usuario no ve la conexión
  Director↔biblioteca.
- **Qué:** en la página Propuesta, bloque colapsable «Recursos elegidos»: chips
  con los `resourceIds` usados; clic en un chip abre la pestaña correspondiente
  de la biblioteca y destaca la tarjeta. Mostrar la plantilla recomendada.
- Archivos: `src/ui/director/panel.ts`, `src/ui/project/library.ts`,
  `src/style.css`.
- **Aceptación:** desde una propuesta se puede ver y localizar cada recurso que
  la IA eligió.

### C5 · Render visible globalmente — impacto medio, esfuerzo S
- **Problema:** el progreso de render vive dentro del panel Director; si el
  panel está colapsado o en otra pestaña, el render es invisible.
- **Qué:** indicador compacto en la topbar mientras hay job activo (spinner +
  porcentaje + etapa), alimentado por el polling existente; clic lleva a la
  página Render. Al completar, notificación (M1) con acción «Ver video».
- Archivos: `index.html` (aditivo), `src/ui/director/panel.ts`, `src/style.css`.
- **Aceptación:** con el panel Director colapsado, un render en curso y su
  finalización siguen siendo visibles y accionables.

### C6 · Arrastrar recursos a la timeline — impacto medio, esfuerzo M
- **Problema:** los recursos se arrastran al lienzo, pero no a la timeline, que
  es donde se piensa en escenas.
- **Qué:** aceptar drop de una tarjeta de personaje/fondo sobre la pista o la
  escena correspondiente de la timeline, despachando los mismos comandos del
  store que usa el inspector (paridad, regla del plan de timeline). Feedback de
  drop-target ya existe como patrón (`is-drop-target`).
- Archivos: `src/ui/timeline.ts`, `src/ui/project/library.ts`.
- **Aceptación:** soltar un fondo sobre una escena la cambia; soltar un
  personaje lo agrega — idéntico resultado que por inspector.

## Fase E — Entendimiento: el sistema se explica solo

### E1 · Calidad de la propuesta visible — impacto alto, esfuerzo S
- **Problema:** `DirectorProposal.quality` (score, piso, passed, issues con
  instrucción de reparación) y `repairAttempts` se descartan. El usuario acepta
  propuestas a ciegas.
- **Qué:** tarjeta de calidad en la página Propuesta: score vs piso en lenguaje
  claro («Calidad 8.2 — supera el mínimo 7.0»), lista de issues legible, y si
  hubo reparaciones, decirlo («Se reparó 1 problema de ritmo automáticamente»).
- Archivos: `src/ui/director/panel.ts`, `src/style.css`.
- **Aceptación:** toda propuesta muestra su reporte de calidad sin jerga.

### E2 · Comparación de candidatos (bestOf > 1) — impacto medio
- **E2a (UI pura, esfuerzo S):** cuando `selection.scores` trae varias
  puntuaciones, mostrar la tabla comparativa (relevancia, gancho, naturalidad…)
  con el ganador marcado y por qué ganó (totales).
- **E2b [servidor] (esfuerzo M):** permitir elegir otro candidato requiere que la
  API devuelva los proyectos de todos los candidatos, no solo el ganador. No
  implementar selección hasta que exista; la tabla de E2a nunca simula que se
  puede elegir.
- **Aceptación E2a:** con 2–3 propuestas, el usuario entiende qué evaluó el juez
  y cómo quedó cada candidata.

### E3 · Estado del sistema explicado — impacto alto, esfuerzo S
- **Problema:** el badge de salud dice «Listo/Error» pero `LocalHealth` sabe
  mucho más (Ollama disponible, modelo instalado y cuál, TTS, render ocupado).
- **Qué:** clic en el badge abre un popover de diagnóstico: cada dependencia con
  su estado y, si falla, la acción sugerida en lenguaje de usuario (reutilizar el
  patrón `suggestedAction` que la API ya trae). Incluir identidad del modelo
  (`modelIdentity`) como dato de reproducibilidad.
- Archivos: `src/ui/director/panel.ts` (o módulo `src/ui/health.ts`),
  `index.html` (aditivo), `src/style.css`.
- **Aceptación:** ante cualquier dependencia caída, el popover dice qué falta y
  cómo resolverlo, sin buscar en la consola.

### E4 · Modos de la timeline explicados — impacto medio, esfuerzo S
- **Problema:** el badge «Sin medir / Medido» es críptico para quien no conoce la
  arquitectura (duración nace del TTS al renderizar).
- **Qué:** popover en el badge: qué significa el modo actual, qué cambia al
  renderizar, y CTA directo «Renderizar para medir» cuando aplica. Misma pieza
  para el estado `stale` del visor («La exportación quedó vieja: esto cambió»).
- Archivos: `src/ui/timeline.ts`, `src/ui/viewer.ts`, `src/style.css`.
- **Aceptación:** un usuario nuevo entiende por qué los tiempos son estimados y
  qué hacer para verlos reales.

### E5 · Primer uso guiado — impacto alto, esfuerzo M
- **Problema:** con la app vacía hay tres paneles con estados vacíos
  independientes; el flujo Idea→Propuesta→Render no se presenta en ningún lado.
- **Qué:** cuando no hay proyecto ni renders, el visor muestra una guía de tres
  pasos apuntando a los controles reales (1 «Escribí tu idea acá» → Director,
  2 «Revisá la propuesta», 3 «Renderizá tu MP4»), con ejemplos de prompt
  clicables que rellenan el textarea. Descartable y recordado en `localStorage`.
  Sin overlays intrusivos ni tours por pasos bloqueantes.
- Archivos: `index.html` (aditivo), `src/ui/viewer.ts` o módulo
  `src/ui/onboarding.ts`, `src/ui/director/panel.ts` (ejemplos), `src/style.css`.
- **Aceptación:** primera apertura → siguiente acción obvia sin leer docs; la
  guía no reaparece tras descartarla ni cuando ya hay proyectos.

### E6 · Auditoría de copy y vocabulario — impacto medio, esfuerzo S
- **Qué:** pasada única de consistencia terminológica en UI: Propuesta /
  Proyecto / Escena / Turno / Render / Exportación — un término por concepto,
  voseo consistente, errores siempre con acción sugerida. Producto: tabla de
  vocabulario al final de este documento (rellenar al ejecutar) que queda como
  referencia para todo texto futuro.
- Archivos: `index.html`, módulos con strings de estado.
- **Aceptación:** cero sinónimos mezclados para el mismo concepto en pantalla.

## Fase M — Modernización: se ve y se siente actual

### M1 · Sistema de notificaciones unificado — impacto alto, esfuerzo M · **fundacional**
- **Problema:** los eventos transitorios (guardado, render listo, edición IA
  aplicada, errores) se reparten entre cinco `role="status"` dispersos; algunos
  se pierden si el panel está oculto.
- **Qué:** módulo único `src/ui/notifications.ts`: cola de toasts apilados
  (esquina inferior), `aria-live="polite"`, niveles info/éxito/error, acción
  opcional (botón), autodescarte con pausa en hover, y reduced-motion. Los
  status persistentes de página (salud, modo timeline) **no** migran — solo los
  transitorios. C3, C5, U1 y U5 se apoyan en esto: va primero.
- Archivos: `src/ui/notifications.ts` (nuevo), `src/style.css`, integración
  gradual en `director/panel.ts`, `project/panel.ts`, `index.ts`.
- **Aceptación:** un solo sistema visual para eventos transitorios; ningún evento
  importante ocurre sin rastro visible.

### M2 · Paleta de comandos (Ctrl+K) — impacto alto, esfuerzo M
- **Qué:** `<dialog>` con buscador difuso sobre un registro de acciones ya
  existentes: nuevo proyecto, abrir proyecto, renderizar, alternar paneles,
  cambiar pestañas del Director, atajos de timeline, configuración. Cada acción
  registra etiqueta + atajo + disponibilidad (deshabilitada con motivo). Registro
  como módulo puro testeable; sin dependencias.
- Archivos: `src/ui/command-palette.ts` (nuevo), `index.html` (dialog aditivo),
  `src/ui/shortcuts.ts`, `src/style.css`.
- **Aceptación:** Ctrl+K desde cualquier lugar; toda acción de la paleta ejecuta
  lo mismo que su control visual; navegable por teclado completo.

### M3 · Micro-interacciones y esqueletos de carga — impacto medio, esfuerzo M
- **Qué:** tokens de movimiento (`--transition-fast/base`, curva estándar);
  elevación sutil en hover de tarjetas; estados de carga tipo skeleton
  (galería de renders, biblioteca, modal de proyectos) en lugar de textos
  «Buscando…»; shimmer ya existe como patrón en el progreso de render —
  generalizarlo. Depende de los tokens del plan 1.
- Archivos: `src/style.css`, `src/ui/gallery.ts`, `src/ui/project/library.ts`,
  `src/ui/director/panel.ts`.
- **Aceptación:** ninguna lista carga con texto plano; toda transición usa los
  tokens de movimiento; reduced-motion desactiva todo.

### M4 · View Transitions entre superficies — impacto bajo, esfuerzo S
- **Qué:** `document.startViewTransition` (con detección de soporte y fallback
  directo) para los cambios Editor↔Creador y lienzo↔reproducción. Mejora
  progresiva pura; sin soporte, comportamiento actual intacto.
- Archivos: `src/ui/editor-workspace.ts` o `viewer.ts`, `src/style.css`.
- **Aceptación:** cambio de superficie con crossfade suave donde el navegador lo
  soporte; cero regresión donde no.

### M5 · Pulido de detalle — impacto bajo, esfuerzo S
- **Qué:** scrollbars con estilo coherente en todos los paneles (hoy solo
  timeline), `backdrop-filter` consistente en popovers, escala de sombras
  tokenizada (2 niveles), `::selection` con acento, favicon/título de pestaña
  con el nombre del proyecto activo (conecta con C1).
- Archivos: `src/style.css`, `index.html`.
- **Aceptación:** revisión visual: ningún control con estilo de navegador crudo.

## Fase A — Agrado: placer de uso

### A1 · Tema claro de primera clase — impacto medio, esfuerzo S
- **Qué:** auditoría de contraste y jerarquía específica del tema claro (hoy es
  derivado del oscuro y se nota: sombras fuertes, gradientes lavados). Ajustar
  tokens claros hasta paridad de calidad; contraste AA en texto sobre todas las
  superficies, en especial `--muted` y los tamaños chicos post-plan 1.
- Archivos: `src/style.css` (solo bloque de tokens claros).
- **Aceptación:** captura A/B de cada área en ambos temas con calidad
  equivalente; verificación AA de pares texto/fondo principales.

### A2 · Momento de render terminado — impacto medio, esfuerzo S
- **Qué:** al completar un render, transición cuidada hacia la reproducción
  (fade del lienzo al video), badge «Exportación actual» con entrada animada y
  botón de descarga destacado; notificación con «Ver video» si el usuario está
  en otra superficie. Sin confetti ni ruido: celebración sobria.
- Archivos: `src/ui/viewer.ts`, `src/ui/editor-workspace.ts`, `src/style.css`.
- **Aceptación:** el resultado del trabajo se presenta como un momento, no como
  un cambio de `hidden`.

### A3 · Acento personalizable — impacto bajo, esfuerzo S · opcional
- **Qué:** 3–4 presets de acento (verde actual, azul, ámbar, violeta) en
  Configuración, aplicados vía tokens (`--accent`, `--accent-ink` y derivados),
  persistidos junto al tema. Barato tras el plan 1; alto cariño percibido.
- Archivos: `src/ui/theme.ts`, `index.html` (select en Configuración),
  `src/style.css`.
- **Aceptación:** cambiar acento recolorea toda la UI coherentemente en ambos
  temas, incluidos estados hover/active.

### A4 · Escuchar las voces en la biblioteca — impacto alto **[servidor]**, esfuerzo M
- **Qué:** botón de reproducción en cada tarjeta de voz con una muestra corta
  («Hola, soy la voz Carlos») para elegir voz sin renderizar. Requiere endpoint
  de muestras pregeneradas (las voces Piper viven en `C:\LocalVideoTTS`).
  **No implementar la UI hasta tener el endpoint** — un botón de play muerto es
  peor que nada.
- Coordinación: definir `GET /api/library/voices/:id/sample` con el otro carril.
- **Aceptación:** clic → escucha en <1s; sin endpoint, la tarjeta queda como hoy.

## Fase U — Usabilidad profunda

### U1 · Undo/redo narrado — impacto medio, esfuerzo M
- **Qué:** al deshacer/rehacer, toast con descripción de lo revertido
  («Deshecho: reordenar escenas»), usando un mapeo comando→etiqueta compartido
  con C3 (mismo módulo puro). Los botones undo/redo muestran en su `title` la
  próxima acción a revertir si el store la expone; si no la expone, solo el
  toast — no inventar.
- Archivos: módulo de etiquetas de C3, `src/ui/timeline.ts`,
  `src/ui/notifications.ts`.
- **Aceptación:** nunca un undo «a ciegas»: siempre se dice qué se deshizo.

### U2 · Buscar y filtrar en biblioteca y proyectos — impacto medio, esfuerzo S
- **Qué:** input de filtro en vivo en la biblioteca de recursos (por nombre y
  etiquetas, client-side) y en «Mis proyectos» (por título). Sin resultados:
  estado vacío con limpiar filtro.
- Archivos: `src/ui/project/library.ts`, `src/ui/director/panel.ts` (modal
  proyectos), `index.html` (aditivo), `src/style.css`.
- **Aceptación:** con 20+ recursos o proyectos, encontrar uno toma un tecleo.

### U3 · Timeline navegable por teclado — impacto medio, esfuerzo M
- **Qué:** los clips se recorren con Tab/flechas (roving tabindex), Enter abre
  el elemento en el inspector, Supr ya funciona; anuncios `aria-live` para
  selección y acciones. Completa el trabajo de atajos existente con acceso real
  sin mouse.
- Archivos: `src/ui/timeline.ts`.
- **Aceptación:** flujo completo seleccionar→editar→borrar sin tocar el mouse,
  con lector de pantalla anunciando cada paso.

### U4 · Zoom y encuadre del lienzo de composición — impacto medio, esfuerzo M
- **Qué:** controles fit/100%/zoom (+ rueda con Ctrl) sobre el lienzo del
  editor para colocar personajes con precisión; solo transforma la vista
  (transform CSS del contenedor), jamás los datos del proyecto. Indicador de
  nivel y doble clic para volver a fit.
- Archivos: `src/ui/project/composition.ts`, `src/style.css`.
- **Aceptación:** colocar un personaje pequeño con precisión deja de requerir
  puntería; exportación idéntica (la vista no toca datos).

### U5 · Errores siempre accionables — impacto alto, esfuerzo S
- **Qué:** política única: todo error mostrado ofrece su `suggestedAction` como
  **botón** cuando la acción es ejecutable desde la UI (reintentar, abrir
  diagnóstico E3, reconectar) y como texto cuando no. Auditar los `catch` de
  `director/panel.ts`, `project/*` y render para que ninguno termine en texto
  plano sin salida.
- Archivos: `src/ui/notifications.ts`, `src/ui/director/panel.ts`,
  `src/ui/project/*.ts`.
- **Aceptación:** ningún error deja al usuario sin un siguiente paso clicable o
  explícito.

### U6 · Historial local de versiones — impacto medio **[servidor]** parcial, esfuerzo L · opcional
- **Qué:** puntos de restauración del proyecto (cada render + manual «Guardar
  versión»), listados con fecha y restaurables. La captura del snapshot es
  local (persistencia existente); retención durable y límites pueden requerir
  al servidor de proyectos. Definir alcance exacto al llegar; no prometer
  historial infinito.
- **Aceptación (fase local):** restaurar el estado previo a una edición IA o a
  un cambio destructivo en dos clics.

---

## Orden recomendado

| Ola | Ítems | Criterio |
|---|---|---|
| 1 — Fundaciones + victorias rápidas | M1 (toasts) → C1 (identidad) → E1 (calidad) → E3 (salud) → C5 (render global) | Máximo impacto/esfuerzo; M1 desbloquea el resto |
| 2 — Comprensión y flujo | C3 (qué cambió) → U5 (errores accionables) → E4 (modos) → E5 (primer uso) → E2a (candidatos) → U2 (buscar) → E6 (copy) | El sistema se explica solo |
| 3 — Conexión profunda y modernización | M2 (paleta) → C2 (selección espejada) → C4 (contexto IA) → C6 (drop en timeline) → M3 (micro-interacciones) → A2 (momento render) → M4/M5 | Se siente un solo sistema, actual |
| 4 — Profundidad y opcionales | U1 (undo narrado) → U3 (teclado timeline) → U4 (zoom lienzo) → A1 (tema claro) → A3 (acento) | Refinamiento |
| Coordinación [servidor] | A4 (voces), E2b (elegir candidato), U6 (historial) | Solo con endpoint acordado |

Cada ola es un punto de pausa válido: nada queda a medias entre olas.

## Qué NO hace este plan

- No reorganiza el layout canónico ni cambia responsabilidades de áreas.
- No toca motor, contratos ni pipeline; los [servidor] esperan coordinación.
- No agrega dependencias ni frameworks.
- No simula capacidades inexistentes (elegir candidato sin endpoint, preview de
  voz sin muestra, trim temporal de clips, etc.).
- No incluye monetización ni cambios en las franjas demo.

## Verificación global al cierre

1. Suites verdes: `tsc --noEmit`, `npm test`, `npm run build`,
   `npm run ui:test-modules` (ampliado con: mapeo comando→etiqueta, registro de
   la paleta, cola de notificaciones — lógica pura nueva siempre con test).
2. Revisión visual completa: ambos temas × breakpoints × paneles colapsados ×
   reduced-motion.
3. Prueba de flujo sin mouse: idea → propuesta → editar → render → descarga,
   solo con teclado.
4. Actualizar el estado de cada ítem en este documento al completarlo.

## Vocabulario canónico (completar en E6)

| Concepto | Término único | Prohibidos |
|---|---|---|
| _(rellenar al ejecutar E6)_ | | |
