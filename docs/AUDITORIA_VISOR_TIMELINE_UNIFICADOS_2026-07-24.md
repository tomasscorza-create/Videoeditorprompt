# Auditoría de visor y timeline unificados — 2026-07-24

## Problema encontrado

El visor mantenía cuatro fuentes (`composition`, `preview`, `final` y `character`) mientras la timeline conservaba otra máquina de estados para proyecto, preview y MP4. El Director conectaba el video final al visor y a la timeline por llamadas separadas. Esto producía tres ambigüedades:

- “Preview” y “MP4 final” parecían espacios de trabajo distintos del editor.
- La timeline cambiaba por completo de estructura al cambiar la fuente del visor.
- Un render histórico podía parecer vigente solo por compartir `projectId`.

También permanecían dos transportes, dos estructuras de pistas y CSS asociado a la timeline V1/A1 ya reemplazada.

## Contrato adoptado

La interfaz expone únicamente:

1. **Editor**: lienzo editable, reproducción temporal del último MP4 y exportación.
2. **Creador**: autoría de recursos reutilizables.

`src/ui/editor-workspace.ts` es la fuente única para modo, superficie activa, medio, tiempo, timeline medida y vigencia de la exportación. Visor y timeline reaccionan a sus eventos; el Director registra cada resultado una sola vez.

La timeline no cambia de identidad:

- sin render vigente, organiza las capas con anchos editoriales y no muestra segundos;
- con render vigente, las mismas capas usan los inicios y duraciones medidos;
- después de cualquier cambio de contenido, el render queda marcado como anterior y la timeline vuelve a autoría;
- seleccionar una escena, personaje o diálogo detiene la reproducción y devuelve el lienzo editable.

## Deuda eliminada

- Pestañas públicas de composición, preview y MP4.
- Controles de preview paralelos.
- Timeline fija V1/A1 y su segundo árbol DOM.
- Conexión doble del resultado desde el Director.
- Dependencia directa circular entre visor y timeline.
- Suposición de vigencia basada solo en el ID del proyecto.

La preview PixiJS de una escena continúa cargándose como comprobación de compatibilidad interna. No participa del flujo principal ni se presenta como modo de edición.

## Límites honestos

- El lienzo editable todavía es una composición estática; la reproducción continua proviene del último MP4 renderizado.
- Un render recuperado de otra sesión se considera anterior porque el trabajo histórico aún no publica un hash de la revisión completa de autoría.
- Los tiempos individuales de cada diálogo no están incluidos en el manifiesto final. Dentro de una escena medida, sus clips conservan el orden editorial y lo indican expresamente.
- Cortar, estirar o mover clips en tiempo sigue fuera del contrato del motor.

## Verificación

- TypeScript y build de producción.
- Contratos del editor y compilador.
- Gestor de render y publicación de timeline medida.
- Navegación funcional Editor/Creador.
- Reproducción desde el único transporte, retorno al lienzo y sincronización de timecode.
