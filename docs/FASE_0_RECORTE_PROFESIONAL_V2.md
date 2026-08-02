# Fase 0 — Contrato de recorte profesional V2

Estado: **congelado para implementar el núcleo aislado de la Fase 1**.

## 1. Objetivo y límite

El editor debe tratar el recorte como una operación no destructiva sobre clips, no como una modificación del archivo fuente ni como una división del texto. Esta fase define el contrato que permite cortar, recortar, mover, duplicar y borrar sin volver a sintetizar una voz, sin reencodear durante la edición y sin romper automatizaciones.

El alcance profesional V2 es el editor local especializado en videos 2D del proyecto. No intenta cubrir todavía multicámara, corrección de color, plugins de terceros, nested timelines ni edición colaborativa.

La Fase 1 permanece aislada de `video-project.schema.json`: el proyecto vigente sigue funcionando mientras el nuevo núcleo demuestra sus invariantes. La migración y la adopción como fuente única de verdad corresponden a la Fase 2.

## 2. Decisiones congeladas

### 2.1 Tiempo entero

- La timeline usa `48_000` ticks por segundo.
- El audio normalizado usa `48_000` muestras por segundo; un tick equivale a una muestra.
- El video V1 profesional permanece en 30 fps; un frame equivale exactamente a `1_600` ticks.
- Los clips visuales empiezan, terminan y se recortan en fronteras de frame.
- Los clips de audio pueden recortarse con precisión de una muestra.
- El render sigue evaluando cada cuadro mediante `frameIndex / fps`; los ticks son el contrato de autoría y se convierten de forma exacta.
- No se guardan segundos decimales como fuente de verdad.

### 2.2 Fuente inmutable y clip editable

Una fuente identifica contenido durable mediante `sourceId` y `contentHash`. Un clip solo referencia una región de esa fuente:

```text
sourceInTick ───────── durationTicks ─────────► fuente inmutable
timelineStartTick ──── durationTicks ─────────► posición editable
```

- Cortar no modifica ni duplica el archivo fuente.
- Dos clips pueden apuntar al mismo `sourceId`.
- Editar el texto de una voz genera otra fuente TTS cacheada; cortar su audio no vuelve a sintetizarla.
- El contenido se normaliza antes de entrar al contrato: video a 30 fps y audio a 48 kHz. El ingest de medios se implementará en una fase posterior.

### 2.3 Pistas y colisiones

- Una pista es `visual` o `audio`.
- Un clip visual solo vive en una pista visual; un clip de audio solo en una pista de audio.
- Una fuente `video` puede alimentar clips visuales y, más adelante, clips de audio enlazados mediante `linkGroupId`.
- En la Fase 1 dos clips no pueden solaparse dentro de la misma pista. Capas simultáneas usan pistas diferentes.
- Ripple, overwrite y mezcla/transición dentro de una misma pista se agregan después del núcleo básico; hasta entonces una colisión se rechaza explícitamente.

### 2.4 Automatización estable

- Los keyframes se guardan en tiempo de fuente mediante `sourceTick`, no anclados a IDs de escenas, turnos o palabras.
- Mover un clip no mueve ni reescribe sus keyframes: cambia dónde se reproduce la misma región.
- Recortar oculta o vuelve a revelar keyframes sin destruirlos.
- Cortar clona la automatización completa en ambas mitades y cambia únicamente `sourceInTick` y `durationTicks`. Así una curva conserva exactamente su evaluación en el punto de corte.
- Los IDs de keyframe son únicos dentro de cada pista de automatización del clip, no globales al proyecto.

### 2.5 Operaciones del núcleo

- `split-clip`: crea dos ventanas contiguas sobre la misma fuente.
- `trim-clip`: cambia el borde inicial o final, incluyendo extenderlo si existe contenido fuente disponible.
- `move-clip`: cambia pista y posición sin tocar la fuente.
- `duplicate-clip`: crea otra instancia independiente sobre la misma fuente.
- `delete-clip`: elimina solo la instancia.
- Todas son inmutables, deterministas, validan antes de publicar estado y participan de undo/redo.

## 3. Invariantes obligatorios

1. Ningún comando modifica una fuente.
2. Un clip nunca referencia tiempo negativo ni sobrepasa su fuente.
3. Un clip visual siempre está alineado a frames.
4. Un clip de audio siempre usa ticks enteros y por lo tanto muestras exactas.
5. Un corte conserva exactamente la cobertura de la región original: no crea huecos, solapamientos ni pérdida de fuente.
6. Split, trim y move no reescriben automatizaciones.
7. Un fallo deja el estado anterior intacto.
8. Undo/redo recupera documentos idénticos byte a byte al serializarlos de forma canónica.
9. IDs, hashes y documentos son datos cerrados; no aceptan rutas, scripts ni expresiones ejecutables.
10. La Fase 1 no se conecta a la UI ni reemplaza el proyecto vigente antes del gate humano/técnico.

## 4. Errores cerrados

- `TIMELINE_DOCUMENT_INVALID`: estructura o semántica inválida.
- `TIMELINE_COMMAND_INVALID`: comando incompleto o con campos arbitrarios.
- `TIMELINE_COMMAND_UNSUPPORTED`: operación desconocida.
- `TIMELINE_SOURCE_NOT_FOUND`: fuente inexistente.
- `TIMELINE_TRACK_NOT_FOUND`: pista inexistente.
- `TIMELINE_CLIP_NOT_FOUND`: clip inexistente.
- `TIMELINE_ID_CONFLICT`: ID repetido.
- `TIMELINE_KIND_MISMATCH`: fuente, clip y pista incompatibles.
- `TIMELINE_RANGE_INVALID`: rango vacío, desalineado o fuera de la fuente.
- `TIMELINE_COLLISION`: la operación solaparía clips de una misma pista.
- `TIMELINE_HISTORY_EMPTY`: reservado para consumidores que quieran distinguir un undo/redo sin historial; el núcleo V1 devuelve el mismo estado en ese caso.

## 5. Gate de Fase 1

La Fase 1 se aprueba únicamente si:

- los schemas de documento y comandos validan fixtures positivos y negativos;
- todos los comandos son puros, cerrados e inmutables;
- cortar clips visuales y de audio conserva fuente, cobertura y automatización;
- trim puede acortar y extender sin salir de la fuente;
- move y duplicate respetan compatibilidad y colisiones;
- delete, batch, undo y redo son atómicos;
- el módulo puede entrar al navegador: no importa Node, DOM, Ajv ni el pipeline;
- `npm run timeline:test-clip-core` pasa y forma parte de `npm test`.

## 6. Fuera de alcance de Fase 1

- Adaptar proyectos actuales a clips V2.
- Reemplazar la timeline visual vigente.
- Ingestar WAV, MP3 o video.
- Reproducir o exportar el documento V2.
- Ripple, overwrite, slip, slide, roll, enlaces A/V y selección múltiple.
- Transiciones entre clips.

Estas capacidades quedan previstas por el modelo, pero se incorporan después de aprobar el núcleo aislado.
