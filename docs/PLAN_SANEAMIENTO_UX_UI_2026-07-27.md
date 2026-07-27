# Plan de saneamiento UX/UI — 27 de julio de 2026

Carril: Claude (UX/UI) · Rama: `main` · Estado general: **ejecutado y cerrado el
27-07-2026** (7 lotes, un commit por lote, de `ffbd9b6` a `5c77005`).

> Documento operativo para ejecución por agente. Objetivo: sanear la deuda técnica
> del sistema visual detectada en la auditoría del 27 de julio de 2026, **sin
> reorganizar el layout canónico ni tocar el motor**. Todo lo que sigue es
> presentación: tokens, clases, ARIA, organización de CSS. El comportamiento y los
> contratos quedan intactos.

Referencias:
- `docs/ESTRUCTURA_VISUAL_CANONICA.md` — decisión de producto aprobada; este plan
  **no** la modifica.
- `docs/UX_DEUDA_TECNICA_Y_PLAN.md` (22-07) — deuda del preview anterior, en gran
  parte ya resuelta; este plan la reemplaza como documento vigente de deuda UX.
- `docs/AUDITORIA_UX_UI_Y_PROPUESTA_LAYOUT.md` (23-07) — el problema de "dos
  aplicaciones superpuestas" ya está resuelto vía `src/ui/editor-workspace.ts`.

---

## Inventario de deuda (auditoría 2026-07-27)

| # | Deuda | Severidad | Lote |
|---|---|---|---|
| 1 | Tipografía micro sin escala: decenas de `font-size` ad-hoc entre `.44rem` y `.98rem` (≈7–16px); clips, chips y labels por debajo de ~11px | **Alta** | L2 |
| 2 | Tokens duplicados: el `<style>` anti-FOUC de `index.html` repite variables de `:root` de `style.css`, solo en variante oscura | **Alta** | L3 |
| 3 | Colores fuera de tokens: clips de timeline (`#477ac8`, `#7759b8`, `#258a79`), superficies del visor (`#101827`, `#c8d5e8`, `#9aabc0`…), banner alternativo (`#8ca8ff`) | Media | L3 |
| 4 | Cinco implementaciones de tabs (`.director-page-tab`, `.proposal-tab`, `.source-tab`, `.resource-tab`, `.character-mode-tabs`) con estilos y ARIA inconsistentes; `.resource-tabs` declara `tablist` pero sus botones no llevan `role="tab"` ni `aria-selected` | Media | L4 |
| 5 | `style.css` monolítico (1400+ líneas) sin secciones formales; overrides a distancia tipo `.director-page .inspector-field` | Media | L5 |
| 6 | Iconografía con glifos de texto (`◀ ▶ ⚙ ↶ ⌑ ⌨`): render inconsistente entre fuentes/SO | Baja | L6 |
| 7 | Estilos inline residuales: dos `style="display: flex; …"` en headers de `index.html` (panel Director y biblioteca de recursos) | Baja | L1 |
| 8 | Acoplamiento por ~80 IDs: los módulos TS resuelven nodos con `required()` que lanza en runtime; un rename en HTML rompe sin aviso del compilador | Baja (se mitiga, no se elimina) | L7 |

## Reglas duras

1. **Solo presentación.** No se toca `shared/`, `schema/`, `scripts/` del motor ni
   contratos de datos. Preview = export se conserva.
2. **HTML aditivo.** No se renombra ni elimina ningún `id` existente (coordinación
   con el otro carril). Se pueden agregar clases; las clases viejas se retiran solo
   cuando ningún selector CSS ni módulo TS las referencie.
3. **Estructura canónica intacta.** Las 5 áreas + franjas laterales de
   `ESTRUCTURA_VISUAL_CANONICA.md` no cambian de responsabilidad ni de posición.
4. **Sin dependencias nuevas.** Tokens CSS, SVG inline y APIs nativas; nada de
   librerías de UI ni de iconos.
5. **Ambos temas, siempre.** Cada lote se verifica en claro y oscuro, y en los
   breakpoints 1100px y 720px, con paneles colapsados y expandidos.
6. **Accesibilidad no regresiva.** `:focus-visible`, `prefers-reduced-motion`,
   regiones `aria-live` y atajos se conservan; los cambios de tabs deben mejorar
   ARIA, nunca quitarlo.
7. **Verificación estándar por lote:** `npx tsc --noEmit` + `npm test` +
   `npm run build` + `npm run ui:test-modules` + revisión visual en `npm run dev:web`.
