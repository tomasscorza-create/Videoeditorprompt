# Diseñador local de videos animados 2D

## Documento de contexto y propuesta técnica

Este documento está pensado para transferir el proyecto a otra sesión de GPT, Codex o cualquier asistente técnico. Contiene el objetivo, las decisiones de arquitectura, el alcance inicial y el plan progresivo de implementación.

**Estado actual:** etapa de diseño. Todavía no debe escribirse el sistema completo ni ampliarse el alcance sin validar primero el prototipo mínimo descrito al final.

---

## 1. Objetivo del proyecto

Construir una herramienta personal y local para producir rápidamente videos animados 2D, principalmente verticales para redes sociales.

No será un producto comercial ni un editor profesional para terceros. La prioridad es acelerar una producción interna basada en:

- Personajes 2D precargados y divididos en capas.
- Fondos, escenarios y objetos reutilizables.
- Sprites, poses, gestos y animaciones predefinidas.
- Transformaciones simples: posición, escala, rotación y opacidad.
- Voz generada localmente.
- Movimiento de boca sincronizado con el audio.
- Parpadeo y acciones sencillas.
- Textos y subtítulos.
- Música, efectos y transiciones en etapas posteriores.
- Exportación final a MP4 mediante FFmpeg.

El sistema debe funcionar sin GPU dedicada. Se acepta que la generación de voz, la inferencia del modelo local o el render final sean más lentos en CPU.

## 2. Principios del producto

Las prioridades, en orden, son:

1. Simplicidad.
2. Velocidad de producción.
3. Reutilización de personajes y escenas.
4. Consistencia visual.
5. Bajo costo.
6. Ejecución local.
7. Ampliación gradual.

No se busca inicialmente:

- Edición profesional de video.
- Generación de cada frame mediante IA.
- Video realista.
- Modelos 3D.
- Efectos visuales complejos.
- Colaboración entre usuarios.
- Cuentas, nube o aplicación móvil.
- Una interfaz extremadamente pulida.

## 3. Concepto central

La herramienta debe comportarse como un **compilador de animaciones 2D**, no como un editor de video tradicional.

La inteligencia artificial actuará como directora: interpretará una idea o guion y propondrá escenas, acciones, diálogos y tiempos. Un motor determinista será el responsable de convertir ese plan en animaciones reales.

El flujo conceptual es:

```text
Idea o guion
    -> Director IA local
    -> Plan JSON semántico
    -> Validación
    -> Compilador de animación
    -> Timeline compilada
    -> Motor visual 2D
    -> Frames y audio
    -> FFmpeg
    -> MP4
```

Se deben separar tres niveles:

1. **Intención:** “el personaje entra, explica una idea, señala y termina con una llamada a la acción”.
2. **Plan semántico:** escenas, personajes, acciones, diálogo y tiempos aproximados.
3. **Timeline compilada:** sprites, posiciones, visibilidad, keyframes, bocas, audio y subtítulos con tiempos exactos.

La IA solamente debe producir el plan semántico. No debe generar cada frame, operar FFmpeg directamente ni crear miles de keyframes.

## 4. Arquitectura propuesta

### 4.1 Aplicación de autoría

Responsabilidades:

- Crear y abrir proyectos locales.
- Elegir personajes, fondos, objetos y plantillas.
- Editar escenas y diálogos.
- Mostrar una lista de escenas y un inspector de propiedades.
- Reproducir y pausar una vista previa.
- Regenerar voz o planificación.
- Ejecutar la exportación.

No necesita inicialmente una timeline profesional. Una lista de escenas, un reproductor y formularios sencillos son suficientes.

### 4.2 Esquema y validador

El formato JSON será el contrato central del sistema.

El validador debe:

- Comprobar la versión del esquema.
- Rechazar propiedades o acciones desconocidas.
- Validar tiempos, duraciones y tipos de valores.
- Verificar que existan los personajes y assets referenciados.
- Verificar que una acción sea compatible con el personaje.
- Detectar acciones fuera de la duración de una escena.
- Producir errores claros para el usuario o para la IA.
- Permitir migraciones futuras entre versiones del formato.

