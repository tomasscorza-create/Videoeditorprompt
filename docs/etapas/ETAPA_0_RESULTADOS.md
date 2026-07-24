# Etapa 0: resultados y evidencia de pruebas técnicas

**Fecha de ejecución:** 21 de julio de 2026  
**Alcance:** Vite, TypeScript, PixiJS, scripts Node.js, PNG, WAV y FFmpeg.  
**Estado general:** Etapa 0 completada. Circuito visual, exportación y TTS local con Piper aprobados, con una restricción documentada de rutas Unicode en Windows.

## 1. Resumen ejecutivo

Se completó correctamente el circuito técnico solicitado sin instalar Electron, React ni componentes de etapas posteriores.

Resultados principales:

- FFmpeg 8.1.2 instalado mediante Scoop.
- FFmpeg y FFprobe accesibles desde PowerShell y Node.js.
- `libx264`, AAC, `yuv420p` y WAV disponibles.
- MP4 sintético vertical validado.
- Proyecto npm mínimo creado con solo PixiJS, TypeScript y Vite.
- Assets PNG y WAV temporales generados localmente.
- Vista previa PixiJS validada en navegador con WebGL.
- Reproducción y pausa del WAV verificadas.
- Exportación offline de 90 frames completada.
- MP4 final validado con FFprobe.
- Tiempo total de la exportación final: 1,686 segundos.

Piper fue probado posteriormente de forma aislada. La evidencia completa está en `ETAPA_0_PIPER_RESULTADOS.md`.

## 2. Software instalado

### Herramienta de sistema

| Herramienta | Versión | Método |
|---|---:|---|
| FFmpeg | 8.1.2 full build | Scoop |
| FFprobe | 8.1.2 full build | Incluido con FFmpeg |

Ubicación de los shims:

```text
C:\Users\usuario\scoop\shims\ffmpeg.exe
C:\Users\usuario\scoop\shims\ffprobe.exe
```

La compilación de FFmpeg informa `--enable-libx264` y soporte amplio de codecs y aceleración. Para esta prueba se utilizó codificación por CPU con `libx264`, no codificación por hardware.

### Dependencias locales npm

| Dependencia | Versión | Tipo |
|---|---:|---|
| `pixi.js` | 8.19.0 | Producción |
| `typescript` | 7.0.2 | Desarrollo |
| `vite` | 8.1.5 | Desarrollo |

La auditoría de npm terminó con cero vulnerabilidades conocidas en el conjunto instalado.

No se instaló:

- Electron.
- React.
- Ajv.
- Librerías de IA.
- Librerías de timeline.
- Librerías adicionales de render Node.

## 3. Verificación de capacidades de FFmpeg

Las consultas a FFmpeg confirmaron:

```text
libx264: disponible
AAC: disponible
yuv420p: disponible como formato de entrada y salida
WAV/WAVE: disponible para lectura y escritura
```

Evidencia de codecs y formatos:

```text
V....D libx264  libx264 H.264 / AVC / MPEG-4 AVC
A....D aac      AAC (Advanced Audio Coding)
IO... yuv420p  4:2:0 de 8 bits
DE wav          WAV / WAVE
```

## 4. MP4 sintético

Se generó `output/stage0-synthetic.mp4` a partir de fuentes sintéticas de FFmpeg.

Tiempo medido:

```text
0,255 segundos
```

FFprobe confirmó:

| Propiedad | Resultado |
|---|---|
| Resolución | 1080×1920 |
| Relación | 9:16 |
| Frame rate | 30 fps |
| Frames | 90 |
| Video | H.264 mediante libx264 |
| Pixel format | yuv420p |
| Audio | AAC LC |
| Sample rate | 48.000 Hz |
| Canales | Mono |
| Duración | 3,000000 s |
| Tamaño | 59.286 bytes |

Esta prueba validó FFmpeg antes de introducir Vite o PixiJS.

## 5. Inicialización del proyecto

El intento inicial de ejecutar `npm init -y` falló porque npm trató de usar el nombre de la carpeta como nombre del paquete:

```text
Invalid name: "diseñador-de-videos-local"
```

La carpeta puede conservar espacios y la letra `ñ`, pero el nombre npm debe ser ASCII. Se creó explícitamente:

```json
"name": "disenador-videos-local"
```

Después se instalaron únicamente las tres dependencias aprobadas.

## 6. Assets temporales

El script `scripts/generate-assets.mjs` ejecuta FFmpeg mediante `spawnSync`, con ejecutable y argumentos separados y `shell: false`.

