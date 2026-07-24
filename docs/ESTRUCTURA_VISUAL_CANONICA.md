# Estructura visual canónica de la aplicación

Estado: **decisión de producto aprobada**.

Alcance: organización espacial y responsabilidades de la interfaz local.
Referencia visual: capturas anotadas por el usuario el 24 de julio de 2026.

Este documento no congela colores, tamaños exactos ni el contenido disponible hoy. Define la lógica espacial que debe mantenerse mientras la herramienta crece.

La dirección cromática vigente conserva un fondo gris neutro y paneles superpuestos con matiz verde y degradados suaves. En modo claro las superficies son menta muy pálidas; en modo oscuro pasan a verdes profundos y desaturados, manteniendo contraste equivalente. El visor de video conserva un fondo oscuro propio para no alterar la percepción del contenido.

## Estructura principal

```text
┌─────────────────────────────────────────────────────────────────────┐
│ ENCABEZADO                                                          │
├───────────────┬───────────────────────────────────┬─────────────────┤
│               │                                   │                 │
│ PANEL         │              VISOR                │ PANEL DERECHO   │
│ IZQUIERDO     │                                   │ EDICIÓN Y      │
│ DIRECTOR IA   │                                   │ RECURSOS        │
│ Y PROYECTOS   │                                   │                 │
│               │                                   │                 │
├───────────────┴───────────────────────────────────┴─────────────────┤
│ TIMELINE AUDIOVISUAL Y HERRAMIENTAS                                 │
└─────────────────────────────────────────────────────────────────────┘
```

La pantalla de escritorio se divide en cinco áreas persistentes:

1. Encabezado superior.
2. Panel izquierdo de comando y selección.
3. Visor central.
4. Panel derecho de edición y recursos.
5. Timeline inferior de ancho completo.

Estas áreas pueden ganar funciones, pestañas, acordeones o controles internos. No deben intercambiar sus responsabilidades principales sin autorización explícita del usuario.

En escritorio, dos franjas laterales de 60 px reservan aire visual desde debajo del encabezado hasta el final de la interfaz. Pueden alojar publicidad vertical claramente identificada, sin invadir las áreas de edición. No desplazan ni atraviesan el encabezado y desaparecen en el layout responsive de 1100 px o menos. Mientras no exista un proveedor real, toda creatividad publicitaria debe marcarse como demostración, carecer de seguimiento y no implicar asociaciones comerciales.

## 1. Encabezado

### Propósito

Identidad de la aplicación, estado global breve y acceso a configuración general.

### Contenido apropiado

- Nombre e identidad del producto.
- Botón global `Archivos`, con `Nuevo +`, `Mis proyectos` editables y `Videos creados`.
- Indicador discreto de guardado o estado global.
- Configuración general.
- Acciones globales futuras que sean realmente universales.

### Regla visual

Debe permanecer limpio, bajo y tranquilo. No es una barra de edición ni un contenedor para controles de escenas, recursos o render.

### Evitar

- Saturarlo con herramientas contextuales.
- Convertir `Archivos` en una barra de edición; su acceso debe seguir siendo compacto.
- Mostrar formularios extensos.
- Duplicar acciones del Director, inspector o timeline.

## 2. Panel izquierdo — Director IA y selección de trabajo

### Propósito

Es el punto de entrada y comando del flujo creativo.

### Responsabilidades

- Escribir instrucciones para el Director IA.
- Seleccionar tono, duración, escenas y futuros parámetros de dirección.
- Generar, cancelar o regenerar propuestas.
- Mostrar debajo del comando la propuesta resultante en un bloque desplegable, ordenado y editable.
- Permitir revisar escenas, diálogo y ajustes básicos de la propuesta antes del render.
- Seleccionar el proyecto o contexto de autoría en el que se trabajará.
- Iniciar el render cuando corresponda.

### Comportamiento esperado

