# Fases 2–9 — Montaje profesional V2

Estado: **implementado y verificado para proyectos nuevos**.

## Resultado

El documento de clips V2 vive como adaptador durable dentro de la timeline única; ya no existe un espacio visual `Montaje` separado. La autoría semántica conserva personajes, props, plantillas y voces, mientras los medios libres comparten el mismo cabezal y la misma superficie temporal. Desde `Archivos` se puede seleccionar o arrastrar MP4, MOV, WebM, WAV, MP3, OGG o M4A: FFprobe mide la fuente, SHA-256 la deduplica y un lote atómico crea los clips A/V enlazados al final de la timeline activa. La importación no genera MP4 ni vuelve a sintetizar voces.

La biblioteca de originales es local y compartida, pero el documento de clips y su revisión se guardan por ID de proyecto. Los formatos que el navegador no puede decodificar reciben un proxy MP4 o WAV solo para preview; la exportación sigue usando el original. Si los medios superan la duración semántica, el ensamblador extiende el resultado final de forma determinista.

## Cierre por fase

- **Fase 2 — adopción:** repositorio V2 durable con revisión SHA-256 y conflicto optimista. Los proyectos anteriores no se migran porque el usuario autorizó crear montajes nuevos.
- **Fase 3 — clips reales:** escenas renderizadas y medios importados crean clips visuales y de audio; el A/V relacionado comparte `linkGroupId` y las operaciones enlazadas preservan sincronía.
- **Fase 4 — voz:** el WAV medido se importa una vez como fuente inmutable. Cortar, mover, recortar, duplicar o borrar no vuelve a sintetizar la voz.
- **Fase 5 — ingest:** carga por streaming con límite de 2 GB, FFprobe, duración real, deduplicación por contenido y objetos locales portables.
- **Fase 6 — interfaz:** `Recursos / Edición / Archivos` en el panel derecho, picker múltiple, dropzone, filtros, reutilización de fuentes y pistas fijas V1/V2/A1/A2 con tijera, trim, arrastre, selección múltiple, snap, zoom, ripple, duplicado, borrado y undo/redo.
- **Fase 7 — preview:** un solo reloj `performance.now()` gobierna cabezal, video y audio; buscar y editar no genera frames ni MP4.
- **Fase 8 — exportación:** FFmpeg se ejecuta solo al pulsar exportar. Cada región fuente se cachea por hash; mover un clip reutiliza el segmento y una composición idéntica reutiliza el MP4 completo.
- **Fase 9 — endurecimiento:** schemas cerrados, comandos atómicos, persistencia por revisión, pruebas con medios reales, rutas HTTP, caché y una carga determinista de 500 clips más 100 cortes.

## Límite intencional

Los medios libres no separan retrospectivamente un MP4 ya compuesto en personajes con transparencia. Para editar por separado un personaje, prop o plantilla se modifica el elemento semántico. Tampoco incluye multicámara, corrección de color, plugins, timelines anidadas, thumbnails, formas de onda ni arrastre interno desde la biblioteca hacia un tiempo exacto.

## Gate reproducible

```powershell
npm run timeline:test-clip-core
npm run timeline:test-media
npm run timeline:test-stress
npm run local:test-server
npm run build
npm test
```
