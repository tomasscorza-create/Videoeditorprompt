# Visión de producto y Etapa 2F — contrato creativo antes de varias escenas

Fecha: 22 de julio de 2026.

Estado: visión y gate 2F aprobados por el usuario. 2F.0–2F.2 están implementadas; 3A.0–3A.2 producen un MP4 multiescena determinista y 3B.0 aporta el núcleo funcional del editor. Todavía no implementa IA ni la integración visual del editor.

## Decisión principal

La herramienta combinará dos recorridos sobre un mismo proyecto:

1. **Generación guiada por prompt:** la persona describe el video y una IA propone guion, estructura, estilo y recursos disponibles.
2. **Edición manual:** el resultado generado se abre como un proyecto editable; pueden corregirse texto, voz, personajes, fondos, poses, colores, tipografías, tiempos y presets antes de exportar.

La IA no entregará un MP4 cerrado ni cientos de keyframes. Entregará un **plan de autoría estructurado**, restringido a capacidades y recursos válidos. El núcleo determinista lo validará, compilará y renderizará. Cualquier proyecto generado por IA deberá poder construirse también de forma manual.

## Experiencia objetivo

```text
Inicio o proyecto existente
        ↓
Prompt: idea, objetivo y duración
        ↓
Preguntas breves solo por datos importantes que falten
        ↓
Variantes visuales: composición, paleta, tipografía y tono
        ↓
Selección o ajuste del usuario
        ↓
Propuesta de guion, escenas, personajes y acciones
        ↓
Proyecto editable
        ↓
Edición manual por escenas y presets
        ↓
Preview determinista
        ↓
Exportación y revisión del MP4
```

La generación y la edición no son aplicaciones separadas. Son dos formas de modificar el mismo documento de autoría.

## Personalización guiada

La IA debe preguntar solo cuando una respuesta cambie materialmente el resultado. Debe preferir opciones visuales seleccionables a conversaciones largas.

Preguntas posibles:

- objetivo del video y público;
- duración aproximada y formato;
- tono: educativo, irónico, serio, enérgico;
- personaje o estilo preferido;
- cantidad aproximada de información;
- llamada a la acción;
- restricciones explícitas de marca.

Variantes seleccionables:

- entre dos y cuatro paletas compatibles;
- combinaciones tipográficas prevalidada;
- uno o pocos layouts verticales;
- personajes o variantes de apariencia;
- fondo y nivel de movimiento;
- ritmo de voz y actuación.

Reglas:

- no repetir preguntas cuya respuesta pueda deducirse o tenga un valor predeterminado seguro;
- permitir omitir preguntas y aceptar una propuesta inicial;
- registrar elecciones como datos del proyecto, no como estado oculto del chat;
- conservar la posibilidad de cambiar manualmente cada elección;
- no permitir que la IA invente IDs, acciones o assets fuera del catálogo disponible.

## Separación de contratos

Para no acoplar el editor, la IA y el render se distinguen tres niveles. El proyecto de autoría tiene un schema inicial en `schema/video-project.schema.json`; 3A.2 implementa la composición multiescena como un pipeline padre sobre runtimes v2 de una escena.

### 1. Proyecto de autoría

Representa lo que entiende y modifica la persona:

- metadatos del proyecto;
- formato y duración objetivo;
- estilo visual elegido;
- escenas y su intención;
- diálogos;
- personajes y variantes;
- fondos, objetos y textos;
- poses, gestos y animaciones por ID;
- voz y ritmo elegidos;
- transiciones por preset.

Debe ser portable, versionado y editable. No contiene rutas absolutas, comandos, código ni keyframes exhaustivos.

### 2. Plan compilado o runtime

Representa decisiones concretas ya validadas y medibles:

- duración real de cada WAV obtenida por FFprobe;
- turnos y silencios resueltos;
- recursos y variantes encontrados en el catálogo;
- presets expandidos;
- cues de boca y parpadeo;
- timeline determinista;
- semilla y hashes de entradas;
- advertencias o sustituciones controladas.

