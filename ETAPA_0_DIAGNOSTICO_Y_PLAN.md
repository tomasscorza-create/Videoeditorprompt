# Etapa 0: diagnóstico del entorno y plan de pruebas

**Fecha de inspección:** 21 de julio de 2026  
**Estado:** diagnóstico completado. Las pruebas visuales y de exportación fueron ejecutadas posteriormente. Ver `ETAPA_0_RESULTADOS.md` para la evidencia real.

## 1. Conclusión ejecutiva

La Etapa 0 es técnicamente viable en esta computadora. El hardware es suficiente para una composición 2D vertical sencilla, una exportación offline y pruebas de TTS en CPU.

Los bloqueos actuales son de software:

- FFmpeg y FFprobe no están instalados o accesibles.
- No existen todavía PixiJS, Vite, TypeScript ni Electron en el proyecto.
- No hay un motor de voz local instalado.
- La carpeta aún no contiene un proyecto de software.

Durante la inspección no se modificó el proyecto ni se instalaron dependencias.

## 2. Contenido actual del repositorio

La carpeta contenía inicialmente:

- `PROPUESTA_TECNICA.md`
- Ninguna subcarpeta.
- Ningún archivo de código.
- Ningún asset gráfico o archivo de audio.

No existen todavía:

- `package.json`
- Lockfile de npm o pnpm.
- `tsconfig.json`
- Configuración de Vite.
- Proyecto Electron.
- Código PixiJS.

Este documento fue agregado después de la inspección para conservar el diagnóstico.

## 3. Sistema operativo y hardware

| Componente | Resultado |
|---|---|
| Windows | Windows 11 Pro, 64 bits |
| Versión | 10.0.26200, build 26200 |
| CPU | AMD Ryzen 5 8500G |
| Núcleos e hilos | 6 núcleos, 12 hilos |
| RAM instalada | 32 GB DDR5 |
| RAM disponible durante la inspección | 18,77 GB |
| Gráficos | AMD Radeon 740M integrada |
| Controlador gráfico | 32.0.31021.5001, 27/06/2026 |
| Pantalla actual | 1920×1080 a 59 Hz |
| Disco C | 930,59 GB NTFS, estado saludable |
| Espacio libre | 574,39 GB |
| Audio | Cuatro dispositivos detectados y funcionando |

Windows informa 0,5 GB como memoria dedicada de la Radeon 740M. Al ser una GPU integrada, también utiliza memoria compartida, por lo que ese valor no representa toda la memoria gráfica disponible.

No se pudo obtener el detalle completo de niveles DirectX porque esa consulta fue bloqueada al requerir la creación y eliminación de un archivo temporal. No es un bloqueo para la Etapa 0: la compatibilidad real de WebGL se verificará ejecutando PixiJS.

## 4. Toolchain instalado

| Herramienta | Estado |
|---|---|
| Node.js | `v24.14.0`, x64 |
| npm | `11.9.0` |
| pnpm | `10.33.2` |
| Git | `2.52.0.windows.1` |
| Python | `3.10.11`, 64 bits |
| pip | `23.0.1` |
| Scoop | Instalado |
| VS Code | Instalado |
| Runtimes Visual C++ | Instalados |

Paquetes globales de npm encontrados:

- `@openai/codex` 0.117.0
- `cline` 2.17.0
- `netlify-cli` 24.2.0
- `pnpm` 10.33.2

Aplicaciones administradas por Scoop:

- `7zip` 26.00
- `supabase` 2.90.0

No hay dependencias locales en el repositorio. PixiJS, TypeScript, Vite y Electron deberán instalarse localmente y quedar fijados en el futuro lockfile.

## 5. Estado de FFmpeg y FFprobe

FFmpeg y FFprobe no están disponibles en `PATH` ni fueron encontrados en las ubicaciones habituales inspeccionadas.

Las comprobaciones desde Node.js produjeron:

```text
ffmpeg: ENOENT
ffprobe: ENOENT
```

Esto bloquea actualmente:

- El acceso a FFmpeg desde Node.js.
- La exportación a MP4.
- La verificación del resultado mediante FFprobe.

Scoop ya está instalado y puede ser una vía sencilla para instalar FFmpeg en el siguiente paso autorizado.

Después de instalarlo se deberá comprobar que la compilación incluya:

- Codificador H.264, preferentemente `libx264`.
- Codificador AAC.
- Decodificación WAV/PCM.
- Formato de píxeles `yuv420p`.
- Ejecutable `ffprobe`.

## 6. Estado de voz local

No se encontraron:

- Piper.
- `piper-tts`.
- eSpeak o eSpeak NG.
- ONNX Runtime.
- Whisper.
- Torch o TensorFlow.

