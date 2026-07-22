# Roadmap del diseñador de videos 2D

Este roadmap define dirección y criterios de avance; no autoriza por sí solo implementar una fase. Las prioridades reales deben surgir del uso personal, evidencia de demanda y tareas aprobadas.

## Estado base — julio de 2026

Las Etapas técnicas 0, 1, 1.1, el endurecimiento de contrato 2A y el selector local 2B están aprobadas. La Etapa 2C está implementada y verificada técnicamente: un mono reutilizable se carga mediante manifiesto, cambia ojos y tres bocas, ejecuta idle y alterna entre pose neutral y `point`. El pipeline sigue siendo local/headless, de una escena, validado mediante JSON Schema y reglas semánticas, aislado por `jobId` y determinista en preview PixiJS y MP4 H.264/AAC.

La siguiente meta pertenece todavía a la Fase 1: transformar el prototipo de una escena en una herramienta local que produzca videos útiles repetidamente sin editar código.

## Principios de avance

- Resolver primero necesidades observadas al producir contenido real.
- Conservar un núcleo determinista, headless y sin dependencia de la interfaz.
- Priorizar open source, modelos locales, CPU, caché y costos previsibles.
- Medir calidad, tiempo, RAM, disco y costo antes de adoptar un motor.
- No generar cada frame con IA.
- No avanzar a plataforma/monetización antes de validar utilidad y demanda.

---

## Fase 1 — Núcleo local confiable

**Estado:** en progreso; la base técnica de una escena está validada.

### Objetivo

Producir videos 2D verticales útiles de forma local, repetible y sin modificar código para cada video.

### Alcance

- Configuración manual validada.
- Varias escenas lineales y transiciones simples.
- Assets reutilizables mediante IDs/manifiestos.
- Personajes por capas, poses y animaciones básicas.
- Piper local, duración por FFprobe y caché.
- Boca, ojos, subtítulos y transformaciones.
- Exportación robusta y trabajos recuperables.
- Uso personal real para publicar videos.

### Entregables

- Contrato versionado de proyecto/escenas y validación clara.
- Biblioteca mínima de personajes, fondos y presets con licencias.
- Compilación de varias escenas a una timeline determinista.
- Preview/exportación equivalentes.
- CLI headless por `jobId` con límites y errores mejorados.
- Un conjunto pequeño de plantillas verticales.
- Registro de tiempos de producción y problemas reales.

### Riesgos

- Diseñar un esquema demasiado amplio antes de usarlo.
- Coste alto de preparar y alinear assets.
- Diferencias entre preview y exportación al introducir escenas.
- Crecimiento de temporales/caché y errores difíciles de recuperar.
- Calidad editorial insuficiente pese a éxito técnico.

### Criterio de entrada

- Etapa 1.1 aprobada, pipeline determinista e infraestructura local disponible.

### Criterio de salida

- Se producen repetidamente videos publicables de varias escenas usando configuración/assets, sin editar el motor.
- Al menos un flujo real completo está documentado con tiempo de producción, fallos y reutilización.
- Repetir un proyecto conserva resultado temporal; errores de entrada son claros.

### No construir todavía

Director IA, editor profesional, cuentas, backend, storage remoto, colas, suscripciones, marketplace, 3D, física o generación de video por frame.

---

## Fase 2 — Edición dirigida por prompt

### Objetivo

Convertir una idea en un guion y un plan de escenas válido, editable y restringido a capacidades/assets existentes.

### Alcance

- Prompt a guion breve.
- Guion a escenas semánticas.
- Selección de assets de un catálogo cerrado.
- Plan JSON validado y normalizado.
- Corrección manual antes de renderizar.
- Codex durante desarrollo/operación experimental.
- Modelo local para tareas repetitivas; proveedor intercambiable.

### Entregables

- Contrato separado entre plan de autoría y timeline compilada.
- JSON Schema/versionado y validador semántico.
- Catálogo resumido de assets para el modelo.
- Adaptador inicial de planificación local.
- Flujo de reparación acotado ante planes inválidos.
- Caché por hash de prompt, catálogo, modelo y parámetros.
- Métricas de tasa de planes válidos y correcciones humanas.

### Riesgos

- JSON sintácticamente válido pero imposible de ejecutar.
- Prompts grandes por catálogos sin resumir.
- Dependencia accidental del modelo concreto.
- Planes visualmente pobres o repetitivos.
- Uso de IA en cálculos deterministas que pertenecen al compilador.

### Criterio de entrada

- Fase 1 produce videos útiles desde configuración manual estable.
- El catálogo y las acciones soportadas están definidos por uso real.

### Criterio de salida