La IA no escribe directamente este nivel. Lo produce un compilador determinista a partir del proyecto de autoría y del catálogo.

### 3. Artefactos de trabajo y render

Incluye WAV, análisis, frames, MP4, logs y evidencia asociada a un `jobId`. Son derivados regenerables y no forman parte del documento creativo portable.

## Generación visual geométrica y paramétrica

La generación rápida de personajes, fondos y objetos se construirá con primitivas editables y parámetros, no generando cada frame con modelos de imagen.

### Formato canónico recomendado

El recurso debería describirse mediante datos independientes de Canvas o del navegador:

- círculos, elipses, rectángulos redondeados, polígonos y paths;
- relleno, borde, opacidad y orden de dibujo;
- sistema de coordenadas local;
- grupos y capas semánticas;
- variables de apariencia: colores, proporciones, ropa y accesorios;
- puntos de anclaje, pivotes y uniones;
- procedencia, autor, licencia y versión.

PixiJS, Canvas 2D o un generador SVG pueden consumir esos datos, pero ninguno debe convertirse en el formato del proyecto. Guardar solamente un bitmap generado perdería editabilidad; guardar instrucciones de Canvas como código rompería portabilidad y seguridad.

### Compilación compatible con el motor actual

El exportador actual compone PNG mediante FFmpeg, mientras el preview usa PixiJS. Para no romperlo, el primer generador paramétrico debe tener una salida compilada compatible:

```text
definición geométrica + variante
              ↓
compilador determinista de asset
              ↓
manifest versionado + capas PNG transparentes
              ↓
preview PixiJS / exportación FFmpeg existentes
```

Así pueden probarse colores, proporciones y estados visuales sin reemplazar prematuramente el backend de exportación.

### Rig y articulaciones

Separar una extremidad en una capa ayuda, pero para animarla de forma consistente también se necesitan jerarquía, pivote y puntos de unión.

```text
root
├── torso
│   ├── cuello → cabeza
│   ├── hombro izquierdo → brazo → codo → antebrazo → mano
│   └── hombro derecho → brazo → codo → antebrazo → mano
└── cadera → piernas
```

Cada parte debe tener:

- coordenadas locales;
- pivote de rotación;
- unión con su padre;
- límites razonables de rotación y escala;
- orden visual;
- ID semántico estable.

El primer incremento no necesita deformación de malla ni cinemática inversa. Puede compilar poses cerradas como `neutral`, `point_left`, `point_right`, `wave` y `react`. La articulación continua se evaluará solo después de demostrar que las poses y los puntos de unión son suficientes.

### Rostro y boca

La boca no debe quedar limitada indefinidamente a tres niveles de volumen. El contrato futuro debe permitir formas semánticas, por ejemplo:

- `rest`;
- `closed`;
- `open_small`;
- `open_wide`;
- `round`;
- `wide`.

La Etapa 2F no promete lip sync fonético. Primero debe mejorar la estabilidad temporal con análisis de audio, silencios, duración mínima y cambios menos nerviosos. El manifiesto debe quedar preparado para más formas sin exigirlas todas en el primer personaje.

## Catálogo interno reutilizable

El sistema mantendrá un catálogo local de recursos listos para reutilizar:

- personajes y variantes;
- fondos por capas;
- objetos y accesorios;
- poses y gestos;
- animaciones;
- paletas;
- estilos tipográficos;
- plantillas de escena;
- transiciones;
- voces configuradas.

Cada entrada tendrá como mínimo:

- ID estable y versión;
- tipo de recurso;
- nombre legible y etiquetas;
- manifest o definición portable;
- parámetros editables;
- preview/thumbnail derivado;
- compatibilidad y capacidades;
- procedencia, licencia y atribución;
- hash o versión de sus entradas.

Los proyectos referencian IDs y variantes. La resolución de esos IDs a archivos ocurre bajo raíces controladas durante la preparación del trabajo.

