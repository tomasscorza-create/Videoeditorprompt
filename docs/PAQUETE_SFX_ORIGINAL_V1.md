# Paquete SFX original V1

## Alcance

El sistema incorpora ocho efectos mono PCM16 a 48 kHz, generados de forma determinista por código propio:

| Categoría | Efectos |
| --- | --- |
| Interfaz | click suave, alerta limpia |
| Acento | pop positivo, destello |
| Transición | whoosh corto, whoosh ascendente |
| Impacto | impacto suave, impacto profundo |

Las fuentes no usan samples, grabaciones, modelos ni bibliotecas sonoras de terceros. Los WAV publicados pueden regenerarse con `npm run stage2f:sfx-pack` y la prueba compara sus SHA-256.

## Autoría y tiempo

Cada escena puede declarar hasta 16 eventos en `soundEffects`. Un evento referencia un recurso `sfx`, ganancia en dB y un ancla semántica:

- inicio o fin de escena;
- inicio o fin de un turno;
- desplazamiento de hasta cinco segundos respecto del ancla.

El proyecto no inventa tiempos absolutos. El compilador conserva las anclas y `prepare-dialogue.mjs` las resuelve después de medir los WAV de voz con FFprobe. Los eventos fuera de la escena se rechazan explícitamente.

## Mezcla y determinismo

FFmpeg convierte cada efecto a mono PCM16 de 22.050 Hz, aplica la ganancia declarada, lo desplaza por una cantidad entera de muestras y lo mezcla con voz y música antes del limitador maestro. El hash del audio maestro incluye recursos, tiempos medidos y ganancias de SFX.

## Licencia

Los ocho efectos se publican como `CC0-1.0`, con uso comercial y redistribución permitidos y sin atribución obligatoria. El manifiesto legal conserva titular, licencia y procedencia por recurso.