### 4.3 Biblioteca de recursos

Debe registrar mediante IDs estables:

- Personajes.
- Fondos.
- Props u objetos.
- Gráficos.
- Fuentes.
- Música y efectos.
- Animaciones.
- Plantillas.
- Voces.

Los proyectos nunca deben depender de rutas absolutas. Deben referenciar, por ejemplo, `alex.v1` o `studio.simple`.

### 4.4 Compilador de animación

Convierte acciones semánticas en tracks, estados y keyframes concretos.

Ejemplos:

- `enter`: genera posición inicial fuera de cuadro y desplazamiento hacia la posición final.
- `exit`: genera trayectoria de salida y cambio de visibilidad.
- `speak`: vincula audio, boca, parpadeos y subtítulos.
- `pointAt`: selecciona una pose o animación de brazo y orienta al personaje hacia el objetivo.
- `react`: instancia una animación predefinida según la emoción.
- `lookAt`: resuelve la dirección de ojos o cabeza hacia un elemento.

Este componente debe ser determinista y no depender del modelo de lenguaje.

### 4.5 Motor de reproducción 2D

Dado un tiempo exacto, calcula:

- Escena activa.
- Objetos visibles.
- Sprite o pose activa.
- Posición, escala, rotación y opacidad.
- Orden de capas.
- Estado de ojos.
- Forma de boca.
- Texto o subtítulo activo.
- Estado de una transición.

La vista previa y la exportación deben utilizar el mismo evaluador temporal para evitar diferencias entre lo que se ve y el MP4 final.

### 4.6 Pipeline de audio

Responsabilidades:

- Generar voz local.
- Guardar resultados en caché.
- Medir la duración real del audio.
- Normalizar volumen.
- Detectar silencios y energía de la voz.
- Generar cues de boca.
- Calcular tiempos de subtítulos.
- Mezclar voz, música y efectos.

La duración definitiva de una escena debe ajustarse después de generar la voz. No se debe confiar en una estimación temporal producida por la IA.

### 4.7 Exportador

Responsabilidades:

- Evaluar la composición a un frame rate fijo.
- Renderizar cada frame de manera determinista.
- Preparar la mezcla de audio.
- Ejecutar FFmpeg.
- Producir MP4 H.264/AAC compatible con redes sociales.
- Informar progreso y errores.

Para el primer prototipo se puede generar una secuencia temporal de PNG y luego codificarla. Es más lenta y ocupa más espacio, pero es fácil de inspeccionar. Más adelante se pueden enviar frames RGBA directamente a FFmpeg.

No se recomienda utilizar `MediaRecorder` como exportador principal porque dificulta el render determinista cuadro por cuadro.

### 4.8 Director basado en IA

Se agregará después de que el motor determinista funcione.

Responsabilidades:

- Convertir una idea en un guion breve.
- Dividir el guion en escenas.
- Elegir exclusivamente personajes y assets existentes.
- Generar acciones semánticas válidas.
- Respetar duración, formato y densidad visual.
- Entregar JSON restringido por un esquema.
- Corregir su plan cuando el validador encuentre errores.

El modelo debe recibir un catálogo resumido de recursos disponibles, no acceso directo al sistema de archivos.

## 5. Tecnologías recomendadas

### Núcleo de la aplicación

- **TypeScript:** lenguaje común para interfaz, esquema, compilador y motor.
- **Node.js LTS:** archivos, procesos, caché y ejecución de herramientas externas.
- **Electron:** aplicación local y acceso controlado al sistema operativo.
- **React:** paneles, formularios y organización de la interfaz.
- **Vite:** entorno de desarrollo y empaquetado de la interfaz.
- **PixiJS 8:** escena 2D, sprites, contenedores, máscaras, texto y transformaciones.
- **JSON Schema + Ajv:** definición y validación del contrato de escenas.
- **FFmpeg/FFprobe:** análisis, mezcla, codificación y exportación.

