# Plan de acción — Director IA y variabilidad creativa V1

Fecha: 2026-08-02

Estado al 2026-08-03: V0 y V1 implementados y verificados. El runtime ya
renderiza escenas con cero, uno o dos personajes y voz fuera de campo sin
placeholders. V2, editor flexible, es la próxima fase. Véanse
`docs/CONTRATO_VARIABILIDAD_CREATIVA_V0.md` y
`docs/RUNTIME_FLEXIBLE_V1.md`.

## 1. Objetivo

Permitir que el sistema y el Director produzcan videos sustancialmente más variados sin perder determinismo, compatibilidad ni sincronización entre preview y exportación.

El objetivo inicial es admitir, por escena:

- cero, uno o dos personajes visibles;
- narración fuera de campo, monólogo o diálogo;
- una o varias escenas con reparto y estructura diferentes;
- duración editorial distribuida de manera distinta entre escenas, medida finalmente desde el audio real;
- personajes, props, plantillas visuales, fondos, música, transiciones y animaciones compatibles;
- recetas narrativas, compositivas y de movimiento reutilizables;
- propuestas ricas a partir de prompts breves.

«Usar todas las funciones» significa exponer al Director todas las capacidades creativas que el render soporte y que puedan representarse mediante datos validados. No significa darle acceso a código, rutas, FFmpeg libre, comandos internos arbitrarios ni cientos de keyframes generados directamente por IA.

## 2. Diagnóstico de partida

La rigidez actual no está solo en el prompt. Está repetida en cuatro niveles:

1. `ai-video-plan-v1` exige un reparto global fijo de dos integrantes.
2. La normalización crea siempre `personaje-a` y `personaje-b` en todas las escenas.
3. El compilador y `scene-config-v2` exigen exactamente dos personajes y al menos dos turnos.
4. El Director no puede crear props, plantillas, pistas manuales ni varias operaciones que el editor ya soporta.

Por eso no alcanza con modificar las instrucciones de Ollama. Primero debe existir un camino renderizable para las nuevas estructuras y luego debe exponerse mediante un vocabulario cerrado.

## 3. Decisiones de arquitectura

### 3.1 Compatibilidad

- Los proyectos y runtimes vigentes continúan siendo válidos.
- `scene-config-v2` conserva su significado histórico.
- Las escenas flexibles usarán un contrato versionado nuevo o un adaptador explícito, nunca una reinterpretación silenciosa de v2.
- Un proyecto sin las nuevas propiedades debe producir el mismo plan temporal y el mismo MP4 verificable que antes.

### 3.2 Participantes y voz

El primer alcance flexible admite un máximo de dos personajes simultáneos por escena, pero el reparto puede cambiar entre escenas y el proyecto puede usar más de dos personajes distintos en total.

Modos iniciales de escena:

- `voiceover`: cero personajes visibles y una voz fuera de campo;
- `solo`: un personaje visible que habla;
- `dialogue`: dos personajes visibles que conversan;
- `visual-with-voiceover`: props o plantilla visual con narración y cero a dos personajes de apoyo.

Una escena sin personajes no significa una escena sin audio. En el primer vertical slice tendrá narración fuera de campo para que la duración siga proviniendo del WAV medido mediante FFprobe.

Las escenas completamente silenciosas quedan para un gate posterior. Deberán usar duración explícita cuantizada a frames o duración medida de un medio, nunca una estimación de IA basada en texto.

### 3.3 Duración

- El usuario y el Director expresan objetivos editoriales, pesos o rangos por escena.
- La duración definitiva de escenas habladas se deriva de los WAV reales.
- La suma de objetivos sirve para presupuestar palabras, no para declarar duración final.
- Las transiciones se calculan después de medir las escenas.
- El normalizador debe evitar que todas las escenas reciban automáticamente el mismo presupuesto.

### 3.4 Recetas en vez de microdirección

La IA elegirá recetas semánticas y parámetros acotados. Un compilador determinista expandirá esas recetas a elementos, pistas y keyframes.

Habrá tres familias:

- recetas narrativas: gancho, explicación, contraste, lista, historia, demostración;
- recetas de escena: narrador visual, monólogo, debate, demostración con prop, palabra protagonista, antes/después;
- secuencias de movimiento: entrada + énfasis + salida, reacción coordinada, señalamiento y foco, aparición de prop, cambio de plano y cierre.

Las secuencias coordinadas no contendrán código. Serán JSON versionado con anclas semánticas, parámetros cerrados, límites y requisitos de recursos.

### 3.5 Variedad verificable

