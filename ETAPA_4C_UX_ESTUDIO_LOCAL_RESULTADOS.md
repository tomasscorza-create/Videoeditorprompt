# Etapa 4C — UX del estudio local

## Resultado

La interfaz local dejó de ser una suma de paneles desconectados y ahora usa un workspace coherente:

- Director IA a la izquierda, con tono, duración objetivo y cantidad de escenas como restricciones reales del esquema de Ollama.
- Viewer central con fuentes explícitas: composición estática del proyecto, preview medido publicado y MP4 final.
- Biblioteca e inspector a la derecha, con miniaturas, tags, licencias, aplicación por clic y secciones plegables.
- Timeline inferior derivada de las escenas y turnos reales del proyecto. No presenta estimaciones como duraciones medidas.
- Galería de videos alimentada por `/api/render-jobs`; `public/generated` conserva únicamente su función de publicación de previews.
- Persistencia local versionada del proyecto y último job, invalidada cuando cambia la revisión del catálogo.
- Salud periódica, progreso por etapas, errores con código y acción sugerida, cancelación, Ctrl+Z/Ctrl+Y y layout responsive.

La composición estática es deliberadamente una proyección de autoría. No duplica el compilador ni el evaluador temporal y no intenta simular voz, boca o duración.

## Verificación

- `npm run director:test-ollama`: 17 controles.
- `npm run local:test-server`: 26 controles.
- `npm run stage3b:test-editor`: 11 controles.
- `npm run build`: TypeScript y Vite correctos.
- Navegador local a 1280 × 720 y 700 × 900:
  - restauración de sesión después de recargar;
  - composición con fondo y dos personajes;
  - apertura de MP4 desde la galería persistida;
  - selección de escena desde la timeline;
  - aplicación de recurso y deshacer;
  - inspector plegable;
  - parámetros editoriales seleccionables;
  - sin overflow horizontal ni errores de consola.

## Límites preservados

- No se agregaron escenas, elementos o turnos desde la UI.
- No se implementó drag-and-drop.
- No se creó un preview PixiJS multiescena continuo.
- La duración real sigue proviniendo exclusivamente del audio medido por FFprobe.