No se implementará todavía una base de datos. Para la etapa local basta un índice JSON regenerable y manifests versionados en carpetas. El índice es una vista del catálogo, no la única fuente de verdad.

## Consistencia de animaciones

Las animaciones reutilizables deben actuar sobre propiedades semánticas, no sobre archivos o coordenadas globales arbitrarias.

Ejemplos:

- `enter_from_left` modifica el transform raíz;
- `idle_calm` controla respiración y balanceo con amplitudes acotadas;
- `point_left` selecciona una pose o articula brazo/mano desde sus pivotes;
- `blink_natural` produce eventos deterministas desde semilla;
- `talk_calm` define intensidad gestual mientras el personaje habla;
- `react_surprised` combina pose, ojos y una transformación breve.

Cada preset debe declarar duración o modo de loop, propiedades afectadas, parámetros permitidos y reglas de mezcla. Dos presets no deben escribir silenciosamente la misma propiedad sin una prioridad definida.

## Calidad de voz y sincronización

Las observaciones actuales son válidas:

- la boca no acompaña suficientemente la percepción del habla;
- Piper puede resultar inestable, alargar fonemas o perder claridad;
- los movimientos carecen todavía de una dirección gestual uniforme.

Estas limitaciones deben abordarse antes de multiplicar el problema a varias escenas. La calidad se evaluará separando:

1. **Texto para voz:** puntuación, abreviaturas, números y segmentación.
2. **Síntesis:** voz, `lengthScale`, silencios y estabilidad de dos ejecuciones.
3. **Postproceso limitado:** nivel y pausas, sin ocultar defectos graves.
4. **Cues de boca:** detección de silencio, suavizado, duración mínima y latencia visual.
5. **Actuación:** presets coherentes según quién habla o escucha.

No se cambiará de motor TTS por intuición. Se comparará la voz Piper actual con una única alternativa o configuración controlada usando el mismo texto y métricas, además de escucha humana.

## Etapa 2F — definición y gate de calidad creativa

### Objetivo

Estabilizar el vocabulario creativo mínimo y alcanzar una calidad aceptable en una escena real antes de implementar varias escenas.

### 2F.0 — definición documental — completada por este documento

- flujo prompt → propuesta → proyecto editable;
- separación autoría/runtime/artefactos;
- dirección del rig paramétrico;
- dirección del catálogo reutilizable;
- criterios de calidad previos a 3A;
- handoff claro para UX/UI.

No modifica schemas ni el pipeline vigente.

### 2F.1 — piloto de calidad de voz, boca y actuación — implementado técnicamente

Alcance propuesto:

- una sola escena de 20–30 segundos;
- dos personajes visualmente distinguibles;
- dos configuraciones de voz diferenciables, sin integrar múltiples proveedores;
- normalización previa del texto para TTS;
- ajuste medido de pausas y velocidad;
- mejora algorítmica acotada de cues de boca, todavía no fonética;
- presets pequeños de hablante y oyente;
- parpadeo, idle y gestos con transiciones consistentes;
- fondo/parallax ya existente;
- comparación preview/MP4 y repetición determinista.

Criterios de aceptación:

- el diálogo se entiende completo en escucha normal;
- no hay alargamientos o pausas claramente defectuosos sin registrar;
- la boca permanece cerrada en silencios y evita cambios nerviosos evidentes;
- solo el hablante presenta actuación de habla;
- el oyente mantiene una reacción discreta y no robótica;
- gestos y parpadeos no se cortan ni se contradicen;
- dos personajes se distinguen inmediatamente por apariencia y voz;
- preview y MP4 conservan los mismos estados temporales;
- la repetición mantiene hashes temporales y frames deterministas.

### 2F.2 — vertical slice de asset paramétrico y catálogo — implementado técnicamente

Alcance propuesto:

- una definición geométrica pequeña y segura;
- un personaje con al menos dos variantes de color;
- pivotes y uniones declarados para cabeza y un brazo;
- estados de ojos y boca;
- dos poses compiladas;
- salida a manifest y PNG transparentes compatibles con el pipeline actual;
- índice local mínimo de catálogo con licencia/procedencia;
- selección por ID y variante;
- prueba de compilación determinista.

Este vertical slice valida el contrato. No incluye editor de dibujo, generación de imágenes con modelos, esqueleto avanzado ni biblioteca masiva.

Resultado comprobado:

- definición declarativa `mono-parametrico-v1` validada por JSON Schema y reglas semánticas;
- dos variantes de paleta compiladas desde la misma geometría;
- primitivas cerradas (`ellipse`, `rect`, `polygon` y `path`) sin scripts ni SVG arbitrario;
- joints para raíz, cabeza, hombros, codo y muñeca, y poses `neutral`/`point`;
- capas runtime y miniaturas PNG transparentes de 1080 × 1920;
- manifest versión 2 y catálogo versión 1 con IDs, capacidades, licencia y procedencia;
- configuración de escena que selecciona personajes por `characterAssetId`, sin rutas de manifest;
- compilación repetida con hashes idénticos y pipeline completo de 319 frames determinista;
- preview PixiJS y MP4 verificados con el mismo runtime.

Límite deliberado: los joints y rotaciones ya forman un contrato portable, pero el runtime todavía selecciona capas PNG precompiladas. La aplicación continua de transforms jerárquicos pertenece a un incremento posterior, no a 2F.2.

La evidencia completa está en `ETAPA_2F_PARAMETRICOS_RESULTADOS.md`.

### Gate para comenzar 3A

3A puede empezar cuando:

- 2F.1 tenga un video revisado visual y auditivamente;
- 2F.2 demuestre un recurso paramétrico reutilizable sin rutas absolutas;
- estén definidos IDs estables de personaje, variante, pose y animación;
- Claude confirme que el flujo manual puede representar estas decisiones sin inventar datos;
- las brechas no bloqueantes queden registradas y priorizadas.

## Implicaciones para la interfaz de Claude

Claude puede diseñar desde ahora, con datos simulados, estas áreas:

- entrada de prompt y preguntas guiadas;
- comparación visual de variantes;
- resumen de propuesta generada;
- editor manual de una escena;
- catálogo de personajes, fondos, objetos y presets;
- controles de apariencia paramétrica;
- diálogo, voz y asignación de hablante;
- preview vertical, progreso y exportación.

Debe evitar todavía:

- asumir un timeline profesional;
- crear keyframes libres como interacción principal;
- definir schemas canónicos en la UI;
- incorporar lógica de duración, boca o animación al frontend;
- conectar una IA real;
- agregar backend, cuentas o base de datos;
- hacer que un mock de interfaz se convierta accidentalmente en el motor.

Cuando un control necesite un dato inexistente debe documentarse como `NECESIDAD DE CONTRATO` según el flujo de colaboración.

## Qué se evita deliberadamente

- Generación de cada frame con IA.
- Un editor gráfico vectorial completo.
- Rig con malla, física o cinemática inversa en el primer incremento.
- Timeline tipo Premiere o After Effects.
- Catálogo abierto sin validación ni licencias.
- Código o expresiones arbitrarias dentro del JSON.
- Guardar rutas absolutas en proyectos o manifests.
- Diseñar el contrato desde la apariencia de una pantalla.
- Construir varias escenas antes de estabilizar una escena útil.
- Elegir React, Electron, backend o base de datos como parte de 2F.

## Resultado esperado

Al cerrar 2F debe existir una respuesta comprobada a tres preguntas:

1. ¿La escena única tiene voz, boca y actuación suficientemente consistentes para reutilizarla?
2. ¿Un personaje puede generarse y variarse mediante datos geométricos sin romper preview/exportación?
3. ¿La IA y la edición manual pueden operar sobre el mismo proyecto sin acoplarse al runtime?

Solo entonces conviene multiplicar la composición mediante la Etapa 3A de varias escenas y transiciones.
