# Auditoría UX/UI y plan de evolución del panel Director IA

Fecha: 5 de agosto de 2026

Estado: implementado y verificado técnicamente el 8 de agosto de 2026

Alcance: únicamente el panel izquierdo del Director IA y sus conexiones directas con el proyecto activo, el visor y el render

Fuera de alcance: layout general de cinco áreas, panel derecho, visor, timeline, Montaje, motor audiovisual, proveedor/modelo de IA y contratos de render

Resultado de implementación: las fases D0–D7 están incorporadas. El Director usa `Idea → Base → Video`, elimina el inspector y la navegación anteriores, conserva las propuestas IA pendientes hasta revisión humana y no muestra porcentajes simulados. El gate técnico y la inspección visual local quedaron registrados al cierre de este documento.

## 1. Decisión ejecutiva

El Director debe dejar de sentirse como un formulario administrativo repartido en pestañas y pasar a ser una superficie de trabajo guiada por IA.

La evolución propuesta no es “hacerlo más redondeado” ni imitar un chat genérico. Es cambiar su jerarquía y su modelo de interacción:

1. El prompt es la acción principal y aparece antes que cualquier explicación o configuración.
2. El usuario describe el resultado; la IA interpreta las decisiones editoriales que ya sabe inferir.
3. Solo dos acompañantes compactos quedan a la vista: duración y formato, ambos en automático por omisión.
4. El prompt genera una base de proyecto, no una pantalla llena de controles.
5. Esa base se resume como storyboard y se continúa mediante nuevas instrucciones o edición contextual en el panel derecho.
6. Los cambios propuestos por IA se revisan dentro del panel antes de aplicarse; desaparecen los `window.confirm`.
7. La creación del MP4 es la última fase del mismo recorrido y solo muestra información que exige una decisión.
8. Calidad, variantes, recursos considerados, salud y diagnóstico siguen disponibles, pero por divulgación progresiva.

El proyecto editable continúa siendo la única fuente de verdad. No se agregará historial de chat, memoria paralela ni un documento intermedio persistente.

## 2. Qué se auditó

### 2.1 Código y contratos actuales

- `index.html`, estructura real del Director.
- `src/style.css`, tokens, densidad y componentes del panel.
- `src/ui/director/panel.ts`, orquestación completa del flujo.
- `src/ui/director/navigation.ts` y `flow-guidance.ts`, estado y siguiente acción.
- `src/ui/director/api.ts`, entradas y salidas disponibles.
- `src/ui/project/panel.ts`, edición interna de la propuesta.
- `scripts/director/ollama-director.mjs`, inferencia de restricciones, contexto, calidad y generación V2.
- `scripts/local-app/server.mjs`, endpoints y guardas operativas.
- Pruebas de UI y Director existentes.
- Documentos vigentes del Director, variabilidad creativa y estructura visual canónica.

### 2.2 Interfaz en ejecución

Se inspeccionó la aplicación real en `1280 × 720`, tema claro, con un proyecto existente, recorriendo:

- `Ajustar con IA`.
- `Estado actual > Escena`.
- `Estado actual > Personajes`.
- `Estado actual > Fondo`.
- `Estado actual > Transición`.
- `Exportar`.

No se creó ni modificó un proyecto para la auditoría.

### 2.3 Evidencia cuantificada

En el estado `Ajustar con IA`:

- El panel tiene 313 px útiles de ancho en la captura auditada.
- El prompt comienza aproximadamente 280 px por debajo del inicio visible del panel.
- Antes del prompt aparecen cabecera, navegación de tres pasos, tarjeta de siguiente acción y barra de estado.
- Esa antesala consume alrededor del 60 % del alto visible del Director antes de llegar a la tarea principal.
- Hay 11 controles interactivos visibles aun cuando los cinco parámetros de creación están ocultos por tratarse de un proyecto existente.

En `Estado actual`:

| Subpágina | Controles visibles | Inputs | Textareas | Problema principal |
| --- | ---: | ---: | ---: | --- |
| Escena | 17 | 3 | 4 | Repite edición de texto que ya pertenece a `Edición` |
| Personajes | 13 | 1 | 0 | Es principalmente una pasarela hacia el panel derecho |
| Fondo | 13 | 1 | 0 | Muestra tarjetas informativas y otra pasarela |
| Transición | 12 | 1 | 0 | Agrega una pestaña para muy poca decisión |

En `Exportar` se muestran cuatro requisitos completos, cada uno con título, detalle y marca verde, aunque ninguno requiere intervención. La confirmación positiva ocupa más espacio que la acción `Exportar MP4`.

## 3. Diagnóstico

### 3.1 Problemas críticos de flujo

#### P0. El prompt no manda visualmente

La interfaz afirma que el Director empieza por una idea, pero la idea llega después de cuatro capas de orientación. La acción más importante no es el primer foco visual ni espacial.

#### P0. La UI obliga a decidir lo que el Director ya puede interpretar

El backend vigente ya ejecuta `inferDirectorConstraints(prompt, constraints)` y reconoce en el prompt:

- cantidad de escenas;
- duración en segundos;
- tono;
- narración, monólogo o diálogo;
- riqueza simple, variada o dinámica.