8. **Un commit por lote**, mensajes con la convención vigente
   (`fix(ui):` / `feat(ui):` / `refactor(ui):` / `docs(ui):`).
9. **Coordinación con el carril activo:** antes de tocar archivos que aparezcan
   modificados en `git status`, verificar que no haya trabajo sin commitear del
   otro carril; si lo hay, el cambio se pospone o se limita a archivos limpios.
   *(Al ejecutar, el árbol estaba limpio salvo `AGENTS.md`: el otro carril ya
   había commiteado `package.json`, `scripts/test-core.mjs` y `src/ui/director/*`,
   así que no hubo nada que posponer.)*

---

## Lote 1 — Quick wins (riesgo casi nulo)

- **1.1 Estilos inline.** Reemplazar los dos `style="display: flex; gap: 0.5rem;
  align-items: center;"` de `index.html` (header del Director y header de la
  biblioteca) por una clase `.section-header-actions` definida en `style.css`.
- **1.2 ARIA de tabs de recursos.** En `index.html`, agregar `role="tab"` a los
  botones de `.resource-tabs`; en `src/ui/project/library.ts`, sincronizar
  `aria-selected` al cambiar de pestaña (hoy solo alterna `.is-active`).

**Aceptación:** `grep 'style="' index.html` sin resultados; el árbol de
accesibilidad muestra tabs correctas en la biblioteca.

Archivos: `index.html`, `src/style.css`, `src/ui/project/library.ts`.
**Estado: hecho** (`ffbd9b6`). `style="` = 0; las tres tabs de la biblioteca
exponen `role="tab"` y `aria-selected` sincronizado.

## Lote 2 — Escala tipográfica tokenizada (el corazón del plan)

- Definir en `:root` una escala única. Propuesta inicial (los valores exactos se
  ajustan con verificación visual, la estructura no):

  ```css
  --fs-2xs: .62rem;  /* ≈10px — solo densidad extrema: chips/ticks de timeline */
  --fs-xs:  .68rem;  /* ≈11px — metadatos secundarios */
  --fs-sm:  .74rem;  /* ≈12px — labels y controles */
  --fs-md:  .8rem;   /* ≈13px — cuerpo */
  --fs-lg:  .9rem;   /* ≈14px — títulos de sección */
  --fs-xl:  1rem;    /* 16px — título principal */
  ```

- Barrido completo de `style.css`: todo `font-size` literal pasa al token más
  cercano **hacia arriba** (nunca se reduce un tamaño existente).
- Regla de piso: nada por debajo de `--fs-2xs`, y `--fs-2xs` solo dentro de
  `.professional-timeline`. Formularios e inspectores: mínimo `--fs-sm`.
- Los tamaños hoy en `.44–.58rem` (ticks de regla, chips, labels de pista,
  metadatos de clip) suben a `--fs-2xs`; revisar en zoom mínimo de timeline que
  no desborden los clips.

**Aceptación:** `grep -E 'font-size: *\.?[0-9]' src/style.css` solo devuelve
declaraciones con `var(--fs-`; ningún texto de UI por debajo de ~10px reales.

Archivos: `src/style.css` (único). **Estado: hecho** (`32869c7`). 91 literales
migrados, 0 restantes, 87 usos de `var(--fs-)`. Se conservaron los valores
propuestos: el piso real queda en 9.92px (`--fs-2xs: .62rem`), dentro del «~10px»
del criterio. Dos ajustes que la verificación visual obligó: la píldora del
banner demo pasó de `2.75rem` a `3rem` para absorber el nuevo mínimo sin
recortes, y los popovers de la timeline usan `--fs-xs` (no `--fs-2xs`) porque se
montan en `body`, fuera del alcance de la excepción de `.professional-timeline`.

## Lote 3 — Tokens de color completos + fuente única anti-FOUC

- **3.1 Tokens nuevos** en `:root` de `style.css`:
  - Clips de timeline: `--clip-background`, `--clip-character`, `--clip-dialogue`
    (hoy `#477ac8` / `#7759b8` / `#258a79`). Son vocabulario visual del producto.
  - Superficies del visor (oscuras **por decisión de producto**, no dependen del
    tema): `--stage-bg` (`#101827`), `--stage-bg-deep` (`#0c131d`),
    `--stage-text` (`#c8d5e8`), `--stage-text-strong` (`#f5fbff`),
    `--stage-muted` (`#9aabc0`).
  - Banner demo alternativo: `--ad-accent-alt` (`#8ca8ff`).
  - Lista blanca de literales que sí quedan: `#fff`/`#000` en contextos de
    contraste fijo (etiqueta sobre video, fondo de `<video>`), y `#111` dentro de
    los gradientes de clip (sombra neutra).
