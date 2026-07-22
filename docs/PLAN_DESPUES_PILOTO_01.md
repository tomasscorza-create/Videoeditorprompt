# Plan después del Piloto 01

Fecha: 22 de julio de 2026.

Estado: Etapas 2B–2F implementadas y verificadas técnicamente. Antes de comenzar 3A falta la aprobación humana del gate completo de 2F.

## Conclusión

El Piloto 01 aprobó el circuito técnico completo, pero todavía no aprobó la calidad de animación de un producto real. El proyecto continúa en la **Fase 1: núcleo local confiable**.

La infraestructura de Fase 1 está bastante avanzada: configuración validada, TTS, FFprobe, evaluador determinista, frames, MP4, jobs aislados, caché, errores y preview técnico. La capa de producción visual todavía es inicial: faltan personajes reutilizables reales, gestos, diálogos, fondos animados, subtítulos temporizados y varias escenas.

Como aproximación orientativa:

- infraestructura técnica de una escena: 80–90 %;
- capacidades creativas/visuales de Fase 1: 20–30 %;
- Fase 1 completa: aproximadamente 50 %;
- producto final imaginado: todavía en una etapa temprana.

No conviene medir el avance por cantidad de archivos, sino por la capacidad de producir videos repetidamente sin editar código.

## Lo que demostró el piloto

### Aprobado

- Exportación vertical real.
- Voz local suficientemente clara para continuar.
- Imagen atractiva y adecuada para teléfono.
- Subtítulo legible.
- Movimiento de cámara básico.
- MP4 verificable y determinista.
- Configuración portable y job independiente.

### Faltante observado

- dos personajes independientes;
- dos voces o turnos diferenciados;
- fondo con elementos animados o parallax;
- subtítulos sincronizados por frase;
- varias escenas;
- interfaz de autoría manual.

Resuelto en 2B–2C: selector por `jobId`, boca visible de tres estados, parpadeos, idle y gesto de señalar mediante capas reemplazables.

La voz actual puede pulirse con texto, puntuación, velocidad y eventualmente otra voz, pero el problema principal del piloto no fue el TTS: fue la ausencia de actuación visual y separación de hablantes.

## Por qué Vite muestra el video anterior

La vista previa no abre archivos MP4. Reconstruye la escena en PixiJS leyendo siempre estas rutas fijas:

```text
/generated/scene.config.json
/generated/scene-runtime.json
```

Antes de la Etapa 2B, `public/generated/` contenía solamente el trabajo técnico `preview`, de 4,90 segundos. El Piloto 01 había sido ejecutado sin `--publish-dir`, por lo que su MP4 estaba correctamente en su output, pero sus archivos de preview no sustituían a los anteriores.

Para mostrar ahora el piloto en `http://localhost:5173`, se puede publicar sin volver a renderizar:

```powershell
node scripts/stage1/publish-preview.mjs `
  --job-id piloto-monos-mundial-01 `
  --config pilots/monos-mundial-01/scene.config.json `
  --assets-dir public `
  --publish-dir public/generated
```

Después hay que recargar la página; si el navegador conserva archivos anteriores, usar una recarga forzada.

Esta solución reemplaza el preview publicado. Para volver al ejemplo anterior habría que publicarlo otra vez. Por eso el siguiente ajuste recomendado es dejar de depender de una única carpeta plana.

## Siguiente etapa recomendada

### Etapa 2B — Selector de trabajos y preview reproducible — COMPLETADA

Debe ser pequeña y no convertirse todavía en editor.

Objetivo: poder abrir y comparar cualquier trabajo generado sin copiar archivos manualmente ni sobrescribir el preview anterior.

Alcance recomendado:

- publicar cada trabajo bajo `public/generated/<jobId>/`;
- generar un índice/manifest local de previews disponibles;
- seleccionar un `jobId` mediante query string o selector sencillo;
- mostrar nombre, duración, estado y enlace al MP4;
- conservar play, pausa y reinicio;
- mantener el evaluador temporal compartido;
- no agregar React, Electron, timeline ni edición de propiedades.

Ejemplos deseados:

```text
http://localhost:5173/?job=preview
http://localhost:5173/?job=piloto-monos-mundial-01
```

Criterio de salida:

- ambos trabajos pueden abrirse sin volver a renderizar;
- cambiar de trabajo no sobrescribe el otro;
- el preview PixiJS carga config, runtime, audio y derivados del job seleccionado;
- una ruta inválida produce un mensaje comprensible.

Esta etapa resuelve el problema operativo observado y crea una base útil para el editor futuro, sin diseñar aún el editor.

## Etapas visuales posteriores

### Etapa 2C — Personaje animable real por capas — COMPLETADA TÉCNICAMENTE

Objetivo: demostrar actuación visual con un personaje reutilizable, no con una ilustración plana.

Alcance:

- manifest de personaje con ID y versión;
- capas PNG alineadas y con pivotes definidos;
- cuerpo/base;
- ojos abiertos y cerrados;
- tres formas visibles de boca;
- al menos dos poses de brazos/manos;
- animación idle sencilla;
- una acción de gesto, por ejemplo señalar o levantar la mano;
- preview y exportación usando el mismo evaluador;
- un personaje real de prueba, preferiblemente un mono estilizado y reutilizable.

No debería incluir todavía múltiples escenas ni un editor visual.

Criterio de salida:

- la boca cambia visiblemente con los cues RMS;
- el personaje parpadea;
- ejecuta al menos un gesto en un tiempo definido;
- repetir el render produce el mismo resultado;
- los assets pueden sustituirse sin cambiar el motor.