La viabilidad estimada es favorable: el Ryzen 5 8500G, sus 12 hilos y 32 GB de RAM no presentan un impedimento evidente para ejecutar una voz Piper en CPU.

Todavía falta validar:

- Instalación del runtime.
- Compatibilidad con Python 3.10 o ejecución mediante binario independiente.
- Disponibilidad y calidad de una voz española.
- Tiempo para generar una frase.
- Consumo máximo de memoria.
- Duración y formato del WAV resultante.
- Relación entre tiempo de generación y duración del audio.

No es necesario instalar Whisper ni llama.cpp durante esta etapa.

## 7. Dependencias mínimas propuestas

### Dependencias JavaScript

- `pixi.js`
- `electron`
- `vite`
- `typescript`
- Tipos mínimos necesarios para Node.js

No se agregará todavía:

- React.
- Ajv.
- Sistema de estado.
- Librerías de timeline.
- Librerías generales de animación.
- Monorepo.
- Múltiples paquetes internos.
- Infraestructura de IA.

Se recomienda usar npm para mantener la prueba sencilla, aunque pnpm también está disponible.

### Herramientas externas

- FFmpeg y FFprobe.
- Piper y una sola voz española para la prueba de viabilidad.

## 8. Estructura mínima recomendada

Esta estructura todavía no fue creada:

```text
Diseñador de videos LOCAL/
  PROPUESTA_TECNICA.md
  ETAPA_0_DIAGNOSTICO_Y_PLAN.md
  package.json
  package-lock.json
  tsconfig.json
  vite.config.ts
  index.html

  src/
    main.ts
    stage.ts
    audio.ts
    export.ts

  assets/
    background.png
    character_body.png
    character_overlay.png
    test.wav

  output/
  temp/
```

Responsabilidades propuestas:

- `main.ts`: inicialización mínima de Electron y coordinación.
- `stage.ts`: PixiJS, canvas 1080×1920 y animación de prueba.
- `audio.ts`: carga y reproducción del WAV.
- `export.ts`: captura de frames y ejecución de FFmpeg.
- `output/`: MP4 final.
- `temp/`: frames descartables de la exportación.

No se dividirá todavía el código en paquetes de esquema, compilador, audio, assets o IA.

## 9. Composición técnica de prueba

La prueba visual deberá contener:

- Canvas lógico de 1080×1920.
- Vista previa escalada para entrar en una pantalla de 1920×1080.
- Fondo PNG.
- Personaje PNG transparente.
- Segundo sprite transparente superpuesto.
- Movimiento horizontal o vertical durante tres segundos.
- Cambio sencillo de escala u opacidad.
- Reproducción de un WAV iniciada por el usuario.

La resolución lógica debe permanecer en 1080×1920 aunque la vista previa se muestre reducida.

## 10. Orden exacto de pruebas

### Prueba 1: preparar los recursos

Verificar:

- Dimensiones.
- Transparencia.
- Perfil de color.
- Formato del WAV.

Resultado esperado: todos los archivos pueden abrirse correctamente antes de integrarlos con PixiJS.

### Prueba 2: instalar y verificar FFmpeg

Comprobar:

- `ffmpeg -version`
- `ffprobe -version`
- Disponibilidad de H.264 y AAC.
- Generación de un MP4 sintético corto.
- Lectura del resultado con FFprobe.

Resultado esperado: MP4 1080×1920, 30 fps, H.264 y `yuv420p`.

### Prueba 3: crear el proyecto mínimo

Inicializar npm, TypeScript, Vite, Electron y PixiJS.

Resultado esperado: una ventana local abre correctamente, sin React ni arquitectura adicional.

### Prueba 4: validar PixiJS

Crear un canvas lógico de 1080×1920 y mostrar:

- Color de fondo.
- Rectángulo de prueba.
- Texto técnico con resolución y fps.
- Transformación animada.

Resultado esperado: ejecución fluida y ausencia de errores gráficos.

### Prueba 5: validar los PNG

Cargar el fondo, el personaje y una capa adicional.

Comprobar:

- Transparencia real.
- Alineación.
- Escala.
- Filtrado visual.
- Orden de capas.

Resultado esperado: personaje correctamente compuesto sobre el fondo, sin bordes opacos.

### Prueba 6: validar WAV

Reproducir el WAV al pulsar un botón.

Comprobar:

- Inicio y pausa.
- Duración.
- Ausencia de errores de decodificación.
- Funcionamiento dentro de Electron.

La reproducción se iniciará mediante una interacción explícita para evitar restricciones de autoplay.

### Prueba 7: validar acceso a FFmpeg desde Node.js

