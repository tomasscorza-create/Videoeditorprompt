# Normas permanentes para agentes

Este archivo rige todo el repositorio. Léelo antes de modificar código. Es una constitución técnica, no una especificación de una etapa futura.

## 1. Misión, estado y alcance

Construimos una herramienta local, dirigida por datos, para producir videos animados 2D verticales a partir de ideas o texto. Debe combinar assets reutilizables, voz local, animación determinista, subtítulos y FFmpeg con un costo de cómputo bajo. Primero se usará personalmente para publicar contenido y validar demanda; a largo plazo podrá evolucionar hacia un producto web multiusuario y comercial.

Estado vigente:

- Etapas 0, 1, 1.1, el endurecimiento de contrato 2A y el selector de previews 2B aprobados. Las Etapas 2C, 2D y 2E están implementadas y verificadas técnicamente.
- La Etapa 2F.0 está documentada, 2F.1–2F.2 están implementadas y verificadas técnicamente, y el usuario aprobó el gate humano con ajustes finos no bloqueantes. 3A.0 define el proyecto editable, 3A.1 lo compila a configuraciones v2 por escena y 3A.2 prepara, renderiza y ensambla esas escenas de forma determinista. 3B.0 aporta el núcleo inmutable de edición y su contrato de comandos, ya conectado a la interfaz local mediante módulos `src/ui/*`. El primer vertical slice dirigido por prompt usa Ollama con `qwen3:8b`, normaliza un plan semántico cerrado al mismo proyecto editable y permite renderizarlo desde la interfaz mediante un servicio limitado a loopback. El Director mantiene el modelo cargado de forma acotada, expone razonamiento opcional, puede comparar hasta tres variantes mediante un juez estructurado y cacheado, y recibe una shortlist local determinista en vez del inventario completo. Cinco plantillas narrativas versionadas aportan beats reutilizables y combinables. La interfaz vigente organiza Director, visor y edición en tres columnas y expone solo dos espacios centrales: Editor y Creador. El Editor reúne lienzo, reproducción y exportación sin pestañas separadas de preview/MP4; un coordinador único vincula su salida renderizada con la timeline. El núcleo distingue borrador incompleto de proyecto renderizable; permite crear/eliminar escenas, personajes y turnos mediante comandos cerrados. El Director reutiliza ese vocabulario para peticiones contextuales sobre un proyecto existente; para animación recibe solo capacidades y procedencia resumidas por elemento, propone comandos validados y muestra una explicación determinista antes de aplicarlos. La timeline conserva sus capas de fondo, personajes y voces tanto en autoría como al adoptar escala real de una exportación vigente. La biblioteca local V1 registra fichas validadas en almacenamiento durable, deduplica por hash y publica un catálogo combinado consumido por Director, editor y render. `CREAR → Personajes` ofrece plantillas y construcción desde cero por piezas geométricas con roles semánticos; ambos caminos compilan un rig v2 real y lo registran de forma no destructiva.
- La Fase U0 mejora la resiliencia y la orientación del flujo vigente sin alterar la estructura visual canónica: el Director expone progreso por etapas, distingue cancelación, timeout, concurrencia, dependencias y respuestas inválidas, muestra acciones comprensibles sin códigos técnicos en el mensaje principal, y el historial de renders permite inspeccionar fallos con detalles técnicos bajo demanda.
- La Fase U1 hace explícito el recorrido de creación sin agregar otra fuente de verdad: numera los tres pasos del Director, deriva una única siguiente acción del proyecto, el workspace, las dependencias y la vigencia del MP4, y desglosa en Render los requisitos reales de contenido, contrato, Editor y voces.
- La Fase P0 de persistencia portable fue aprobada. P1 separa contratos async para proyectos, recursos, jobs y blobs, conserva `filesystem` como backend operativo e inyecta sus adaptadores desde el servicio local.
- P2 exporta el estado durable a un bundle portable y determinista, verifica esquema, referencias, tamaños y SHA-256, e ignora cachés, temporales, publicaciones regenerables y jobs sin outputs conservados. G2–G6 fueron aprobados. P3 aporta PostgreSQL 17.10 y SeaweedFS 4.40 locales reproducibles; P4 implementa repositorios PostgreSQL de metadata. P5 implementa blobs S3 con el mismo contrato que filesystem, materialización atómica, publicación de outputs y streaming privado. P6 implementa un importador filesystem → PostgreSQL/S3 con plan inmutable, apply explícito, verificación, conflictos e idempotencia. P7 activa PostgreSQL/S3 como backend normal con diagnóstico estricto, conserva rollback no destructivo a filesystem y aporta backup/restauración lógicos. P8 añade configuración remota TLS/secret mounts, matrices y probe de capacidad/costos, y verifica un worker Linux con render multiescena real; G7 sigue pendiente de proveedor/región, prueba administrada, retención, presupuesto y autenticación.
- Existe un runtime probado de **una escena**: 1080 × 1920, 30 fps, dos personajes reutilizables y diferenciados, diálogo medido con dos voces Piper, boca híbrida de seis visemas guiada por texto y límites RMS (con fallback RMS), cinco gestos temporizables, prosodia por turno, idle seeded, layouts interpolados, subtítulo por turno, música opcional con ducking y fondo opcional de tres capas con cámara/parallax deterministas, equivalente en PixiJS y MP4 H.264/AAC. Un pipeline padre ya compone varias de esas escenas en un MP4 mediante cortes o fundidos.
- El pipeline es headless, se invoca por CLI, usa `jobId`, rutas configurables y trabajos aislados.
- `shared/scene-evaluator.js` es el evaluador temporal compartido.
- `public/generated` es solo una publicación opcional e indexada por `jobId` para el preview; no es almacenamiento del motor.

