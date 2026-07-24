# Etapa 1 — Prototipo mínimo de una escena

Fecha de cierre técnico: 22 de julio de 2026  
Estado: **APROBADA TÉCNICAMENTE (28 verificaciones automáticas, 0 fallos)**

Este documento deja el estado completo y reproducible para otra sesión de GPT/Codex. La implementación se mantuvo dentro del alcance aprobado: una escena manual, un personaje geométrico por capas, una voz Piper, animación simple, parpadeo determinista, boca guiada por RMS, un subtítulo, vista previa PixiJS y exportación MP4. No se agregaron React, Electron, IA directora, varias escenas, formato JSON definitivo, lip sync fonético ni dependencias npm nuevas.

## 1. Resultado ejecutivo

El circuito mínimo funciona de extremo a extremo:

1. `public/scene.config.json` define manualmente una composición vertical de 1080 × 1920 a 30 fps.
2. Piper genera o recupera desde caché una narración en español desde una ruta ASCII estable.
3. FFprobe determina la duración real del WAV: **4,899410 s**.
4. Un analizador local de PCM calcula energía RMS, suaviza la señal y produce cues `closed`, `medium` y `open`.
5. Un evaluador temporal compartido calcula movimiento, escala, opacidad, ojos, boca y visibilidad del subtítulo en `t = frameIndex / fps`.
6. PixiJS reproduce la escena en el navegador usando el tiempo del audio como reloj.
7. El exportador genera **147 PNG** y compone un MP4 H.264/AAC/yuv420p de **4,900 s**.
8. Dos exportaciones independientes produjeron exactamente el mismo plan, los mismos frames y el mismo MP4 binario.

Archivo de video principal: `output/stage1/stage1-final-1.mp4`  
SHA-256: `18ba4c4a5a877d4e66fee2436ec9f0f312fd971255d875dff6b3f343ceefa885`

## 2. Arquitectura implementada

```text
public/scene.config.json
        │
        ├── scripts/stage1/prepare-scene.mjs
        │     ├── Piper en C:\LocalVideoTTS
        │     ├── caché WAV por SHA-256
        │     ├── FFprobe para duración
        │     ├── análisis RMS de PCM16
        │     └── PNG de subtítulo con fuente controlada
        │
        ├── public/generated/scene-runtime.json
        ├── public/generated/audio/<hash>.wav
        ├── public/generated/mouth/<hash>.json
        └── public/generated/subtitle/<hash>.png
                         │
             shared/scene-evaluator.js
                  ┌──────┴──────┐
                  │             │
              PixiJS        FFmpeg offline
              preview       147 PNG + WAV
                  │             │
             navegador      MP4 H.264/AAC
```

La configuración sigue siendo deliberadamente pequeña y no pretende ser el contrato JSON definitivo del producto.

## 3. Contrato temporal y sincronización

Decisiones fijadas en esta etapa:

- La duración oficial de la escena proviene de FFprobe sobre el WAV generado, no de una estimación del texto.
- La cantidad de frames es `ceil(duraciónAudio × fps)`. En esta prueba: `ceil(4,899410 × 30) = 147`.
- El tiempo de cada frame es exactamente `frameIndex / fps`.
- El navegador usa `audio.currentTime` como reloj de la vista previa.
- El evaluador compartido `shared/scene-evaluator.js` recibe configuración, runtime, cues de boca y tiempo.
- Los parpadeos se generan una vez con una semilla fija (`41731`) y quedan registrados en el runtime.
- La boca queda cerrada cuando no existe un cue aplicable y también fuera de la duración del audio.
- El subtítulo es un PNG prerenderizado con Arial controlada, usado tanto por PixiJS como por FFmpeg. Esto evita diferencias de tipografía entre preview y exportación.
- El exportador obtiene los estados de ojos y boca del mismo plan evaluado que se usa para verificar la vista previa. Las expresiones de movimiento para FFmpeg se producen desde el mismo módulo compartido.

## 4. Piper aislado y caché

Piper no fue incorporado a `package.json`, `src/` ni a una arquitectura de proveedores.

Runtime estable:

```text
C:\LocalVideoTTS\
├── venv\
├── models\
│   ├── es_AR-daniela-high.onnx
│   └── es_AR-daniela-high.onnx.json
├── cache\
├── temp\
└── fonts\arial.ttf
```

Datos verificados:

- Motor: `piper-tts 1.5.0`.
- Distribución: paquete mantenido de `OHF-voice/piper1-gpl`.
- Licencia del motor: `GPL-3.0-or-later`.
- Modelo único: `es_AR-daniela-high`.
- Región declarada en el catálogo: español de Argentina (`es_AR`).
- Calidad: `high`.
- Sample rate: `22050 Hz`.
- Modelo ONNX: `114.199.011 bytes`.
- Dataset indicado por la ficha: OpenSLR 61.
- Licencia/atribución del dataset indicada por la ficha: CC BY-SA 4.0.
- Fuente del modelo: <https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_AR/daniela/high>.
- Hash de caché actual: `414bad2d2803043e2ef38e4a7cb4436c0af99dfb300d025d0c1b14af9d2e3bdf`.
- No existe una unidad temporal creada con `subst`; la prueba se ejecuta directamente desde `C:\LocalVideoTTS`.