WebGL debería ser el renderer inicial de PixiJS por compatibilidad. No debe asumirse que WebGPU estará disponible.

### Voz local

Usar una interfaz de proveedores de voz. La primera implementación puede utilizar Piper, actualmente mantenido como `OHF-Voice/piper1-gpl`.

Para el prototipo:

- Una sola voz española.
- Salida WAV.
- Texto dividido por frases o bloques cortos.
- Caché por hash de texto, voz y parámetros.

El formato del proyecto no debe contener opciones internas de Piper. Debe utilizar IDs como `narrador_principal` para permitir reemplazar el proveedor más adelante.

### Sincronización labial

Primera versión:

- Analizar amplitud en ventanas de aproximadamente 20 a 40 ms.
- Suavizar los valores.
- Detectar silencio.
- Usar tres estados: `closed`, `medium` y `open`.
- Aplicar una duración mínima a cada estado para evitar vibración visual.

Mejora posterior:

- Integrar Rhubarb Lip Sync.
- Utilizar seis formas básicas y formas extendidas opcionales.
- En español, usar su reconocedor fonético.

El MVP no debe depender de Rhubarb.

### Modelo de lenguaje local

Usar `llama.cpp` mediante servidor HTTP y un modelo instruct cuantizado apropiado para la memoria y CPU disponibles.

La característica esencial es la salida restringida por JSON Schema. El modelo concreto debe ser intercambiable.

Toda respuesta debe pasar por:

1. Validación sintáctica.
2. Validación semántica.
3. Normalización.
4. Compilación.
5. Presentación de errores o reparación.

### Transcripción y análisis posterior

`whisper.cpp` puede incorporarse más adelante para audio importado, subtítulos o marcas temporales. No es necesario para el primer prototipo si la narración es generada desde texto conocido.

## 6. Formatos de datos

Se recomienda mantener dos documentos diferentes.

### 6.1 Plan de autoría

Es compacto, legible y puede ser escrito manualmente o generado por la IA.

Ejemplo ilustrativo:

```json
{
  "schemaVersion": "1.0",
  "video": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "backgroundColor": "#F4F1EA"
  },
  "cast": [
    {
      "instanceId": "presentador",
      "characterId": "alex.v1",
      "defaultPose": "neutral"
    }
  ],
  "scenes": [
    {
      "id": "introduccion",
      "durationMode": "fit-content",
      "backgroundId": "studio.simple",
      "elements": [
        {
          "instanceId": "grafico_idea",
          "assetId": "graphic.idea",
          "position": { "x": 760, "y": 620 }
        }
      ],
      "actions": [
        {
          "type": "enter",
          "target": "presentador",
          "startMs": 0,
          "durationMs": 600,
          "from": "left"
        },
        {
          "type": "speak",
          "target": "presentador",
          "startMs": 700,
          "dialogue": "Hoy vamos a explicar una idea muy simple.",
          "voiceId": "narrador_principal",
          "subtitles": true
        },
        {
          "type": "pointAt",
          "target": "presentador",
          "startMs": 2600,
          "durationMs": 1200,
          "element": "grafico_idea"
        }
      ]
    }
  ]
}
```

Este ejemplo muestra la dirección del formato, no constituye todavía el esquema definitivo.

### 6.2 Timeline compilada

Es generada por el compilador y normalmente no se edita a mano.

Debe contener:

- Duración definitiva.
- Tiempos normalizados.
- Tracks de posición, escala, rotación y opacidad.
- Cambios discretos de sprite.
- Cues de boca.
- Cues de ojos.
- Subtítulos resueltos.
- Archivos de audio generados.
- Semilla para variaciones reproducibles.
- Versiones o hashes de assets y archivos derivados.