Sin embargo, la creación inicial presenta cinco selectores y envía siempre tono educativo, 30 segundos y dos escenas. En ausencia de una petición explícita, la interfaz fija la respuesta antes de que el Director interprete la idea.

#### P0. Hay navegación dentro de navegación

El recorrido usa tres pestañas principales y `Estado actual` agrega cuatro pestañas secundarias. El usuario debe entender una taxonomía de pantallas antes de poder continuar con el contenido.

#### P0. El Director duplica funciones del Editor

`Escena` permite editar títulos y textos dentro del Director, mientras el panel derecho ya concentra la edición contextual y la timeline conserva la estructura. Esto diluye la función del Director: dirigir y proponer.

### 3.2 Problemas de jerarquía y carga cognitiva

#### P1. Tres sistemas indican el estado al mismo tiempo

- números de paso;
- tarjeta `Siguiente paso`;
- barra global de estado.

Los tres pueden ser correctos, pero compiten entre sí y repiten información.

#### P1. La respuesta de IA se vuelca como auditoría técnica

`renderProposalQuality` puede apilar en una sola tarjeta:

- score;
- perfil de riqueza;
- storyboard;
- reparaciones;
- problemas de calidad;
- comparación de candidatos;
- recursos considerados;
- plantilla elegida.

Son datos valiosos, pero no tienen la misma prioridad. La base creativa y la explicación técnica aparecen mezcladas.

#### P1. Las opciones de modelo se presentan como decisiones de producto

`Razonamiento` y `Propuestas 1/2/3` describen el mecanismo interno. El usuario debería elegir entre velocidad y nivel de elaboración solo si desea intervenir, no comprender `think` o `bestOf` al comenzar.

#### P1. La revisión de cambios usa diálogos nativos

La edición con IA devuelve comandos y una explicación estructurada, pero se confirma mediante `window.confirm`. El resultado es correcto y seguro, aunque visualmente rompe el flujo y no permite comparar con calma antes de aplicar.

#### P1. La exportación premia estados sin acción

Los cuatro requisitos completos producen ruido. La lista solo aporta valor cuando hay un bloqueo o una comprobación pendiente.

### 3.3 Problemas visuales

#### P2. Tipografía excesivamente pequeña

El Director usa de forma dominante tamaños aproximados de 11–13 px. La jerarquía depende de mayúsculas, bordes y peso, no de una escala tipográfica cómoda.

#### P2. Demasiadas superficies equivalentes

Tabs segmentadas, tarjeta de siguiente paso, barra de estado, `details`, tarjetas de escena, tarjeta de calidad y tarjetas de requisitos usan bordes parecidos. Nada domina con claridad.

#### P2. Sensación de formulario tradicional

La grilla de selects nativos, las etiquetas sobre cada campo y el CTA separado al pie corresponden a un formulario de configuración. Un Director de IA actual debería empezar por intención, no por parametrización.

#### P2. Exceso de lenguaje interno

Términos como `Riqueza`, `Estructura`, `Razonamiento`, `Propuestas` y valores como `static` aparecen antes o junto al contenido. Deben traducirse, inferirse o quedar en detalles.

### 3.4 Problema técnico que agrava la UX

`src/ui/director/panel.ts` concentra más de 1.100 líneas y mezcla:

- navegación;
- salud;
- generación;
- confirmación de cambios;
- calidad;
- recursos;
- galería de renders;
- progreso;
- disponibilidad de MP4;
- copy de errores.

No es un fallo funcional, pero hace frágil cualquier evolución visual. El rediseño debe separar estados y vistas sin crear otra fuente de verdad.

## 4. Fortalezas que deben conservarse

El rediseño no debe perder lo que ya está bien resuelto:

- La IA emite planes o comandos cerrados; nunca escribe libremente el proyecto.
- Los cambios de edición IA se validan y aplican atómicamente.
- El proyecto actual puede deshacer un lote completo del Director.
- La IA recibe shortlist de recursos, plantillas y capacidades reales.
- Plan V2 ya soporta 1–8 escenas, 0–2 personajes simultáneos, voz fuera de campo, props, plantillas, música, recetas y secuencias.
- El progreso de IA distingue preparación, generación, reparación, juez y finalización.
- IA y render comparten cancelación contextual y exclusión de concurrencia.
- Salud, errores y acciones sugeridas ya tienen datos estructurados.
- El MP4 vigente, anterior o ausente ya se distingue correctamente.
- El visor, el panel derecho y la timeline ya comparten proyecto, selección y medición.

## 5. Principios del nuevo Director

### 5.1 Prompt primero

La primera pregunta visible será: `¿Qué video querés crear?` o, sobre un proyecto existente, `¿Qué querés cambiar?`.

### 5.2 Automatización por omisión, control por elección

Los parámetros no desaparecen: empiezan en automático y se revelan solo cuando el usuario quiere fijarlos.

### 5.3 Una fase visible a la vez

`Idea`, `Base` y `Video` serán estados de un recorrido, no tres pestañas paralelas. Un indicador compacto mostrará progreso; las acciones del contenido harán avanzar o volver.

### 5.4 La IA propone; el usuario conserva agencia

