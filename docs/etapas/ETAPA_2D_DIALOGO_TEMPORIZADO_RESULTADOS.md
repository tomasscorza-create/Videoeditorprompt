# Etapa 2D — Diálogo temporizado y dos hablantes

Fecha: 22 de julio de 2026.

Estado: implementada y verificada técnicamente. Pendiente la aceptación visual y auditiva del usuario.

## Resultado

El núcleo puede preparar y renderizar una conversación secuencial entre exactamente dos personajes dentro de una escena. Cada turno declara texto, `speakerId`, parámetros Piper y una pausa posterior. Los tiempos no se escriben manualmente: se calculan después de medir cada WAV con FFprobe.

El piloto `piloto-dialogo-monos-01` contiene tres turnos alternados. El motor:

- genera/cachea una voz por turno;
- mide cada WAV;
- calcula inicio y fin;
- analiza cues RMS relativos al turno;
- genera un subtítulo ajustado por palabras;
- inserta silencios explícitos;
- compone un WAV maestro PCM;
- activa la boca únicamente en el hablante;
- mantiene cerrada la boca del personaje inactivo;
- exporta dos MP4 binariamente idénticos.

Se mantiene una sola escena. No se agregaron editor, React, Electron, varias escenas, director IA, lip sync fonético ni dependencias nuevas.

## Contrato v2 para la interfaz

La configuración v1 permanece compatible. El nuevo modo usa `version: 2` y separa datos de autoría de datos compilados.

Estructura resumida:

```json
{
  "version": 2,
  "video": { "width": 1080, "height": 1920, "fps": 30 },
  "assets": { "background": "assets/fondo.png" },
  "characters": [
    {
      "id": "presentador",
      "characterManifest": "assets/personaje/character.manifest.json",
      "transform": {},
      "blink": {}
    },
    {
      "id": "invitado",
      "characterManifest": "assets/personaje/character.manifest.json",
      "transform": {},
      "blink": {}
    }
  ],
  "dialogue": [
    {
      "id": "turno-01",
      "speakerId": "presentador",
      "text": "Texto del turno.",
      "voice": {
        "model": "es_AR-daniela-high",
        "lengthScale": 1.3,
        "volume": 1
      },
      "gapAfterSeconds": 0.25
    }
  ],
  "mouth": {},
  "subtitleStyle": { "fontSize": 48, "bottomMargin": 135 }
}
```

La UI debe editar orden, hablante, texto, voz y pausa. No debe pedir `startSeconds`, `endSeconds` ni duración: esos valores pertenecen al runtime compilado.

## Runtime compilado

El runtime v2 contiene:

- `characters[]` con assets, rig, transform y parpadeos compilados;
- `dialoguePath` relativo;
- `audio.path` al WAV maestro;
- duración y propiedades medidas;
- cache key de toda la timeline.

El archivo de diálogo derivado contiene por turno:

- ID y hablante;
- inicio, fin y duración medidos;
- pausa posterior;
- WAV/cache key;
- PNG de subtítulo;
- cues RMS relativos;
- parámetros de voz.

Ningún config, runtime o derivado contiene rutas absolutas.

## Evidencia real

Turnos medidos:

| Turno | Hablante | Duración | Inicio | Fin |
|---|---|---:|---:|---:|
| `turno-01` | `presentador` | 1,590567 s | 0,000000 | 1,590567 |
| `turno-02` | `invitado` | 3,541043 s | 1,870567 | 5,411610 |
| `turno-03` | `presentador` | 3,192744 s | 5,691610 | 8,884354 |

Audio maestro:

- PCM `pcm_s16le` durante preparación;
- mono;
- 22.050 Hz;
- duración 8,884354 s.

MP4 final:

- H.264;
- 1080 × 1920;
- 30 fps;
- `yuv420p`;
- AAC mono a 22.050 Hz;
- duración 8,900 s;
- tamaño 1.050.345 bytes.

Render 1:

- 267 frames;
- generación de frames: 20,133 s;
- codificación: 1,471 s;
- total: 21,771 s;
- hash de frames: `23446c18e3c492358bcdeb81401bea2921610be069cb36477f0ab5411961061a`;
- SHA-256 MP4: `5be2dd81abc877d4069648d8e6ee859bb3bec00719aaaff2e72f3595d62c5ba2`.

El verificador aprobó 43 controles. Los dos planes, secuencias PNG y MP4 fueron idénticos.

## Preview

El adaptador PixiJS v2 es intencionalmente mínimo para no competir con el trabajo UX/UI de Claude. Carga:

- dos contenedores de personaje;
- ojos y bocas independientes;
- subtítulo del turno activo;
- WAV maestro como reloj;
- estado del hablante activo.

La prueba real en navegador confirmó WebGL, cuatro jobs seleccionables y transición de `presentador` a `invitado` alrededor de 1,87 s.

Abrir:

```text
http://localhost:5173/?job=piloto-dialogo-monos-01
```

## Archivos incorporados o modificados

- `schema/scene-config-v2.schema.json`
- `scripts/stage1/validate-scene-config.mjs`
- `scripts/stage1/piper-voice.mjs`
- `scripts/stage1/subtitle-renderer.mjs`
- `scripts/stage1/prepare-dialogue.mjs`
- `scripts/stage1/prepare-scene.mjs`
- `shared/scene-evaluator.js`
- `shared/scene-evaluator.d.ts`
- `scripts/stage1/export-dialogue.mjs`
- `scripts/stage1/export-scene.mjs`
- `scripts/stage1/verify-dialogue.mjs`
- `scripts/stage1/verify-stage1.mjs`
- `scripts/stage1/test-dialogue-contract.mjs`
- `src/main.ts`
- `pilots/dialogo-monos-01/scene.config.json`
- `package.json`
- documentación de estado y colaboración.

## Comandos

Contrato:

```powershell
npm run stage2d:test-contract
```

Pipeline completo:

```powershell
npm run stage2d:pipeline
```

## Pruebas ejecutadas

Se eligió nivel 4 porque cambiaron contrato, TTS, audio, evaluador, FFmpeg y preview.

- contrato 2D: 8/8;
- pipeline 2D: 43/43 y determinista;
- validación v1: 16/16;
- rig 2C: 6/6;
- pipeline v1: 30/30;
- dos jobs aislados: aprobado;
- publicación: 10/10;
- TypeScript/Vite: aprobado;
- FFprobe WAV y MP4: aprobado;
- inspección visual offline: aprobada;
- preview PixiJS real: aprobado.

## Problemas detectados y corregidos

1. Los procesos largos fueron interrumpidos varias veces por una ventana de terminal demasiado corta; se relanzaron por `jobId` y caché sin perder aislamiento.
2. El segundo subtítulo excedía el ancho. Se agregó ajuste determinista por palabras con máximo de 38 caracteres por línea.
3. Publicar v2 hacía visible el job para un preview que solo comprendía v1. Se incorporó un adaptador v2 mínimo, sin rediseñar la interfaz.

## Evaluación honesta

La independencia temporal está demostrada, pero el piloto duplica el mismo rig y usa el mismo modelo Piper con velocidades 1,30 y 1,72. Se perciben como dos ritmos, no como dos voces naturales claramente distintas. Para calidad de producción se necesita al menos otro personaje o variante visual y evaluar una segunda voz española Piper.

No conviene cambiar de motor TTS todavía: el contrato ya admite `model` por turno y permite comparar voces sin reescribir la timeline.

## Handoff para Claude

Claude puede diseñar o conectar ahora:

- lista ordenada de turnos;
- selector de `speakerId` entre exactamente dos personajes;
- campo de texto;
- selector/preset de voz;
- control simple de pausa posterior;
- acción preparar;
- visualización read-only de tiempos medidos después de preparar;
- estados de progreso repetidos por `turnId` y `speakerId`.

La interfaz no debe calcular tiempos, analizar audio ni decidir qué boca se abre.

## Próximo paso del motor

Etapa 2E: fondo y cámara animables mediante pocas capas, paneo/zoom determinista y parallax simple. Debe conservar una sola escena y no introducir todavía el editor ni varias escenas.