Fuera del alcance actual salvo pedido explícito: editor profesional, preview multiescena interactivo, React, Electron, llama.cpp, lip sync fonético, usuarios, backend remoto, base de datos, storage remoto, colas distribuidas, Docker, suscripciones y monetización.

Dirección de largo plazo: núcleo local confiable → creación dirigida por prompt → herramientas creativas open source → editor local → separación web/worker → plataforma multiusuario → optimización económica → monetización. El roadmap no autoriza implementar una fase por anticipado.

No reinterpretar sin autorización estas decisiones:

- La IA dirige planes semánticos; no genera cada frame ni cientos de keyframes.
- El render visual final es determinista y dirigido por datos.
- Local/open source/CPU es el camino predeterminado.
- Una API paga solo se usa cuando aporta una ventaja demostrable y con presupuesto, caché, métricas y sustitución local.
- No reemplazar PixiJS, FFmpeg, Piper o el pipeline vigente sin una razón probada y una tarea específica.

Cuando documentos históricos contradigan el código actual, prevalecen este archivo, `docs/etapas/ETAPA_1_ENDURECIMIENTO_RESULTADOS.md` y el código verificado. `docs/PROPUESTA_TECNICA.md` y los informes de Etapa 0/1 conservan decisiones e historia, pero algunos comandos y rutas ya fueron superados.

## 2. Prioridades

Ante conflictos, usar este orden:

1. Correctitud.
2. No romper funciones existentes.
3. Mantener determinismo.
4. Mantener sincronización entre preview y exportación.
5. Simplicidad.
6. Portabilidad.
7. Rendimiento.
8. Seguridad.
9. Bajo costo de cómputo.
10. Facilidad de ampliación.

No sacrificar claridad o correctitud por optimización prematura.

## 3. Invariantes arquitectónicas

- Preview y exportación deben usar el mismo evaluador temporal. Cambios de movimiento, ojos, boca, opacidad o subtítulos requieren revisar ambos consumidores.
- La duración real proviene del WAV mediante FFprobe; nunca de una estimación de IA o texto.
- Un frame se evalúa con `frameIndex / fps`; no acumular deltas para exportar.
- Misma configuración, assets, semilla y derivados deben producir el mismo plan, frames y MP4 verificable.
- Voz, análisis, subtítulos, planes y otros derivados deben poder cachearse por hash de todas sus entradas relevantes.
- El núcleo no depende de Vite, DOM, navegador ni interfaz. El pipeline completo debe funcionar headless.
- Configuraciones, runtimes, cues y manifiestos no contienen rutas absolutas. Usar IDs y rutas relativas bajo raíces controladas.
- Procesos externos reciben ejecutable y lista de argumentos, con `shell: false`. Nunca interpolar comandos de proyecto en una shell.
- Todo render tiene `jobId` válido, configuración congelada y carpetas propias de trabajo, temporales y resultados.
- Nunca mezclar o limpiar temporales de otro trabajo. Toda eliminación debe validar el destino dentro del trabajo actual.
- TTS, IA, render y storage deben evolucionar hacia contratos reemplazables; no extender los acoplamientos actuales de Piper o filesystem.
- Progreso y errores son estructurados, vinculados a `jobId` y comprensibles por humanos y procesos.
- El código nuevo del motor no debe depender obligatoriamente de Windows. Diseñar para un worker Linux/contenedor, aunque la compatibilidad aún deba probarse.
- JSON de proyecto es datos, no código. No admitir scripts, comandos ni expresiones arbitrarias aportadas por el usuario.
- La organización visual canónica está definida en `docs/ESTRUCTURA_VISUAL_CANONICA.md`: encabezado limpio, Director/selección a la izquierda, visor dominante al centro, edición/recursos a la derecha y timeline audiovisual de ancho completo abajo. No intercambiar ni eliminar estas áreas sin autorización explícita del usuario.

## 4. Mapa del repositorio vigente