Separar ambos documentos evita llenar el plan de autoría con miles de keyframes.

### 6.3 Reglas temporales y espaciales

Definir desde el principio:

- Tiempos semánticos como enteros en milisegundos.
- Cálculo de cada frame mediante `frameIndex / fps`, sin acumular deltas.
- Resolución de diseño fija de 1080 por 1920 para el formato vertical inicial.
- Origen visual en la esquina superior izquierda.
- Anchors normalizados entre 0 y 1.
- Orden de capas explícito.
- Transformaciones numéricas, sin unidades implícitas.
- Semilla fija para parpadeos y movimientos aleatorios.

## 7. Organización de assets

Estructura conceptual recomendada:

```text
assets/
  characters/
    alex.v1/
      manifest.json
      body/
      heads/
      eyes/
      mouths/
      hands/
      poses/
      animations/
  backgrounds/
  props/
  graphics/
  audio/
    music/
    sfx/
  fonts/
  templates/
```

### Manifiesto de personaje

Cada personaje debe declarar:

- ID y versión.
- Resolución de diseño.
- Punto de origen.
- Capas y orden de render.
- Rutas relativas de sprites.
- Anchors por capa.
- Poses disponibles.
- Gestos disponibles.
- Formas de boca soportadas.
- Estados de ojos.
- Reglas de parpadeo.
- Escala recomendada.
- Animaciones compatibles.
- Autor, fuente y licencia del arte.

### Capas iniciales de un personaje

Un personaje sencillo podría usar:

1. Piernas.
2. Torso.
3. Brazo trasero.
4. Cabeza.
5. Ojos.
6. Boca.
7. Brazo delantero.
8. Accesorios.

Las poses pueden cambiar el sprite, la transformación o visibilidad de las capas.

### Animaciones reutilizables

Las animaciones deben ser plantillas parametrizables, por ejemplo:

- `enter(from, duration)`
- `exit(to, duration)`
- `idle(intensity)`
- `talk(intensity)`
- `point(direction)`
- `nod(count)`
- `lookAt(target)`
- `popIn(scale)`
- `fadeIn(duration)`

El compilador debe convertir estas plantillas en tracks concretos. No se deben permitir scripts arbitrarios dentro del JSON.

## 8. Estructura conceptual del proyecto de software

Una posible organización futura del repositorio sería:

```text
apps/
  desktop/              Interfaz Electron y React
packages/
  schema/               JSON Schema, tipos y migraciones
  core/                 Modelo de dominio y validación semántica
  compiler/             Acciones semánticas a timeline
  renderer/             Motor PixiJS y evaluación temporal
  asset-library/        Manifiestos y resolución de recursos
  audio/                TTS, análisis y mezcla
  exporter/             Frames, FFmpeg y trabajos de exportación
  ai-director/          Adaptador para llama.cpp
assets/                 Biblioteca local de producción
projects/               Proyectos creados por el usuario
cache/                  Voz, cues y otros resultados regenerables
```

Esta estructura es una orientación. No conviene crear todos los paquetes antes de que exista el prototipo vertical.

## 9. Plan progresivo de implementación

### Etapa 0: contrato y prueba técnica

Objetivo:

- Definir coordenadas, tiempos, capas y formato de recursos.
- Crear un esquema JSON mínimo.
- Preparar un personaje de prueba correctamente separado.
- Probar PixiJS a 1080 por 1920.
- Verificar FFmpeg y el proveedor de voz.
- Medir una exportación corta en la computadora disponible.

Criterio de finalización:

- Las decisiones técnicas críticas fueron probadas, no solamente asumidas.

### Etapa 1: prototipo vertical completo

Objetivo:

- Leer un JSON manual.
- Cargar un fondo y un personaje.
- Generar o cargar voz.
- Reproducir el audio.
- Animar tres formas de boca mediante amplitud.
- Parpadear.
- Ejecutar una transformación sencilla.
- Mostrar un subtítulo.
- Exportar un MP4.