- Una idea produce un plan validado que el usuario puede corregir y renderizar sin editar código.
- La IA nunca emite frames ni keyframes exhaustivos.
- Los fallos del modelo no comprometen el motor; existe edición/fallback manual.

### No construir todavía

Editor completo, generación abierta de cualquier asset, modelos pagos obligatorios, backend multiusuario o automatización sin revisión humana.

---

## Fase 3 — Ampliación creativa open source

### Objetivo

Mejorar calidad y variedad con herramientas gratuitas/locales solo cuando demuestren valor medible.

### Alcance

Evaluar motores para:

- guion y reescritura;
- voz;
- transcripción y subtítulos;
- clasificación de escenas;
- generación/adaptación de imágenes y fondos;
- efectos simples;
- selección de momentos.

Cada capacidad conserva fallback determinista o manual.

### Entregables

- Banco de pruebas común: calidad humana, tiempo, RAM, CPU/GPU, disco, licencia y tamaño.
- Matriz comparativa de motores aceptados/rechazados.
- Adaptadores solo para herramientas aprobadas.
- Procedencia, versión y licencia en outputs/manifest.
- Políticas de caché y degradación controlada.

### Riesgos

- Incorporar una herramienta solo por ser “IA”.
- Dependencias pesadas o abandonadas.
- Licencias incompatibles con uso comercial.
- Calidad inconsistente o hardware insuficiente.
- Aumentar tiempos y costos sin mejorar el video.

### Criterio de entrada

- Producción real identifica una limitación creativa concreta.
- Existe benchmark y criterio de calidad antes de integrar.

### Criterio de salida

- Cada motor incorporado supera un baseline definido y puede desactivarse/sustituirse.
- Sus costos y licencias están registrados.
- El pipeline base sigue funcionando sin servicios pagos obligatorios.

### No construir todavía

Entrenamiento propio, infraestructura GPU permanente, generación indiscriminada, marketplace o dependencia de una única API externa.

---

## Fase 4 — Editor local utilizable

### Objetivo

Ofrecer una interfaz local práctica para crear, revisar y corregir proyectos sin manipular JSON directamente en cada operación.

### Alcance

- Gestión local de proyectos.
- Lista y edición de escenas.
- Preview y desplazamiento temporal sencillo.
- Selección de personajes, fondos, imágenes y elementos.
- Controles de texto, voz y movimientos.
- Presets y procesamiento por lotes.
- Recuperación y explicación de errores.

### Entregables

- UI local que consume contratos del núcleo, sin duplicar lógica temporal.
- Formularios generados/validados contra el esquema.
- Guardado portable y versionado de proyectos.
- Operaciones de preparar, previsualizar, exportar y reintentar.
- Pruebas de regresión entre UI, CLI y outputs.

### Riesgos

- Convertir la UI en una timeline profesional prematuramente.
- Mover lógica de negocio al frontend.
- Estado de interfaz difícil de reproducir.
- Sobrecargar la aplicación con opciones poco usadas.

### Criterio de entrada

- Contrato de proyectos/escenas y pipeline CLI son estables.
- Usuarios de prueba ya producen contenido y conocen los controles necesarios.

### Criterio de salida

- El flujo habitual se completa desde la interfaz local.
- Un proyecto guardado se reproduce por CLI con el mismo resultado.
- Errores comunes pueden corregirse/reintentarse sin perder el trabajo.

### No construir todavía

Colaboración, cuentas, nube, facturación, plugins, edición tipo Premiere, móvil nativo o backend distribuido.

---

## Fase 5 — Preparación web

### Objetivo

Separar formalmente frontend, motor y worker para ejecutar el pipeline en Linux/contenedores sin cambiar el contrato creativo.

### Alcance

- Pipeline invocable por CLI o servicio interno.
- Jobs aislados y sin estado global mutable.
- Configuración por entorno.
- Compatibilidad Linux.
- Contenedor reproducible.
- Storage abstracto.
- Límites, timeouts y cancelación.
- Pruebas de concurrencia.

### Entregables

- Paquetes/límites claros solo donde existan usos reales.
- Contrato de job, progreso, error y artefactos versionado.
- Adaptadores de filesystem/storage.
- Worker Linux contenedorizado y benchmarkeado.
- Reserva atómica de `jobId`, caché segura por hash y limpieza.
- Pruebas de aislamiento concurrente y seguridad de rutas.

### Riesgos

- Reestructurar demasiado antes de necesitar un servidor.
- Diferencias FFmpeg/fuentes/modelos entre Windows y Linux.
- Carreras en caché y jobs.
- Consumo sin límites o archivos no confiables.

### Criterio de entrada

- Producto local útil y contrato suficientemente estable.
- Existe una razón validada para ejecutar renders fuera del equipo local.

### Criterio de salida