- `scripts/stage1/pipeline.mjs`: orquestador headless canónico.
- `scripts/stage1/job-context.mjs`: `jobId`, raíces y aislamiento.
- `scripts/stage1/prepare-scene.mjs`: Piper, FFprobe, RMS, subtítulo y runtime.
- `scripts/stage1/export-scene.mjs`: plan de frames, PNG y MP4.
- `scripts/stage1/verify-stage1.mjs`: integración, formatos y determinismo.
- `scripts/stage1/progress.mjs`: estados JSONL y estado final.
- `scripts/stage1/publish-preview.mjs`: adaptador opcional hacia `public/generated`.
- `public/generated/index.json`: índice local de previews publicados; cada job vive bajo su propia subcarpeta.
- `shared/scene-evaluator.js`: lógica temporal compartida.
- `src/main.ts`: composición mínima del selector de previews y despacho por versión; no debe absorber lógica del motor ni del editor.
- `src/preview/legacy.ts`: consumidor PixiJS aislado del runtime v1.
- `src/preview/dialogue.ts`: consumidor PixiJS aislado del runtime v2 con diálogo, dos personajes y fondo por capas.
- `src/preview/common.ts` y `types.ts`: utilidades, UI mínima y contratos TypeScript compartidos por ambos previews.
- `public/scene.config.json`: ejemplo vigente del contrato mínimo de una escena.
- `schema/scene-config.schema.json`: JSON Schema 2020-12 del contrato versión 1.
- `schema/scene-config-v2.schema.json`: contrato de una escena con exactamente dos personajes, diálogo secuencial medido y gesto opcional por turno.
- `schema/character-manifest.schema.json`: contrato versión 1 de un rig alineado con ojos, bocas y poses de manos.
- `schema/parametric-character.schema.json`: definición geométrica declarativa y segura de un personaje y sus variantes.
- `schema/local-character-design.schema.json`: contrato cerrado de nombre, paleta y presets admitidos por el creador local.
- `schema/character-manifest-v2.schema.json`: rig compilado con capas, miniaturas, joints, poses, variante y procedencia.
- `schema/asset-catalog.schema.json`: índice local portable de assets seleccionables por ID.
- `schema/video-project.schema.json`: contrato versión 1 del proyecto editable con hasta ocho escenas, instancias sobre canvas, diálogo por IDs y transiciones cerradas.
- `schema/authoring-resource-catalog.schema.json`: catálogo de autoría para personajes compilados, props v3, voces, fondos e imágenes.
- `schema/local-resource-library.schema.json`: registro durable de fichas locales, hashes y fecha de alta.
- `schema/background-manifest.schema.json`: contrato portable del fondo por tres capas.
- `schema/compiled-project.schema.json`: manifiesto versionado que vincula proyecto, hashes, escenas v2 compiladas y transiciones.
- `schema/rendered-project.schema.json`: contrato v2 del manifiesto final con timeline medida por escena y turno, subtrabajos, outputs y verificación. `schema/rendered-project-v1.schema.json` conserva la validación histórica.
- `schema/editor-command.schema.json`: vocabulario cerrado de operaciones semánticas soportadas por el editor local.
- `schema/animation-scene.schema.json`: contrato aislado de la Fase 0 de animación (pistas, keyframes, anclas, interpolaciones, procedencia y límites). El documento de pistas todavía no tiene consumidor.
- `shared/animation-contract.js`: vocabulario versionado, catálogo cerrado de errores, cuantización a frame y estado «requiere revisión». Puro y sin dependencias de Node porque entra en el bundle del navegador. `ANIMATION_PARAMETERS` es la única fuente del vocabulario. Conserva `armRaise` y agrega controles reutilizables para brazo izquierdo, ambos codos, cabeza y cuerpo; cada rig declara solo los que realmente soporta.
- `scripts/animation/animation-contract.mjs`: validación de autoría contra el schema JSON (lo único que necesita ajv). Reexporta todo lo de `shared/animation-contract.js`.
- `shared/compositor-contract.js`: traduce un recurso v3 y su instancia a una lista PLANA de sprites con su cadena de transformaciones, ordenada por dibujo. Es lo que hace intercambiables a los backends: ninguno reinterpreta la jerarquía de piezas.
- `shared/animation-evaluator.js`: resolución de anclas a segundos después de FFprobe, cuantización a frame, rechazo de referencias rotas, colisiones y keyframes fuera de escena, y evaluación de pistas. La interpolación de un keyframe describe el tramo que sale de él; `ease` es `inOutSine`.
- `pilots/animacion-v1/`: fixtures válidos e inválidos del contrato de animación.
- `docs/FASE_0_CONTRATO_ANIMACION_V1.md`: vocabulario congelado, errores y estado visible de timeline, inspector y lienzo.
- `shared/shape-renderer.js`: único renderizador de primitivas, compartido por el Creador y el compilador de assets. El orden de atributos es contrato: la salida SVG tiene que quedar idéntica byte a byte.
- `schema/resource-manifest-v3.schema.json` y `scripts/stage2f/resource-manifest.mjs`: manifest de recurso v3 (piezas con pivote y jerarquía, tipo `prop`, parámetros animables con bindings) y adaptador de lectura v2 → v3 sin pérdida.
- `pilots/recursos-v3/`: fixtures del manifest v3 (un personaje articulado y un prop).
- `schema/parametric-resource-v3.schema.json` y `scripts/stage2f/parametric-resource.mjs`: definición y compilador de recursos v3. Rasteriza **una capa por pieza** y fusiona el catálogo en vez de sobrescribirlo. El compilador v1 → v2 de `parametric-character.mjs` no se toca.
- `scripts/stage2f/rasterizer.mjs`: rasterizado con Chrome headless, compartido por los dos compiladores. Los flags determinan el determinismo del PNG.
- `public/assets/resource-definitions/`: definiciones v3. `mono-articulado-v1` (brazo derecho como pieza propia con pivote en el hombro, declara `armRaise`) y `cartel-dato-v1` (prop piloto).
- `schema/published-project-index.schema.json`: índice versionado de proyectos compatibles publicados para la UI.
- `shared/project-editor.js`: estado inmutable, validación, comandos, undo/redo, catálogo y exportación del proyecto de autoría.
- `scripts/stage3a/validate-video-project.mjs`: validación estructural, semántica y de recursos del proyecto editable.
- `scripts/stage3a/project-compilation-context.mjs`: congelado del proyecto y aislamiento de la compilación por `jobId`.
- `scripts/stage3a/compile-video-project.mjs`: mapeo determinista de autoría a configuraciones v2 compatibles con el motor actual.
- `scripts/stage3a/project-pipeline.mjs`: orquestador padre que ejecuta un job aislado por escena y ensambla cortes/fundidos con FFmpeg.
- `scripts/stage3b/publish-project.mjs`: valida un proyecto compilable y lo publica bajo `public/projects` con hashes deterministas.
- `scripts/director/ollama-director.mjs`: adaptador local `qwen3:8b`, salida estructurada, timeout y caché por hash.
- `scripts/director/director-plan.mjs`: validación semántica y normalización determinista del plan IA al proyecto editable.
- `scripts/director/director-context.mjs`: ranking local, shortlist acotada y selección de plantillas narrativas sin IA.
- `public/assets/catalog/narrative-templates.json`: beats narrativos reutilizables validados por `schema/narrative-template-catalog.schema.json`.
- `scripts/local-app/server.mjs`: API HTTP local limitada a loopback para salud, propuestas, validación y trabajos.
- `scripts/local-app/render-job-manager.mjs`: congelado, aislamiento, progreso, cancelación y entrega del MP4.
- `scripts/local-app/retention.mjs`: limpieza validada de temporales y retención local; el modo predeterminado no borra.
- `scripts/local-app/resource-library.mjs`: registro local atómico, validación, deduplicación y publicación del catálogo combinado.
- `scripts/storage/contracts.mjs`: capacidades async reemplazables de proyectos, recursos, jobs y blobs.
- `scripts/storage/file-resource-repository.mjs`: índice durable filesystem separado de publicación/materialización.
- `scripts/storage/file-render-job-repository.mjs`: reserva y transiciones persistentes de jobs.
- `scripts/storage/file-blob-storage.mjs`: claves portables, streaming, límites y SHA-256 dentro de raíces controladas.
- `docs/PERSISTENCIA_FILESYSTEM_P1.md`: contrato operativo, compatibilidad, pruebas y límites de P1.
- `scripts/storage/local-data-bundle.mjs`: inventario, exportación determinista y verificación de bundles portables.
- `schema/local-data-bundle.schema.json`: contrato v1 del bundle autocontenido.
- `docs/PERSISTENCIA_BUNDLE_P2.md`: política, operación, evidencia y límites de P2.
- `scripts/storage/postgres-client.mjs`: pool PostgreSQL acotado, timeouts, transacciones y errores saneados.
- `scripts/storage/postgres-project-repository.mjs`, `postgres-resource-repository.mjs` y `postgres-render-job-repository.mjs`: adaptadores de metadata PostgreSQL.
- `scripts/storage/repository-contract-suite.mjs`: casos contractuales idénticos para filesystem y PostgreSQL.
- `docs/PERSISTENCIA_POSTGRES_P4.md`: modelo, operación, evidencia y límites de P4.
- `scripts/storage/s3-client.mjs` y `s3-blob-storage.mjs`: cliente S3 acotado y blobs por streaming, límites y SHA-256.
- `scripts/storage/artifact-storage.mjs`: materialización atómica y publicación verificable de manifiesto/MP4.
- `scripts/storage/blob-storage-contract-suite.mjs`: casos idénticos para BlobStorage filesystem y S3.
- `docs/PERSISTENCIA_S3_P5.md`: integridad, operación, evidencia y límites de P5.
- `scripts/storage/storage-migration.mjs` y `storage-migration-cli.mjs`: plan inmutable, importación idempotente y verificación filesystem → PostgreSQL/S3.
- `schema/storage-migration-plan.schema.json`: contrato portable v1 del plan de migración.
- `docs/PERSISTENCIA_IMPORTADOR_P6.md`: operación, seguridad, evidencia y límites de P6.
- `scripts/storage/persistence-runtime.mjs` y `remote-resource-repository.mjs`: selección estricta del backend, diagnóstico y materialización de recursos remotos.
- `scripts/storage/postgres-s3-backup.mjs` y `postgres-s3-backup-cli.mjs`: backup lógico, verificación offline y restauración idempotente.
- `schema/storage-backup.schema.json`: contrato portable v1 del backup PostgreSQL/S3.
- `docs/PERSISTENCIA_CUTOVER_P7.md`: arranque normal, rollback, backup/restauración y evidencia de P7.
- `scripts/storage/configuration-secrets.mjs`: secretos por entorno o archivos montados, acotados y no observables.
- `scripts/storage/remote-readiness-probe.mjs`: salud, latencia, transferencia, capacidad y escenario de costos sin secretos.
- `deploy/worker/Dockerfile` y `scripts/worker/*`: runtime Linux aislado, hidratación y render multiescena real.
- `docs/PERSISTENCIA_REMOTA_P8.md`: matrices, seguridad, costos, operación, worker y gate remoto.
- `compose.yaml`: PostgreSQL y SeaweedFS locales, fijados por digest y con volúmenes nombrados.
- `scripts/storage/infra-health.mjs` y `db-migrate.mjs`: salud real y migraciones SQL idempotentes.
- `docs/INFRAESTRUCTURA_LOCAL_P3.md`: configuración, operación, evidencia y límites de P3.
- `src/ui/viewer.ts`: selector explícito entre composición editable, preview medido y MP4 final.
- `src/ui/timeline.ts`: timeline audiovisual, transporte, zoom, snap, atajos y despacho al medio activo; nunca estima duración como si fuera medida.
- `src/ui/project/composition.ts`: proyección visual estática del proyecto y catálogo; no evalúa audio, boca ni tiempos.
- `src/ui/project/persistence.ts`: sesión local versionada y ligada a la revisión del catálogo.
- `src/ui/project/library.ts` y `project-timeline.ts`: recursos aplicables e inventario estructural de escenas/turnos.
- `src/ui/project/character-placement.ts`: selección y transferencia drag/drop de personajes; composición resuelve el personaje más cercano y despacha una colocación atómica sin superar dos instancias.
- `src/ui/character-creator.ts` y `shared/character-design-presets.js`: modo visual de autoría y transformación compartida hacia la definición paramétrica compilable.
- `docs/ESTRUCTURA_VISUAL_CANONICA.md`: contrato de layout y responsabilidades visuales que deben preservar las ampliaciones de la UI.
- `scripts/stage1/validate-scene-config.mjs`: validación estructural, semántica, de rutas/assets y límites medidos.
- `pilots/personaje-mono-01/scene.config.json`: piloto vigente del personaje animable real.
- `pilots/dialogo-monos-01/scene.config.json`: piloto del contrato v2 con dos hablantes y tres turnos.
- `pilots/fondo-parallax-01/scene.config.json`: piloto v2 con tres planos, paneo, zoom y parallax.
- `pilots/parametric-character-01/scene.config.json`: piloto v2 que resuelve dos variantes mediante `characterAssetId` y catálogo.
- `pilots/proyecto-editable-01/project.json`: piloto de autoría con dos escenas; aún no es consumido por el render.
- `pilots/proyecto-compilable-01/project.json`: subconjunto de dos escenas compilable al contrato v2 actual.
- `pilots/gate-capacidades-v1/project.json`: gate integrado de dos escenas que combina ambos compositores, rig articulado, prop, música, cámara, transición y los seis parámetros animables; su evidencia humana/técnica vive en `docs/GATE_INTEGRADO_CAPACIDADES_V1.md`.
- `scripts/stage2c/generate-monkey-character.mjs`: generador determinista de las fuentes SVG y capas PNG del mono; no forma parte del render normal.
- `scripts/stage2f/parametric-character.mjs`: compilador determinista de definición geométrica a SVG, PNG, manifest v2 y catálogo.
- `public/assets/character-definitions/mono-parametrico-v1.json`: definición fuente del vertical slice 2F.2.
- `public/assets/catalog/index.json`: catálogo mínimo con las dos variantes paramétricas.
- `public/assets/catalog/authoring-resources.json`: capa de autoría que ofrece personajes, voces y fondo mediante IDs estables.
- `assets/`: assets legacy de Etapa 0. No usarlos como base para funciones nuevas. Los scripts sueltos de Etapa 0 (`scripts/process.mjs`, `export-video.mjs`, `generate-assets.mjs`, `verify-output.mjs`) y `tts-test/` fueron eliminados del repositorio; su historia se conserva en git.
- `.local-video/`: trabajos y evidencia local regenerable; no versionar.

