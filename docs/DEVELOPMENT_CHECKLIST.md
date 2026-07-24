# Checklist de desarrollo

Usar solo los puntos aplicables. Debe poder completarse en menos de dos minutos; las reglas completas están en `AGENTS.md`.

## Estado actual y próximo gate

- [x] Etapas 0, 1, 1.1, endurecimiento 2A y selector de previews 2B aprobados.
- [x] Etapas 2C, 2D y 2E implementadas y verificadas técnicamente.
- [x] 2F.0 documenta el flujo prompt → proyecto editable, el contrato creativo y el gate de calidad.
- [x] 2F.1 implementa el piloto de calidad con dos personajes y voces, boca RMS estabilizada y actuación por turnos.
- [x] 2F.2 implementa definición geométrica segura, dos variantes, joints, poses, manifest v2 y catálogo por IDs.
- [x] Pipeline paramétrico verificado: 54/54 controles, preview PixiJS y dos MP4 deterministas.
- [x] Usuario revisó y aprobó el gate 2F; calidad de voz, boca y actuación queda como ajuste fino no bloqueante.
- [x] 3A.0 define proyecto editable v1, catálogo de autoría, coordenadas de canvas, voces por ID y transiciones cerradas.
- [x] Piloto `proyecto-editable-01` con dos escenas validado estructural y semánticamente.
- [x] 3A.1 compila recursos, voces, transforms y transiciones a configuraciones v2 por escena con hashes deterministas.
- [x] El compilador rechaza texto, imágenes y transforms todavía no representables; no descarta decisiones de autoría silenciosamente.
- [x] 3A.2 prepara cada escena con TTS/FFprobe en jobs aislados y ensambla cortes/fundidos en un MP4 determinista.
- [x] Piloto multiescena: 2 escenas, 13,683 s calculados, 11/11 controles finales y dos MP4 binariamente idénticos.
- [x] 3B.0 implementa estado inmutable, comandos cerrados, selección por ID, coordenadas, diálogo, transiciones, undo/redo y exportación portable.
- [x] El adaptador de publicación expone proyectos compatibles mediante `public/projects/index.json` y revisión por hash, sin depender de `pilots/` en producción.
- [x] 3B.1 conecta la UX/UI al núcleo, abre un proyecto publicado, permite editarlo y descargar el JSON sin escribirlo manualmente.
- [x] El Director IA local transforma prompts en planes cerrados con `qwen3:8b`, los valida y normaliza al proyecto editable vigente.
- [x] El puente local seguro congela el proyecto, admite un render activo, lanza el pipeline con `shell: false` y expone progreso, cancelación y MP4.
- [x] Flujo real verificado: prompt desde la UI, 3 escenas, 33,03 s y dos MP4 finales binariamente idénticos.
- [x] API mutante protegida por Host, Origin y token efímero; lectura limitada y tipada.
- [x] Limpieza automática de frames/temp en trabajos completados y comando de retención con dry-run.
- [x] Recuperación de estados interrumpidos, cierre de conexiones y terminación del árbol de render.
- [x] CI mínima, `npm test` agregado y corpus de compatibilidad de contratos.
- [x] Render interactivo de una pasada; verificación completa preservada en CLI/pruebas.
- [x] Workspace de tres columnas con Editor/Creador, biblioteca licenciada, inspector plegable y timeline única coordinada con la reproducción.
- [x] Proyecto y último job persistidos con versión y revisión de catálogo; galería alimentada por `/api/render-jobs`.
- [x] Tono, duración objetivo y cantidad de escenas restringen el JSON Schema del Director, no solo su texto de prompt.
- [x] Biblioteca local durable con registro validado, deduplicación, catálogo unificado y API limitada a loopback.
- [x] Importación de fondos JPG/PNG con validación binaria, normalización vertical y manifiesto runtime compatible.
- [x] Índice y assets locales viven fuera del repositorio; la publicación servible es regenerable y existe migración legacy no destructiva.
- [x] Timeline audiovisual V1/A1 restaurada con regla, playhead, zoom, snap, transporte, mute, navegación y atajos.
- [x] Preview usa turnos medidos; MP4 usa escenas, audio y fundidos del manifiesto final; autoría queda marcada sin medir.
- [ ] Próximo gate: producción personal real, métricas de planes válidos y mejoras de variantes/reparación y edición manual.

Evidencia vigente: `ETAPA_2F_CALIDAD_RESULTADOS.md`, `ETAPA_2F_PARAMETRICOS_RESULTADOS.md`, `ETAPA_3A0_PROYECTO_EDITABLE_RESULTADOS.md`, `ETAPA_3A1_COMPILADOR_PROYECTO_RESULTADOS.md`, `ETAPA_3A2_RENDER_MULTIESCENA_RESULTADOS.md` y `ETAPA_3B0_NUCLEO_EDITOR_RESULTADOS.md`. Los joints de 2F.2 son todavía metadatos validados; la articulación continua no está implementada.

