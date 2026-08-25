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

### Franjas laterales de demostración (estado vigente y relación con el roadmap)

Las creatividades actuales de estas franjas (`index.html`, `aside.side-banner`, con marcas ficticias como «FrameFlow» y «Voz Clara») son un **experimento de layout**, no monetización activa. Su único propósito es validar que reservar dos columnas verticales de 60 px no comprime las áreas de edición y se integra con el tema claro/oscuro.

- No hay proveedor real, ni tracking, ni red publicitaria, ni ingresos: son placeholders estáticos marcados como «Demo».
- Reservar este espacio **no** contradice el gate del roadmap «no monetizar antes de validar»: se reserva la posibilidad espacial futura, sin activar ninguna monetización.
- Antes de conectar publicidad real haría falta una decisión de producto explícita, además de la revisión de privacidad, licencias y desempeño correspondiente.
- Alternativa siempre disponible: retirar las franjas es un cambio local en `index.html` y su CSS, sin impacto en el motor.

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
- Inferir por omisión tono, duración, particiones internas y estructura; las particiones no se exponen como control.
- Generar, cancelar o replantear bases de proyecto.
- Organizar el recorrido guiado en tres fases: `Idea`, `Base` y `Video`.
- Resumir el proyecto como storyboard y llevar la edición detallada al panel derecho.
- Presentar los cambios propuestos por IA antes de aplicarlos al proyecto.
- Seleccionar el proyecto o contexto de autoría en el que se trabajará.
- Iniciar el render cuando corresponda.

### Comportamiento esperado

- Cambiar de proyecto actualiza el visor, el inspector y la timeline.
- `Idea` comienza por un prompt dominante. Duración y modelo acompañan a la vista; tono, riqueza y exploración viven en `Más dirección`.
- Los valores automáticos no fijan restricciones. El prompt completa esas decisiones y cualquier elección explícita del usuario prevalece.
- Solo una fase está visible a la vez. `Base` se habilita cuando la IA termina de preparar las preguntas y `Video` cuando existe un proyecto; un proyecto existente abre directamente en `Video`.
- `Idea` contiene el prompt y dos decisiones iniciales compactas: duración y modelo IA. El botón principal dice `Aceptar` porque todavía no crea el proyecto.
- `Base` muestra exactamente tres preguntas contextuales generadas por el mismo proveedor/modelo. Cada pregunta contiene tres opciones prearmadas y un campo `Otra respuesta` para escribir una alternativa. No contiene storyboard, resumen del proyecto ni otro prompt global.
- Al confirmar las tres respuestas, el Director crea el proyecto de forma atómica y pasa a `Video`. La medición liviana prepara voces, tiempos y preview en segundo plano, pero no inicia la exportación del MP4. Si existe un proyecto anterior, el aviso de reemplazo se muestra en `Base` y aquel se conserva hasta que la nueva creación termina correctamente.
- Eliminar animación manual o personalizada requiere una confirmación inline específica. El flujo normal no usa diálogos nativos del navegador.
- `Replantear idea` solicita confirmación inline antes de reemplazar una base existente; el proyecto vigente no cambia mientras se espera ni mientras se genera.
- Calidad, recursos considerados, plantilla y variantes se revelan progresivamente después del storyboard.
- `Video` permite revisar el preview sin esperar un render y ofrece la exportación del MP4 como acción explícita. Oculta los requisitos completos y muestra solo bloqueos accionables. Durante una exportación informa la etapa humana y el momento disponible en los datos reales, sin inventar porcentajes.
- IA y render comparten un único control contextual de cancelación porque solo uno puede estar activo.
- El Director no duplica el título, los diálogos, las propiedades, las acciones estructurales ni el ordenamiento de momentos: esas responsabilidades permanecen en cabecera, Edición y timeline.
- La base prioriza decisiones creativas; no muestra descargas técnicas ni explicaciones internas del pipeline.
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