Comandos canónicos:

```powershell
npm run stage1:pipeline    # trabajo preview + publicación opcional
npm run stage1:test-jobs   # dos trabajos headless y determinismo
npm run stage2b:test-preview # publicación aislada e índice de previews
npm run stage2d:test-audio-mix # mezcla musical, duración medida y ducking
npm run stage2f:test-parametric # seguridad, portabilidad y determinismo del compilador paramétrico
npm run stage2f:parametric-pipeline # piloto por IDs del catálogo
npm run stage3a:validate-project # valida el proyecto editable piloto
npm run stage3a:test-project # contrato, referencias, rutas y límites de 3A.0
npm run stage3a:compile-project # compila el piloto a scene.config v2 por escena
npm run stage3a:test-compiler # compatibilidad, límites y determinismo de 3A.1
npm run stage3a:test-assembly # cálculo temporal de cortes/fundidos y límites de 3A.2
npm run stage3a:project-pipeline # render real de dos escenas y MP4 final determinista
npm run stage3b:test-editor # comandos, undo/redo, seguridad y exportación compatible
npm run stage3b:publish-project # publica el piloto compatible para la UI y el build
npm run stage3b:test-publishing # índice, portabilidad, hashes y rechazo de proyectos incompatibles
npm run anim:test-contract  # vocabulario, límites, errores y estado de revisión de la animación V1
npm run anim:test-evaluator # anclas, interpolaciones y el temporalHash v2 congelado
npm run compositor:test-contract # jerarquía de piezas, bindings y orden de dibujo
npm run stage3b:test-keyframes   # pistas en el proyecto y comandos de keyframe con undo/redo
npm run anim:test-presets        # catálogo versionado de presets y su aplicación
npm run stage2f:test-hash-baseline     # los assets compilados siguen coincidiendo con los publicados
npm run stage2f:test-resource-manifest # manifest de recurso v3 y adaptador de lectura v2 → v3
npm run stage2f:test-resource          # compilador v3 y los dos pilotos (rasteriza de verdad)
npm run stage2f:resource-assets -- --definition=assets/resource-definitions/mono-articulado-v1.json
npm run director:test-plan # contrato, catálogo, límites y normalización determinista
npm run director:test-context # ranking, shortlist, plantillas y recursos requeridos
npm run director:test-ollama # adaptador, salida estructurada, caché y fallos
npm run local:test-library # registro durable, validación, deduplicación y publicación
npm run local:test-server # API loopback, límites y respuestas
npm run local:test-render-manager # aislamiento, proceso, cancelación y errores
npm run local:test-retention # limpieza, rutas protegidas y trabajos activos
npm run storage:test-filesystem # contratos filesystem, conflictos, rutas y hashes
npm run storage:test-postgres # mismos contratos de metadata en PostgreSQL y recuperación
npm run storage:test-s3 # mismos contratos de blobs contra SeaweedFS
npm run storage:test-p5-flow # flujo PostgreSQL, hidratación, upload y streaming privado
npm run storage:test-migration # vacío/parcial/completo, repetición, corrupción y conflictos
npm run storage:test-cutover # arranque real, reapertura, streaming, rollback y fallo estricto
npm run storage:test-backup # backup/restauración real, idempotencia y corrupción
npm run storage:test-remote-config # TLS, secret mounts y rechazo de configuración insegura
npm run storage:probe-remote # mide DB/S3 y verifica un asset real
npm run worker:test-portability # rutas Piper Windows/Linux
npm run worker:test-linux # hidratación y render multiescena dentro de Linux
npm run storage:test-bundle # bundles vacíos/parciales, determinismo y corrupción
npm run storage:inventory # inventario portable de solo lectura
npm run storage:export -- --output=<directorio> # exporta a una carpeta nueva
npm run storage:verify -- --bundle=<directorio> # verifica sin modificar el bundle
npm run storage:migrate -- --dry-run # inventario/plan por stdout, sin abrir el destino
npm run storage:migrate -- --plan=<archivo> # crea un plan nuevo e inmutable
npm run storage:migrate -- --plan=<archivo> --apply # importa sin borrar el origen
npm run storage:migrate -- --plan=<archivo> --verify # compara origen y destino
npm run storage:backup -- --output=<directorio> # backup lógico de PostgreSQL y blobs administrados
npm run storage:backup:verify -- --backup=<directorio> # verificación offline
npm run storage:restore -- --backup=<directorio> --dry-run # preflight sin escritura
npm run infra:up # levanta PostgreSQL y SeaweedFS y espera salud
npm run db:migrate # aplica migraciones idempotentes
npm run infra:health # comprueba DB, migraciones y bucket privado
npm run infra:down # detiene sin eliminar volúmenes
npm run stage3b:test-contracts # compatibilidad entre autoría, editor y compilador
npm test                  # suite central agregada
npm run build              # TypeScript + Vite
```

