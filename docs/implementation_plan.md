# Plan de Implementación: Interfaz de Editor de Video (Línea de Tiempo)

El objetivo es transformar el actual previsualizador de escenas en una interfaz que luzca y se comporte estructuralmente como un software de edición de video profesional (NLE), introduciendo una línea de tiempo (Timeline) con canales y herramientas, y corrigiendo la visualización de los íconos.

## Problema detectado con los íconos
Los íconos SVG no se ven debido a la ausencia del atributo `xmlns` estándar requerido por algunos navegadores cuando se incrustan en estructuras complejas, o por un conflicto con el `stroke` nativo. Se corregirá inyectando las propiedades correctas.

## Cambios Arquitectónicos de UI propuestos

Para que parezca un editor real, la pantalla debe dividirse en dos grandes zonas verticales:
1. **Espacio de Trabajo (Arriba):** Controles, Visor Central y Galería de Escenas.
2. **Línea de Tiempo (Abajo):** Pistas de video, pistas de audio, cabezal de reproducción y herramientas de edición.

### 1. Reestructuración del Layout (`index.html` y `style.css`)
- **[MODIFICAR]** Envolver el actual `.layout` de 3 columnas en un contenedor superior (`.workspace`).
- **[NUEVO]** Añadir una sección inferior `.timeline-panel` que ocupará todo el ancho de la pantalla (aprox 30-35% del alto total).

### 2. Diseño de la Línea de Tiempo (Timeline)
La línea de tiempo contendrá los siguientes elementos:
- **Barra de Herramientas:** Moveré la barra de herramientas (cursor, tijera, etc.) que está en el panel derecho para que se ubique justo por encima de las pistas, que es el estándar de la industria.
- **Regla de Tiempo (Time Ruler):** Una regla horizontal superior que mostrará las marcas de tiempo/fotogramas.
- **Cabezal de Reproducción (Playhead):** Una línea vertical roja interactiva que marca el punto actual del video.
- **Pista de Video (V1):** Un canal horizontal para bloques visuales.
- **Pista de Audio (A1):** Un canal horizontal debajo del video para las ondas/bloques de voz.

### 3. Sincronización Funcional (Prototipo en `main.ts`)
- **[MODIFICAR]** Conectar el movimiento del cabezal de reproducción (`playhead`) con el reloj interno del video (`audio.currentTime`), para que la línea de tiempo *cobre vida* y se mueva en sincronía al darle Play o avanzar fotogramas.

## Preguntas Abiertas
- ¿Prefieres que la Línea de Tiempo tenga un color de fondo ligeramente más oscuro que el resto de la interfaz para separarla visualmente (como en Adobe Premiere), o mantenemos el cristalino unificado?

## Plan de Verificación
1. Visualizar la pantalla completa: confirmar que el layout ahora tiene un espacio inferior dedicado.
2. Verificar que los íconos de edición sean visibles y legibles.
3. Darle Play al video y comprobar que el cabezal de la línea de tiempo se mueve de izquierda a derecha.