- Mantener el lienzo editable como superficie principal del Editor.
- Seleccionar y mover elementos compatibles directamente sobre la composición.
- Reproducir la última exportación dentro del mismo Editor, sin convertirla en otra fuente o pestaña.
- Conservar claramente la relación vertical 9:16.
- Compartir transporte, tiempo y estado de medición con la timeline.
- Mostrar contexto breve, vigencia de la exportación y descarga cuando corresponda.

### Espacios vigentes

- **Editor:** lienzo editable y reproducción temporal de su última exportación.
- **Creador:** autoría de recursos reutilizables; no modifica ni simula una timeline de video.

La reproducción es un estado del Editor, no un tercer espacio. **Volver a editar** pausa el medio y recupera el lienzo. La preview PixiJS publicada se conserva únicamente como compatibilidad técnica interna.

### Regla visual

Debe recibir el mayor espacio del área principal. Los paneles laterales sirven al visor; el visor no debe reducirse hasta convertirse en una miniatura.

### Evitar

- Mezclar formularios largos sobre el video.
- Duplicar la biblioteca o el inspector dentro del visor.
- Exponer composición, preview y MP4 como modos paralelos.
- Presentar una exportación histórica como si correspondiera con certeza a la revisión actual.

## 4. Panel derecho — Recursos, Edición y Archivos

### Propósito

Es el área contextual para modificar lo seleccionado y elegir materiales o tratamientos.

### Responsabilidades actuales y futuras compatibles

- Propiedades del proyecto y momento interno.
- Edición de diálogo, voz, gesto y pausa.
- Fondo, cámara, personajes y transforms compatibles.
- Biblioteca de personajes, fondos, voces e imágenes.
- Biblioteca de videos y audios importados, con picker y zona de arrastre.
- Filtros, ajustes visuales y presets cuando el motor los soporte.
- Información de licencia y procedencia.
- Validación y exportación del proyecto.

### Organización

- Sus tres páginas de alto nivel vigentes son `Recursos`, `Edición` y `Archivos`.
- `Archivos` agrega cada importación al final de la timeline activa y permite reutilizar una fuente ya deduplicada con `Agregar`.
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
- Un fondo global, una barra continua por personaje, prop o efecto, y los turnos de voz sobre el mismo tiempo.
- Selección y navegación temporal.
- Reproducción, pausa, mute, zoom, ajuste al ancho y snap.
- Undo/redo y atajos relacionados con edición temporal.
- Herramientas futuras de corte, borrado o movimiento únicamente cuando existan comandos seguros en el núcleo.
- Capas estructurales vigentes para fondo, personajes y voces. Las pistas reservadas sin soporte de motor deben mostrarse deshabilitadas y explicitar su estado.

### Regla visual

- Ocupa todo el ancho inferior, debajo de los tres paneles principales.
- Es una timeline audiovisual, no una galería de tarjetas ni un resumen textual.
- El video se percibe como una sola secuencia. Las divisiones internas no crean marcas, clips, carriles, huecos ni controles visibles.
- Los enlaces técnicos se resuelven automáticamente y no son una decisión expuesta en la interfaz.
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
- Seleccionar un momento o turno en la timeline actualiza el visor y el inspector.
- Editar en el panel derecho actualiza composición y clips relacionados.
- Reproducir o hacer seek mantiene sincronizados visor, timecode y playhead sin cambiar de timeline.
- Una exportación compatible aporta tiempos reales a las mismas capas editables.
- Cualquier cambio posterior marca esa exportación como anterior y devuelve la timeline a **Sin medir**.
- El Creador conserva el proyecto intacto y muestra que la timeline pertenece al Editor.

## Proporciones y comportamiento

Las proporciones exactas pueden ajustarse por legibilidad, pero la jerarquía debe conservarse:

- Encabezado: altura mínima necesaria.
- Panel izquierdo: ancho suficiente para el prompt, las subpáginas del Director, la propuesta por pestañas y sus formularios; puede ganar espacio moderado del visor para evitar controles excesivamente compactos.
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