- Un worker Linux aislado produce el mismo resultado lógico que la CLI local.
- Jobs concurrentes no comparten datos.
- Storage, progreso, cancelación y límites tienen contratos probados.

### No construir todavía

Suscripciones, planes, facturación, marketplace o funciones sociales. La contenedorización pertenece a esta fase, no al prototipo local actual.

---

## Fase 6 — Plataforma web multiusuario

### Objetivo

Permitir que usuarios creen y gestionen proyectos desde web/celular con renders aislados y seguros.

### Alcance

- Frontend responsive/PWA.
- Usuarios y proyectos.
- Base de datos y storage remoto.
- Cola de trabajos y workers.
- Estado de progreso.
- Seguridad, aislamiento, cuotas y uso desde celular.

### Entregables

- Autenticación y autorización por recurso.
- Modelo de datos versionado.
- Uploads validados y storage por usuario.
- Cola/reintentos idempotentes.
- Workers observables y límites de recursos.
- PWA enfocada en flujos esenciales.
- Auditoría de acceso cruzado y abuso básico.

### Riesgos

- Exposición de assets/proyectos entre usuarios.
- Costos de render imprevisibles.
- Duplicación de trabajos por reintentos.
- Complejidad móvil para edición visual.
- Dependencia prematura de un proveedor cloud.

### Criterio de entrada

- Fase 5 demuestra worker seguro y portable.
- Existe demanda más allá del uso personal o un grupo piloto definido.

### Criterio de salida

- Usuarios piloto crean, renderizan y recuperan proyectos sin acceso cruzado.
- Los costos/tiempos se miden por job y usuario.
- Fallos y reintentos no duplican cargos ni outputs.

### No construir todavía

Monetización compleja, múltiples tiers premium, marketplace o escalado global sin datos de uso.

---

## Fase 7 — Optimización económica

### Objetivo

Conocer y reducir el costo por video manteniendo calidad y fiabilidad.

### Alcance

- Medición por etapa/job/usuario.
- Evitar renders y llamadas duplicadas.
- Reutilizar assets y derivados.
- Favorecer modelos locales.
- APIs pagas solo para funciones premium o de alto valor.
- Presupuestos, créditos internos y límites.
- Comparar CPU propia, VPS y workers bajo demanda.

### Entregables

- Cost ledger por video y capacidad.
- Métricas de cache hit, tiempo CPU/GPU, storage y transferencia.
- Presupuestos máximos y circuit breakers.
- Selección de infraestructura basada en benchmarks.
- Política de calidad/costo y fallback.

### Riesgos

- Optimizar costo degradando el resultado.
- Métricas incompletas o no atribuibles.
- GPU permanente sin utilización suficiente.
- Ahorros locales que aumentan soporte/operación.

### Criterio de entrada

- Plataforma o pilotos generan volumen suficiente para medir.
- El costo real por video todavía limita crecimiento o margen.

### Criterio de salida

- Costo unitario y margen potencial son conocidos por tipo de video.
- Existen límites automáticos y la mayoría de tareas repetitivas son locales/cacheadas.
- GPU o APIs pagas solo se usan con justificación económica.

### No construir todavía

Planes comerciales definitivos sin demanda, precios basados en supuestos o compromisos largos de infraestructura sin utilización demostrada.

---

## Fase 8 — Suscripción y monetización

### Objetivo

Convertir demanda comprobada en un negocio sostenible y controlado.

### Alcance

- Planes, créditos o minutos.
- Límites de exportación.
- Facturación y pruebas gratuitas.
- Control de abuso.
- Métricas de uso, costo por usuario y margen.
- Funciones premium.

### Entregables

- Catálogo de planes ligado a costos medidos.
- Ledger de consumo idempotente.
- Integración de pagos y webhooks segura.
- Políticas de prueba, límites y reembolso.
- Paneles de costos, conversión, retención y margen.
- Controles antifraude/abuso proporcionales.

### Riesgos

- Monetizar antes de que los videos tengan demanda.
- Precios inferiores al costo real.
- Cobros duplicados o pérdida de créditos.
- Complejidad legal, fiscal y de soporte.
- Funciones premium que fragmentan el núcleo.

### Criterio de entrada

- Los videos producidos muestran demanda/tracción.
- Usuarios piloto repiten el uso y expresan intención de pago.
- El costo por generación y margen objetivo son conocidos.
- Seguridad, aislamiento y medición de la plataforma están aprobados.

### Criterio de salida

- Cobros, límites y créditos son correctos e idempotentes.
- Los planes mantienen margen verificable.
- Abuso y soporte son operables.
- La monetización no compromete portabilidad ni determinismo del núcleo.

### No construir todavía

Expansión agresiva, planes numerosos, contratos empresariales o infraestructura global antes de validar retención, margen y soporte.