No se confiará únicamente en una instrucción del prompt como «sé creativo». El plan tendrá validaciones deterministas:

- no repetir el mismo arquetipo en todas las escenas salvo que el usuario lo pida;
- variar composición, foco o recurso entre escenas cuando haya alternativas compatibles;
- exigir que cada elemento tenga una función narrativa o visual;
- impedir efectos incompatibles o exceso de movimiento;
- medir cobertura de capacidades y diversidad estructural;
- permitir una salida simple cuando el contenido no justifique más complejidad.

El objetivo no es obligar a usar todo en cada video, sino obligar a considerar todas las familias disponibles y usar un conjunto mínimo coherente según un perfil de riqueza.

## 4. Arquitectura objetivo

### 4.1 Registro único de capacidades creativas

Crear una proyección compartida y derivada de los contratos reales que describa:

- tipos de elemento renderizables;
- cantidad de personajes admitida por escena;
- modos de voz;
- transformaciones base y animables;
- presets y secuencias aplicables por recurso;
- plantillas visuales y campos editables;
- fondos, cámara, música y transiciones;
- capacidades disponibles en preview, exportación y editor.

El Director, el editor y los validadores deben consumir este registro. No se mantendrá una segunda lista manual dentro del prompt.

### 4.2 Plan semántico V2

El nuevo plan debe expresar decisiones de alto nivel, no coordenadas ni frames. Cada escena contendrá como mínimo:

- propósito y arquetipo;
- modo de voz;
- participantes visibles;
- voz fuera de campo cuando corresponda;
- peso de duración editorial;
- receta compositiva;
- recursos y roles visuales;
- beats hablados;
- recetas de efectos;
- transición.

El normalizador será responsable de IDs, posiciones, capas, pistas y defaults deterministas.

### 4.3 Runtime de escena flexible

El runtime nuevo debe admitir de cero a dos personajes y una secuencia hablada unificada con entregas de tipo:

- personaje visible;
- narrador fuera de campo.

Preview y exportación consumirán el mismo evaluador. Boca y gestos solo se aplicarán cuando exista un personaje visible asociado; subtítulos y audio seguirán funcionando para narración.

### 4.4 Director como planificador y editor

En creación podrá elegir arquetipos, reparto por escena, props, plantillas y recetas de efectos.

En edición podrá usar los comandos creativos que ya soporta el núcleo, pero mediante esquemas acotados al proyecto y a las capacidades reales. Las operaciones destructivas o personalizadas conservarán confirmación humana.

La IA no generará keyframes crudos de forma predeterminada. Elegirá una secuencia, ancla, intensidad y duración; el expansor local producirá los puntos.

### 4.5 Montaje V2

Montaje mantiene su documento durable separado. En una fase posterior tendrá un Director específico que proponga comandos de clips V2 sobre fuentes existentes. No se mezclarán `video-project` y `timeline-project-v2` ni se creará una fuente de verdad híbrida.

## 5. Fases de implementación

### V0 — Contrato y matriz de capacidades

Objetivo: congelar la semántica antes de cambiar el render.

Estado: **completado**. Los contratos permanecen aislados hasta V1; completar V0
no habilita todavía escenas flexibles en el producto.

Trabajo:

- documentar los modos `voiceover`, `solo`, `dialogue` y `visual-with-voiceover`;
- definir límites iniciales: 0–2 personajes simultáneos y hasta 8 escenas;
- diseñar el contrato de turno hablado con personaje o voz fuera de campo;
- crear la matriz de capacidades compartida;
- definir esquema de recetas de escena y secuencias coordinadas;
- preparar fixtures válidos e inválidos;
- documentar migración y compatibilidad v1/v2.

Gate:

- schemas válidos y cerrados;
- referencias y límites verificados;
- ninguna ruta, comando o expresión libre;
- revisión explícita de consumidores afectados.

### V1 — Runtime flexible 0/1/2 personajes

Objetivo: hacer renderizables las estructuras nuevas sin IA.

Estado: **completado**. Los pilotos versionados cubren narración sin personajes,
monólogo, diálogo y un proyecto mixto 0/1/2. Los gates completos de narración y
solo producen dos MP4 binariamente idénticos.

Trabajo:

- adaptar preparación de voz a narración y monólogo;
- compilar escenas con cero, uno o dos personajes;
- generalizar el evaluador temporal sin índices fijos de pareja;
- adaptar subtítulos, boca, gestos, compositor FFmpeg/Pixi y selector de backend;
- actualizar validación de renderabilidad;
- conservar el camino v2 para proyectos históricos.

