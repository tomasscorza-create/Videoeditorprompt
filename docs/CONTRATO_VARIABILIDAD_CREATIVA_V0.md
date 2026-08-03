# Contrato de variabilidad creativa V0

Estado: implementado y verificado contractualmente el 2026-08-03.

V0 congela el vocabulario que usarán las siguientes fases para ampliar el
Director y el runtime. No habilita todavía renders con cero o un personaje.

## Alcance implementado

- cuatro modos de escena: `voiceover`, `solo`, `dialogue` y
  `visual-with-voiceover`;
- entre cero y dos personajes visibles por escena;
- turnos discriminados entre personaje visible y narrador fuera de campo;
- peso editorial de duración, separado de la duración real;
- props y plantillas como roles visuales;
- recetas de escena y secuencias coordinadas declarativas;
- bindings entre slots de una secuencia y roles de una escena;
- registro compartido del estado de cada capacidad por consumidor;
- validación estructural, semántica, de recursos y parámetros;
- fixtures válidos e inválidos para los cuatro modos.

Quedan fuera de V0:

- compilar estos blueprints a `video-project`;
- sintetizar narración fuera de campo;
- preview o exportación de escenas flexibles;
- cambios en el Editor o en el panel del Director;
- generación de blueprints mediante Ollama;
- expansión de secuencias coordinadas a pistas reales;
- escenas completamente silenciosas.

## Contratos

### Blueprint de escena

`schema/creative-scene-blueprint.schema.json` define intención y referencias
semánticas. No contiene rutas, código, frames ni tiempos absolutos.

`durationWeight` es un entero entre 1 y 10. Solo distribuye presupuesto
editorial entre escenas. La duración final de una escena hablada seguirá
proviniendo del WAV medido mediante FFprobe.

Reglas por modo:

| Modo | Personajes visibles | Voz admitida |
|---|---:|---|
| `voiceover` | 0 | narrador fuera de campo |
| `solo` | 1 | personaje visible |
| `dialogue` | 2 | personajes visibles; ambos hablan |
| `visual-with-voiceover` | 0–2 | narrador fuera de campo |

El máximo simultáneo sigue siendo dos. El futuro plan de proyecto podrá cambiar
el reparto entre escenas y usar más de dos recursos distintos en total.

### Catálogo de recetas

`schema/creative-recipe-catalog.schema.json` separa:

- `sceneRecipes`: estructura narrativa y visual de alto nivel;
- `effectSequences`: coordinación de presets existentes mediante slots.

Una secuencia declara tipos de elemento, parámetros requeridos, anclas
compatibles y acciones. Cada acción referencia un preset versionado existente.
No puede contener scripts, expresiones ni filtros libres.

Catálogo inicial:

- escenas: `voiceover-feature-v1`, `solo-explainer-v1`,
  `dialogue-contrast-v1` y `keyword-pages-v1`;
- secuencias: `visual-reveal-v1`, `entrance-emphasis-exit-v1`,
  `speaker-focus-reaction-v1` y `prop-pop-and-point-v1`.

### Matriz de capacidades

`shared/creative-capabilities.js` es puro y apto para navegador. Proyecta:

- límites creativos;
- modos de escena;
- parámetros y presets de animación reales;
- recursos del catálogo de autoría;
- recetas disponibles;
- estado por `authoring`, `preview`, `export`, `directorCreation` y
  `directorEditing`.

Estados admitidos:

- `available`: camino operativo;
- `limited`: operativo con una restricción conocida;
- `draft-only`: representable como borrador, no renderizable;
- `planned`: contrato congelado, consumidor pendiente;
- `excluded`: fuera del camino creativo vigente.

Esto permite mostrar límites honestos y evita mantener prompts con listas
manuales divergentes.

## Validación semántica

`scripts/director/creative-contract.mjs` verifica además del JSON Schema:

- IDs únicos;
- cantidad de participantes por modo;
- voz compatible con el modo;
- referencias de hablante, turno, receta, secuencia y slot;
- tipos reales de recursos;
- animación base y gestos admitidos por el personaje;
- requisitos de elementos de cada receta;
- compatibilidad entre bindings y slots;
- parámetros de articulación declarados por el recurso;
- anclas de turno y palabra vigentes;
- pausa final igual a cero.

El catálogo de errores tiene mensajes y acciones estables para procesos y UI.

## Compatibilidad

V0 es aislado y aditivo:

- no modifica `video-project.schema.json`;
- no modifica `scene-config-v2.schema.json`;
- no cambia `shared/scene-evaluator.js`;
- no cambia proyectos, cachés, previews ni MP4 históricos;
- no incorpora los blueprints al Director actual.

V1 deberá crear un contrato o adaptador versionado para runtime flexible. No se
reinterpretará una escena v2 histórica como una escena flexible.

## Gate

Ejecutar:

```powershell
npm run director:test-creative-contract
```

El gate cubre:

- los cuatro modos válidos;
- participantes y tipos de voz incompatibles;
- requisito visual ausente;
- binding de tipo incorrecto;
- articulación no soportada;
- rechazo de duración absoluta y código arbitrario;
- referencias rotas;
- determinismo y honestidad de la matriz.

La evidencia regenerable se escribe en
`.local-video/test-results/creative-contract-latest.json`.
