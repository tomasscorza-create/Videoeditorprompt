# Gate integrado de capacidades creativas V1

Fecha: 28 de julio de 2026

Proyecto: `pilots/gate-capacidades-v1/project.json`

Job: `gate-capacidades-v1-render`

Estado técnico: **aprobado en modo interactivo de una pasada**

Estado humano: **pendiente de revisión visual y auditiva del usuario**

## Objetivo

Producir un único video corto que fuerce el recorrido conjunto de la mayor
cantidad posible de capacidades actualmente renderizables. Este gate integrado
no reemplaza el requisito de la Fase 7 de evaluar tres videos separados; sirve
como prueba transversal y como referencia para construirlos.

## Cobertura

| Área | Cobertura del piloto |
| --- | --- |
| Proyecto | Dos escenas editables y ensambladas |
| Backends | Escena 1 con PixiJS; escena 2 con FFmpeg overlay |
| Recursos | Rig v3 articulado, tres rigs v2 y un prop v3 |
| Fondo | Tres capas con `slow-pan` y `slow-zoom` |
| Transición | Fundido de 0,45 s con `xfade` y `acrossfade` |
| Audio | Cuatro voces Piper, cinco turnos, pausas y tres ritmos |
| Música | `musica-brillante-v1` con loop y ducking del runtime |
| Diálogo | Cinco gestos y cinco layouts dinámicos |
| Subtítulos | Texto por turno sincronizado con WAV medido |
| Movimiento base | `idle-calm` y `talk-calm` |
| Keyframes | `position.x`, `position.y`, `scale`, `rotationDegrees`, `opacity` y `armRaise` |
| Procedencia | Presets intactos, preset personalizado y pistas manuales |
| Presets | Entrada izquierda/derecha, aparecer, desaparecer, énfasis y brazo |
| Anclas | Inicio/final de escena, inicio de turno y palabra |
| Interpolación | `linear`, `ease` y `hold` |

## Evidencia del render

- Duración final: 18,4 s.
- Resolución: 1080 × 1920.
- Cadencia: 30 fps.
- Frames por escena: 315 PixiJS + 250 FFmpeg.
- Video: H.264, `yuv420p`.
- Audio: AAC mono, 22.050 Hz.
- Tamaño: 2.165.658 bytes.
- SHA-256: `2ceb77e4290678c9bfa2d4790506771dd4fd1e53007736b385659a25abaf9b89`.
- Verificación: 9 aprobadas, 0 fallos.
- Inicio del pipeline: 18:02:44.
- Fin del pipeline: 18:05:13.
- Tiempo aproximado del render interactivo: 2 min 29 s.

El modo interactivo ejecutó una sola pasada, por lo que el manifiesto marca
`deterministic: false`: significa «no comparado contra una segunda pasada», no
que haya detectado una diferencia. La suite automatizada conserva las pruebas de
doble ejecución y frames dorados.

## Artefactos locales

- Proyecto editable: `pilots/gate-capacidades-v1/project.json`
- MP4: `.local-video/output/gate-capacidades-v1-render/render-1.mp4`
- Manifiesto: `.local-video/output/gate-capacidades-v1-render/project-manifest.json`
- Verificación: `.local-video/output/gate-capacidades-v1-render/verification.json`
- Contact sheet: `.local-video/output/gate-capacidades-v1-render/contact-sheet.png`

## Revisión humana solicitada

1. ¿La entrada de ambos personajes se entiende y se siente fluida?
2. ¿El brazo se eleva en una palabra razonable del primer diálogo?
3. ¿El cartel aparece, pulsa y rota sin distraer del diálogo?
4. ¿El fundido entre backends conserva continuidad visual y sonora?
5. ¿Música, voces y subtítulos mantienen buena legibilidad?
6. ¿Algún movimiento se siente demasiado rápido, fuerte o mecánico?