Una edición sobre el proyecto se muestra como propuesta pendiente con `Aplicar` y `Descartar`. Después de aplicar, se ofrece `Deshacer`.

### 5.5 Explicar por capas

Primero se muestra el resultado y la siguiente acción. Calidad, recursos, plantilla, variantes y diagnóstico viven bajo `Cómo lo decidió` o `Detalles`.

### 5.6 El Director dirige; el Editor edita

El storyboard del Director resume y navega. La modificación manual detallada se abre en el panel derecho ya existente.

### 5.7 Sin chat ficticio

El compositor puede sentirse contemporáneo, pero cada envío sigue siendo una orden acotada. No se persistirá una conversación que el motor no necesita ni puede garantizar.

## 6. Flujo objetivo

```text
SIN PROYECTO
    │
    ▼
1 · IDEA ── prompt + dirección automática
    │ Crear base
    ▼
GENERANDO ── progreso real por etapas + cancelar
    │
    ▼
2 · BASE ── resumen + storyboard + compositor de ajustes
    │                     │
    │                     └── propuesta de cambio → aplicar/descartar → deshacer
    │ Continuar
    ▼
3 · VIDEO ── listo o bloqueadores → crear/actualizar MP4 → resultado
```

Al abrir un proyecto existente, el Director entra directamente en `2 · Base`. Si hay una tarea de IA o render en curso, el estado operativo correspondiente gana temporalmente. Si el MP4 está vigente, `Video` aparece completado sin forzar al usuario a abrirlo.

### 6.1 Fase Idea

Contenido visible, en este orden:

1. Cabecera compacta `Director IA` con estado solo si requiere atención.
2. Indicador discreto `Idea — Base — Video`.
3. Prompt grande.
4. Dos chips: `Duración · Auto` y `Formato · Auto`.
5. Acción secundaria `Más dirección`.
6. Un único CTA primario `Crear base`.
7. Ejemplos breves solo mientras el prompt está vacío.

`Más dirección` contiene:

- tono;
- cantidad de escenas;
- riqueza visual;
- estrategia de calidad/variantes.

Todo empieza en automático. Un chip activo significa que el usuario fijó una restricción; no que la interfaz eligió por él.

### 6.2 Estado Generando

El prompt sigue visible en modo de solo lectura o resumido. Debajo se muestra una única línea viva, por ejemplo:

- `Entendiendo la idea…`
- `Eligiendo recursos de tu biblioteca…`
- `Creando escena 2 de 4…`
- `Revisando el guion…`
- `Ajustando la propuesta…`

Solo aparecen `Cancelar` y, cuando corresponda, el bloqueador accionable. No se inventan porcentajes de IA.

### 6.3 Fase Base

Cabecera:

- `Base creada` o `Proyecto actual`.
- chips derivados del resultado real: `3 escenas`, `Diálogo`, `30 s objetivo`, `Variada`.
- no se repite el título editable que ya vive en el encabezado global.

Storyboard:

- una tarjeta compacta por escena;
- número y título;
- modo narrativo;
- participantes y recursos visuales en lenguaje humano;
- una síntesis de diálogo o propósito, no todos los textareas abiertos;
- estado seleccionado compartido con timeline y visor;
- clic abre la escena o el elemento en `Edición` cuando se necesita detalle.

Compositor persistente al pie:

- `Pedile un ajuste al Director…`;
- contexto breve de selección, por ejemplo `Escena 2 seleccionada`;
- enviar;
- sugerencias contextuales no bloqueantes cuando está vacío.

Acciones:

- primaria: `Continuar con el video`;
- secundaria: `Replantear idea`;
- el compositor es el camino normal de iteración, no otra pestaña.

Si `Replantear idea` se usa sobre un proyecto con contenido, el Director muestra
primero una advertencia inline de reemplazo. La generación no comienza hasta que
el usuario confirma y el proyecto vigente no se modifica durante esa espera.

Detalles plegables:

- `Control de calidad`;
- `Cómo lo decidió`;
- `Variantes comparadas`, solo si existen;
- `Recursos usados`.

### 6.4 Propuesta de cambio sobre una base

La respuesta de `/api/director/edits` no se aplica inmediatamente. Se conserva de forma efímera en el panel con:

- resumen humano;
- lista de cambios exactos ya disponible en `explanation.changes`;
- aviso especial si elimina animación manual/personalizada;
- `Aplicar cambios`;
- `Descartar`.

Al aplicar:

1. se vuelve a comparar la revisión base con el proyecto actual;
2. se autorizan solo las eliminaciones personalizadas confirmadas;
3. se despacha un único lote atómico;
4. se muestra recibo breve `Cambios aplicados`;
5. se ofrece `Deshacer` usando el historial vigente.

Si el proyecto cambió mientras se revisaba, la propuesta caduca y se explica por qué. No se intenta mezclarla.

### 6.5 Fase Video

Estado listo:

- una frase: `Todo listo para crear el MP4`;
- CTA `Crear MP4` o `Actualizar MP4`;
- detalles de requisitos plegados.

Estado bloqueado:

- solo se muestran los requisitos bloqueados o pendientes;
- cada uno ofrece su acción real: volver al Editor, completar proyecto o abrir diagnóstico.

Estado en curso:

- etapa humana actual;
- escena N de M si el job la informa;
- cancelación;
- sin porcentaje fijo derivado únicamente de una tabla de etapas.

Estado completado:

- `MP4 listo`;
- duración y cantidad de escenas;
- `Ver en el visor`;
- `Descargar`;
- no se duplica el video dentro del panel.

## 7. Wireframes de referencia

### 7.1 Idea

```text
┌──────────────────────────────┐
│ Director IA             ●    │
│ Idea ───── Base ───── Video  │
│                              │
│ ¿Qué video querés crear?     │
│ ┌──────────────────────────┐ │
│ │ Explicá por qué...       │ │
│ │                          │ │
│ └──────────────────────────┘ │
│ [Duración · Auto] [Formato · Auto]
│ Más dirección                │
│                              │
│ [ Crear base              → ]│
│                              │
│ Ejemplos: Explicación · Historia
└──────────────────────────────┘
```

### 7.2 Base e iteración

```text
┌──────────────────────────────┐
│ Director IA             ●    │
│ Idea ━━━━━ Base ───── Video  │
│                              │
│ Base creada                  │
│ 3 escenas · Diálogo · 30 s   │
│                              │
│ 01  El problema          ›   │
│     Diálogo · 2 personajes   │
│ 02  El contraste         ›   │
│     Voz + prop                │
│ 03  El cierre            ›   │
│     Narración · música        │
│                              │
│ ▸ Control de calidad          │
│ ▸ Cómo lo decidió             │
│                              │
│ ┌──────────────────────────┐ │
│ │ Pedile un ajuste…     →  │ │
│ └──────────────────────────┘ │
│ [ Continuar con el video   ] │
└──────────────────────────────┘
```

### 7.3 Cambio pendiente

```text
┌──────────────────────────────┐
│ Cambio propuesto             │
│ • Reescribe el cierre        │
│ • Agrega un prop en escena 2 │
│ • Aplica una entrada suave   │
│                              │
│ [Descartar] [Aplicar cambios]│
└──────────────────────────────┘
```

## 8. Especificación visual

### 8.1 Jerarquía

- El prompt o el resumen de base ocupa el primer bloque de contenido.
- Máximo una acción primaria visible por fase.
- El acento se reserva para foco, estado activo y CTA.
- Los estados positivos en reposo no generan una tarjeta permanente.
- Los bordes separan secciones funcionales, no cada línea de información.

### 8.2 Tipografía del Director

Sin alterar toda la aplicación:

- título: 16–17 px;
- pregunta principal: 14–15 px y peso 650–700;
- cuerpo y controles: 13–14 px;
- metadatos: mínimo 12 px;
- evitar mayúsculas espaciadas como principal recurso jerárquico.

### 8.3 Espaciado y superficies

- padding interior principal: 12–16 px;
- separación entre bloques: 12 px;
- controles táctiles/clicables: mínimo 36 px de alto;
- radios coherentes de 10–12 px en compositor y tarjetas principales;
- no más de una superficie bordeada dentro de otra;
- el compositor puede usar fondo levemente elevado, sin sombra fuerte permanente.

### 8.4 Comportamiento espacial

- En creación, prompt, chips y CTA deben entrar sin scroll con panel de 320 px de ancho y 600 px de alto útil.
- En Base, el encabezado y el compositor permanecen visibles; el storyboard usa el scroll interno.
- El panel puede seguir redimensionándose dentro de los límites vigentes.
- En responsive se conserva el mismo orden semántico; no reaparecen las pestañas anidadas.

### 8.5 Movimiento

- Transiciones de estado de 160–220 ms.
- Generación con actividad sutil ligada a la etapa real.
- Sin animación decorativa continua cuando no hay una tarea.
- `prefers-reduced-motion` elimina desplazamientos y shimmer.

## 9. Plan de acción por fases

### Fase D0 — Alinear el contrato del panel

Objetivo: autorizar documentalmente que el Director deje de usar las subpáginas internas actualmente exigidas por `ESTRUCTURA_VISUAL_CANONICA.md`.

Cambios exactos:

1. Actualizar la sección `Panel izquierdo — Director IA` para reemplazar `Idea / Propuesta / Render` como pestañas por `Idea / Base / Video` como estados de flujo.
2. Eliminar del contrato la obligación de las subpestañas `Escena / Personajes / Fondo / Transición`.
3. Fijar que el storyboard del Director navega y resume; la edición manual detallada vive a la derecha.
4. Mantener sin cambios la posición izquierda, el visor dominante, el panel derecho y la timeline.
5. Congelar los estados y términos del nuevo flujo antes de tocar HTML.

Archivos:

- `docs/ESTRUCTURA_VISUAL_CANONICA.md`.
- Este documento, si la implementación descubre una incompatibilidad real.

Criterio de salida:

- No existe contradicción entre el rediseño aprobado y la constitución visual del repositorio.

### Fase D1 — Prompt primero y restricciones automáticas

Objetivo: hacer que una idea pueda enviarse sin completar un formulario.

Cambios exactos:

1. Sustituir la fila de pestañas, la tarjeta `Siguiente paso` y el estado positivo permanente por cabecera + indicador de flujo compacto.
2. Mover el prompt al primer bloque de contenido.
3. Mantener visibles solo `Duración · Auto`, `Formato · Auto` y `Más dirección`.
4. Mover tono, escenas, riqueza y calidad al panel progresivo.
5. Cambiar el payload por omisión para enviar:
   - `planVersion: 2`;
   - `richnessProfile: automatic`;
   - `structure: automatic`;
   - sin `tone`, `targetDurationSeconds` ni `sceneCount` si el usuario no los fijó.
6. Cambiar el tipo de UI a restricciones parciales; no modificar el schema del motor.
7. Conservar la inferencia por texto vigente y agregar una prueba de propuesta V2 sin restricciones rígidas.
8. Resolver la precedencia en dos niveles: el prompt completa todo lo que queda en automático; un chip que el usuario cambió deliberadamente se aplica después como override explícito. Esto requiere ajustar `inferDirectorConstraints` y sus pruebas, sin cambiar el schema de salida.
9. Traducir calidad avanzada a lenguaje de resultado, sin exponer nombres de implementación en la vista inicial.
10. Reutilizar los ejemplos del onboarding como ayudas vacías; no sumar otro sistema de plantillas.

Archivos principales:

- `index.html`.
- `src/ui/director/panel.ts`.
- `src/ui/director/api.ts`.
- nuevo `src/ui/director/brief.ts` para normalizar overrides y producir chips.
- `src/ui/onboarding.ts`.
- `src/ui/command-palette.ts`.
- `scripts/director/ollama-director.mjs`, únicamente para precedencia de overrides explícitos.
- `src/style.css`.
- `scripts/ui/test-ui-modules.mjs`.
- `scripts/director/test-flexible-director-v2.mjs` o prueba equivalente.

Criterios de aceptación:

- Crear una base requiere prompt + un clic.
- Ningún selector rígido tiene un valor oculto que contradiga el prompt.
- Escribir `45 segundos`, `diálogo` o `tono irónico` sigue influyendo mediante la inferencia existente.
- Fijar un chip produce una restricción explícita y visible; ante contradicción deliberada, el chip fijado gana y el resultado efectivo se muestra después.
- El estado inicial tiene como máximo cuatro controles principales: prompt, dos chips y CTA; `Más dirección` es secundario.
- No hay scroll en el estado inicial al tamaño mínimo definido.

### Fase D2 — Generación comprensible dentro de la misma superficie

Objetivo: convertir la espera de Ollama en una continuación del prompt, no en otra pantalla.

Cambios exactos:

1. Modelar `brief`, `generating`, `base`, `pending-change` y `video` en una función pura de estado.
2. Reemplazar `navigation.ts` y la lógica de páginas por `flow-state.ts`.
3. Reutilizar `progress-copy.ts`, revisando el vocabulario para el nuevo flujo.
4. Mostrar etapa real, candidato, reparación y segmento solo cuando existan.
5. Mantener `Cancelar` junto al estado de generación.
6. Ocultar el mensaje `Servicios locales listos` en reposo; el indicador sano queda discreto en cabecera.
7. Ante dependencia ausente, mostrar un único bloque accionable con `Ver diagnóstico`.
8. Conservar el prompt tras error o cancelación.
9. Limpiar o transformar el prompt en compositor de ajustes solo después de crear la base con éxito.

Archivos principales:

- `src/ui/director/panel.ts`.
- `src/ui/director/navigation.ts` → retirar o reemplazar.
- `src/ui/director/flow-guidance.ts` → simplificar en estados y copy.
- `src/ui/director/progress-copy.ts`.
- `src/ui/director/health-copy.ts`.
- `index.html`.
- `src/style.css`.
- `scripts/ui/test-ui-modules.mjs`.

Criterios de aceptación:

- Una tarea de IA no abre una pestaña distinta.
- El usuario siempre ve qué está ocurriendo y puede cancelar.
- No se muestra porcentaje de IA sin medición real.
- Cancelar, timeout, concurrencia, dependencia y respuesta inválida mantienen sus acciones vigentes.
- El lector de pantalla recibe cambios de etapa sin repetir toda la región.

### Fase D3 — Base y storyboard sin subpestañas

Objetivo: convertir la propuesta generada en una base legible y navegable.

Cambios exactos:

1. Retirar `Escena / Personajes / Fondo / Transición` del Director.
2. Retirar el título duplicado `#proposal-title`; el título global sigue siendo editable.
3. Sustituir `src/ui/project/panel.ts` por un módulo de storyboard del Director.
4. Proyectar cada tarjeta directamente desde `ProjectStore`; metadatos adicionales de la última propuesta son opcionales y efímeros.
5. Mostrar resumen derivado del plan real cuando exista y degradar correctamente al abrir un proyecto durable sin metadata de propuesta.
6. Compartir selección con timeline, visor y panel derecho.
7. Abrir `Edición` para cambios manuales detallados; no conservar textareas paralelos.
8. Separar calidad, decisión y recursos en tres `details` independientes.
9. Mostrar solo una síntesis de calidad por omisión: correcta o con cuestiones que revisar.
10. Hacer que un proyecto existente abra directamente en Base.
11. Mantener el compositor de ajustes anclado al pie.