Fixtures de gate:

1. una escena sin personajes, con narración y plantilla o prop;
2. dos escenas con un personaje en monólogo y reparto distinto;
3. tres escenas que combinen narración, solo y diálogo;
4. repetición de cada fixture con hashes temporales y MP4 verificables.

Gate:

- preview y exportación coinciden;
- duración medida por WAV;
- H.264/AAC válido;
- determinismo en doble ejecución;
- pilotos históricos sin cambios semánticos.

### V2 — Editor flexible

Objetivo: que una persona pueda construir y corregir esas escenas antes de delegarlas a la IA.

Trabajo:

- reemplazar el requisito visual de dos personajes por 0–2 según modo;
- permitir narrador fuera de campo y monólogo;
- permitir reparto diferente por escena;
- adaptar creación, división, duplicado, borrado y validación de escenas;
- actualizar timeline, Edición y mensajes de renderabilidad;
- mantener borradores incompletos separados de proyectos renderizables.

Gate:

- todas las operaciones participan de undo/redo;
- no se crean referencias rotas al borrar personajes o voces;
- selección, cabezal y medición conservan una única fuente de verdad.

### V3 — Director de creación V2

Objetivo: producir variedad estructural desde prompts breves.

Trabajo:

- introducir `ai-video-plan-v2`;
- elegir arquetipo y participantes por escena;
- permitir reparto global mayor, con máximo de dos visibles por escena;
- permitir voz fuera de campo;
- distribuir el presupuesto editorial con pesos distintos por escena;
- seleccionar props y plantillas además de personajes;
- expandir shortlist según los arquetipos elegidos;
- normalizar el plan a un proyecto renderizable sin placeholders;
- mantener lectura del plan V1 para cachés históricos o invalidarlas por versión explícita.

Gate:

- prompts de benchmark producen las cuatro clases de escena;
- ningún plan aceptado falla luego en compilación;
- la IA no inventa IDs ni capacidades;
- el usuario puede pedir explícitamente una estructura simple y obtenerla.

### V4 — Biblioteca de recetas y efectos coordinados

Objetivo: aportar riqueza visual reutilizable sin pedirle a la IA microanimación.

Primer catálogo propuesto:

- `solo-explainer`;
- `voiceover-cards`;
- `debate-contrast`;
- `prop-reveal`;
- `keyword-pages`;
- `before-after`;
- `countdown-visual`;
- `entrance-emphasis-exit`;
- `speaker-focus-reaction`;
- `prop-pop-and-point`.

Trabajo:

- crear schemas versionados;
- declarar requisitos y conflictos por receta;
- expandir recetas a comandos y pistas deterministas;
- permitir intensidad, duración y ancla acotadas;
- previsualizar la receta antes de aplicarla;
- registrar procedencia para edición y eliminación segura.

Gate:

- ninguna receta sobrescribe pistas manuales sin confirmación;
- ningún keyframe queda fuera de escena;
- misma receta, parámetros y medición producen las mismas pistas;
- cada receta llega tanto al preview como al MP4.

### V5 — Cobertura completa de funciones creativas por el Director

Objetivo: cerrar la brecha entre capacidades renderizables y capacidades accesibles por IA.

Exponer mediante comandos cerrados:

- agregar, cambiar y eliminar personajes;
- agregar, configurar, transformar y eliminar props;
- agregar y configurar plantillas visuales;
- posición, escala, rotación, opacidad y capa;
- música del proyecto;
- recetas de animación y eliminación protegida;
- estructura y orden de turnos;
- división semántica cuando exista medición vigente.

No exponer:

- filtros FFmpeg libres;
- rutas o URLs arbitrarias;
- código o expresiones;
- confirmación automática de borrados personalizados;
- keyframes masivos sin receta.

Gate:

- una matriz automática demuestra qué capacidades del editor/render están disponibles o justificadamente excluidas;
- cada comando se valida antes de aplicar el lote;
- aplicación atómica y un solo undo/redo;
- explicación humana previa.

### V6 — Política de riqueza y calidad audiovisual

Objetivo: conseguir propuestas interesantes sin prompts extensos.

Agregar perfiles simples:

- `simple`: claridad y pocos elementos;
- `variado`: al menos dos arquetipos o familias visuales cuando haya varias escenas;
- `dinámico`: mayor ritmo, recetas de movimiento compatibles y cambios de foco;
- `automático`: decide según el contenido.

El validador calculará:

- diversidad de arquetipos;
- repetición de layouts y recursos;
- cobertura de elementos narrativamente útiles;
- densidad de movimiento;
- equilibrio de duración;
- compatibilidad de voz, gesto y animación;
- legibilidad y riesgo de saturación.

La reparación de calidad deberá modificar el plan semántico, no parchear frames.

Gate:

- benchmarks cortos no caen siempre en diálogo de dos personajes;
- el perfil `simple` no agrega adornos innecesarios;
- el perfil `variado` supera un umbral estructural medible;
- el perfil `automático` justifica de forma determinista las familias elegidas.

### V7 — Panel del Director

Objetivo: hacer accesible la potencia sin convertir el prompt en un formulario largo.

Cambios:

- selector de riqueza `Automático / Simple / Variado / Dinámico`;
- estructura `Automática / Narración / Un personaje / Diálogo` como preferencia, no obligación salvo elección explícita;
- storyboard de escenas que muestre modo, participantes, receta, recursos y duración objetivo relativa;
- resumen de capacidades utilizadas y omitidas;
- acceso a cambiar una escena sin regenerar todo;
- ocultar o desactivar opciones de calidad que no tengan efecto en modo edición;
- confirmaciones existentes para cambios y animación personalizada.

Gate:

- un prompt de una frase puede producir un proyecto rico y entendible;
- el usuario puede simplificarlo sin reescribir el prompt;
- el panel nunca promete una función que la API ignore.

### V8 — Director de Montaje

Objetivo: aprovechar las funciones del recorte profesional después de estabilizar la creación flexible.

Trabajo:

- contexto compacto de fuentes y clips;
- comandos V2 cerrados para selección, split, trim, move, duplicate y ripple;
- recetas de montaje basadas en beats medidos;
- preview antes de aplicar y batch atómico;
- exportación solo por petición.

Gate:

- no modifica `video-project`;
- no vuelve a sintetizar voces al adoptar un render;
- conserva ticks enteros, enlaces A/V y determinismo del exportador.

## 6. Orden recomendado de ejecución

No comenzar por ampliar el prompt. El orden correcto es:

1. V0 — contrato y capacidades;
2. V1 — runtime 0/1/2;
3. V2 — editor humano;
4. V3 — creación IA flexible;
5. V4 — recetas coordinadas;
6. V5 — cobertura de comandos;
7. V6–V7 — política de riqueza y panel;
8. V8 — Montaje.

Cada fase debe aprobar su gate antes de que la siguiente dependa de ella.

## 7. Primer vertical slice recomendado

La primera implementación debe ser pequeña pero atravesar el sistema completo:

> Una escena `voiceover` sin personajes, con un prop o plantilla visual, narración Piper, subtítulos, una receta de animación coordinada y MP4 determinista.

Razones:

- rompe la obligación central de dos personajes;
- obliga a modelar voz fuera de campo correctamente;
- prueba que el contenido visual puede conducir una escena;
- reutiliza props, plantillas, Piper, subtítulos, Pixi y FFmpeg existentes;
- crea la base necesaria para monólogo y reparto variable sin implementar todo a la vez.

El slice termina solamente cuando se verifica desde datos de autoría hasta MP4 y cuando preview/export comparten la misma evaluación.

## 8. Riesgos y controles

- **Explosión combinatoria:** resolver con registro de capacidades, recetas y schemas derivados.
- **Planes válidos pero no renderizables:** validar contra capacidades antes de aceptar y compilar fixtures en pruebas del Director.
- **Videos sobrecargados:** política de densidad y perfiles de riqueza.
- **Duración falsa:** conservar medición WAV/FFprobe y distinguir objetivo de resultado.
- **Regresiones históricas:** adaptadores versionados y hashes de pilotos existentes.
- **Prompts enormes:** shortlist por etapas y recetas compactas.
- **Keyframes mediocres de IA:** expansión determinista local desde secuencias.
- **Divergencia UI/MP4:** evaluador compartido y gates cruzados.
- **Mezcla con Montaje:** Director separado y documentos durables separados.

## 9. Criterio de finalización global

El objetivo se considera cumplido cuando:

- el sistema renderiza escenas con cero, uno o dos personajes;
- un proyecto puede cambiar de reparto y modo entre escenas;
- el Director genera esas combinaciones desde prompts breves;
- props, plantillas y recetas coordinadas forman parte de sus propuestas;
- la duración real sigue siendo medida;
- la cobertura creativa se valida y se muestra al usuario;
- todo plan aceptado es compilable;
- preview y MP4 coinciden;
- los proyectos actuales siguen funcionando;
- el Director de Montaje opera sin mezclar fuentes de verdad.