Archivos generados:

| Archivo | Propiedades verificadas |
|---|---|
| `assets/background.png` | PNG, 1080×1920, rgb24 |
| `assets/character_body.png` | PNG, 360×900, rgba |
| `assets/character_overlay.png` | PNG, 360×900, rgba |
| `assets/test.wav` | PCM s16le, mono, 48 kHz, 3 s |

El personaje es geométrico y deliberadamente simple. El cuerpo y la capa de rostro/accesorio son PNG separados con transparencia.

## 7. Vista previa PixiJS

La vista previa fue compilada y ejecutada mediante Vite en:

```text
http://127.0.0.1:5173/
```

Se abrió la página en un navegador real y se comprobó:

| Verificación | Resultado |
|---|---|
| Canvas interno | 1080×1920 |
| Renderer | WebGLRenderer |
| Fondo PNG | Visible |
| Cuerpo PNG | Visible |
| Overlay PNG | Visible y alineado |
| Movimiento | Activo y cíclico durante 3 s |
| Escala | Cambio sinusoidal visible |
| Opacidad del overlay | Cambio visible |
| Reproducir WAV | Funcionó |
| Pausar WAV | Funcionó |
| Errores o warnings de consola | Ninguno |

Estados observados directamente en la aplicación:

```text
Estado: Lista
Renderer: WebGLRenderer
Audio después de reproducir: Reproduciendo
Audio después de pausar: Pausado
```

La vista previa se muestra escalada para entrar en la pantalla horizontal, pero el canvas conserva internamente la resolución completa.

## 8. Compilación de producción

El comando `npm run build` ejecutó TypeScript y Vite correctamente.

Resultado final:

```text
709 módulos transformados
16 archivos en dist
Build de Vite: 231 ms
```

No se agregaron dependencias para resolver la compilación.

## 9. Exportación offline final

El script `scripts/export-video.mjs` realiza dos pasos:

1. Genera 90 PNG en `temp/frames` mediante FFmpeg, controlado desde Node.js.
2. Ensambla esos frames con `assets/test.wav` y produce `output/stage0-final.mp4`.

Todas las llamadas utilizan:

- Ejecutable separado.
- Array de argumentos.
- `shell: false`.
- Rutas absolutas.

Esto funcionó correctamente con los espacios y la `ñ` de la ruta del repositorio.

### Tiempo de la ejecución final

| Parte | Tiempo |
|---|---:|
| Generación de 90 PNG | 1,200 s |
| Codificación MP4 | 0,486 s |
| Total | 1,686 s |

Estos tiempos corresponden a la ejecución final corregida. La primera ejecución fue más rápida, pero produjo un personaje invisible por un problema de alfa y no se considera evidencia válida.

## 10. Resultado de FFprobe

El verificador automático comprobó todos los criterios:

```json
{
  "frameSequenceHas90Pngs": true,
  "videoCodecIsH264": true,
  "dimensionsAre1080x1920": true,
  "pixelFormatIsYuv420p": true,
  "frameRateIs30": true,
  "decodedFrameCountIs90": true,
  "audioCodecIsAac": true,
  "audioSampleRateIs48000": true,
  "durationIsThreeSeconds": true
}
```

Propiedades del archivo final:

| Propiedad | Resultado |
|---|---|
| Archivo | `output/stage0-final.mp4` |
| Resolución | 1080×1920 |
| Frame rate | 30/1 |
| Frames decodificados | 90 |
| Codec de video | H.264 |
| Pixel format | yuv420p |
| Codec de audio | AAC |
| Sample rate | 48.000 Hz |
| Canales | Mono |
| Frames de audio informados | 141 |
| Duración | 3,000000 s |
| Tamaño | 127.450 bytes |
| Bitrate total | 339.866 bit/s |

El informe completo de máquina está guardado en:

```text
output/stage0-final-ffprobe.json
```

## 11. Inspección visual de frames

Se inspeccionaron manualmente:

- `temp/frames/frame_001.png`
- `temp/frames/frame_045.png`
- `temp/frames/frame_090.png`

La inspección confirmó:

- Personaje visible y correctamente compuesto.
- Transparencia funcional.
- Desplazamiento horizontal.
- Desplazamiento vertical secundario.
- Cambio de escala en el frame intermedio.
- Fondo vertical consistente.

## 12. Errores encontrados y correcciones

### Error 1: nombre npm inválido

**Síntoma:** `npm init -y` rechazó la letra `ñ` en el nombre inferido.  
**Corrección:** nombre explícito ASCII `disenador-videos-local`.  
**Estado:** resuelto.