Archivos principales:

- nuevo `src/ui/director/storyboard.ts`.
- `src/ui/director/panel.ts`.
- `src/ui/project/panel.ts` → retirar tras migrar la navegación útil.
- `src/ui/index.ts`.
- `src/ui/project/selection.ts`.
- `src/ui/right-panel.ts`.
- `src/ui/director/quality-copy.ts`.
- `src/ui/director/candidates-copy.ts`.
- `index.html`.
- `src/style.css`.
- `scripts/ui/test-ui-modules.mjs`.

Criterios de aceptación:

- No existe navegación anidada dentro del Director.
- La primera escena y la acción para continuar se entienden sin abrir detalles.
- Seleccionar una tarjeta sincroniza el resto del Editor.
- El Director no mantiene campos editables duplicados.
- Score, comparación y IDs de recursos no dominan la lectura.
- Un proyecto restaurado funciona sin depender de conservar la respuesta original de Ollama.

### Fase D4 — Revisar, aplicar, descartar y deshacer cambios IA

Objetivo: reemplazar confirmaciones nativas por una revisión moderna y segura.

Cambios exactos:

1. Cuando `/api/director/edits` responda, guardar en memoria un `pendingEdit` con revisión base, comandos y explicación.
2. No ejecutar `dispatchBatch` hasta que el usuario pulse `Aplicar cambios`.
3. Mostrar la lista humana de cambios mediante `explanation.changes` y los mapeos existentes.
4. Ofrecer `Descartar` sin modificar el proyecto.
5. Invalidar la propuesta si el fingerprint del proyecto deja de coincidir.
6. Para eliminación de animación personalizada, insertar un segundo estado inline específico; la IA sigue sin poder emitir `confirmCustomized`.
7. Aplicar el lote de forma atómica.
8. Mostrar recibo con `Deshacer` después de aplicar.
9. Usar el mismo patrón inline para confirmar `Replantear idea` cuando reemplazaría una base con cambios.
10. Eliminar `window.confirm` del camino normal del Director.
11. Conservar confirmaciones nativas solo como fallback temporal durante la migración, nunca como estado final.

Archivos principales:

- `src/ui/director/panel.ts`.
- `src/ui/director/edit-proposal.ts`.
- nuevo `src/ui/director/pending-edit.ts` para la máquina pura de revisión.
- `src/ui/project/store.ts`, solo para usar capacidades existentes, no para crear otro historial.
- `src/style.css`.
- `scripts/ui/test-ui-modules.mjs`.

Criterios de aceptación:

- Antes de aplicar, el proyecto permanece byte a byte igual.
- Aplicar ocupa un único paso de undo.
- Descartar no deja cambios ni estado residual.
- Un proyecto modificado durante la revisión invalida el lote.
- Una eliminación personalizada requiere confirmación humana explícita.
- Todo el flujo funciona con teclado y devuelve el foco al compositor.

### Fase D5 — Video como cierre simple del recorrido

Objetivo: reducir `Exportar` a decisión, progreso y resultado.

Cambios exactos:

1. Renombrar la fase a `Video` y usar CTA `Crear MP4`, `Actualizar MP4` o estado `MP4 al día`.
2. Ocultar la lista de requisitos cuando todos están completos.
3. Mostrar solo requisitos bloqueados o pendientes y conservar detalles completos bajo demanda.
4. Reemplazar el porcentaje derivado de `stageProgress()` por etapa real; usar porcentaje solo si el backend entrega uno medido.
5. Mostrar escena N/M cuando el job lo permita.
6. Mantener el indicador global de render para panel colapsado.
7. En éxito, ofrecer ver y descargar sin incrustar un segundo reproductor.
8. Conservar correctamente estados `missing`, `stale` y `current`.
9. Mantener historial de videos en `Archivos > Videos creados`, fuera del Director.

Archivos principales:

- `src/ui/director/panel.ts`.
- `src/ui/director/flow-guidance.ts` o su reemplazo.
- `src/ui/director/api.ts`.
- `src/ui/viewer.ts`.
- `src/ui/editor-workspace.ts`.
- `index.html`.
- `src/style.css`.
- `scripts/ui/test-ui-modules.mjs`.

Criterios de aceptación:

- Con todo listo se ve una frase y un CTA, no cuatro tarjetas verdes.
- Cada bloqueo tiene una acción real.
- Un MP4 vigente no puede renderizarse de nuevo por accidente.
- Un MP4 anterior se conserva y se identifica como anterior.
- Cancelación y fallos mantienen detalle técnico bajo demanda.

### Fase D6 — Lenguaje visual moderno, responsive y accesible

Objetivo: consolidar el cambio de flujo en un diseño contemporáneo y consistente.

Cambios exactos:

