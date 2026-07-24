# Etapa 3A.0 — proyecto editable y catálogo de autoría

Fecha: 22 de julio de 2026.

Estado: **contrato y validación implementados; todavía no existe render multiescena**.

## Resultado

Se creó el primer documento portable que podrán compartir el futuro generador por prompt, el editor manual y el compilador determinista. El piloto contiene dos escenas, personajes y voces por ID, texto editable, posiciones sobre un canvas vertical y una transición cerrada.

Esta etapa no modifica el pipeline vigente de una escena. No agrega interfaz, IA, backend, base de datos ni exportación de varias escenas.

## Contratos

- `schema/video-project.schema.json`: proyecto versión 1, 1080 × 1920, 30 fps y máximo de ocho escenas.
- `schema/authoring-resource-catalog.schema.json`: personajes, voces Piper, fondos e imágenes seleccionables por ID.
- `schema/background-manifest.schema.json`: fondo portable de tres capas.

El proyecto guarda decisiones editables:

- orden de escenas;
- instancias de personajes, imágenes y texto;
- coordenadas `x`/`y` en píxeles, con origen arriba a la izquierda, X hacia la derecha e Y hacia abajo;
- ancla, escala, rotación, opacidad y `zIndex`;
- pose y preset de animación por ID;
- diálogo con personaje hablante y voz por ID;
- fondo y preset de cámara;
- transición `cut` o `fade` hacia la escena siguiente.

No guarda duración estimada, rutas de modelos Piper, comandos, filtros, código ni keyframes exhaustivos. La duración continuará proviniendo del WAV medido por FFprobe cuando se implemente el compilador.

## Catálogo de autoría

`public/assets/catalog/authoring-resources.json` contiene cinco recursos iniciales:

- dos personajes que enlazan con entradas existentes del catálogo compilado 2F.2;
- dos voces Piper con modelo, locale y parámetros predeterminados, sin rutas locales;
- un fondo por capas con presets de cámara declarados.

El catálogo de autoría no reemplaza `public/assets/catalog/index.json`. El primero expone recursos creativos al editor o a la IA; el segundo sigue siendo el índice técnico de personajes compilados.

## Validación

`scripts/stage3a/validate-video-project.mjs` comprueba:

- JSON Schema estricto y rechazo de campos desconocidos;
- IDs únicos de escenas, elementos, turnos y recursos;
- máximo de ocho escenas y veinte elementos/turnos por escena;
- coordenadas, anclas, escala, rotación, opacidad y orden acotados;
- existencia y tipo correcto de personajes, voces, fondos e imágenes;
- poses, animaciones y cámara declaradas por el recurso elegido;
- hablantes presentes como personajes dentro de la misma escena;
- transición obligatoria entre escenas y ausente en la última;
- rutas relativas portables, traversal, absolutos y escapes por symlink;
- referencias internas hacia catálogos de personajes, manifests, thumbnails y capas de fondo.

Comandos:

```powershell
npm run stage3a:validate-project
npm run stage3a:test-project
```

## Piloto

`pilots/proyecto-editable-01/project.json` demuestra:

- dos escenas ordenadas;
- reutilización de personajes entre escenas;
- dos voces elegidas por ID;
- composición manual mediante transforms de canvas;
- texto editable;
- poses `neutral` y `point`;
- presets `idle-calm` y `talk-calm`;
- fondo y cámara por ID;
- fundido entre escenas.

El piloto es únicamente un documento validado. Todavía no produce runtime, audio ni MP4.

## Pruebas

La suite específica cubre el caso válido y rechazos por:

- IDs duplicados;
- transiciones faltantes o mal ubicadas;
- duración incorrecta de un corte;
- recursos inexistentes o de tipo incorrecto;
- hablante que no es personaje;
- pose no soportada;
- coordenadas fuera de límite;
- campos arbitrarios;
- rutas absolutas.

## Próximo incremento

3A.1 debe compilar cada escena del proyecto hacia configuraciones/runtimes medidos compatibles con el motor actual. Después, 3A.2 podrá concatenar esas escenas y sus transiciones en un único MP4 determinista. El editor manual debe consumir este contrato cuando esa compilación haya demostrado el recorrido completo.
