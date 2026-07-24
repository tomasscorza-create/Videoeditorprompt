# Auditoría de timeline profesional — 2026-07-24

## Alcance auditado

Timeline inferior de la aplicación local después del rediseño UX. Se revisaron contratos disponibles, interacción con proyecto editable, preview PixiJS medido, MP4 final, manifiestos, accesibilidad y atajos.

## Hallazgo original

El rediseño anterior reemplazó la timeline audiovisual por una representación estructural de escenas y diálogos. Aunque los datos eran reales, desaparecieron convenciones esenciales de un editor de video: regla, pistas, playhead, transporte y navegación temporal.

Conclusión: la sustitución fue incorrecta. La estructura editorial debía alimentar una timeline, no reemplazarla.

## Correcciones implementadas

- Superficie permanente con pistas `V1 Video` y `A1 Diálogo`.
- Regla temporal y timecode con milisegundos cuando existe duración medida.
- Playhead sincronizado con el audio del preview y el `<video>` del MP4.
- Seek mediante regla, pista o selección de clips.
- Zoom, ajuste al ancho y scroll horizontal.
- Snap magnético a inicios de clips medidos.
- Navegación al clip anterior/siguiente.
- Transporte y mute desde la timeline.
- Seguimiento automático del playhead durante reproducción.
- Undo/redo conectado al mismo `ProjectStore`.
- Atajos visibles: Espacio, J/K/L, flechas, Inicio/Fin, S, M, F, +/− y Ctrl+Z/Y.
- Clips de video, audio y overlays de transición para el MP4 multiescena.
- Recuperación de timeline desde manifiestos de renders históricos cuando están disponibles.

## Veracidad temporal

Se mantienen dos modos explícitos:

1. **Sin medir**: proyecto editable todavía no renderizado. Los anchos organizan escenas y turnos para edición, pero no muestran segundos ni playhead.
2. **Medido**: preview o MP4. Los anchos y posiciones derivan de `durationSeconds`, `startSeconds` y `endSeconds` producidos por Piper/FFprobe y el ensamblador.

La UI no convierte conteo de palabras en una duración falsa.

## Herramientas deliberadamente no implementadas

- Cortar/dividir clips.
- Eliminar escenas o turnos.
- Estirar duración.
- Arrastrar clips para cambiar tiempos.
- Crear pistas o medios nuevos.

El núcleo actual no ofrece comandos semánticos seguros para esas acciones. Mostrar esos botones como si funcionaran produciría proyectos inválidos o una segunda fuente de verdad.

## Verificación automática

- `npm run build`: TypeScript y Vite.
- `npm run local:test-render-manager`: 29 controles, incluida publicación de timeline medida y fundidos.
- `npm run local:test-server`: 26 controles de API local.

## Pruebas manuales sugeridas al usuario

1. Abrir **Composición** y seleccionar escenas/turnos desde V1/A1.
2. Abrir **Preview medido**, reproducir y hacer seek sobre un turno.
3. Abrir un **MP4 final**, comprobar escenas, audio, fundidos y seguimiento del playhead.
4. Probar Espacio, J/K/L, flechas, S, M, F y zoom.
5. Cambiar de escena, deshacer y rehacer desde la barra inferior.