1. Aplicar la escala tipográfica específica definida en §8.2.
2. Diseñar compositor, chips, stepper de estado, tarjetas de storyboard y propuesta pendiente.
3. Reducir bordes y superficies anidadas.
4. Reservar color fuerte para CTA, foco y error.
5. Diseñar estados hover, focus, pressed, disabled, busy y reduced motion.
6. Validar tema claro, oscuro y los cuatro acentos actuales.
7. Verificar anchos de Director 280, 320, 384 y 560 px.
8. Verificar alturas útiles de 600, 720 y 900 px.
9. Mantener targets de al menos 36 px y texto secundario de al menos 12 px.
10. Conservar roles, nombre accesible, orden de foco y anuncios `aria-live` acotados.
11. Evitar que el compositor sticky tape la última tarjeta del storyboard.

Archivos principales:

- `src/style.css`.
- `index.html`.
- módulos nuevos de Director de las fases anteriores.
- `scripts/ui/check-critical-css.mjs` si cambian tokens críticos.
- `scripts/ui/check-contrast.mjs`.
- `scripts/ui/check-dom-ids.mjs`.

Criterios de aceptación:

- El prompt es el foco visual inequívoco en Idea.
- No hay texto funcional por debajo de 12 px.
- La fase activa se entiende sin depender solo del color.
- Tema y acentos conservan WCAG AA.
- El flujo principal puede completarse sin mouse.
- El diseño responsive no reconstruye la antigua pila de pestañas.

### Fase D7 — Migración, pruebas y gate humano

Objetivo: retirar el sistema anterior sin romper invariantes ni dejar dos Directores coexistiendo.

Cambios exactos:

1. Eliminar DOM, CSS y pruebas del recorrido anterior solo después de completar los estados equivalentes.
2. Dividir `panel.ts` para que quede como orquestador; las máquinas puras viven en módulos testeables.
3. Actualizar onboarding, paleta de comandos y copy global.
4. Actualizar `AGENTS.md` solo al finalizar y resumir el estado real, no el plan.
5. Actualizar documentación de capacidades si cambia el payload por omisión.
6. Ejecutar prueba humana del recorrido completo y registrar hallazgos antes del cierre.

Gate técnico:

```powershell
npm run ui:test-modules
npm run ui:check-css
npm run ui:check-ids
npm run ui:check-contrast
npm run build
npm test
```

Matriz visual mínima:

- proyecto vacío;
- proyecto existente;
- IA lista, ausente, ocupada, cancelada, timeout y respuesta inválida;
- generación simple, con reparación y best-of;
- propuesta de cambio normal, descartada, caducada y con eliminación personalizada;
- proyecto válido e inválido;
- MP4 ausente, anterior, vigente, en curso, cancelado y fallido;
- claro/oscuro;
- teclado;
- `prefers-reduced-motion`;
- panel mínimo, normal y máximo;
- breakpoint responsive.

Gate humano:

- 4 de 5 usuarios deben crear una base sin explicación externa.
- 4 de 5 deben saber cómo pedir un cambio y cómo descartarlo.
- 5 de 5 deben distinguir Base de MP4.
- Ningún usuario debe buscar tono, escenas o estructura antes de escribir su idea.
- Ningún usuario debe interpretar que el Director modificó el proyecto antes de pulsar `Aplicar cambios`.

## 10. Mapa de sustitución

| Actual | Destino |
| --- | --- |
| Tabs `Idea / Propuesta / Exportar` | Indicador de progreso `Idea / Base / Video` |
| Tarjeta `Siguiente paso` | Una CTA contextual dentro de la fase |
| Barra `Servicios locales listos` | Estado discreto en cabecera; bloque solo ante problema |
| Cinco selects visibles | Dos chips automáticos + `Más dirección` |
| `Calidad y variantes` al inicio | Estrategia de creación avanzada bajo demanda |
| `Escena / Personajes / Fondo / Transición` | Storyboard único y navegación al panel derecho |
| Título duplicado del proyecto | Título global existente |
| Tarjeta monolítica de calidad | Síntesis + detalles separados |
| `window.confirm` | Revisión inline aplicar/descartar |
| Cuatro requisitos verdes | Resumen listo; solo bloqueadores visibles |
| Porcentaje fijo por etapa | Etapa real; porcentaje solo si es medido |

## 11. Riesgos y mitigaciones

### Riesgo: esconder demasiado control

Mitigación: chips visibles, `Más dirección`, resumen de decisiones efectivas después de generar y posibilidad de replantear.

### Riesgo: que “automático” produzca resultados imprevisibles

Mitigación: el resultado muestra tono, duración, estructura, escenas y riqueza reales; el usuario puede fijarlos y regenerar.

### Riesgo: convertir el Director en otro inspector

Mitigación: storyboard de solo resumen/navegación; edición detallada siempre en el panel derecho.

### Riesgo: crear una segunda fuente de verdad con metadata IA

Mitigación: las tarjetas se derivan del `ProjectStore`; calidad y contexto son decorativos y pueden desaparecer al recargar sin romper el proyecto.

### Riesgo: perder seguridad al reemplazar confirmaciones

Mitigación: propuesta pendiente, fingerprint, lote atómico, confirmación especial y undo mantienen o mejoran las guardas actuales.

### Riesgo: que la fase Video oculte un bloqueo importante

Mitigación: se ocultan solo requisitos completos; bloqueados y pendientes siguen visibles y accionables.