- **3.2 Reducir el bloque `<style>` de `index.html`** al mínimo crítico
  anti-FOUC: esqueleto del grid (`.app-shell`, `.topbar`, `.workspace`) + los
  tokens que ese esqueleto usa (`--bg`, `--surface`, `--border`, `--text`,
  `--muted`, `--accent`, `--timeline-height`, fuente). Marcar ambos bloques con
  comentarios `/* SYNC:critical-css — ver scripts/ui/check-critical-css.mjs */`.
- **3.3 Guardia automática.** Nuevo `scripts/ui/check-critical-css.mjs`: parsea el
  bloque inline de `index.html` y verifica que cada token declarado ahí exista en
  `style.css` con el mismo valor (tema oscuro). Exponer como
  `npm run ui:check-css`; sumarlo a `scripts/test-core.mjs` **solo si** ese
  archivo está limpio en `git status` (regla dura 9); si no, queda como script
  independiente hasta poder integrarlo.

**Aceptación:** cambiar un color de la paleta en `style.css` no requiere tocar
`index.html`, o la guardia falla avisándolo; `grep` de hex fuera de bloques de
tokens solo devuelve la lista blanca.

Archivos: `src/style.css`, `index.html`, `scripts/ui/check-critical-css.mjs`
(nuevo), `package.json` (script). **Estado: hecho** (`ff03a16`). Hex fuera de
tokens y lista blanca = 0. `test-core.mjs` estaba limpio, así que `ui:check-css`
se integró directo a `npm test`. De paso se unificaron tres hex casi idénticos
que eran el mismo color con distinto redondeo (`#101823`/`#111827` → `--stage-bg`,
`#f7fbff` → `--stage-text-strong`). Probada en negativo: alterar un token del
bloque inline hace fallar la guardia con código 1.

## Lote 4 — Patrón único de tabs

- Hoy existen tres estilos reales repartidos en cinco clases:
  **segmentadas** (`.director-page-tabs`, `.character-mode-tabs`),
  **subrayadas** (`.proposal-tabs`) y **fantasma** (`.source-tabs`,
  `.resource-tabs`). Unificar en un componente CSS único:

  ```html
  <div class="tabs" data-variant="segmented|underline|ghost" role="tablist">
    <button class="tab is-active" role="tab" aria-selected="true">…</button>
  </div>
  ```

- Migración por grupo (un commit puede cubrir varios): agregar las clases nuevas
  en `index.html` y en los módulos TS que togglean estado
  (`director/panel.ts`, `project/panel.ts`, `project/library.ts`, `viewer.ts`,
  `character-creator.ts`), retirar las reglas viejas de `style.css` cuando nadie
  las use. **Los IDs no cambian** (regla dura 2).
- ARIA y teclado completos en los cinco grupos: `role="tab"`, `aria-selected`,
  `aria-controls` donde exista panel, y navegación con flechas (roving tabindex)
  implementada una sola vez en un helper `src/ui/tabs.ts`.

**Aceptación:** una sola definición de estilos de tab en `style.css`; los cinco
grupos navegables por teclado; sin regresión visual en ambos temas.

Archivos: `src/style.css`, `index.html`, `src/ui/tabs.ts` (nuevo), módulos TS
listados. **Estado: hecho** (`606a287`). Una sola definición de estilos de tab;
los cinco grupos con `role="tab"`, `aria-selected` y `aria-controls`, navegables
con flechas/Home/End. `director/panel.ts` ya estaba commiteado por el otro
carril, así que no hizo falta coordinar.

Nota de implementación: el helper no toma la propiedad de la selección. Cada
módulo sigue siendo dueño de su `is-active`/`aria-selected`; `tabs.ts` solo
aporta el teclado y mantiene el roving `tabindex` observando `aria-selected` con
un `MutationObserver`. Así la migración no tocó la lógica de estado de ningún
módulo. Las tabs del modo de personaje convergieron al estilo `segmented` del
Director (antes eran un cuarto estilo, con fondo de acento).

## Lote 5 — Organización de `style.css`