Criterio de finalización:

- El mismo JSON produce una vista previa y un MP4 sincronizados y repetibles.

### Etapa 2: reutilización

Agregar:

- Manifiestos de assets.
- Varias poses.
- Biblioteca de animaciones.
- Varias escenas.
- Transiciones simples.
- Caché de voz y análisis.
- Validación robusta.
- Plantillas de videos verticales.

### Etapa 3: herramienta de autoría

Agregar:

- Lista de escenas.
- Inspector de propiedades.
- Selector de personajes, fondos y objetos.
- Vista previa con desplazamiento temporal.
- Edición de diálogos.
- Botones para regenerar voz y exportar.
- Edición manual del plan generado.

### Etapa 4: director IA

Agregar:

- Idea a guion.
- Guion a escenas.
- Escenas a plan JSON.
- Catálogo de recursos incluido en el prompt.
- Salida restringida por JSON Schema.
- Reparación de errores semánticos.
- Controles de duración y estilo.

### Etapa 5: mejoras surgidas de producción real

Posibles mejoras:

- Lip sync fonético.
- Subtítulos palabra por palabra.
- Música con ducking automático.
- Más personajes.
- Variaciones de cámara.
- Procesamiento por lotes.
- Exportación directa a FFmpeg sin PNG temporales.
- Métricas de rendimiento.

Estas mejoras deben priorizarse según problemas encontrados al producir videos reales, no por anticipación.

## 10. Riesgos técnicos y mitigaciones

### Preparación de personajes

Riesgo: separar y alinear bocas, ojos, brazos y poses puede demandar más trabajo que el motor.

Mitigación: crear una especificación estricta de personaje y una herramienta de previsualización de anchors antes de producir muchos personajes.

### Duración de la voz

Riesgo: la duración real se conoce después del TTS.

Mitigación: permitir escenas `fit-content` y realizar una fase de resolución temporal después de generar el audio.

### Planes inválidos de la IA

Riesgo: un JSON sintácticamente válido puede pedir recursos inexistentes o tiempos imposibles.

Mitigación: catálogo cerrado de recursos, validador semántico y compilador determinista.

### Diferencias entre preview y exportación

Riesgo: usar dos lógicas temporales diferentes produce resultados inconsistentes.

Mitigación: compartir el mismo evaluador de timeline.

### Rendimiento sin GPU dedicada

Riesgo: 1080 por 1920 con filtros, transparencias y muchos sprites puede exportarse lentamente.

Mitigación: limitar filtros, cargar solamente assets necesarios, medir temprano y renderizar offline sin exigir tiempo real.

### Memoria

Riesgo: precargar todas las poses y personajes consume demasiada memoria.

Mitigación: cargar recursos por escena y liberar los que no estén en uso.

### Fuentes y subtítulos

Riesgo: el ajuste de texto puede cambiar según la fuente instalada.

Mitigación: incluir y versionar las fuentes utilizadas por cada plantilla.

### Dependencias externas

Riesgo: TTS, lip sync o transcripción pueden cambiar o dejar de mantenerse.

Mitigación: usar adaptadores reemplazables y formatos intermedios propios.

### Licencias

Riesgo: voces, fuentes, música, sprites o compilaciones de FFmpeg pueden tener restricciones.

Mitigación: guardar procedencia y licencia en cada manifiesto de recurso.

## 11. Decisiones que conviene tomar desde el principio

- Formato inicial: vertical 1080 por 1920.
- Frame rate inicial: 30 fps.
- Tiempos: milisegundos enteros.
- IDs estables y versionados para assets.
- JSON Schema como contrato oficial.
- Plan semántico separado de la timeline compilada.
- Un solo evaluador para preview y exportación.
- Personajes por capas e intercambio de sprites en la primera versión.
- Herramientas externas detrás de adaptadores.
- Caché basada en hashes.
- Semillas explícitas para comportamiento pseudoaleatorio.
- Proyectos portables sin rutas absolutas.
- Guardado de versión del motor y de los recursos utilizados.

