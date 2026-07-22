# Piloto real 01 — Monos hablando del Mundial

Fecha de producción: 22 de julio de 2026.

## Resultado

Se produjo un video vertical de 11,37 segundos con dos monos comentaristas discutiendo irónicamente sobre el Mundial de fútbol. El video fue generado mediante el pipeline local aprobado, con Piper, evaluación temporal determinista, frames PNG y exportación FFmpeg H.264/AAC.

Archivo final:

- `pilots/monos-mundial-01/output/monos-mundial-01.mp4`

Imagen de revisión:

- `pilots/monos-mundial-01/output/preview-frame.png`

Configuración reproducible:

- `pilots/monos-mundial-01/scene.config.json`

## Guion utilizado

> Este Mundial lo gana mi selección caminando. Sí, claro: como los últimos cuatro que ganaste en Twitter. El fútbol no entiende de estadísticas. Exacto. Por eso todos somos técnicos cuando empieza el Mundial.

El tono polémico se concentra en la costumbre de proclamarse experto durante un Mundial. No menciona personas, selecciones ni acusaciones reales.

Texto mostrado en pantalla:

> UNO: Este Mundial lo ganamos caminando.  
> DOS: Sí, como los cuatro que ganaste en Twitter.  
> Todos somos técnicos cuando empieza el Mundial.

## Producción visual

Se utilizó la skill de generación de imágenes en su modo integrado para crear una ilustración raster original destinada al piloto. El asset final fue copiado al repositorio y adaptado a 1080 × 1920 mediante FFmpeg.

Prompt final:

```text
Use case: illustration-story
Asset type: vertical 2D animated-video scene background for a social-media pilot
Primary request: two expressive cartoon monkeys having a heated but humorous conversation about the football World Cup in a small sports commentary studio
Scene/backdrop: colorful football commentary set, green tactical board, generic footballs, small generic international pennants without readable symbols, bright stadium lights visible through a window
Subject: two clearly distinct monkeys seated facing each other at a desk; the monkey on the left looks overly confident and theatrical, the monkey on the right looks skeptical and ironic; lively hand gestures and comedic facial expressions
Style/medium: polished flat 2D editorial cartoon, clean shapes, consistent outlines, visually suitable for simple animation
Composition/framing: portrait 9:16 composition, both monkeys fully visible around the middle of frame, ample clean space at the bottom for subtitles, important faces away from the lower subtitle-safe area
Lighting/mood: energetic, satirical, playful debate; colorful but coherent
Constraints: no real players, no politicians, no team crests, no brand logos, no official World Cup marks, no written text, no speech bubbles, no watermark; do not depict violence or hateful national stereotypes; keep the layout readable on a phone screen
```

Assets del piloto:

- `public/assets/pilots/monos-mundial-01/source-imagegen.png`: fuente generada original.
- `public/assets/pilots/monos-mundial-01/body.png`: composición RGBA 1080 × 1920 que recibe el movimiento suave.
- `public/assets/pilots/monos-mundial-01/background.png`: respaldo oscurecido y desenfocado para los bordes del paneo/zoom.
- `public/assets/pilots/monos-mundial-01/overlay-transparent.png`: capa técnica transparente utilizada por los slots que exige el contrato vigente.

Procedencia: ilustración generada mediante la herramienta integrada de imagen de Codex el 22 de julio de 2026. No se incorporaron logos, escudos ni personajes reales. Antes de un uso comercial permanente deben conservarse esta procedencia y los términos aplicables a la herramienta de generación.

## Ejecución

Job independiente:

```text
piloto-monos-mundial-01
```

Comando equivalente:

```powershell
node scripts/stage1/pipeline.mjs `
  --job-id piloto-monos-mundial-01 `
  --config pilots/monos-mundial-01/scene.config.json `
  --assets-dir public
```

El job usó las raíces predeterminadas aisladas:

- trabajo: `.local-video/work/piloto-monos-mundial-01/`
- resultados técnicos: `.local-video/output/piloto-monos-mundial-01/`

## Métricas y verificación

| Propiedad | Resultado |
|---|---:|
| Duración WAV medida con FFprobe | 11,342948 s |
| Duración del MP4 | 11,366667 s |
| Frames | 341 |
| FPS | 30 |
| Resolución | 1080 × 1920 |
| Video | H.264, yuv420p |
| Audio | AAC, mono, 22050 Hz |
| Tamaño final | 2.351.654 bytes |
| Generación Piper sin caché | 4,206 s |
| Análisis de audio | 0,0068 s |
| Render completo 1 | 21,980 s |
| Render completo 2 | 21,260 s |
| Verificaciones aprobadas | 30 |
| SHA-256 | `c6bea3958ce6872d2226f4106e57075e17eb025d4812a5e793d6aa6c25f564f6` |

Las dos exportaciones tuvieron planes temporales, frames y MP4 idénticos. El manifest registró `deterministic: true`. La copia entregable conserva el mismo SHA-256 que el render verificado.

## Revisión visual

Se extrajo y revisó manualmente un frame a los cinco segundos:

- ambos monos son visibles y se distinguen por gesto y vestuario;
- no aparecen textos accidentales, logos ni escudos;
- el bloque de subtítulos entra completo;
- el subtítulo no tapa caras ni gestos;
- el encuadre conserva espacio seguro para formato vertical;
- el paneo/zoom utiliza el fondo oscuro como respaldo sin dejar zonas vacías.

## Limitaciones honestas del piloto

- El motor vigente tiene una única pista de voz. Piper interpreta todo el intercambio con una sola voz.
- Los monos forman una ilustración compuesta, no dos personajes independientes por capas.
- Se generaron cues RMS de boca, pero las capas de boca del piloto son transparentes; no existe movimiento labial individual visible.
- El movimiento es un paneo/zoom suave de la composición completa.
- El subtítulo es un único bloque estático durante el video.
- No se añadieron escenas, multivoz, lip sync nuevo ni funciones fuera del contrato de una escena.

## Aprendizaje para el siguiente paso

El pipeline actual ya permite producir un clip corto visualmente presentable, pero este piloto muestra con claridad que una conversación real necesita, en este orden:

1. subtítulos divididos por cues temporales;
2. dos voces o turnos de diálogo;
3. personajes separados por ID/capas;
4. boca visible por personaje;
5. solo después, varias escenas.

La mejora de mayor valor inmediato es el subtítulo temporizado. Es pequeña, visible y reutilizable incluso antes de implementar múltiples personajes.