- Estructurar el archivo con `@layer tokens, base, layout, components, overrides`
  (o, si `@layer` complica el diff, secciones comentadas con índice al inicio).
  Orden por área: tokens → base → shell/topbar → banners → Director → visor →
  inspector/biblioteca → creador de personajes → timeline → modales → responsive.
- Eliminar los overrides a distancia: las variantes compactas del inspector
  dentro del Director (`.director-page .inspector-*`) pasan a una clase
  modificadora explícita (`.inspector-group.is-compact`) aplicada por el módulo
  que monta el inspector en el Director.
- **Cero cambios visuales**: capturas antes/después en ambos temas como
  verificación; el diff debe ser reordenamiento + renombres controlados.

**Aceptación:** índice de secciones al inicio del archivo; ningún selector
`.director-page .inspector-*`; capturas idénticas.

Archivos: `src/style.css`, `src/ui/project/panel.ts` (aplicar modificador).
**Estado: hecho** (`bb782bc`). 14 secciones con índice al inicio; cero selectores
`.director-page .inspector-*`. La equivalencia visual se verificó con dos pruebas
en vez de capturas: las 419 reglas del archivo son idénticas antes y después
(solo cambia el orden), y 745 elementos × 20 propiedades computadas no registran
ninguna diferencia. Se optó por secciones comentadas en lugar de `@layer`, que
habría cambiado la cascada. Se retiraron además `.inspector-actions` e
`.inspector-inline-fields`: ningún módulo TS ni el HTML crean esas clases.

## Lote 6 — Iconografía SVG

- Sprite inline al inicio de `<body>` (`<svg hidden><symbol id="icon-…">`) con
  ~12 iconos de trazo simple: play, clip anterior/siguiente, undo, redo, snap,
  teclado, zoom +/−, ajustar, flechas de colapso (4 direcciones), configuración,
  cerrar.
- Reemplazar los glifos de texto en botones por `<svg><use href="#icon-…"/></svg>`
  con `fill="currentColor"`, conservando los `aria-label` existentes. Los
  caracteres que sí son texto (M de mute, «Duplicar», «Eliminar») no cambian.

**Aceptación:** sin caracteres de dibujo (`◀ ▶ ⚙ ↶ ⌑ ⌨ ▼ ▲ ×`) en botones;
mismos tamaños de botón; los iconos heredan color de tema.

Archivos: `index.html`, `src/style.css`, módulos TS que crean botones dinámicos
(`timeline.ts` si aplica). **Estado: hecho** (`8e57013`, corregido en `5c77005`).
16 símbolos, 20 usos; cero caracteres de dibujo en botones. Los iconos miden
`1.15em`, heredan `currentColor` en ambos temas y los botones conservan su
tamaño (29×29 en la timeline, 38×38 en los `icon-button`).

Dos cosas que el plan no anticipaba:
- El botón de transporte alternaba su `textContent` entre play y pausa, lo que
  habría borrado el SVG. Se agregó `ui-icon-pause` y `syncPlayButton` cambia el
  `href` del `<use>`.
- El sprite se llama `ui-icon-*`, no `icon-*`: `playback.ts` ya buscaba
  `#icon-play` e `#icon-pause` para el preview legacy y les aplicaba
  `style.display`. Aunque `initPlaybackUi` hoy no se invoca, reactivarlo habría
  ocultado el icono de play de toda la app. Lo detectó la guardia del L7.

Se mantienen como texto los caracteres que son texto (`M`, «Duplicar»,
«Eliminar», «Ajustar»), por la regla del propio lote. Quedan fuera del alcance,
por no ser botones: `◆` de la marca, `⌄`/`⌃` de los `summary` (pseudo-elementos
CSS), `◇` de los chips de transición y `♪`/`▧` de las miniaturas de recursos.

## Lote 7 — Mitigación del acoplamiento por IDs (opcional, al final)

- No es un rediseño: agregar a `scripts/ui/test-ui-modules.mjs` (o script nuevo
  bajo `ui:test-modules`) una verificación que extraiga los IDs referenciados en
  `src/ui/**` (`required('#…')`, `optional('#…')`, `getElementById`) y valide que
  todos existen en `index.html`. Convierte roturas de runtime en fallo de test.
- Si en el camino aparece un ID huérfano (referenciado pero inexistente, o
  declarado y nunca usado fuera de `.legacy-controls`), documentarlo en el commit.

**Aceptación:** el test falla si un ID usado por la UI desaparece de `index.html`.