Para otros trabajos, invocar `scripts/stage1/pipeline.mjs` con `--job-id` y las raíces necesarias. Configurar Piper con `LOCAL_VIDEO_TTS_ROOT` o `--tts-root`.

### Brechas vigentes (no confundir con capacidades implementadas)

- Los contratos de runtime v1 y v2 siguen limitados a una escena. 3A.2 los ejecuta como subtrabajos aislados y ensambla el resultado; no existe todavía un runtime ni preview PixiJS multiescena continuo.
- Los borradores permiten crear/eliminar escenas, personajes y turnos, pero el render vigente sigue exigiendo exactamente dos personajes y al menos dos turnos por escena.
- El Director inicial usa un único modelo y un catálogo de tipos/capacidades cerrados, ahora ampliable mediante fichas locales validadas y consultado mediante shortlist determinista; todavía no formula preguntas aclaratorias, usa búsqueda semántica por embeddings ni repara automáticamente cualquier plan rechazado. Sí combina cinco plantillas narrativas, compara hasta tres variantes y repara rechazos por presupuesto de palabras.
- La biblioteca V1 registra descriptores, importa fondos estáticos JPG/PNG y guarda personajes creados desde plantillas o piezas geométricas semánticas en una raíz durable externa al repositorio. `public/assets/library` es solo su publicación regenerable y el arranque migra sin borrar la ubicación legacy; todavía no elimina recursos, importa rigs externos ni genera assets con IA.
- El Director acepta tono, duración objetivo y cantidad de escenas como restricciones del JSON Schema; siguen siendo objetivos editoriales y la duración real solo existe después de Piper/FFprobe.
- El servicio local acepta un solo render activo, recupera estados interrumpidos y no es un backend multiusuario ni una cola durable.
- La UI usa verificación interactiva de una pasada; la CLI conserva la verificación completa de dos pasadas por defecto.
- El evaluador temporal resuelve anclas y evalúa pistas; proyecto, timeline, inspector, lienzo y render ya consumen ese estado compartido. Sin animación, `evaluateScene` devuelve exactamente el estado histórico y no agrega la clave `elements`; de eso depende que el `temporalHash` de los pilotos v2 no cambie.
- El proyecto editable admite `tracks` por elemento y cinco comandos de edición directa con undo/redo (`create-track`, `add-keyframe`, `set-keyframe`, `delete-keyframe`, `delete-track`), más `apply-animation-preset` con los seis presets versionados de `shared/animation-presets.js` y `remove-animation` como operación segura para automatizaciones. Este último exige confirmación explícita ante pistas manuales o personalizadas. La UI permite editar y previsualizar las pistas; la biblioteca aplica presets compatibles directamente sobre el recurso del elemento seleccionado, y el render los resuelve después de medir audio. Un proyecto sin pistas sigue siendo válido: el campo es aditivo.
- El Director puede proponer presets y quitar animaciones usando combinaciones de escena/elemento restringidas por su esquema estructurado. El contexto no contiene keyframes: resume parámetros, presets, procedencia y protección. Una pista manual o personalizada no puede reemplazarse mediante un preset y exige una segunda confirmación humana para eliminarse; la IA no puede emitir `confirmCustomized`. El lote aceptado se valida completo, se aplica atómicamente y crea un único undo/redo.
- **El compositor headless de la Fase 3 funciona y está integrado selectivamente.** La comparación cruzada sobre una escena v2 dio SSIM mínimo 0.999505 en personajes (umbral 0.995), así que las escenas v2 conservan FFmpeg y una escena con rig v3 o prop usa PixiJS; FFmpeg sigue haciendo encode, audio y mux. `compositor:test-headless` cubre frames dorados y doble ejecución, `compositor:compare-v2` cubre equivalencia entre backends y `compositor:test-pipeline` verifica un MP4 real con `armRaise` y un prop rotando de -8° a 8°.
- El render selecciona un compositor detrás de contrato: FFmpeg overlay conserva el camino v2 y PixiJS headless compone escenas con rigs v3. FFmpeg sigue siendo encoder, mixer y muxer en ambos casos.
- `animationPreset` (`idle-calm`/`talk-calm`) sigue siendo movimiento base continuo, no un preset de keyframes.
- El ancla de palabra se **prorratea** por cantidad de palabras sobre la duración medida del turno, igual que los gestos. No hay alineación forzada palabra por palabra, así que la precisión es la de un prorrateo.
- Existen tres recursos v3 compilados y expuestos en el catálogo de autoría. `mono-articulado-azul-v1` habilita `armRaise`; `el-peque-v1` habilita ambos brazos, inclinación/asentimiento de cabeza e inclinación/rebote corporal, con los estados faciales heredando el transform de la cabeza; `cartel-dato-v1` es un prop propio, colocable por clic o arrastre, visible en lienzo, inspector y timeline, animable y renderizable mediante PixiJS. Los props no cuentan como personajes ni pueden ser hablantes.
- Los ocho personajes históricos siguen siendo v2: el adaptador les devuelve `parameters: []` y conservan el conjunto renderizable de FFmpeg. El noveno personaje seleccionable es el rig v3 articulado.
- La timeline muestra capas estructurales y permite selección/navegación, pero cortar o estirar clips, keyframes libres y mezcla editable de música/SFX siguen fuera de alcance. El runtime ya admite una pista musical opcional por video con loop y ducking fijo; todavía no hay clips musicales editables ni SFX puntuales.
- `public/projects` es una publicación regenerable para la UI, no almacenamiento del motor. Solo lista proyectos aceptados por 3A y 3B.0; debe regenerarse antes del build que se quiera distribuir.
- 3A.1 solo compila escenas con exactamente dos personajes, al menos dos turnos, pose inicial neutral, ancla central, rotación 0 y opacidad 1. Texto, imágenes y otros transforms se rechazan explícitamente hasta que el runtime pueda representarlos.
- El rig versión 2 y el catálogo paramétrico demuestran `neutral`, `point`, `celebrate`, `doubt` y `deny`; todavía no modelan una biblioteca general de animaciones continuas.
- Los joints y rotaciones del manifest v2 son metadatos validados; el runtime actual sigue alternando capas PNG de poses y todavía no aplica articulación continua por jerarquía.
- El piloto 2D reutiliza el mismo rig y modelo Piper; 2F.1 agrega dos rigs y dos voces. El usuario aceptó su calidad como base y dejó el ajuste fino de casting visual/vocal como mejora no bloqueante.
- El fondo del piloto 2C es estático; cámara, parallax y elementos ambientales pertenecen a una etapa posterior.
- 2E implementa paneo/zoom global y parallax por capa; todavía no existen keyframes libres ni loops ambientales configurables. 3A.2 puede ensamblar varias escenas, pero cada una conserva las capacidades cerradas del runtime v2.
- La boca usa seis visemas derivados de grafemas españoles y acotados por actividad RMS, con fallback RMS. No existe todavía alineación fonética real de Piper/espeak-ng y la mejora técnica no equivale a aprobación visual.
- La voz `es_ES-davefx-medium` está instalada solo en el runtime local y requiere evaluación auditiva antes de aceptarse como voz de producto.
- `prepare-scene.mjs` conoce directamente Piper, su modelo y `venv/Scripts/python.exe`; proveedor reemplazable y Linux aún son objetivos, no hechos.
- La caché TTS y un mismo `jobId` no están protegidos ante procesos concurrentes.
- Los procesos usan `spawnSync` sin timeout ni cancelación.
- Los fallos del pipeline tienen estructura plana, etapa y código estable para validación/procesos conocidos; errores internos no clasificados usan `UNEXPECTED_ERROR`.
- Los comandos npm legacy `assets`, `export` y `verify` de Etapa 0 fueron eliminados junto con sus scripts; su historia se conserva en git.
- Cada subcarpeta publicada se reconstruye al republicar su job; el índice global aún no tiene locking para publicaciones concurrentes y pueden quedar archivos legacy planos de etapas anteriores.
- Compatibilidad Linux, límites de recursos, limpieza/retención y licencias completas de assets requieren trabajo antes de un servicio web.

