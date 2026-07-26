# Plan de arreglo: carga lenta de la UI y regresión de voces

> Auditoría del 2026-07-26. Ejecutar **después** de que termine el plan de migración
> y base de datos en curso — los pasos 2 y 3 tocan `.local-video/` y el almacenamiento
> de proyectos, que ese plan puede estar reestructurando. Los pasos 1, 4 y 5 no
> tocan almacenamiento y pueden aplicarse en cualquier momento.
>
> Complemento: `docs/PLAN_LIMPIEZA_Y_ANTIBASURA.md` contiene el inventario de basura
> del repo (~600 MB regenerables), el borrado inmediato y los cambios para que tests
> y renders dejen de producir residuos. Conviene ejecutar su Fase 1 antes del paso 1
> de este plan.

## Diagnóstico (resumen)

La app en caliente es rápida (UI completa con proyecto en ~1,5 s; API < 15 ms; sin
tareas largas de JS — medido en vivo). La demora de 1-2 minutos está en el **arranque
en frío de `npm run dev`** y crece con el tiempo por datos acumulados:

- Vite no tiene `server.watch.ignored`, así que su watcher escanea **25.578 archivos**
  al arrancar (medido: 0,9 s con cachés calientes; en frío, Windows Defender multiplica
  ese costo 10-50×). La mayoría son datos regenerables: `.local-video/tests` (15.038
  archivos, 349 MB, **nadie los limpia** — la retención solo barre `.local-video/work`),
  `tts-test` (7.761 archivos), `dist`, `temp`, `public/generated`, `.claude/worktrees`.
- `index.html` no enlaza CSS: todo el estilo llega vía `import './style.css'` en
  `src/main.ts` → los "botones simplificados" son el HTML sin estilo (FOUC) mientras
  el grafo de módulos + pixi.js termina de servirse.
- `src/main.ts` arranca en cada carga el preview legacy de Pixi (WebGL + texturas +
  ~470 KB de audio del piloto) hacia una vista oculta que nunca se muestra.
- Regresión de voces: al quitar `voz-daniela-ar-v1` del catálogo, **10 de 20 proyectos
  guardados** y el proyecto publicado por defecto (`proyecto-compilable-01`) quedaron
  inabribles: `"El recurso debe existir y ser de tipo voice"`. Además, si la sesión
  restaurada falla, `src/ui/project/persistence.ts` borra la sesión de localStorage
  en silencio.

Descartado empíricamente: el token aleatorio de `dev.mjs` NO invalida la caché de
dependencias de Vite; el servidor API arranca en ~0,5 s y no es el cuello de botella.

---

## Paso 1 — Excluir carpetas de datos del watcher de Vite (mayor impacto, 5 min)

Editar `vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4174',
    },
    watch: {
      ignored: [
        '**/.local-video/**',
        '**/.local-video-library/**',
        '**/tts-test/**',
        '**/temp/**',
        '**/dist/**',
        '**/output/**',
        '**/.claude/**',
        '**/scratch/**',
        // Publicaciones regenerables: servidas como estáticos, no necesitan HMR.
        '**/public/generated/**',
        '**/public/projects/**',
      ],
    },
    // Pre-transforma el grafo de la app apenas arranca el server, antes del primer request.
    warmup: { clientFiles: ['./src/main.ts'] },
  },
  // pixi.js se pre-empaqueta siempre de entrada (evita el descubrimiento tardío).
  optimizeDeps: { include: ['pixi.js'] },
});
```

Nota: `public/generated` y `public/projects` se publican con archivos nuevos (no se
editan in-place), así que perder HMR ahí no afecta el flujo; la UI ya usa `?v=` como
cache-buster.

**Verificar:** `npm run dev`, abrir la app y confirmar que sigue cargando proyectos,
galería de renders y catálogo. Editar `src/style.css` y confirmar que el HMR sigue vivo.

## Paso 2 — Limpiar `.local-video/tests` y sumarlo a la retención (⚠ coordinar con la migración)

1. Borrar el residuo actual (regenerable, 349 MB / 15.038 archivos):
   `.local-video/tests` completo. Verificar antes que ningún test esté corriendo.
2. En `scripts/local-app/retention.mjs`, extender `runStartupRetention` (o
   `cleanLocalVideo`) para que también aplique la política de edad/tamaño sobre
   `.local-video/tests` y `.local-video/persistence-bundles` (48 MB hoy), no solo
   sobre `work/`. Mantener la regla existente: nunca tocar MP4 finales ni trabajos
   activos, y jamás lanzar una excepción que impida levantar el servidor.