El próximo incremento debe medir el flujo en producción personal y profundizar variantes, reparación y edición manual sobre el contrato vigente. No incorporar todavía Electron, timeline profesional, lip sync fonético, backend remoto ni funciones multiusuario.

## Antes de comenzar

- [ ] Entendí el pedido y el resultado esperado.
- [ ] Identifiqué los módulos y contratos afectados.
- [ ] Definí qué queda fuera del alcance.
- [ ] Leí `AGENTS.md` y la documentación relevante.
- [ ] Revisé riesgos y cambios existentes del usuario.
- [ ] Elegí un nivel de pruebas proporcional (1–4).
- [ ] Busqué funciones existentes y no duplicaré capacidades.
- [ ] Si agrego una dependencia, preparé su justificación y revisión de licencia/portabilidad.

## Durante el desarrollo

- [ ] Mantengo `shared/scene-evaluator.js` como fuente temporal compartida.
- [ ] Mantengo `frameIndex / fps`, duración por FFprobe y semillas deterministas.
- [ ] No introduzco rutas absolutas en proyectos, runtimes, cues o manifiestos.
- [ ] Mantengo configuración y archivos aislados por `jobId`.
- [ ] No limpio temporales fuera del trabajo actual validado.
- [ ] Ejecuto procesos con argumentos separados y `shell: false`.
- [ ] No mezclo lógica del núcleo con Vite, DOM o la UI.
- [ ] No agrego dependencias ni abstracciones innecesarias.
- [ ] No agrego funciones fuera del pedido.
- [ ] Valido entradas, rutas y límites relevantes.
- [ ] Manejo errores/progreso de forma estructurada.
- [ ] Evito IA, APIs pagas y cómputo innecesarios; uso caché cuando corresponde.

## Antes de finalizar

- [ ] Ejecuté las pruebas específicas elegidas y un caso límite relevante.
- [ ] Ejecuté integración/pipeline solo si el cambio puede afectarlos.
- [ ] Ejecuté `npm run build` si afecté TypeScript, preview o contratos importados.
- [ ] Verifiqué FFprobe/exportación y repetición si afecté audio, frames o FFmpeg.
- [ ] Verifiqué preview y exportación si cambié evaluación temporal.
- [ ] Revisé secretos, datos sensibles y logs excesivos.
- [ ] Revisé temporales/outputs accidentales y limpieza segura.
- [ ] Registré procedencia/licencia si agregué assets, fuentes, voces o modelos.
- [ ] Actualicé solo la documentación afectada.
- [ ] Informé cambios, pruebas realizadas, suficiencia y pendientes.

## Para contratos creativos, catálogo o IA

- [ ] Separé el proyecto de autoría, el runtime compilado y los artefactos del job.
- [ ] La generación por prompt produce datos editables y validados, no frames ni keyframes exhaustivos.
- [ ] Personajes, variantes, poses, animaciones y assets se referencian por IDs estables y rutas relativas resueltas bajo raíces controladas.
- [ ] Las definiciones geométricas contienen datos permitidos, nunca código o expresiones arbitrarias.
- [ ] Preview y exportación consumen el mismo estado temporal después de compilar presets y decisiones de autoría.
- [ ] Assets, voces, fuentes y modelos incorporan procedencia, licencia y versión.

## Para cambios web futuros

- [ ] Cada trabajo está aislado por `jobId`, usuario y raíces permitidas.
- [ ] No hay estado global mutable requerido por el motor.
- [ ] Entradas, uploads y rutas están validados; no hay traversal.
- [ ] Existen límites de CPU, RAM, disco, duración, resolución y texto.
- [ ] Storage está abstraído del motor y autorizado por usuario.
- [ ] El worker y herramientas son compatibles con Linux.
- [ ] Errores/progreso tienen contratos versionados y códigos estables.
- [ ] Operaciones largas tienen timeout, cancelación e idempotencia.
- [ ] Caché y reserva de jobs son seguras ante concurrencia.
- [ ] No existe acceso cruzado entre usuarios ni secretos en logs/artefactos.

## Para cambios de interfaz

- [ ] Preservo `docs/ESTRUCTURA_VISUAL_CANONICA.md`.
- [ ] Director IA y selección de trabajo permanecen en el panel izquierdo.
- [ ] El visor central continúa siendo el foco visual dominante.
- [ ] Edición, ajustes y recursos permanecen en el panel derecho.
- [ ] La timeline audiovisual continúa visible y ocupa el ancho inferior.
- [ ] No mezclo responsabilidades entre áreas ni agrego controles sin capacidad real.