## 5. Disciplina de alcance y protocolo de cambio

Antes de trabajar:

1. Identificar exactamente el pedido y los módulos afectados.
2. Declarar qué queda fuera.
3. Leer archivos afectados, pruebas, tipos y configuración relacionada.
4. Buscar funciones existentes antes de crear otras.
5. Explicar brevemente el cambio y luego implementarlo.

Para cambios amplios: inspeccionar arquitectura/dependencias, identificar riesgos, proponer una secuencia verificable e implementar por pasos. Para cambios mínimos, no exigir un diseño extenso.

Reglas:

- No agregar funciones no solicitadas ni ampliar “por si acaso”.
- No crear una abstracción hasta que existan dos usos reales o un límite externo ya aprobado.
- No reemplazar tecnología estable sin evidencia.
- No introducir una dependencia para un problema pequeño resuelto claramente con Node, TypeScript o código existente.
- No modificar outputs históricos para hacer pasar una prueba nueva; producir evidencia nueva por trabajo.
- Preservar cambios del usuario y evitar tocar archivos ajenos al alcance.

## 6. Pruebas proporcionales

Explicar al finalizar qué nivel se eligió y por qué.

### Nivel 1 — Cambio local pequeño

Texto, estilo, mensaje o valor de configuración:

- prueba directa o inspección del elemento;
- typecheck/build relacionado si aplica;
- revisión manual breve.

