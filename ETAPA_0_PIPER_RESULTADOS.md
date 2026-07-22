# Etapa 0: prueba aislada de Piper TTS

**Fecha:** 22 de julio de 2026  
**Estado:** completada  
**Decisión:** Piper es viable para el primer prototipo en CPU, con una restricción de rutas Unicode en Windows.

## 1. Resultado ejecutivo

Piper generó localmente dos WAV válidos de la misma frase, cada uno de 5,0039 segundos. La síntesis tardó 2,469 y 2,392 segundos, por lo que se ejecutó aproximadamente al doble de la velocidad de reproducción.

El consumo máximo observado fue de unos 292 MB de RAM. FFmpeg aceptó el WAV sin conversión previa y produjo un MP4 vertical válido de 5,004 segundos con H.264/AAC.

El rendimiento es suficiente para el primer prototipo. No se necesita GPU dedicada.

Existe una restricción concreta: la wheel oficial Windows no pudo inicializar espeak-ng al ejecutarse directamente desde una ruta que contiene `ñ`. La misma instalación funcionó usando una letra de unidad temporal que presenta una ruta ASCII. Esta restricción debe contemplarse en el diseño del runtime local.

## 2. Distribución elegida

Se utilizó la continuación mantenida:

- Proyecto: [`OHF-Voice/piper1-gpl`](https://github.com/OHF-Voice/piper1-gpl)
- Versión instalada: `piper-tts 1.5.0`
- Fecha de la release: 17 de julio de 2026
- Distribución: wheel oficial `piper_tts-1.5.0-cp39-abi3-win_amd64.whl`
- Plataforma: Windows AMD64
- Licencia del motor: GPL-3.0
- Backend: ONNX Runtime para CPU
- Phonemizer: espeak-ng integrado

La release 1.5.0 es la versión mantenida actual y contiene cambios específicos para compilación en Windows. La documentación oficial recomienda instalar la interfaz Python mediante `pip install piper-tts`.

No se utilizó el repositorio antiguo `rhasspy/piper`, que se encuentra archivado.

## 3. Método de instalación aislada

Piper se instaló exclusivamente en:

```text
tts-test/.venv/
```

El modelo y las salidas están en:

```text
tts-test/models/
tts-test/output/
```

No se modificaron:

- `package.json`
- `src/`
- La vista previa PixiJS.
- La arquitectura de la aplicación.

El entorno virtual ocupa aproximadamente 187,76 MB. El directorio del modelo y su metadata ocupa aproximadamente 108,92 MiB.

Dependencias instaladas dentro del entorno aislado:

| Paquete | Versión |
|---|---:|
| `piper-tts` | 1.5.0 |
| `onnxruntime` | 1.23.2 |
| `numpy` | 2.2.6 |
| `protobuf` | 7.35.1 |
| `pathvalidate` | 3.3.1 |
| `coloredlogs` | 15.0.1 |

El resto son dependencias transitivas de estos paquetes.

## 4. Modelo de voz elegido

| Propiedad | Valor |
|---|---|
| ID exacto | `es_AR-daniela-high` |
| Archivo | `es_AR-daniela-high.onnx` |
| Voz | Daniela |
| Idioma del catálogo | Español |
| Región del catálogo | Argentina (`es_AR`) |
| Calidad | High |
| Speakers | 1 |
| Sample rate | 22.050 Hz |
| Phonemizer configurado | `es-419` |
| Tamaño ONNX | 114.199.011 bytes |
| Tamaño de configuración | 7.248 bytes |
| MD5 | `e373fb657c93877dbc438badeadff4cb` |
| SHA-256 | `7ceb1fc0dab349418c5b54a639ae9ee595212d7c9ea422220d8419163d5cc985` |

Fuente oficial:

- [Catálogo `piper-voices`](https://huggingface.co/rhasspy/piper-voices)
- [Directorio de la voz Daniela](https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_AR/daniela/high)
- [Archivo ONNX](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_AR/daniela/high/es_AR-daniela-high.onnx)

El MD5 descargado coincide con el catálogo oficial.

### Inconsistencia de metadata

El catálogo general identifica correctamente la voz como `es_AR`, español de Argentina. La ficha `MODEL_CARD` contiene la línea `Language: es_ES (Spanish, Argentina)`, una inconsistencia aparente entre el código regional y la descripción. La configuración interna utiliza `es-419`, español latinoamericano.

Para este proyecto se registra la variante como `es_AR`, que es el ID oficial del modelo y la región declarada por el catálogo.

## 5. Licencias y procedencia

Se encontraron tres capas de licencia relevantes:

1. **Motor Piper actual:** GPL-3.0.
2. **Repositorio general `piper-voices`:** declarado como MIT por Hugging Face.
3. **Dataset de Daniela:** `Attribution-ShareAlike 4.0 International`, según la ficha específica del modelo.

La ficha específica declara:

```text
Dataset URL: https://www.openslr.org/61/
License: Attribution-ShareAlike 4.0 International
```

La interpretación conservadora para el proyecto es registrar esta voz como sujeta a atribución y compartir-igual, incluso aunque el repositorio general indique MIT. Antes de cualquier uso comercial o distribución de modelos, conviene revisar nuevamente los términos específicos.

## 6. Frase y parámetros

La frase utilizada exactamente en ambas ejecuciones fue:

> Esta es una prueba de voz generada localmente para nuestro sistema de animación.

Parámetros:

```text
Modelo: es_AR-daniela-high.onnx
Length scale: 1.55
CUDA: desactivado
Normalización: configuración predeterminada de Piper
Formato: WAV
```

Se utilizó `length-scale 1.55` porque la velocidad predeterminada producía una frase inferior a cinco segundos. No se cambió el texto entre ejecuciones.

## 7. Resultados de rendimiento

### Primera generación definitiva

| Métrica | Resultado |
|---|---:|
| Tiempo total | 2,468654 s |
| Duración WAV | 5,003900 s |
| Real-time factor | 0,493346 |
| Audio generado por segundo | 2,026975 s |
| Máximo de RAM observado | 291,801 MB |
| Tamaño WAV | 220.716 bytes |
| SHA-256 WAV | `793984b15709a31370873bdd7db4aeff978ae7eef76697eaff2e3c396051d8b4` |

### Segunda generación definitiva

| Métrica | Resultado |
|---|---:|
| Tiempo total | 2,392438 s |
| Duración WAV | 5,003900 s |
| Real-time factor | 0,478115 |
| Audio generado por segundo | 2,091548 s |
| Máximo de RAM observado | 292,332 MB |
| Tamaño WAV | 220.716 bytes |
| SHA-256 WAV | `12abc0f8074087f91e6dabc95e06ac5e393c649cdaae5ec5a3047fee2d7c1c16` |

### Comparación

- Diferencia de tiempo: 0,076216 s, aproximadamente 3,1 %.
- Diferencia de memoria máxima: 0,531 MB.
- Diferencia de duración: 0 s.
- Diferencia de tamaño: 0 bytes.
- Las formas de onda no son idénticas byte a byte.

La diferencia de hash es esperable porque Piper utiliza parámetros de ruido en la generación. La duración, tamaño, formato, consumo y tiempo fueron estables.

Promedios aproximados:

- Tiempo: 2,431 s.
- Memoria máxima: 292,1 MB.
- Velocidad: 2,06 segundos de audio por segundo de procesamiento.

## 8. Medición de memoria

La memoria se midió mediante APIs nativas de Windows, muestreando cada 10 ms todo el árbol de procesos iniciado por la wheel.

Esto fue necesario porque el ejecutable Python del entorno virtual actúa como lanzador y crea procesos hijos. Una primera medición solo observó el stub de aproximadamente 4 MB y fue descartada.

La cifra documentada de unos 292 MB es un máximo aproximado del working set agregado durante la generación. Es suficientemente precisa para evaluar viabilidad, pero no equivale a un perfil exhaustivo de memoria privada.

## 9. Propiedades verificadas de los WAV

FFprobe confirmó lo mismo en ambas generaciones:

| Propiedad | Resultado |
|---|---|
| Codec | `pcm_s16le` |
| Sample format | `s16` |
| Sample rate | 22.050 Hz |
| Canales | 1, mono |
| Duración | 5,003900 s |
| Tamaño | 220.716 bytes |

FFmpeg `volumedetect` informó:

| Ejecución | Volumen medio | Volumen máximo |
|---|---:|---:|
| 1 | -14,7 dB | -0,0 dB |
| 2 | -15,0 dB | -0,0 dB |

La normalización predeterminada lleva el pico a escala completa. Para el prototipo es aceptable, pero más adelante convendría normalizar a un margen seguro durante la mezcla final.

Archivos:

```text
tts-test/output/piper-test.wav
tts-test/output/piper-test-second.wav
tts-test/output/wav-verification.json
tts-test/output/benchmark-process-results.json
```

## 10. Problema de ruta Unicode en Windows

### Síntoma

La ejecución directa desde la ruta real falló con:

```text
Error processing file
'D:/a/piper1-gpl/piper1-gpl/_skbuild/win-amd64-3.9/cmake-build/espeak_ng-install/share/espeak-ng-data\phontab':
No such file or directory.
```

La wheel sí contiene:

```text
tts-test/.venv/Lib/site-packages/piper/espeak-ng-data/
```

### Diagnóstico

La parte nativa de espeak-ng no resolvió correctamente la ruta que contiene `ñ` y terminó utilizando una ruta de compilación interna como fallback.

### Solución de la prueba

Se creó temporalmente una letra de unidad ASCII:

```text
P: -> C:\Users\usuario\Desktop\Diseñador de videos LOCAL\tts-test
```

Piper se ejecutó desde:

```text
P:\.venv\Scripts\python.exe
```

Los WAV continuaron almacenándose físicamente dentro de `tts-test/output`. La unidad temporal se desmontó después de cada prueba y no quedó activa.

### Recomendación de implementación futura

Para el primer prototipo se recomienda una de estas soluciones:

1. Instalar el runtime TTS y los modelos en una ruta ASCII controlada, por ejemplo `C:\LocalVideoTTS\`.
2. Crear un directorio de staging ASCII para ejecutar Piper.
3. Mantener el proyecto donde está, pero no cargar las librerías nativas de Piper directamente desde esa ruta.

No conviene depender permanentemente de `subst`; fue adecuado para confirmar el diagnóstico.

## 11. Exportación con la voz de Piper

No se sobrescribió `assets/test.wav`. El pipeline recibió temporalmente:

```text
tts-test/output/piper-test.wav
```

Como el audio dura cinco segundos y la secuencia visual original dura tres, FFmpeg repitió la secuencia de 90 frames hasta que terminó la voz.

Archivo final:

```text
tts-test/output/stage0-piper-voice.mp4
```

Tiempo de exportación:

```text
0,677 segundos
```

FFprobe confirmó:

| Propiedad | Resultado |
|---|---|
| Video | H.264 |
| Resolución | 1080×1920 |
| Pixel format | yuv420p |
| Frame rate | 30 fps |
| Frames de video | 150 |
| Duración video | 5,000000 s |
| Audio | AAC |
| Sample rate de audio | 22.050 Hz |
| Canales | Mono |
| Duración audio | 5,003991 s |
| Duración contenedor | 5,003991 s |
| Tamaño MP4 | 193.751 bytes |
| Bitrate total | 309.754 bit/s |

La primera variante de exportación utilizó `-t 5.0039` y truncó aproximadamente 35 ms del stream AAC por redondeo de paquetes. Fue descartada. La exportación definitiva usa `-shortest` sin imponer un límite temporal manual y conserva el audio completo.

## 12. Comandos principales ejecutados

```text
python -m venv tts-test/.venv
tts-test/.venv/Scripts/python.exe -m pip install piper-tts
tts-test/.venv/Scripts/python.exe -m piper.download_voices --data-dir tts-test/models es_AR-daniela-high
subst P: <ruta absoluta de tts-test>
P:/.venv/Scripts/python.exe P:/run-benchmark.py
subst P: /D
python tts-test/verify-wavs.py
node tts-test/export-with-piper.mjs
```

Los scripts usan listas de argumentos y `shell=False`. No construyen comandos concatenando strings.

## 13. Archivos creados

```text
tts-test/README.md
tts-test/phrase.txt
tts-test/run-benchmark.py
tts-test/verify-wavs.py
tts-test/export-with-piper.mjs

tts-test/models/es_AR-daniela-high.onnx
tts-test/models/es_AR-daniela-high.onnx.json
tts-test/models/es_AR-daniela-high.MODEL_CARD.txt

tts-test/output/piper-test.wav
tts-test/output/piper-test-second.wav
tts-test/output/benchmark-process-results.json
tts-test/output/wav-verification.json
tts-test/output/stage0-piper-voice.mp4
tts-test/output/piper-video-ffprobe.json
tts-test/output/piper-video-export-metrics.json
```

El entorno `tts-test/.venv/` también fue creado y permanece aislado.

## 14. Evaluación honesta de calidad

### Lo que quedó demostrado

- La voz produce audio válido y estable.
- La velocidad es suficiente para producción local.
- El uso de RAM es bajo para esta computadora.
- La duración puede controlarse mediante `length-scale`.
- El acento configurado es español latinoamericano y el modelo está catalogado como argentino.
- FFmpeg acepta el WAV directamente.

### Lo que no puede afirmarse automáticamente

Las métricas técnicas no permiten determinar por sí solas naturalidad, expresividad, prosodia agradable o adecuación editorial. Esa evaluación requiere escuchar el audio. El asistente no debe fingir una evaluación auditiva que no realizó.

Los dos WAV quedan disponibles para escucha humana. El modelo utiliza normalización hasta 0 dB y una configuración VITS de una sola voz; por su naturaleza, es esperable que tenga menos expresividad que servicios TTS modernos de mayor tamaño.

## 15. Recomendación

**Piper es suficiente para el primer prototipo.**

La decisión se basa en:

- Ejecución totalmente local.
- Rendimiento superior al tiempo real en CPU.
- Consumo aproximado de solo 292 MB.
- Modelo argentino disponible.
- Integración comprobada con FFmpeg.
- Instalación relativamente pequeña.

No se recomienda evaluar otra alternativa antes de construir el primer prototipo, salvo que la escucha humana determine que la voz Daniela no alcanza el nivel mínimo de naturalidad requerido para publicar.

Condiciones para avanzar:

1. El usuario debe escuchar los dos WAV y aprobar o rechazar subjetivamente la voz.
2. El runtime futuro debe ubicarse en una ruta ASCII.
3. Se debe conservar la metadata y atribución de la voz.
4. La mezcla final deberá dejar margen de volumen en lugar de conservar picos a 0 dB.

Con estas condiciones, la Etapa 0 puede considerarse cerrada.