### Error 2: declaración de importación CSS

**Síntoma:** TypeScript 7 produjo `TS2882` al importar `style.css`.  
**Corrección:** se agregó `src/vite-env.d.ts` con los tipos estándar de Vite.  
**Estado:** resuelto sin instalar dependencias.

### Error 3: PNG RGBA completamente transparente

**Síntoma:** FFprobe informaba `rgba`, pero el personaje era invisible en navegador y frames. Las figuras se dibujaban sobre alfa cero sin reemplazar el canal alfa.  
**Corrección:** se utilizó `replace=1` en las operaciones `drawbox` de FFmpeg. Se regeneraron assets, frames y MP4.  
**Estado:** resuelto y validado visualmente.

### Advertencia benigna: layout del WAV

FFmpeg indicó que infirió el layout mono del WAV:

```text
Guessed Channel Layout: mono
```

El audio final fue codificado correctamente como AAC mono y FFprobe lo confirmó.

## 13. Comandos principales ejecutados

```text
scoop install ffmpeg
ffmpeg -version
ffprobe -version
ffmpeg -hide_banner -encoders
ffmpeg -hide_banner -pix_fmts
ffmpeg -hide_banner -formats
npm init -y
npm install pixi.js
npm install --save-dev typescript vite
npm run assets
npm run build
npm run dev -- --host 127.0.0.1
npm run export
npm run verify
```

Los comandos FFmpeg que contienen rutas o filtros fueron ejecutados con arrays de argumentos en PowerShell o Node.js. Los scripts versionados no construyen comandos concatenando strings y no utilizan `shell: true`.

Algunas pruebas se ejecutaron dos veces después de corregir el canal alfa. Los resultados documentados corresponden a la ejecución final válida.

## 14. Archivos creados

### Configuración

```text
.gitignore
package.json
package-lock.json
tsconfig.json
vite.config.ts
index.html
```

### Vista previa

```text
src/main.ts
src/style.css
src/vite-env.d.ts
```

### Scripts Node.js

```text
scripts/process.mjs
scripts/generate-assets.mjs
scripts/export-video.mjs
scripts/verify-output.mjs
```

### Assets

```text
assets/background.png
assets/character_body.png
assets/character_overlay.png
assets/test.wav
```

### Evidencia y salidas

```text
output/stage0-synthetic.mp4
output/stage0-final.mp4
output/stage0-export-metrics.json
output/stage0-final-ffprobe.json
temp/frames/frame_001.png ... frame_090.png
dist/                  build de producción generado por Vite
```

`node_modules` también fue creado por npm y contiene exclusivamente el árbol requerido por las tres dependencias declaradas.

## 15. Estado de los siete objetivos técnicos

| Objetivo | Estado | Evidencia |
|---|---|---|
| Composición 1080×1920 | Aprobado | Canvas y MP4 verificados |
| Render simple PixiJS | Aprobado | WebGLRenderer en navegador |
| Fondo y PNG transparentes | Aprobado | Preview y frames inspeccionados |
| Reproducción WAV | Aprobado | Reproducir y pausar verificados |
| FFmpeg desde Node.js | Aprobado | Scripts con `spawnSync` y `shell: false` |
| Exportación de pocos segundos | Aprobado | 90 frames, MP4 de 3 s |
| Voz local | Aprobado con restricción | Piper 1.5.0 en CPU; requiere ruta ASCII en Windows para espeak-ng |

## 16. Resultado de la prueba de Piper

La prueba aislada de Piper se completó con el modelo `es_AR-daniela-high`:

- Dos generaciones de 5,0039 segundos.
- Tiempos de 2,469 y 2,392 segundos.
- Aproximadamente 292 MB de memoria máxima.
- PCM s16le, mono, 22.050 Hz.
- Exportación final H.264/AAC aceptada por FFmpeg.
- Ejecución completamente local en CPU.

Se detectó que el bridge nativo de espeak-ng incluido en la wheel Windows 1.5.0 falla cuando su ruta contiene la letra `ñ`. La misma instalación funciona al acceder a `tts-test` mediante una letra de unidad temporal con ruta ASCII. Esta restricción debe resolverse mediante staging ASCII o una ubicación de runtime sin caracteres Unicode.

Ver el informe detallado:

```text
ETAPA_0_PIPER_RESULTADOS.md
```

No corresponde avanzar todavía hacia lip sync, IA, JSON definitivo, varias escenas, Electron o editor visual.