No ejecutar el pipeline completo si el cambio no puede afectarlo.

### Nivel 2 — Lógica de módulo

RMS, caché, movimiento, evaluador o subtítulos:

- prueba específica del módulo;
- caso normal y un límite relevante;
- typecheck;
- integración directa con su consumidor.

Si cambia `shared/scene-evaluator.js`, comparar preview y exportación.

### Nivel 3 — Integración

TTS, preparación, FFmpeg, exportación o trabajos:

- pipeline afectado;
- FFprobe del archivo generado;
- errores y rutas relevantes;
- repetición cuando intervenga determinismo.

### Nivel 4 — Arquitectura o pre-release

- suite completa disponible;
- build;
- exportación completa y determinismo;
- múltiples trabajos;
- revisión de seguridad, documentación y rendimiento.

No ejecutar pruebas sin relación, pero nunca omitir las que protegen el invariante cambiado.

## 7. Uso eficiente de Codex e IA

- Leer primero `AGENTS.md`, documentación vigente y archivos centrales afectados.
- Usar `rg` y búsquedas específicas; no recorrer repetidamente todo el repo.
- No reanalizar archivos sin cambios ni repetir auditorías completas tras ajustes menores.
- Agrupar cambios relacionados y usar herramientas locales para medir en vez de inferir.
- Preferir scripts deterministas a razonamiento repetitivo de IA.
- No pedir a modelos cientos de keyframes ni enviar imágenes/audio grandes si un algoritmo local basta.
- No usar IA para formatos, hashes, metadata, validación o cálculos.
- Mantener prompts breves, con catálogo cerrado y salida estructurada.
- Cachear guiones, planes, voces, subtítulos y análisis cuando sus entradas no cambien.