- Cambiar de proyecto actualiza el visor, el inspector y la timeline.
- El contenido puede organizarse mediante pestañas o secciones como `Crear` y `Proyectos`.
- La propuesta se abre automáticamente después de generarse y puede plegarse sin perder sus cambios.
- En un proyecto vacío el Director crea una propuesta; con contenido existente se compacta y acepta peticiones contextuales convertidas en comandos semánticos deshacibles.
- Tras el render, la propuesta deja de presentarse como un paso pendiente, pero el proyecto sigue disponible para edición.
- La edición interna de la propuesta se separa en pestañas de nombres directos —escena, personajes, fondo y transición— para evitar un formulario vertical único.
- Las pestañas forman una única fila compacta inmediatamente debajo de `Revisar y ajustar`; todo el contenido inferior pertenece a la pestaña activa.
- El título del proyecto, la selección de escena y el guion editable viven dentro de `Escena`. El guion identifica al personaje y solo expone su texto; voz, gesto y pausa no forman parte de este editor simple.
- La propuesta no mantiene una cabecera paralela de acciones o reordenamiento.
- La propuesta prioriza decisiones creativas; no muestra descargas técnicas ni explicaciones internas del pipeline.
- La biblioteca persistente de videos terminados pertenece a `Archivos > Videos creados` en el encabezado, no al panel del Director.
- Su scroll es independiente.
- Las acciones primarias deben ser claras y estar cerca del contexto que las origina.

### Evitar

- Convertirlo en inspector detallado de propiedades.
- Cargar aquí filtros, transforms, voces o recursos del elemento seleccionado.
- Usarlo como visor secundario.

## 3. Centro — Visor

### Propósito

Es el foco visual dominante. Responde a la pregunta: “¿Qué video o composición estoy viendo y editando?”.

### Responsabilidades

- Mostrar la composición editable.
- Seleccionar y mover elementos compatibles directamente sobre la composición.
- Mostrar el preview medido.
- Reproducir el MP4 final.
- Conservar claramente la relación vertical 9:16.
- Ofrecer controles de reproducción relacionados con la vista.
- Mostrar contexto breve y descarga del resultado cuando corresponda.

### Fuentes vigentes

- **Composición:** proyección estática del proyecto editable.
- **Preview medido:** escena publicada con tiempos reales.
- **MP4 final:** resultado ensamblado por el pipeline.

### Regla visual

Debe recibir el mayor espacio del área principal. Los paneles laterales sirven al visor; el visor no debe reducirse hasta convertirse en una miniatura.

### Evitar

- Mezclar formularios largos sobre el video.
- Duplicar la biblioteca o el inspector dentro del visor.
- Ocultar qué fuente está activa.

## 4. Panel derecho — Edición, ajustes y recursos

### Propósito

Es el área contextual para modificar lo seleccionado y elegir materiales o tratamientos.

### Responsabilidades actuales y futuras compatibles

- Propiedades del proyecto y escena.
- Edición de diálogo, voz, gesto y pausa.
- Fondo, cámara, personajes y transforms compatibles.
- Biblioteca de personajes, fondos, voces e imágenes.
- Filtros, ajustes visuales y presets cuando el motor los soporte.
- Información de licencia y procedencia.
- Validación y exportación del proyecto.

### Organización

- Puede usar pestañas de alto nivel como `Editar`, `Recursos`, `Ajustes` o `Filtros`.
- Dentro de cada pestaña debe usar acordeones o grupos contextuales.
- Debe priorizar la selección activa; no mostrar todos los controles posibles al mismo tiempo.
- Su scroll es independiente.

### Evitar

- Mover el Director IA completo a este panel.
- Mostrar controles que el núcleo no puede aplicar.
- Duplicar herramientas de reproducción o navegación temporal.

## 5. Parte inferior — Timeline y herramientas

### Propósito

Representar y controlar la estructura audiovisual del trabajo.

### Responsabilidades

- Regla temporal, timecode y playhead.
- Pistas de video, audio, diálogo y futuras pistas compatibles.
- Clips de escenas, turnos y transiciones.
- Selección y navegación temporal.
- Reproducción, pausa, mute, zoom, ajuste al ancho y snap.
- Undo/redo y atajos relacionados con edición temporal.
- Herramientas futuras de corte, borrado o movimiento únicamente cuando existan comandos seguros en el núcleo.
- Capas estructurales vigentes para fondo, personajes y voces. Las pistas reservadas sin soporte de motor deben mostrarse deshabilitadas y explicitar su estado.

### Regla visual

- Ocupa todo el ancho inferior, debajo de los tres paneles principales.
- Es una timeline audiovisual, no una galería de tarjetas ni un resumen textual.
- Debe permanecer visible en el flujo de edición de escritorio.
- Puede aumentar de altura, plegarse parcialmente o ganar pistas, pero no desaparecer como concepto.

