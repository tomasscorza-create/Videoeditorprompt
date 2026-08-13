# Paquete de animaciones internas V2

## Resultado

El catálogo cerrado pasa de 13 a 24 presets de keyframes. Todos se expanden
localmente como datos, usan el evaluador temporal compartido y conservan la
misma salida para una combinación idéntica de preset, intensidad, ancla y valor
base.

No se incorporan scripts externos ni keyframes generados libremente por IA.

## Grupos visibles

- **Entradas:** izquierda, derecha, abajo y aparición con rebote.
- **Salidas:** izquierda, derecha y arriba.
- **Visibilidad:** aparecer, desaparecer y parpadeo visual.
- **Énfasis:** pulso, sacudida lateral, balanceo y aplastar/estirar.
- **Movimiento:** salto y flotación.
- **Cuerpo y articulaciones:** brazos, codos, cabeza y cuerpo según las
  capacidades declaradas por cada recurso.

Los primeros cinco grupos suman 16 presets genéricos disponibles tanto para
personajes como para props. Los ocho presets articulados solo aparecen cuando
el manifiesto v3 del personaje declara el parámetro correspondiente.

## Contrato

`shared/animation-presets.js` es la fuente ejecutable del catálogo y de sus
grupos. La prueba contractual comprueba que sus identificadores coincidan con:

- `shared/animation-contract.js`;
- `schema/animation-scene.schema.json`;
- `schema/editor-command.schema.json`;
- `schema/video-project.schema.json`.

Una divergencia entre esas fuentes hace fallar `npm run anim:test-presets`.

## Límites conservados

- Cada preset produce una sola pista con entre dos y cinco keyframes.
- La intensidad modifica amplitud y duración sin cambiar la forma del efecto.
- Los valores se recortan al rango cerrado del parámetro.
- Un preset no sobrescribe una pista manual o personalizada.
- La colocación desde la interfaz sigue exigiendo medición real y que todos los
  puntos entren dentro de la escena.
- Preview y MP4 consumen las mismas pistas resueltas; no existe un evaluador
  alternativo para este paquete.

## Próxima ampliación compatible

Los efectos coordinados sobre varias propiedades deben modelarse como recetas
que aplican varios presets existentes. No deben convertir un preset en código
ni introducir un segundo formato de timeline.