### Riesgo: refactor amplio de un módulo central

Mitigación: migrar por estados, conservar IDs útiles durante la transición y cerrar cada fase con pruebas puras antes de retirar el DOM anterior.

## 12. Lo que este plan no autoriza

- Mover el Director fuera de la izquierda.
- Cambiar el layout canónico general.
- Crear memoria conversacional o persistir chats.
- Permitir que la IA emita JSON, scripts, filtros o keyframes libres.
- Cambiar Ollama, `qwen3:8b`, Piper, PixiJS o FFmpeg.
- Agregar React, un framework o una dependencia visual.
- Modificar el render, preview o evaluador temporal.
- Mezclar el Director de autoría con el Director de Montaje.
- Agregar preguntas aclaratorias generadas por el modelo sin un contrato separado y aprobado.
- Simular confianza, porcentaje, duración medida o capacidades no existentes.

## 13. Métricas de éxito

### Flujo

- Prompt visible en el primer viewport y dentro de los primeros 100 px de contenido tras la cabecera.
- Idea → base en un envío y un CTA.
- Cero pestañas anidadas.
- Una acción primaria por fase.
- Cero `window.confirm` en el camino normal.

### Densidad

- Máximo dos parámetros visibles junto al prompt.
- Cero mensajes positivos persistentes que no requieran acción.
- Cero listas de requisitos completos abiertas por omisión.
- Texto funcional mínimo de 12 px.

### Comprensión

- El usuario identifica qué decidió el Director sin abrir detalles técnicos.
- La diferencia entre base editable y MP4 es explícita.
- Toda propuesta IA pendiente dice que todavía no modificó el proyecto.

### Robustez

- Mismos comandos, validación, undo/redo y fingerprints que hoy.
- Mismos estados de salida y medición.
- Build, suite central y guardas de UI en verde.

## 14. Referentes externos usados como criterio, no como plantilla visual

- [Apple Human Interface Guidelines — Generative AI](https://developer.apple.com/design/human-interface-guidelines/generative-ai): progreso específico durante latencia, errores con siguiente acción y facilidad para refinar, revertir o reintentar resultados.
- [Microsoft HAX — Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/): corrección eficiente, control humano, explicación bajo demanda y recuperación ante fallos previsibles.
- [Microsoft HAX — Scope services when in doubt](https://www.microsoft.com/en-us/haxtoolkit/guideline/scope-services-when-in-doubt/): pedir precisión o degradar con honestidad cuando la intención es ambigua; este plan no inventa incertidumbre que el backend aún no calcula.
- [Google PAIR — Feedback + Control](https://pair.withgoogle.com/guidebook-v2/chapter/feedback-controls/): equilibrar automatización y control, y conectar la acción del usuario con el efecto visible en la experiencia.

## 15. Definición de terminado del rediseño

El trabajo se considera completo cuando:

- el contrato visual actualizado está aprobado;
- el prompt domina la entrada;
- la UI no fija restricciones no elegidas;
- el flujo usa Idea, Base y Video sin pestañas anidadas;
- la base se resume desde el proyecto real;
- los cambios IA se revisan, aplican, descartan y deshacen dentro del panel;
- Video muestra solo decisión, bloqueo, progreso o resultado;
- los detalles técnicos siguen accesibles sin dominar;
- se preservan seguridad, determinismo y fuentes de verdad;
- pasan los gates técnicos y el gate humano;
- no quedan DOM, estilos, copy ni pruebas del flujo anterior coexistiendo con el nuevo.

## 16. Registro de implementación

Implementado el 8 de agosto de 2026:

- Se retiraron `navigation.ts`, `flow-guidance.ts` y `src/ui/project/panel.ts`.
- `brief.ts` produce restricciones parciales y deja las decisiones automáticas al prompt; el backend aplica los overrides explícitos al final.
- `flow-state.ts` gobierna las fases `Idea`, `Base` y `Video` sin semántica de pestañas.
- `storyboard.ts` proyecta `ProjectStore`, comparte selección y abre `Edición`.
- `pending-edit.ts` conserva revisión base, comandos y explicación; la UI aplica o descarta inline y exige confirmación específica para animación personalizada.
- Video muestra únicamente bloqueos y etapas reales del job, sin `stageProgress()` ni barra porcentual ficticia.
- El documento visual canónico, onboarding, paleta de comandos y estado vigente de `AGENTS.md` se actualizaron al comportamiento real.

Verificación ejecutada:

- `npm run ui:test-modules`: 313 pruebas aprobadas.
- `npm run ui:check-css`: 7 comprobaciones aprobadas.
- `npm run ui:check-ids`: 288 comprobaciones aprobadas; solo advertencias opcionales históricas fuera del Director.
- `npm run ui:check-contrast`: 72 comprobaciones aprobadas.
- `npm run build`: TypeScript y Vite aprobados.
- Inspección visual local a 1280 × 720: Base sin overflow interno, storyboard navegable, Edición sincronizada, Video sin requisitos completos visibles, Idea prompt-first y ausencia de diálogos nativos.

Pendiente de producto, no técnico: ejecutar el gate humano 4/5 y 5/5 con usuarios reales definido en D7.