## 12. Qué evitar

No construir inicialmente:

- Una timeline estilo Premiere.
- Curvas Bézier editables visualmente.
- Un sistema de plugins.
- Esqueletos avanzados o deformación de mallas.
- Física.
- Cámara 3D.
- Rigging automático.
- Edición de audio multipista.
- Marketplace de assets.
- Base de datos.
- Backend web o microservicios.
- Entrenamiento de modelos.
- Generación automática de personajes.
- Scripts ejecutables dentro del JSON.
- Decenas de acciones antes de validar unas pocas acciones útiles.
- Dependencia directa entre el modelo de IA y rutas de archivos.
- Generación detallada de keyframes por parte de la IA.

## 13. Alcance exacto del primer prototipo

El primer prototipo debe quedar limitado a:

- Windows local.
- Un proyecto.
- Una escena de entre 5 y 15 segundos.
- Resolución 1080 por 1920.
- 30 fps.
- Un fondo.
- Un personaje por capas.
- Una pose neutral.
- Ojos abiertos y cerrados con parpadeo automático.
- Tres bocas: cerrada, media y abierta.
- Una voz local fija.
- Una entrada o desplazamiento sencillo.
- Un bloque de subtítulos.
- Reproducción y pausa.
- Exportación H.264/AAC a MP4.
- Configuración mediante un JSON escrito manualmente.
- Mensajes claros si falta algún recurso.

Queda expresamente fuera del primer prototipo:

- Generación de escenas mediante IA.
- Varias escenas.
- Señalar elementos.
- Gestos complejos.
- Música y efectos.
- Transiciones.
- Editor visual completo.
- Varios personajes.
- Subtítulos palabra por palabra.
- Lip sync fonético.

## 14. Criterio de éxito del prototipo

El prototipo se considera exitoso cuando:

1. Un JSON manual válido carga una escena vertical.
2. La escena muestra un personaje por capas sobre un fondo.
3. La voz se reproduce correctamente.
4. La boca cambia según la energía del audio.
5. El personaje parpadea y realiza un movimiento sencillo.
6. Aparece un subtítulo sincronizado.
7. Se exporta un MP4 reproducible y compatible.
8. La vista previa y el archivo exportado muestran el mismo resultado temporal.
9. Ejecutar nuevamente el proyecto produce el mismo video.

La calidad profesional del dibujo o de la voz no es el criterio principal en esta etapa. El objetivo es validar el circuito técnico completo.

## 15. Orden recomendado para la próxima sesión

La próxima sesión técnica debería:

1. Inspeccionar el contenido actual de la carpeta del proyecto.
2. Confirmar qué versiones de Node.js y FFmpeg están instaladas.
3. Confirmar CPU, memoria disponible y sistema operativo.
4. Definir el primer personaje de prueba y sus archivos gráficos.
5. Redactar el JSON Schema mínimo del prototipo.
6. Diseñar la estructura mínima del repositorio.
7. Crear una prueba vertical de PixiJS.
8. Probar generación o reproducción de una voz WAV.
9. Probar exportación de unos pocos segundos.
10. Implementar el flujo completo solamente después de validar esas pruebas.

No se debe comenzar por integrar el modelo de lenguaje. La IA debe añadirse cuando el JSON manual ya pueda producir videos correctamente.

## 16. Instrucción breve para otra IA

Si este documento se entrega a otra IA, se le puede indicar:

> Lee completamente `PROPUESTA_TECNICA.md`. Trabaja con el proyecto como un compilador local de animaciones 2D dirigido por datos. Respeta el alcance del primer prototipo y no agregues todavía el director IA, una timeline profesional ni funciones fuera del MVP. Antes de escribir código, inspecciona el entorno, identifica dependencias disponibles y propone el diseño detallado de la Etapa 0 y la Etapa 1.

