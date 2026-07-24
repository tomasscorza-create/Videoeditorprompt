# Etapa 3A.2 — render multiescena

Fecha: 22 de julio de 2026.

Estado: implementada y verificada técnicamente.

## Resultado

El proyecto de autoría compatible ya puede recorrer el circuito completo:

```text
video-project v1
  → compilación determinista
  → job aislado por escena
  → TTS, FFprobe, runtime y MP4 de cada escena
  → timeline medida
  → corte o fundido FFmpeg
  → MP4 final H.264/AAC
```

El pipeline padre está en `scripts/stage3a/project-pipeline.mjs`. No modifica el evaluador ni el pipeline canónico de una escena: crea raíces de trabajo y salida propias para cada escena y llama a `runPipeline` con su configuración v2 congelada.

## Contratos y artefactos

- `schema/rendered-project.schema.json` valida el manifiesto final.
- `compiled/compiled-project.json` conserva proyecto, hashes y configuraciones compiladas.
- `scene-work/<sceneJobId>/` conserva input, runtime y evidencia de cada subtrabajo.
- `scene-output/<sceneJobId>/` conserva los MP4 verificados por escena.
- `project-manifest.json` registra timeline, duraciones, transiciones, hashes y outputs finales.
- `verification.json` conserva los controles FFprobe y de determinismo.

Todas las rutas persistidas son relativas al job padre. Las transiciones admitidas siguen siendo un catálogo cerrado: `cut` y `fade`.

## Duración y determinismo

La duración de cada escena procede del audio real preparado y del MP4 medido. El ensamblaje usa la duración de frames a 30 fps; un fundido solapa ambas escenas durante su duración declarada. No se estima duración desde texto ni se acumulan deltas.

El piloto `proyecto-compilable-01` produjo:

- escena 1: 7,2 s de render;
- escena 2: 6,833333333 s de render;
- fundido: 0,35 s;
- timeline calculada: 13,683333333 s;
- duración FFprobe del MP4: 13,7 s;
- salida: 1080 × 1920, 30 fps, H.264, AAC mono 22050 Hz, `yuv420p`;
- dos ensamblajes de 1.715.571 bytes con SHA-256 idéntico `bf4084fc6098bda8d5584335d1817842f79fde303e4348e88805adb4490b2bf9`.

Cada escena aprobó además los 54 controles del pipeline canónico.

## Pruebas ejecutadas

- `npm run stage3a:test-assembly`: 5/5; fundido, corte, combinación, límite de duración y proyecto vacío.
- `npm run stage3a:test-compiler`: 11/11.
- `npm run stage3a:project-pipeline`: 11/11 controles finales, dos escenas y determinismo binario.
- `npm run build`: TypeScript y Vite correctos.

Se eligió nivel 4 porque se añadió un orquestador, un contrato de artefactos y una exportación completa. La prueba real incluye TTS/cache, FFprobe, dos renders por escena, FFmpeg final y repetición del ensamblaje.

## Incidencia detectada

El primer recorrido reveló que `slow-zoom` no producía desplazamiento horizontal y por ello no demostraba la separación de planos exigida por el verificador de parallax. El preset conserva su zoom y ahora añade un paneo horizontal mínimo de −2 a 2 píxeles. No se relajó el control existente.

## Límites vigentes

- El runtime y preview PixiJS continúan evaluando una escena; la multiescena es una composición headless de subtrabajos.
- No hay editor, guardado desde UI ni preview continuo de la timeline final.
- Cada escena sigue limitada al subconjunto v2 que compila 3A.1: dos personajes, al menos dos turnos y transforms compatibles.
- No existen keyframes libres, pistas arbitrarias ni transiciones aportadas como filtros FFmpeg.
- Siguen pendientes cancelación/timeouts, locking concurrente, retención y validación Linux antes de operar online.

## Próximo paso recomendado

Construir un editor local mínimo sobre `video-project` v1: abrir/crear proyecto, listar escenas, elegir recursos por ID, editar texto/voz/posición/escala y lanzar validación/render. Debe usar el catálogo real y mantener el pipeline headless separado; todavía no necesita timeline profesional, Electron ni IA directora.