Para una IA paga: definir tarea exacta, contexto mínimo, esquema de salida, límite de tokens, clave de caché, prevención de duplicados, consumo/costo estimado, presupuesto máximo y fallback local. Nunca usarla para tareas repetitivas y deterministas resolubles localmente.

## 8. Seguridad

- Validar tipos, rangos y referencias de toda entrada.
- Antes de aceptar contenido no confiable, imponer límites de texto, escenas, duración, resolución, tamaño de asset, frames y output.
- Resolver rutas bajo raíces permitidas y rechazar absolutas, traversal y symlinks que escapen del trabajo.
- Sanitizar `jobId` y futuros nombres de archivos.
- No ejecutar código, filtros libres, URLs o comandos procedentes del JSON.
- Mantener argumentos separados, directorios aislados y limpieza limitada al trabajo validado.
- Agregar timeouts/cancelación y límites de CPU, RAM y disco antes de ejecución online.
- No incluir claves, tokens, prompts sensibles, datos personales o secretos en código, commits, logs u outputs.
- Usar variables de entorno para configuración sensible.
- Registrar fuente, autor, licencia y atribución de modelos, voces, fuentes, música e imágenes.
- Revisar licencias antes de distribuir o monetizar assets y modelos.

## 9. Dependencias

Toda dependencia nueva debe documentar: problema, insuficiencia del código existente, mantenimiento, licencia, tamaño/impacto, Windows/Linux, efecto web/contenedor, riesgos de seguridad y sustitución posible.

Evitar paquetes masivos para funciones pequeñas. No actualizar versiones principales sin tarea explícita, lectura de notas de migración y pruebas proporcionales. Mantener el lockfile coherente.

## 10. Errores y observabilidad

El formato objetivo de fallo debe poder representar:

```json
{
  "version": 1,
  "jobId": "job-123",
  "state": "failed",
  "stage": "encoding",
  "code": "FFMPEG_EXIT_NONZERO",
  "message": "No se pudo codificar el video.",
  "technicalDetail": "detalle acotado",
  "cause": "causa conocida o encadenada",
  "suggestedAction": "acción concreta"
}
```

`jobId`, etapa, código, mensaje humano y estado final son obligatorios para errores del pipeline. Detalle, causa y acción se incluyen cuando aportan valor. No persistir stacks con rutas locales, secretos, prompts completos ni salida externa ilimitada. Los logs deben ser suficientes para diagnosticar, no ruidosos.

Estados actuales mínimos: `preparing`, `generating_voice`, `analyzing_audio`, `rendering_frames`, `encoding`, `completed`, `failed`. Si se agregan estados, versionar el contrato y actualizar consumidores.

## 11. Documentación

Actualizar documentación cuando cambien arquitectura, configuración, comandos, dependencias, variables de entorno, assets, pipeline, invariantes o restricciones. No crear un informe largo por una corrección menor.

- `AGENTS.md`: normas permanentes y estado resumido.
- `README.md`: entrada general, instalación, uso local y mapa de documentación.
- `docs/ROADMAP.md`: dirección y gates; no describe trabajo ya autorizado.
- `docs/DEVELOPMENT_CHECKLIST.md`: control operativo breve.
- Informes `ETAPA_*`: evidencia histórica; no reescribirlos para ocultar evolución.

Usar comentarios de código solo para decisiones no evidentes.

## 12. Criterio de finalización

Una tarea termina cuando:

- funciona lo solicitado;
- no se rompió el comportamiento afectado;
- se ejecutaron pruebas proporcionales y se explicó su selección;
- se manejaron errores relevantes;
- no se amplió el alcance;
- no quedaron temporales accidentales ni secretos;
- se revisaron licencias si hubo assets/modelos;
- se actualizó la documentación afectada;
- se informó qué cambió, qué se probó y qué queda pendiente.
