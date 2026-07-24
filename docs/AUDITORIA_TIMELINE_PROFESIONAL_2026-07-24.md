# Auditoría de timeline profesional — 2026-07-24

## Alcance auditado

Timeline inferior de la aplicación local después del rediseño UX. Se revisaron contratos disponibles, interacción con proyecto editable, salida MP4, manifiestos, accesibilidad y atajos.

## Hallazgo original

El rediseño anterior reemplazó la timeline audiovisual por una representación estructural de escenas y diálogos. Aunque los datos eran reales, desaparecieron convenciones esenciales de un editor de video: regla, pistas, playhead, transporte y navegación temporal.

Conclusión: la sustitución fue incorrecta. La estructura editorial debía alimentar una timeline, no reemplazarla.

## Correcciones implementadas

- En autoría, una única superficie alineada divide **VISUAL** arriba y **AUDIO** abajo.
- Pistas visuales separadas para fondo y cada personaje; pistas de audio separadas por voz.
- Los clips de una misma escena comparten inicio y ancho editorial, de modo que fondo, personajes y diálogos se leen verticalmente como una composición.
- Regla temporal y timecode con milisegundos cuando existe duración medida.
- Playhead sincronizado con el `<video>` único del Editor.
- Seek mediante regla, pista o selección de clips.
- Zoom, ajuste al ancho y scroll horizontal.
- Snap magnético a inicios de clips medidos.
- Navegación al clip anterior/siguiente.
- Transporte y mute desde la timeline.
- Seguimiento automático del playhead durante reproducción.
- Undo/redo conectado al mismo `ProjectStore`.
- Selección sincronizada entre timeline, visor e inspector.
- Arrastre horizontal de escenas para reordenarlas mediante `reorder-scenes`.
- Duplicación y eliminación contextual de escenas, personajes o diálogos mediante comandos cerrados.
- Tecla Supr para eliminar la selección compatible.
- Atajos visibles: Espacio, J/K/L, flechas, Inicio/Fin, S, M, F, +/− y Ctrl+Z/Y.
- Las mismas pistas de autoría adoptan posiciones medidas cuando la exportación corresponde a la revisión vigente.
- Las exportaciones históricas siguen disponibles para reproducción y descarga, pero se identifican como anteriores.

## Veracidad temporal

Se mantienen dos modos explícitos:

1. **Sin medir**: proyecto editable todavía no renderizado. Los anchos organizan escenas y turnos para edición, pero no muestran segundos ni playhead.
2. **Medido**: exportación vigente. Los anchos y posiciones derivan de `durationSeconds`, `startSeconds` y `endSeconds` producidos por Piper/FFprobe y el ensamblador.

La UI no convierte conteo de palabras en una duración falsa.

## Herramientas deliberadamente no implementadas

- Cortar/dividir clips.
- Estirar duración.
- Arrastrar clips para cambiar tiempos.
- Crear pistas o medios nuevos.

El núcleo ya permite eliminar y reordenar estructura. Los recortes temporales y cambios de duración continúan bloqueados porque todavía no tienen representación compartida en preview y exportación.

## Verificación automática

- `npm run build`: TypeScript y Vite.
- `npm run local:test-render-manager`: 29 controles, incluida publicación de timeline medida y fundidos.
- `npm run local:test-server`: 26 controles de API local.

## Pruebas manuales sugeridas al usuario

1. Abrir **Editar video** y comprobar que las capas visuales están arriba y las voces abajo.
2. Seleccionar personajes y diálogos; comprobar el cambio coordinado en visor e inspector.
3. Arrastrar una escena sobre otra para reordenar y probar Duplicar/Eliminar.
4. Reproducir desde la timeline y comprobar que el visor usa el mismo Editor, sin abrir otra pestaña.
5. Volver a editar, modificar el proyecto y comprobar que la exportación se marca como anterior.
6. Probar Espacio, J/K/L, flechas, S, M, F y zoom.