Archivos: `scripts/ui/` (test). **Estado: hecho** (`5c77005`). Script propio
`scripts/ui/check-dom-ids.mjs` expuesto como `ui:check-ids` e integrado a
`npm test`; valida 188 referencias. Probado en negativo: renombrar
`#director-panel` hace fallar el test con código 1.

Criterios de diseño que el plan dejaba abiertos:
- Solo las referencias con `required()` hacen fallar. Las de `optional()` se
  reportan como aviso, porque ese helper existe justamente para degradar sin
  romper y convertirlas en error obligaría a mantener markup muerto.
- Se excluyen los IDs que la propia UI crea en runtime (`elemento.id = 'x'`,
  como `authoring-playhead`), que si no serían falsos positivos.

**IDs huérfanos encontrados** (11 avisos, ninguno rompe hoy): los controles del
preview legacy en `playback.ts` (`seek`, `viewer-play-btn`, `viewer-current`,
`viewer-duration`, `speed-btn`, `loop-btn`, `icon-play`, `icon-pause`) y en
`shortcuts.ts` (`loop-btn`); y `tool-undo`/`tool-redo` en `project/panel.ts`, hoy
servidos por `timeline-undo`/`timeline-redo`. `initPlaybackUi` no se invoca desde
ningún módulo. Se documentan aquí, no se eliminan: el preview legacy es
compatibilidad del otro carril (ver «Qué NO hace este plan»).

---

## Orden y dependencias

```
L1 (quick wins) → L2 (tipografía) → L3 (color + anti-FOUC) → L4 (tabs) → L5 (CSS) → L6 (iconos) → L7 (guardia IDs)
```

- L1–L3 son el corazón del saneamiento y no dependen entre sí más que por
  conveniencia de diff (L2 antes que L5 para no reordenar dos veces).
- El plan se puede pausar después de cualquier lote sin dejar la UI en estado
  intermedio: cada lote es autocontenido y verificable.
- L4 y L7 requieren coordinación con el otro carril si sus archivos siguen
  modificados sin commitear.

Ejecutado en ese orden, sin pausas. El orden resultó acertado en un punto no
previsto: la guardia de L7 detectó la colisión de IDs que había introducido L6.

## Qué NO hace este plan

- No reorganiza el layout ni las responsabilidades de las 5 áreas canónicas.
- No toca motor, contratos, esquemas ni scripts de pipeline.
- No cambia el copy ni el flujo del Director.
- No introduce frameworks, librerías de componentes ni de iconos.
- No elimina el preview legacy (`.legacy-controls`): sigue siendo compatibilidad
  del otro carril; solo se documenta.

## Verificación global al cierre

Ejecutada el 27-07-2026. Resultado: **todo verde**.

1. Guardias por grep, todas en cero: `font-size` literal fuera de `var(--fs-)`;
   hex fuera de tokens y lista blanca; `style="` en `index.html`; glifos de
   dibujo en botones; selectores `.director-page .inspector-*`; clases de tabs
   viejas.
2. `npx tsc --noEmit`, `npm test` (29 suites, incluidas las dos guardias nuevas),
   `npm run build`, `npm run ui:test-modules`, `npm run ui:check-css` y
   `npm run ui:check-ids`: verdes.
3. Revisión en `dev:web` sobre el proyecto real del usuario: ambos temas ×
   escritorio/1100px/720px, sin scroll horizontal del body ni desborde de la
   barra de la timeline en ningún breakpoint; el bloque
   `prefers-reduced-motion` conserva sus tres reglas y queda después de toda
   declaración de `animation` (regla 391 de 402), así que sigue ganando.
4. Este documento queda actualizado con el estado y las desviaciones de cada lote.

### Observaciones que quedan abiertas

- **`.dialogue-gap small`** (etiqueta de pausa entre diálogos) desborda su caja
  de 16px: es un label `position: absolute` con `nowrap`, y ya desbordaba antes
  del L2 (a `.44rem` el texto «0.3 s» tampoco entraba). No es regresión, pero al
  subir a `--fs-2xs` el label es ~40% más ancho y puede solaparse con clips
  vecinos en zoom mínimo. Candidato a revisar en un plan futuro.
- El piso tipográfico real es **9.92px**, no 10px exactos. Se respetó el valor
  `.62rem` que proponía el plan; subirlo a `.63rem` daría 10.08px si se quiere el
  piso estricto.
