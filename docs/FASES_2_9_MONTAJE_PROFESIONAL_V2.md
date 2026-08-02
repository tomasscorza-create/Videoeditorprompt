# Fases 2–9 — Montaje profesional V2

Estado: **implementado y verificado para proyectos nuevos**.

## Resultado

El espacio `Montaje` adopta el documento de clips V2 como su única fuente de verdad. La autoría semántica existente no se migra: personajes, props, plantillas, voces y escenas se siguen creando en `Autoría`; un render vigente entra a `Montaje` como una fuente A/V inmutable y se divide automáticamente por escenas medidas. También se puede importar MP4, MOV, WebM, WAV, MP3, OGG o M4A y agregar la mezcla WAV de una medición sin generar MP4 ni repetir Piper.

## Cierre por fase

- **Fase 2 — adopción:** repositorio V2 durable con revisión SHA-256 y conflicto optimista. Los proyectos anteriores no se migran porque el usuario autorizó crear montajes nuevos.
- **Fase 3 — clips reales:** escenas renderizadas y medios importados crean clips visuales y de audio; el A/V relacionado comparte `linkGroupId` y las operaciones enlazadas preservan sincronía.
- **Fase 4 — voz:** el WAV medido se importa una vez como fuente inmutable. Cortar, mover, recortar, duplicar o borrar no vuelve a sintetizar la voz.
- **Fase 5 — ingest:** carga por streaming con límite de 2 GB, FFprobe, duración real, deduplicación por contenido y objetos locales portables.
- **Fase 6 — interfaz:** pistas fijas V1/V2/A1/A2, tijera en el cabezal, trim por tiradores, arrastre, selección múltiple, snap, zoom, ripple, duplicado, borrado y undo/redo.
- **Fase 7 — preview:** un solo reloj `performance.now()` gobierna cabezal, video y audio; buscar y editar no genera frames ni MP4.
- **Fase 8 — exportación:** FFmpeg se ejecuta solo al pulsar exportar. Cada región fuente se cachea por hash; mover un clip reutiliza el segmento y una composición idéntica reutiliza el MP4 completo.
- **Fase 9 — endurecimiento:** schemas cerrados, comandos atómicos, persistencia por revisión, pruebas con medios reales, rutas HTTP, caché y una carga determinista de 500 clips más 100 cortes.

## Límite intencional

`Montaje` es postproducción A/V profesional y no simula capacidades inexistentes: no separa retrospectivamente un MP4 ya compuesto en personajes con transparencia. Para editar por separado personaje, prop o plantilla se vuelve a `Autoría`, se cambia el elemento semántico y se genera una nueva fuente. Tampoco incluye multicámara, corrección de color, plugins, nested timelines ni transiciones avanzadas.

## Gate reproducible

```powershell
npm run timeline:test-clip-core
npm run timeline:test-media
npm run timeline:test-stress
npm run local:test-server
npm run build
npm test
```