La clave SHA-256 de caché incluye modelo, texto, `lengthScale` y volumen. El primer preparo observado tardó **3,053 s** y produjo el WAV. El segundo preparo fue un cache hit y reportó **0 s de síntesis**. El análisis RMS tardó alrededor de **0,006 s**.

## 5. Voz y WAV

Texto utilizado:

> Esta es una prueba de voz generada localmente para nuestro sistema de animación.

Propiedades verificadas con FFprobe:

| Propiedad | Resultado |
|---|---:|
| Codec | PCM signed 16-bit little-endian (`pcm_s16le`) |
| Sample rate | 22050 Hz |
| Canales | 1 (mono) |
| Duración | 4,899410 s |
| Tamaño | 216.108 bytes |

## 6. Análisis RMS y boca

El analizador `scripts/stage1/audio-analysis.mjs` lee directamente el contenedor WAV RIFF PCM16 sin bibliotecas externas.

Parámetros actuales:

- Ventana: 30 ms.
- Suavizado exponencial: 0,55.
- Umbral normalizado de silencio: 0,11.
- Umbral normalizado de boca abierta: 0,42.
- Duración mínima estable: 90 ms.
- Referencia de normalización: percentil 95 de RMS suavizado.

Resultado:

- 18 segmentos compactados.
- 3 segmentos `closed`.
- 8 segmentos `medium`.
- 7 segmentos `open`.
- Umbral RMS absoluto de silencio observado: aproximadamente `0,02813`.
- Umbral RMS absoluto de apertura observado: aproximadamente `0,10740`.

Este método no reconoce fonemas. Su objetivo es únicamente comprobar que una señal de voz puede controlar de forma estable tres sprites de boca sin GPU ni modelos adicionales.

## 7. Assets de prueba

Todos los PNG miden 1080 × 1920. Las capas de personaje son RGBA transparentes y comparten el mismo lienzo/origen, por lo que no requieren offsets individuales en esta etapa.

```text
public/assets/stage1/
├── background.png
├── body.png
├── eyes_open.png
├── eyes_closed.png
├── mouth_closed.png
├── mouth_medium.png
├── mouth_open.png
└── arial.ttf
```

La geometría es temporal y sirve para validar capas, estados y sincronización. No constituye aún un sistema de personajes.

## 8. Vista previa PixiJS

Prueba realizada contra Vite en `http://127.0.0.1:4173/`:

- Carga correcta de configuración, runtime, WAV, cues y ocho texturas visuales.
- Canvas real: 1080 × 1920.
- Renderer: `WebGLRenderer`.
- Estado inicial: tiempo `0,00`, boca `closed`, ojos `open`.
- Al reproducir: el reloj avanzó y se observó estado de boca `open` durante voz.
- Al pausar: el reloj quedó estable y el estado mostró `Pausado`.
- Al reiniciar: volvió a `0,00`, audio `Detenido`, boca `closed`, ojos `open`.
- Consola: 0 errores y 0 advertencias.
- La inspección visual confirmó fondo, personaje por capas y subtítulo dentro del cuadro.

## 9. Exportaciones offline

Cada ejecución generó una secuencia independiente en:

```text
temp/stage1/export-1/frames/
temp/stage1/export-2/frames/
```

Resultados:

| Métrica | Exportación 1 | Exportación 2 |
|---|---:|---:|
| Frames PNG | 147 | 147 |
| Generación de frames | 3,949 s | 4,002 s |
| Codificación | 0,693 s | 0,733 s |
| Tiempo total | 4,664 s | 4,756 s |
| MP4 | 214.299 bytes | 214.299 bytes |

Propiedades FFprobe de ambos MP4:

| Propiedad | Resultado |
|---|---:|
| Resolución | 1080 × 1920 |
| Video | H.264 (`h264`) |
| Pixel format | `yuv420p` |
| Framerate | 30/1 fps |
| Duración de video | 4,900000 s |
| Audio | AAC mono |
| Sample rate AAC | 22050 Hz |
| Duración AAC | 4,899002 s |
| Duración del contenedor | 4,900000 s |

Prueba de determinismo:

- Hash del plan temporal en ambas ejecuciones: `0be8abc88a0f62558d7ac00db1588635f8d65844c270fe129f58ab979e8d644c`.
- Hash agregado de los 147 PNG en ambas ejecuciones: `dcd498bdffa546d5ab9aea3af9498cac5e943e4746ff9309b282bd07b0a67768`.
- SHA-256 de ambos MP4: `18ba4c4a5a877d4e66fee2436ec9f0f312fd971255d875dff6b3f343ceefa885`.

## 10. Verificación automatizada

`npm run stage1:verify` aprobó 28 controles y dejó la evidencia detallada en `output/stage1/verification.json`.

Los controles cubren:

- resolución y fps de configuración;
- dimensiones de cada asset;
- transparencia RGBA de las capas;
- presencia de los tres estados de boca;
- orden y validez de cues;
- boca cerrada fuera del audio;
- parpadeos deterministas;
- igualdad de los dos planes temporales;
- igualdad de los frames;
- cantidad exacta de frames;
- movimiento visible;
- subtítulo visible;
- H.264/AAC/yuv420p;
- 1080 × 1920, 30 fps y duración completa;
- igualdad binaria de los dos MP4.

Además, `npm run build` terminó correctamente con TypeScript estricto y Vite.

## 11. Archivos nuevos y modificados

Archivos de contrato y runtime:

- `public/scene.config.json`: configuración manual mínima.
- `public/generated/scene-runtime.json`: duración, URLs, parpadeos y metadatos de voz.
- `shared/scene-evaluator.js`: evaluación temporal compartida.
- `shared/scene-evaluator.d.ts`: tipos para TypeScript.

Scripts:

- `scripts/stage1/common.mjs`: rutas, procesos con argumentos separados, JSON y FFprobe.
- `scripts/stage1/generate-assets.mjs`: assets geométricos temporales.
- `scripts/stage1/prepare-scene.mjs`: caché Piper, duración, RMS, cues y subtítulo.
- `scripts/stage1/audio-analysis.mjs`: parser WAV y clasificación RMS.
- `scripts/stage1/export-scene.mjs`: frame plan, PNG y MP4.
- `scripts/stage1/verify-stage1.mjs`: 28 verificaciones.

Vista previa:

- `src/main.ts`: composición PixiJS y controles.
- `src/style.css`: interfaz mínima.
- `index.html`: panel técnico.
- `package.json`: solo se agregaron scripts npm; no se agregaron paquetes.
- `tsconfig.json`: incluye el módulo compartido.

Evidencia:

- `output/stage1/stage1-final-1.mp4`.
- `output/stage1/stage1-final-2.mp4`.
- `output/stage1/export-metrics-1.json`.
- `output/stage1/export-metrics-2.json`.
- `output/stage1/frame-plan-1.json`.
- `output/stage1/frame-plan-2.json`.
- `output/stage1/verification.json`.

## 12. Comandos reproducibles

Desde la raíz del repositorio:

```powershell
npm run stage1:assets
npm run stage1:prepare
npm run dev -- --host 127.0.0.1 --port 4173
node scripts/stage1/export-scene.mjs --run=1
node scripts/stage1/export-scene.mjs --run=2
npm run stage1:verify
npm run build
```

Todos los procesos externos se invocan con ejecutable y arreglo de argumentos separados (`shell: false`). No se construyen comandos concatenados, por lo que la ruta con espacios y `ñ` no se pasa por un shell intermedio.

## 13. Problemas encontrados y correcciones

1. El primer PNG de subtítulo quedó con fondo opaco porque el origen de FFmpeg convertía a RGBA después de crear un fondo negro. Se corrigió generando el origen directamente como RGBA transparente.
2. La primera línea del subtítulo excedía el ancho útil. Se fijó un salto manual en tres líneas y fuente de 48 px.
3. La primera codificación usó `-shortest` y FFmpeg terminó el stream de video en 4,866667 s, descartando el último frame frente a un audio apenas más corto. Se eliminó `-shortest` y se fijó la duración de salida al múltiplo exacto de frames: 4,900 s.
4. La vista previa inicial tiene el personaje fuera de cuadro durante su entrada, de forma intencional. El movimiento lo lleva al centro en 0,65 s.

Las exportaciones definitivas y las métricas documentadas son posteriores a estas correcciones.

## 14. Limitaciones deliberadas

- Solo una escena.
- Solo un personaje geométrico con capas de lienzo completo.
- Solo una voz y un texto.
- Solo tres estados de boca por volumen; no hay fonemas.
- Solo un subtítulo estático durante la narración.
- No hay timeline editable ni editor visual.
- No hay múltiples acciones, poses ni sistema reusable de rigs.
- No hay música, efectos, transiciones ni mezcla de audio.
- La configuración JSON no tiene esquema formal ni validación Ajv.
- No hay Electron, React, base de datos, Whisper, Rhubarb, llama.cpp ni director IA.

## 15. Decisión de cierre

La Etapa 1 demuestra que esta computadora puede producir localmente una escena 2D vertical consistente con TTS en CPU, preview PixiJS, control simple de boca, subtítulo y exportación H.264/AAC. El circuito es suficientemente rápido para continuar de forma incremental: la síntesis fría tardó aproximadamente 3,05 s y cada exportación completa unos 4,7 s para 4,9 s de video.

La decisión técnica es **continuar con esta base**, conservando las tres reglas que más reducen riesgo:

1. audio medido por FFprobe como fuente de duración;
2. evaluador temporal compartido entre preview y exportación;
3. assets y resultados derivados cacheados por hash.

No se recomienda ampliar todavía a un editor o a múltiples proveedores. El próximo alcance debe definirse explícitamente antes de modificar esta base.