3. Revisar por qué los tests dejan residuos: idealmente cada test limpia su carpeta
   al terminar (`scripts/**/test-*.mjs` escriben en `.local-video/tests`).

**Verificar:** `npm test` y luego confirmar que `.local-video/tests` no crece sin
límite entre corridas.

## Paso 3 — Migrar la voz eliminada `voz-daniela-ar-v1` (⚠ coordinar con la migración)

Elegir una voz de reemplazo del catálogo activo (`voz-ald-mx-v1`, `voz-claude-mx-v1`,
`voz-sharvard-es-v1`, `voz-davefx-es-v1`) y:

1. **Proyectos guardados**: migrar los archivos en
   `%LOCALAPPDATA%\DisenadorVideosLocal\projects\*.json` reemplazando
   `"voz-daniela-ar-v1"` por la voz elegida (10 de 20 archivos la referencian).
   Si el plan de base de datos mueve este almacenamiento, hacer la migración como
   parte de ese movimiento (una pasada de re-escritura con el mapeo de voces).
2. **Proyecto publicado**: `pilots/proyecto-compilable-01/project.json` también la
   referencia; actualizarlo y republicar con `npm run stage3b:publish-project` para
   regenerar `public/projects/`.
3. **Robustez a futuro** (evita repetir esta clase de rotura): en la carga de
   proyectos de la UI (`shared/project-editor.js` / `src/ui/project/store.ts`),
   cuando un `voiceId` no exista en el catálogo, degradar con aviso (ej.: sustituir
   por una voz por defecto y marcar el diálogo) en lugar de rechazar el proyecto entero.
4. **No perder la sesión en silencio**: en `src/ui/project/persistence.ts`,
   `restoreSession` hace `localStorage.removeItem` cuando la restauración falla.
   Cambiarlo para conservar la sesión y mostrar el motivo del fallo, o al menos
   guardar un respaldo antes de borrarla.

**Verificar:** abrir cada proyecto desde "Mis proyectos" (los 10 afectados) y abrir
la app en una ventana privada (sin sesión) — el editor debe inicializar sin
`"El recurso debe existir y ser de tipo voice"` en consola.

## Paso 4 — No arrancar el preview legacy de Pixi en cada carga (10 min)

En `src/main.ts`, `start()` siempre descarga `scene.config.json` + `scene-runtime.json`
y levanta una Application de Pixi (WebGL, texturas, audio) hacia `#preview-view`, que
está oculto y no se usa: `initEditorUi(handle)` descarta el handle. Convertirlo en
carga perezosa (solo si la vista legacy se muestra) o eliminarlo del arranque si ya
nadie lo consume. Ojo: `scripts/ui/test-ui-modules.mjs` y los tests de stage pueden
depender del contrato — correr `npm run ui:test-modules` y `npm test` después.

## Paso 5 — Reducir el FOUC de los "botones simplificados" (15 min)

Extraer a `index.html` un bloque `<style>` mínimo con el layout base (app-shell,
topbar, tipografía, colores de fondo) o enlazar `src/style.css` como `<link>` además
del import, para que el primer render no muestre HTML pelado aunque el grafo de
módulos tarde. Mantener el `import './style.css'` para el HMR.

## Paso 6 — Del lado del sistema (requiere admin, opcional pero muy efectivo)

Agregar una exclusión de Windows Defender para la carpeta del proyecto (o como mínimo
`node_modules` y `.local-video`): Seguridad de Windows → Protección antivirus →
Exclusiones. Verificado en la auditoría: la protección en tiempo real está activa y
escanea cada primer acceso a archivo en frío, que es el multiplicador principal del
arranque lento.

---

## Cómo medir el resultado

Antes y después, con la máquina "fría" (tras reiniciar o al primer arranque del día):

1. Cronometrar desde `npm run dev` hasta que la UI se ve completa y estilada.
2. En la consola del navegador (F12 → pestaña Red): el tiempo del último módulo de
   `/src/` y de los chunks de `/node_modules/.vite/deps/`.

Objetivo razonable tras los pasos 1, 2 y 6: **menos de 10 segundos** de arranque en
frío, estable en el tiempo (sin crecer con la cantidad de renders/tests acumulados).