### Estados temporales

- **Sin medir:** muestra estructura editable sin presentar estimaciones como segundos reales.
- **Medido:** usa duraciones y posiciones producidas por Piper, FFprobe y el ensamblador.

## Relaciones entre áreas

La estructura no son cinco aplicaciones separadas. Las áreas se coordinan:

```text
Director / selección izquierda
              │
              ▼
        Proyecto activo
      ┌───────┼────────┐
      ▼       ▼        ▼
    Visor  Inspector  Timeline
      ▲       ▲        │
      └───────┴────────┘
        selección y reproducción
```

- Seleccionar un trabajo a la izquierda carga el contexto de las demás áreas.
- Seleccionar una escena o turno en la timeline actualiza el visor y el inspector.
- Editar en el panel derecho actualiza composición y clips relacionados.
- Cambiar entre Composición, Preview y MP4 cambia el modo temporal de la timeline.
- Reproducir o hacer seek mantiene sincronizados visor, timecode y playhead.

## Proporciones y comportamiento

Las proporciones exactas pueden ajustarse por legibilidad, pero la jerarquía debe conservarse:

- Encabezado: altura mínima necesaria.
- Panel izquierdo: ancho suficiente para el prompt, la propuesta por pestañas y sus formularios; puede ganar espacio moderado del visor para evitar controles excesivamente compactos.
- Centro: columna flexible y dominante.
- Panel derecho: ancho suficiente para formularios sin invadir el visor.
- Timeline: altura suficiente para herramientas, regla y al menos las pistas audiovisuales principales.

Cada panel lateral debe tener scroll independiente. La página completa no debería convertirse en un scroll largo en escritorio.

### Ajuste personal del espacio

En escritorio, el usuario puede arrastrar los separadores entre Director/visor, visor/panel derecho y workspace/timeline. El encabezado mantiene su altura fija.

- Director y panel derecho: entre 16% y 36% del ancho cada uno, con protección adicional de 280–560 px.
- Visor: conserva al menos 32% del ancho y un piso de 360 px.
- Timeline: entre 18% y 42% de la altura de la aplicación, con protección adicional de 150–460 px.
- Si dos paneles compiten por espacio, prevalece el mínimo del visor.
- Los tamaños se guardan localmente como proporciones para adaptarse a futuros cambios de ventana.
- Los separadores aceptan arrastre, flechas del teclado y doble clic para restaurar su tamaño inicial.
- Por debajo de 1101 px se desactivan los separadores y prevalece el layout responsive.

## Responsive

En pantallas estrechas puede ser imposible mantener las cinco regiones simultáneamente. La adaptación puede usar pestañas, paneles plegables o apilado, pero debe conservar la misma lógica conceptual:

1. Visor como foco.
2. Director/selección como entrada.
3. Edición/recursos como contexto.
4. Timeline como superficie audiovisual accesible.

Responsive no autoriza eliminar permanentemente una región ni mezclar sus responsabilidades.

## Decisiones que requieren aprobación explícita

- Cambiar el panel del Director de lado.
- Mover la edición contextual al panel izquierdo.
- Quitar la timeline inferior.
- Sustituir la timeline por una lista de escenas.
- Reducir el visor para dar prioridad a paneles auxiliares.
- Convertir el encabezado en una barra densa de herramientas.
- Agregar una segunda fuente de verdad separada del proyecto editable.

## Checklist para futuras ampliaciones

Antes de aceptar un cambio de interfaz:

- ¿La función está ubicada en el área que corresponde a su responsabilidad?
- ¿El visor sigue siendo el foco visual?
- ¿Director y selección continúan a la izquierda?
- ¿Edición, ajustes y recursos continúan a la derecha?
- ¿La timeline sigue ocupando el área inferior completa?
- ¿La interacción actualiza las demás áreas mediante el mismo estado del proyecto?
- ¿Los controles visibles representan capacidades reales?
- ¿Los paneles conservan scroll y legibilidad independientes?

## Relación con documentos anteriores

Esta estructura reemplaza propuestas históricas de layout cuando entren en conflicto con ella. Las auditorías anteriores siguen siendo evidencia del proceso, pero este documento es la referencia vigente para la organización visual.