### Etapa 2D — Diálogo temporizado y dos hablantes — COMPLETADA TÉCNICAMENTE

Objetivo: representar una conversación real.

Alcance:

- diálogo como lista de turnos;
- `speakerId`, texto, inicio/duración medida y voz;
- generación/cache de voz por turno;
- composición de audio determinista;
- subtítulos por cue temporal;
- boca activa solo para el personaje que habla;
- silencio y reacción del segundo personaje;
- dos voces diferenciadas o, como mínimo, parámetros de voz distintos.

La voz actual puede conservarse como una de las voces. Antes de buscar otro motor TTS conviene probar otra voz Piper española y ajustes de prosodia dentro de un benchmark pequeño.

### Etapa 2E — Fondo y cámara animables — COMPLETADA TÉCNICAMENTE

Objetivo: evitar escenas completamente estáticas sin introducir efectos complejos.

Alcance:

- fondo dividido en dos o tres capas;
- paneo y zoom por keyframes;
- parallax simple;
- uno o dos elementos ambientales en loop;
- entrada/salida o reacción sencilla;
- límites para que la cámara no muestre zonas vacías.

### Etapa 2F — Contrato creativo y gate de calidad — IMPLEMENTADA TÉCNICAMENTE

Antes de multiplicar la composición a varias escenas se validará una escena de calidad más representativa y un vertical slice de assets paramétricos.

Se divide en:

- **2F.0 — definición documental:** flujo prompt → proyecto editable, separación entre autoría/runtime/artefactos, rig paramétrico y catálogo. Completada en `docs/VISION_PRODUCTO_Y_ETAPA_2F.md`.
- **2F.1 — calidad:** piloto de 20,47 segundos con texto TTS normalizado, dos voces/configuraciones, boca RMS estabilizada, parpadeo, idle, gesto y actuación de hablante/oyente. Implementado; pendiente de aprobación humana.
- **2F.2 — asset paramétrico:** definición geométrica segura, dos variantes, joints, dos poses, manifest v2, PNG transparentes y catálogo resoluble por ID. Implementado y verificado de forma determinista.

Esta etapa no implementa todavía IA real, editor, varias escenas, generación de imágenes por modelo ni rig avanzado.

### Etapa 3A — Varias escenas y transiciones

Solo después de superar el gate de 2F dentro de una escena:

- lista lineal de escenas;
- duración medida/compilada;
- corte y fundido sencillo;
- audio y subtítulos continuos;
- concatenación determinista;
- máximo pequeño de escenas para el primer contrato.

## Cuándo diseñar el editor manual

Conviene separar tres niveles.

### 1. Visor/selector: ahora

La Etapa 2B agregó una interfaz mínima para seleccionar, reproducir y descargar trabajos. No es un editor; resuelve una necesidad real sin fijar prematuramente el modelo de datos.

### 2. Diseño UX del editor: durante Etapas 2C–2D

Se pueden preparar wireframes y definir el flujo mientras se estabilizan personajes y diálogos:

- crear/abrir proyecto;
- elegir fondo;
- añadir personaje;
- escribir diálogo;
- elegir voz;
- seleccionar pose/gesto;
- previsualizar;
- renderizar;
- revisar errores.

Este diseño no debería asumir una timeline profesional. La interfaz debe editar datos del contrato, no controlar frames manualmente.

### 3. Implementación del editor MVP: después de Etapa 3A

El editor manual debería comenzar a implementarse cuando estén probados:

- contrato de proyectos y escenas;
- personajes por ID/capas;
- acciones y poses soportadas;
- diálogo y subtítulos temporizados;
- fondos/cámara;
- varias escenas lineales;
- preview/exportación equivalentes.

Si se implementa antes, cada cambio del contrato obligará a rehacer formularios, estado, guardado y timeline.

El primer editor MVP debería incluir solamente:

- lista de proyectos;
- lista ordenada de escenas;
- formulario de propiedades de escena;
- selector de assets/personajes;
- diálogo y voz;
- presets de acciones;
- preview;
- botón de preparar/exportar;
- progreso y errores.

No debería incluir todavía edición estilo Premiere, keyframes libres, colaboración, nube o timeline profesional.

La decisión React/Electron debe posponerse. El visor 2B puede continuar con Vite, TypeScript, DOM y PixiJS. Cuando el editor tenga suficiente estado y formularios reales se evaluará si una librería de UI aporta valor. Electron sigue siendo posterior al circuito web-local estable.

## Orden recomendado

1. **Etapa 2B — completada:** selector de jobs y publicación por `jobId`.
2. **Etapa 2C — completada técnicamente:** personaje real por capas con boca, ojos, idle y manos.
3. **Etapa 2D — completada técnicamente:** diálogo por turnos, voces parametrizadas y subtítulos temporizados.
4. **Etapa 2E — completada técnicamente:** fondo/cámara/parallax.
5. **Etapa 2F — implementada técnicamente:** calidad de voz/boca/actuación y vertical slice paramétrico; falta aprobación humana del gate.
6. **Etapa 3A — siguiente solo después de aprobar el gate 2F:** varias escenas y transiciones.
7. **Diseño UX en paralelo; implementación del editor MVP después de estabilizar 2F/3A.**

## Decisión propuesta

La Etapa 2F ya tiene evidencia técnica de calidad mejorada y recursos paramétricos reutilizables por ID. El siguiente acto no es ampliar automáticamente el núcleo: primero debe revisarse el video de 2F.1 y el piloto paramétrico, confirmar que Claude puede representar sus IDs/variantes/poses y aprobar o devolver el gate. Solo entonces se retomará 3A sin convertir el preview en un editor profesional.
