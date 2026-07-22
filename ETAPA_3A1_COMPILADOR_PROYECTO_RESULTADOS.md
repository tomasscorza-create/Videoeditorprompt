# Etapa 3A.1 — compilador de proyecto a escenas v2

Fecha: 22 de julio de 2026.

Estado: **implementada y verificada; todavía no prepara audio ni renderiza varias escenas**.

## Resultado

El proyecto editable versión 1 ya puede compilarse de forma determinista a una configuración `scene.config.json` versión 2 por cada escena compatible con el motor actual.

La compilación:

- congela el proyecto dentro de un trabajo identificado por `jobId`;
- resuelve personajes, voces y fondos desde el catálogo de autoría;
- convierte coordenadas de canvas a offsets del runtime actual;
- expande presets cerrados de movimiento, cámara y parpadeo;
- conserva orden, bindings y transición hacia la escena siguiente;
- valida cada configuración resultante con el validador canónico de escenas v2;
- registra hashes de proyecto, catálogo, fuentes y configuraciones;
- produce un `semanticHash` estable independiente del `jobId`.

No se ejecutan Piper, FFprobe, FFmpeg, frames ni MP4 en esta etapa.

## Archivos principales

- `schema/compiled-project.schema.json`
- `scripts/stage3a/project-compilation-context.mjs`
- `scripts/stage3a/compile-video-project.mjs`
- `scripts/stage3a/test-project-compiler.mjs`
- `pilots/proyecto-compilable-01/project.json`

Los outputs regenerables viven bajo:

```text
.local-video/work/<jobId>/
├── input/project.json
├── status/
└── compiled/
    ├── compiled-project.json
    └── scenes/
        ├── 001-<sceneId>/scene.config.json
        └── 002-<sceneId>/scene.config.json
```

## Mapeo implementado

- `resourceId` de personaje → `characterAssetId` del catálogo técnico 2F.2.
- `voiceId` → modelo Piper, `lengthScale` y volumen.
- `x/y` del canvas → `toX/baseY` relativos al centro del video.
- `scale` → `baseScale`.
- `zIndex` → orden estable de composición de personajes.
- `idle-calm` y `talk-calm` → amplitud, período y pulso cerrados.
- `static`, `slow-pan` y `slow-zoom` → cámara determinista.
- manifest de fondo → tres capas portables con parallax.
- semilla de proyecto + escena + elemento → semilla estable de parpadeo.

Los valores de boca y subtítulos usan los defaults ya aprobados en 2F. El compilador no estima duración; 3A.2 deberá obtenerla del WAV mediante FFprobe.

## Límites explícitos

Para producir una escena v2 válida, 3A.1 admite:

- exactamente dos personajes;
- al menos dos turnos de diálogo;
- personajes provenientes de un mismo catálogo técnico;
- pose inicial `neutral`;
- ancla `0.5/0.5`, rotación `0` y opacidad `1`;
- elementos de tipo `character`.

Texto, imágenes, otra cantidad de personajes y transforms no representables producen `PROJECT_SCENE_UNSUPPORTED`. No se eliminan ni aproximan silenciosamente.

## Verificación

`npm run stage3a:test-compiler` cubre:

- dos escenas compiladas con `semanticHash` idéntico en trabajos diferentes;
- configuraciones portables y byte a byte idénticas;
- conversión de coordenadas y IDs;
- resolución de las dos voces;
- conservación de orden y fundido;
- hashes de entradas;
- rechazo de elementos, rotación, cantidad de personajes y pose inicial no soportados;
- congelado del proyecto por `jobId`.

Comandos:

```powershell
npm run stage3a:compile-project
npm run stage3a:test-compiler
```

## Próximo incremento

3A.2 debe consumir `compiled-project.json`, preparar cada escena con el pipeline vigente, medir sus WAV, producir MP4 intermedios aislados y unirlos con cortes o fundidos en un único resultado determinista. Preview multiescena y editor continúan fuera de este incremento.