Lanzar FFmpeg mediante `child_process` usando:

- Ejecutable resuelto explícitamente.
- Argumentos como array.
- Captura de código de salida.
- Captura de `stderr`.
- Rutas absolutas.

La carpeta contiene espacios y el carácter `ñ`. No se deben construir comandos concatenando strings.

### Prueba 8: exportar tres segundos

Renderizar 90 frames a 30 fps:

- Frame inicial.
- Movimiento sencillo.
- Frame final.
- Secuencia PNG temporal.
- WAV agregado como pista de audio.
- Exportación MP4.

Resultado esperado según FFprobe:

- 1080×1920.
- 30 fps.
- Aproximadamente tres segundos.
- H.264.
- AAC.
- `yuv420p`.
- Una pista de video y una de audio.

### Prueba 9: probar Piper

En un entorno Python aislado:

- Instalar Piper.
- Descargar una sola voz española.
- Generar una frase de 5 a 10 segundos.
- Medir tiempo y memoria.
- Verificar el WAV con FFprobe.
- Repetir la generación para comprobar estabilidad.

Piper todavía no se integrará con el proyecto; será una prueba técnica separada.

## 11. Recursos que debe preparar el usuario

### Mínimo obligatorio

#### `background.png`

- Exactamente 1080×1920.
- Preferentemente opaco.
- RGB o RGBA.
- Sin elementos importantes pegados a los bordes.

#### `character_body.png`

- PNG con transparencia real.
- Personaje completo o cuerpo principal.
- Sin fondo blanco.
- Resolución suficiente para ocupar aproximadamente entre 60 % y 80 % de la altura del video.

#### `character_overlay.png`

- Capa transparente para probar superposición.
- Puede ser ojos, boca, brazo o accesorio.
- Debe estar alineada con `character_body.png`.

#### `test.wav`

- Voz hablada de entre 3 y 5 segundos.
- PCM de 16 bits.
- 44.100 o 48.000 Hz.
- Mono o estéreo.
- Sin música ni ruido fuerte.

### Preparación recomendada del personaje

Para la Etapa 0, lo más sencillo es exportar todas las capas desde el mismo lienzo de 1080×1920, conservando su posición original:

```text
character_body.png
eyes_open.png
eyes_closed.png
mouth_closed.png
mouth_medium.png
mouth_open.png
```

Aunque estos PNG completos ocupen más espacio, eliminan temporalmente el problema de anchors y coordenadas. En una etapa posterior podrán recortarse y describirse mediante un manifiesto.

La Etapa 0 solo necesita utilizar `character_body.png` y una capa adicional. Los ojos y las bocas son recomendables para preparar el siguiente prototipo sin rehacer el arte.

## 12. Riesgos concretos

- FFmpeg es el bloqueo inmediato.
- No existe todavía ningún runtime de TTS.
- La pantalla es horizontal 1920×1080; la composición vertical se mostrará reducida.
- La GPU es integrada; se debe validar WebGL sin filtros complejos.
- No se confirmaron los niveles DirectX mediante diagnóstico detallado.
- La ruta del proyecto contiene espacios y `ñ`; los procesos deben usar argumentos y rutas correctamente estructurados.
- Una secuencia PNG consume espacio y tiempo, aunque los 574 GB libres son suficientes para una prueba corta.
- Rendimiento y calidad de la voz española deben evaluarse por separado.
- El valor de memoria gráfica informado por Windows no es fiable para una GPU integrada.
- El autoplay de audio puede bloquearse si no se inicia con un clic.
- La descarga inicial de Electron será considerable, pero no representa un problema operativo posterior.

## 13. Criterio de cierre de la Etapa 0

La etapa quedará validada solamente si se obtiene evidencia de que:

1. PixiJS renderiza una escena lógica de 1080×1920.
2. El fondo y los sprites transparentes cargan correctamente.
3. Un WAV se reproduce dentro de la aplicación.
4. Node.js encuentra y ejecuta FFmpeg.
5. Se genera un MP4 vertical de tres segundos con audio.
6. FFprobe confirma sus propiedades.
7. Piper genera una frase española localmente y se registra su rendimiento.

Hasta completar estas siete comprobaciones no conviene iniciar el formato JSON definitivo, el sistema de personajes ni el director IA.

## 14. Próximo paso propuesto

Cuando el usuario lo autorice:

1. Instalar y validar FFmpeg.
2. Recibir o crear los assets mínimos de prueba.
3. Crear la estructura mínima del proyecto.
4. Instalar solo las dependencias aprobadas.
5. Ejecutar las pruebas en el orden documentado.
6. Registrar los resultados reales en un segundo archivo Markdown.
