# Etapa 2B — Selector de trabajos y previews

Fecha de cierre técnico: 22 de julio de 2026.

## Resultado

La Etapa 2B quedó implementada y verificada. Vite/PixiJS ya no depende de una única publicación plana: cada trabajo se publica bajo su `jobId`, existe un índice local reutilizable y la interfaz permite cambiar entre trabajos sin volver a generar voz, frames o MP4.

El piloto de los monos quedó como trabajo predeterminado y el ejemplo técnico anterior continúa disponible.

URLs verificadas:

```text
http://localhost:5173/?job=piloto-monos-mundial-01
http://localhost:5173/?job=preview
```

No se agregaron editor, React, Electron, personajes nuevos, voces, escenas, timeline ni cambios al evaluador temporal.

## Estructura de publicación

`--publish-dir` representa ahora la raíz de publicación. El adaptador crea una subcarpeta confinada por `jobId`:

```text
public/generated/
├── index.json
├── piloto-monos-mundial-01/
│   ├── preview-manifest.json
│   ├── scene.config.json
│   ├── scene-runtime.json
│   ├── audio/
│   ├── mouth/
│   ├── subtitle/
│   └── video.mp4
└── preview/
    ├── preview-manifest.json
    ├── scene.config.json
    ├── scene-runtime.json
    ├── audio/
    ├── mouth/
    ├── subtitle/
    └── video.mp4
```

Al republicar un job:

- se valida que su destino esté dentro de `publish-dir`;
- se limpia únicamente su subcarpeta;
- no se toca ninguna otra publicación;
- se copian config, runtime y derivados de preview;
- si existe `render-1.mp4`, se publica como `video.mp4`;
- se escribe `preview-manifest.json`;
- se actualiza `index.json` y el job recién publicado pasa a ser el predeterminado.

La publicación sigue siendo un adaptador local. Los resultados canónicos permanecen en el output aislado del job.

## Contrato del índice

Ejemplo real resumido:

```json
{
  "version": 1,
  "defaultJobId": "piloto-monos-mundial-01",
  "jobs": [
    {
      "jobId": "piloto-monos-mundial-01",
      "state": "completed",
      "durationSeconds": 11.342948,
      "previewPath": "piloto-monos-mundial-01/",
      "videoPath": "piloto-monos-mundial-01/video.mp4",
      "verificationPassed": 30,
      "deterministic": true
    }
  ]
}
```

Todas las rutas son relativas. El frontend valida el formato del `jobId`, busca coincidencia exacta en el índice y solo entonces construye la URL de carga.

## Interfaz

La página incorpora:

- selector nativo de trabajos publicados;
- selección inicial por `?job=<jobId>`;
- fallback al `defaultJobId` del índice;
- actualización de la URL al cambiar de trabajo;
- estado, duración, verificaciones y determinismo;
- enlace de descarga al MP4 publicado;
- play, pausa y reinicio existentes;
- canvas PixiJS alimentado por la config/runtime del job seleccionado;
- mensaje explícito para un `jobId` inexistente;
- fallback de lectura al formato plano legacy cuando todavía no existe `index.json`.

Cambiar de trabajo recarga la página deliberadamente. Esto reinicia audio, canvas y caché de PixiJS, evitando mezclar recursos del job anterior y manteniendo la implementación simple.

## Comandos

Publicar un trabajo ya renderizado sin repetir el pipeline:

```powershell
node scripts/stage1/publish-preview.mjs `
  --job-id piloto-monos-mundial-01 `
  --config pilots/monos-mundial-01/scene.config.json `
  --assets-dir public `
  --publish-dir public/generated
```

Ejecutar el pipeline canónico y publicar automáticamente:

```powershell
npm run stage1:pipeline
```

Probar el contrato de publicación:

```powershell
npm run stage2b:test-preview
```

## Archivos creados

- `scripts/stage1/test-preview-publishing.mjs`
- `ETAPA_2B_SELECTOR_PREVIEWS_RESULTADOS.md`

## Archivos modificados

- `scripts/stage1/job-context.mjs`
- `scripts/stage1/publish-preview.mjs`
- `src/main.ts`
- `src/style.css`
- `index.html`
- `package.json`
- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/PLAN_DESPUES_PILOTO_01.md`

No se añadieron dependencias.

## Pruebas realizadas

Se utilizó Nivel 3 porque cambiaron publicación, pipeline y consumo del preview, pero no el contrato temporal ni la arquitectura completa del motor.

### Build

```powershell
npm run build
```

Resultado: TypeScript estricto y Vite aprobados; 710 módulos transformados.

### Publicación aislada

```powershell
npm run stage2b:test-preview
```

Resultado: 10 controles aprobados, 0 fallidos.

- raíces por job distintas;
- destinos dentro de la raíz permitida;
- índice con ambos jobs;
- último job como predeterminado;
- configuraciones preservadas;
- archivos de preview y MP4 presentes;
- hash del MP4 idéntico al output canónico;
- primer job conservado al publicar el segundo;
- manifiestos sin rutas absolutas;
- metadata determinista;
- derivado obsoleto del mismo job retirado al republicar.

Evidencia: `.local-video/test-results/preview-publishing-latest.json`.

### Pipeline completo

```powershell
npm run stage1:pipeline
```

Resultado: 147 frames, dos renders, 30 verificaciones y `deterministic: true`. La nueva publicación por subcarpeta funcionó desde el orquestador canónico.

### Navegador local

La interfaz fue probada en `localhost:5173` mediante el navegador integrado:

- sin query, redirige lógicamente al job predeterminado y añade su query a la URL;
- `piloto-monos-mundial-01` carga un canvas, 11,34 s, 30 verificaciones y su MP4;
- el selector cambia a `preview`;
- `preview` carga un canvas, 4,90 s, 30 verificaciones y su MP4;
- Reproducir cambia el estado de audio a `Reproduciendo`;
- `?job=no-existe` informa los dos jobs disponibles;
- el navegador quedó abierto en el piloto.

## Compatibilidad conservada

- El pipeline sigue siendo headless y no necesita Vite.
- `publishPreview` sigue siendo opcional.
- Preview y exportación continúan usando `shared/scene-evaluator.js`.
- El audio continúa siendo el reloj del preview.
- Config, runtime y manifests siguen usando rutas relativas.
- Los argumentos de procesos externos y `shell: false` no cambiaron.
- La publicación plana anterior puede leerse como fallback si aún no existe índice.

## Riesgos pendientes

- `index.json` no tiene locking ni escritura coordinada para publicaciones concurrentes.
- `public/generated` puede conservar archivos planos legacy anteriores; el selector indexado los ignora.
- Copiar MP4 a la publicación duplica espacio en disco; es aceptable para el uso local actual.
- El índice es local y regenerable; todavía no existe almacenamiento abstracto o remoto.
- No hay eliminación desde la interfaz ni política de retención.
- El selector es un visor, no un editor.

## Siguiente gate

La Etapa 2B puede considerarse aprobada técnicamente. El siguiente objetivo recomendado es la Etapa 2C: un personaje real por capas con boca, parpadeo, idle y al menos un gesto de manos visible en preview y exportación.
