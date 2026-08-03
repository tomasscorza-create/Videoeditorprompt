# Runtime flexible V1

Fecha: 2026-08-03

Estado: implementado y verificado.

## Resultado

El runtime v2, el compilador de proyectos y el manifiesto renderizado admiten
ahora entre cero y dos personajes visibles por escena. Una escena conserva de
uno a veinte turnos hablados y cada turno puede ser:

- histórico/de personaje: `speakerType` ausente o `character`, con
  `speakerElementId`/`speakerId`;
- voz fuera de campo: `speakerType: "voiceover"`, sin referencia a personaje,
  gesto ni layout.

La extensión es aditiva. Los proyectos históricos no necesitan migración y no
cambia su interpretación semántica.

## Duración y sincronización

Una voz fuera de campo usa el mismo camino que el diálogo:

1. Piper sintetiza cada turno;
2. FFprobe mide el WAV real;
3. la timeline coloca subtítulos y anclas contra esos tiempos;
4. `shared/scene-evaluator.js` produce el estado por `frameIndex / fps`;
5. PixiJS o FFmpeg componen el MP4 desde ese mismo estado.

No se agregó duración de escena estimada por texto ni por IA. Las escenas
silenciosas continúan fuera del alcance.

## Compatibilidad por cantidad de personajes

- cero: narración con fondo, props o plantillas; no se fabrican personajes
  invisibles;
- uno: monólogo con boca, gesto, parpadeo, layout base y subtítulo;
- dos: diálogo histórico sin cambios;
- más de dos: rechazo explícito del compilador.

Los verificadores de escena y proyecto también aceptan un solo turno medido.
Los chequeos que solo tienen sentido con dos personajes se ejecutan de manera
condicional.

## Gates

Pilotos versionados en `pilots/runtime-flexible-v1/`:

- `voiceover-prop.project.json`: render completo sin personajes, prop animado y
  subtítulo; 9,9 s medidos, 297 frames, H.264/AAC, dos MP4 idénticos y 12 gates;
- `solo.project.json`: render completo con un personaje y un turno; 3,033333333
  s renderizados desde 3,018594 s de WAV, 91 frames, dos MP4 idénticos y 12
  gates;
- `mixed-0-1-2.project.json`: compilación integrada de tres escenas con conteos
  de personajes `[0, 1, 2]` y hablantes coherentes.

Los resultados locales regenerables se publican bajo
`.local-video/output/piloto-runtime-flexible-v1/` y
`.local-video/output/piloto-runtime-solo-v1/`; no se versionan.

## Límites vigentes

- El Director de creación todavía produce su plan rígido V1. Conectarlo a estos
  modos corresponde a V3.
- La interfaz humana todavía no ofrece todos los controles para crear voz fuera
  de campo o elegir el modo de escena. Ese trabajo corresponde a V2.
- Máximo dos personajes simultáneos por escena.
- No hay escenas sin audio ni duración arbitraria.
- Las secuencias coordinadas están contratadas, pero su aplicación automática
  como receta corresponde a V4.
