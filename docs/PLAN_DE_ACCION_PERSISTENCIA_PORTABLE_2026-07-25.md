# Plan de acción — Persistencia portable local → remoto

Fecha: 25 de julio de 2026.

Estado: **plan aprobado para ejecución; implementación pendiente**.

Objetivo operativo: evolucionar la persistencia actual basada en archivos hacia
una arquitectura seleccionable con PostgreSQL para metadata y JSON versionado,
MinIO/S3 para binarios y un camino de migración verificable hacia infraestructura
remota, sin romper el funcionamiento local, el render determinista ni los datos
existentes.

Este documento está diseñado para que otro hilo/agente pueda continuar el trabajo
sin redescubrir la arquitectura.

---

## 1. Resultado exacto que debe conseguirse

Al completar este plan:

1. La aplicación podrá arrancar con dos backends:
   - `filesystem`: comportamiento local compatible con el actual;
   - `postgres-s3`: PostgreSQL + storage S3-compatible local mediante Docker.
2. Proyectos, recursos, trabajos y artefactos conservarán los mismos IDs,
   contratos JSON, hashes y límites.
3. PostgreSQL almacenará metadata, estados, relaciones y documentos JSON
   versionados. No almacenará PNG, WAV, MP4 ni modelos como blobs.
4. MinIO almacenará imágenes, rigs, WAV persistentes, manifiestos y MP4 mediante
   claves portables y hashes SHA-256.
5. Piper y FFmpeg seguirán trabajando sobre rutas locales dentro de un sandbox
   aislado por `jobId`. Un adaptador hidratará inputs desde storage y publicará
   outputs al terminar.
6. Existirá un importador idempotente con:
   - inventario;
   - `--dry-run`;
   - plan de migración persistible;
   - verificación de conteos, referencias, tamaños y SHA-256;
   - reanudación segura;
   - rollback sin borrar el origen.
7. El cambio entre backends será configurable por entorno y reversible.
8. Quedará documentado cómo sustituir PostgreSQL/MinIO locales por servicios
   administrados remotos sin cambiar el núcleo creativo ni el pipeline.

No se considera terminado si solo existe un `compose.yml` o si la base de datos
arranca pero la aplicación todavía escribe silenciosamente en rutas antiguas.

---

## 2. Alcance y fuera de alcance

### Incluido

- Inventario formal de todos los datos persistentes y regenerables.
- Contratos reemplazables para proyectos, recursos, trabajos y blobs.
- Adaptadores filesystem que preserven el comportamiento actual.
- PostgreSQL local bajo Docker para metadata.
- MinIO local bajo Docker como API S3-compatible.
- Migraciones SQL versionadas y repetibles.
- Herramienta de migración filesystem → PostgreSQL/MinIO.
- Verificación, rollback y documentación operativa.
- Materialización de inputs y recolección de outputs del worker.
- Pruebas de paridad entre backends.
- Diseño de sustitución posterior por PostgreSQL administrado y S3/R2
  compatible.

### Fuera de alcance

- Usuarios, login, organizaciones y autorización multiusuario.
- Suscripciones, facturación o cuotas comerciales.
- Exposición pública de la API.
- Cola distribuida y múltiples workers.
- Kubernetes.
- Migrar o ejecutar Ollama remotamente.
- Cambiar PixiJS, FFmpeg, Piper o el evaluador temporal.
- Guardar secretos reales en el repositorio.
- Borrar automáticamente el origen filesystem después de migrar.
- Contenerizar Piper antes de probar compatibilidad Linux y equivalencia.

La base de datos no convierte por sí sola la aplicación en un backend remoto
seguro. Usuarios, aislamiento por propietario y cola pertenecen a la Fase 6 del
roadmap.

---

## 3. Reglas duras

1. **Filesystem sigue siendo un backend válido.** No se elimina hasta que
   PostgreSQL/MinIO tenga paridad demostrada y rollback probado.
2. **Binarios fuera de PostgreSQL.** PNG, JPG, WAV, MP4, fuentes, rigs y modelos
   viven en storage de objetos o filesystem.
3. **El render conserva filesystem local por job.** FFmpeg y Piper reciben rutas
   del sandbox; nunca URLs S3 ni streams de base de datos.
4. **JSON sigue siendo datos.** Se valida con los schemas actuales antes de
   persistir y después de leer.
5. **IDs y rutas portables.** La base guarda IDs, object keys y rutas relativas;
   nunca rutas absolutas del host.
6. **Objetos dirigidos por contenido.** Siempre que aplique, usar SHA-256 en la
   clave del objeto para deduplicación e idempotencia.
7. **Migración no destructiva.** El importador no borra, mueve ni modifica los
   archivos de origen.
8. **Sin dual-write indefinido.** La migración usa importación offline/reanudable
   y luego un backend activo. Un espejo temporal solo se admite como herramienta
   acotada de verificación.
9. **Sin credenciales en Git.** Usar `.env.local` ignorado y un
   `.env.example` sin secretos reales.
10. **Docker de desarrollo no equivale a producción.** Sus credenciales,
    puertos y volúmenes son exclusivamente locales.
11. **No acoplar el núcleo a drivers.** `shared/`, evaluador, compilador y
    pipeline temporal no importan PostgreSQL ni SDK S3.
12. **No relajar seguridad de rutas.** La hidratación desde storage también
    valida claves, tamaños, hashes y destino bajo el job actual.

---

## 4. Estado e inventario actual

| Clase de dato | Fuente actual | Naturaleza | Destino objetivo |
| --- | --- | --- | --- |
| Sesión rápida del editor y último `jobId` | `localStorage`, clave `local-video.editor-session` | caché UX local | mantener local; no es fuente durable |
| Proyectos editables | `%LOCALAPPDATA%\DisenadorVideosLocal\projects\<id>.json` o `LOCAL_VIDEO_PROJECTS_ROOT` | durable | PostgreSQL `projects` |
| Registro de biblioteca | `%LOCALAPPDATA%\DisenadorVideosLocal\library\library-index.json` | durable | PostgreSQL `resources` |
| Assets locales de biblioteca | `%LOCALAPPDATA%\DisenadorVideosLocal\library\assets/**` | durable | bucket de objetos |
| Catálogo builtin | `public/assets/catalog/**` y assets versionados del repo | distribuido con la app | seguir en release; registrar revisión |
| Publicación de biblioteca | `public/assets/library/**` | regenerable | materialización/caché compatible |
| Proyectos publicados | `public/projects/**` | regenerable | materialización/caché compatible |
| Previews publicados | `public/generated/**` | regenerable | artefacto opcional en storage |
| Estado de jobs | `.local-video/app-jobs/<jobId>.json` | durable operativo local | PostgreSQL `render_jobs` |
| Snapshot de input | `.local-video/app-input/<jobId>/project.json` | evidencia inmutable | PostgreSQL + objeto opcional |
| Trabajo de render | `.local-video/work/<jobId>/**` | temporal/regenerable | sandbox local del worker |
| Outputs y manifiestos | `.local-video/output/<jobId>/**` | resultado | bucket + `render_artifacts` |
| Cachés del Director | `.local-video/director-cache` y `director-edit-cache` | regenerable | filesystem primero; tabla/objeto después |
| Runtime, modelos y caché Piper | `LOCAL_VIDEO_TTS_ROOT` | dependencia local pesada | volumen del worker; no migrar en primera etapa |

Implementaciones actuales que deben envolverse, no duplicarse:

- `scripts/local-app/project-repository.mjs`
- `scripts/local-app/resource-library.mjs`
- `scripts/local-app/render-job-manager.mjs`
- `scripts/local-app/server.mjs`
- `scripts/local-app/retention.mjs`
- `scripts/stage1/job-context.mjs`
- `scripts/stage3a/project-compilation-context.mjs`
- `scripts/director/ollama-director.mjs`
- `scripts/director/project-editor-director.mjs`

Ya existe una migración legacy no destructiva para la biblioteca. Debe
preservarse y quedar antes del nuevo importador en el orden de actualización:

```text
legacy local → biblioteca filesystem vigente → PostgreSQL/MinIO
```

---

## 5. Arquitectura objetivo

```text
UI / API local
      │
      ├── ProjectRepository ───────────┐
      ├── ResourceRepository ──────────┤
      ├── RenderJobRepository ─────────┤── filesystem
      └── BlobStorage ─────────────────┤
                                      │
                                      └── PostgreSQL + S3

RenderJobService
      │
      ├── congela proyecto/revisión
      ├── crea sandbox local por jobId
      ├── hidrata assets desde BlobStorage
      ├── ejecuta pipeline headless
      ├── verifica FFprobe/hashes
      └── publica artefactos y estado

Worker local
      ├── Piper
      ├── FFmpeg / FFprobe
      └── filesystem efímero aislado
```

La frontera importante no es “DB versus motor”, sino:

```text
persistencia durable ↔ materialización local ↔ render determinista
```

---

## 6. Contratos mínimos

Los nombres finales pueden ajustarse, pero las capacidades no deben mezclarse.
Todos los adaptadores serán asíncronos para no fijar el contrato al filesystem
síncrono actual.

### `ProjectRepository`

```ts
interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<StoredProject>;
  save(project: VideoProject, expectedRevision?: string): Promise<StoredProject>;
  remove(id: string, expectedRevision?: string): Promise<boolean>;
}
```

- `revision` será SHA-256 del JSON canónico o una revisión derivada de este.
- PostgreSQL debe impedir actualizaciones perdidas mediante revisión esperada.
- El documento completo sigue validándose como `video-project` v1.

### `ResourceRepository`

```ts
interface ResourceRepository {
  list(): Promise<ResourceRecord[]>;
  get(id: string): Promise<ResourceRecord>;
  register(record: ResourceRecord): Promise<RegisterResult>;
}
```

- Conserva `contentHash`, procedencia, licencia y descriptor validado.
- Los archivos referenciados se resuelven mediante `BlobStorage`.
- La deduplicación vigente por hash no cambia.

### `RenderJobRepository`

```ts
interface RenderJobRepository {
  reserve(job: QueuedRenderJob): Promise<void>;
  get(jobId: string): Promise<RenderJob>;
  list(filter?: JobFilter): Promise<RenderJob[]>;
  transition(jobId: string, expectedState: string, event: JobEvent): Promise<RenderJob>;
}
```

- Las transiciones de estado deben ser atómicas.
- Reservar `jobId` usa una restricción única.
- No guardar procesos, timers ni rutas absolutas.
- `error` conserva el contrato estructurado vigente.

### `BlobStorage`

```ts
interface BlobStorage {
  put(input: PutBlobInput): Promise<StoredBlob>;
  getToFile(key: string, destination: string, expectedSha256?: string): Promise<void>;
  stat(key: string): Promise<StoredBlob>;
  delete(key: string): Promise<void>;
}
```

- `destination` debe estar dentro del sandbox validado.
- `put` calcula o verifica SHA-256 y tamaño.
- Las claves no contienen `..`, barras inversas, drive letters ni datos privados.
- El borrado no se usa durante la migración inicial.

---

## 7. Modelo de datos inicial

No introducir ORM antes de demostrar que SQL parametrizado y migraciones
versionadas son insuficientes.

### `schema_migrations`

| Campo | Tipo conceptual |
| --- | --- |
| `version` | entero/identificador único |
| `name` | texto |
| `sha256` | hash del archivo SQL |
| `applied_at` | timestamp UTC |

Una migración aplicada con contenido diferente debe fallar.

### `projects`

| Campo | Propósito |
| --- | --- |
| `id` | ID portable, PK |
| `contract_version` | versión de `video-project` |
| `document` | JSONB validado |
| `revision` | SHA-256 único de contenido |
| `created_at` / `updated_at` | timestamps UTC |

### `resources`

| Campo | Propósito |
| --- | --- |
| `id` | ID portable, PK |
| `type` | character/background/voice/image |
| `descriptor` | JSONB compatible con catálogo |
| `content_hash` | deduplicación |
| `source_kind` | builtin/local/imported |
| `registered_at` | timestamp UTC |

Restricciones: ID único y política explícita para `content_hash` repetido.

### `resource_blobs`

| Campo | Propósito |
| --- | --- |
| `resource_id` | FK |
| `role` | manifest/body/pose/background/etc. |
| `object_key` | clave S3 portable |
| `sha256` | integridad |
| `bytes` | tamaño |
| `mime_type` | tipo admitido |

PK compuesta: `(resource_id, role)`.

### `render_jobs`

| Campo | Propósito |
| --- | --- |
| `job_id` | PK |
| `project_id` | referencia lógica |
| `project_revision` | snapshot exacto renderizado |
| `project_snapshot` | JSONB congelado |
| `state` / `stage` | contrato vigente |
| `progress` | JSONB acotado |
| `error` | JSONB estructurado |
| `verification_mode` | interactive/full |
| `created_at` / `updated_at` / `completed_at` | timestamps |

### `render_artifacts`

| Campo | Propósito |
| --- | --- |
| `job_id` | FK |
| `kind` | project-manifest/video/verification/runtime/etc. |
| `object_key` | clave S3 |
| `sha256` | integridad |
| `bytes` | tamaño |
| `mime_type` | tipo |
| `metadata` | JSONB pequeño, sin rutas locales |

PK compuesta: `(job_id, kind)`.

### Cachés

No migrar caché del Director ni de Piper en la primera pasada. Primero medir
tamaño y tasa de aciertos. Si se migran después:

- metadata/clave/versión en PostgreSQL;
- contenido grande en storage;
- expiración y presupuesto explícitos;
- nunca mezclar caché entre versiones del pipeline.

---

## 8. Convención de object keys

Formato sugerido:

```text
resources/<type>/<resourceId>/<role>/<sha256>.<ext>
jobs/<jobId>/inputs/project-<revision>.json
jobs/<jobId>/artifacts/project-manifest-<sha256>.json
jobs/<jobId>/artifacts/render-1-<sha256>.mp4
jobs/<jobId>/artifacts/verification-<sha256>.json
```

Reglas:

- solo `/`, nunca `\`;
- sin rutas absolutas;
- sin texto de usuario salvo IDs ya validados;
- claves inmutables para objetos dirigidos por hash;
- metadata mutable solo en PostgreSQL;
- bucket privado;
- no usar URLs públicas persistentes como identidad.

---

## 9. Fases de ejecución

Cada fase debe quedar en commits separados y cerrar sus pruebas antes de avanzar.

### Fase P0 — Baseline, decisiones y evidencia

**Objetivo:** congelar el comportamiento que debe preservarse.

Tareas:

- [ ] Actualizar inventario si cambió el repositorio desde este documento.
- [ ] Ejecutar `npm test`, `npm run build` y un render real.
- [ ] Registrar conteos y hashes de:
  - proyectos durables;
  - recursos locales;
  - jobs completados;
  - MP4/manifiestos elegidos como corpus.
- [ ] Confirmar que no hay secretos dentro de los JSON actuales.
- [ ] Crear ADR breve para:
  - PostgreSQL como metadata;
  - S3-compatible como blobs;
  - sandbox filesystem del worker;
  - importación offline en lugar de dual-write permanente.
- [ ] Evaluar dependencias y licencias antes de instalarlas:
  - driver PostgreSQL;
  - cliente S3;
  - imágenes Docker con tags/digests fijados.

**Cierre:** baseline reproducible y decisiones aprobadas.

**Pruebas:** nivel 1 documental + suite baseline nivel 4.

---

### Fase P1 — Contratos y adaptadores filesystem

**Objetivo:** separar persistencia sin cambiar dónde se guardan los datos.

Tareas:

- [ ] Crear módulos de contratos fuera de `shared/` si dependen de Node.
- [ ] Convertir `project-repository.mjs` en adaptador filesystem del contrato.
- [ ] Separar registro de recursos de publicación/materialización.
- [ ] Extraer persistencia de jobs de `render-job-manager.mjs`.
- [ ] Crear `FileBlobStorage` con validación de claves, límites y SHA-256.
- [ ] Inyectar adaptadores desde `server.mjs`.
- [ ] Mantener defaults actuales si no existe configuración nueva.
- [ ] Convertir APIs necesarias a async de extremo a extremo.
- [ ] Preservar migración legacy de la biblioteca.

**Cierre:**

- La aplicación funciona igual con `LOCAL_VIDEO_PERSISTENCE=filesystem`.
- No hay imports de PostgreSQL/S3 en núcleo, compilador o evaluador.
- Los archivos siguen apareciendo en las ubicaciones actuales.

**Pruebas:**

- unitarias por contrato;
- suite local completa;
- build;
- render real y comparación de manifiesto/MP4;
- caso de ruta inválida y hash incorrecto.

---

### Fase P2 — Bundle portable e inventario de migración

**Objetivo:** poder describir y transportar los datos sin Docker.

Entregables:

- `schema/local-data-bundle.schema.json`.
- Comando conceptual:

```powershell
npm run storage:inventory
npm run storage:export -- --output=<directorio>
npm run storage:verify -- --bundle=<directorio>
```

El bundle contendrá:

- manifiesto versionado;
- proyectos y revisiones;
- registros de recursos;
- lista de blobs con role, tamaño y SHA-256;
- jobs/artefactos seleccionados por política;
- exclusiones explícitas de temporales y cachés;
- cero rutas absolutas.

Tareas:

- [ ] Definir política de qué jobs migrar: recomendación inicial, completados y
  no eliminados; no migrar `work/temp/frames`.
- [ ] Hacer exportación determinista en orden estable.
- [ ] Verificar referencias y hashes sin modificar origen.
- [ ] Probar bundle vacío, parcial, corrupto y repetido.

**Cierre:** un bundle verificado representa todo lo durable sin depender del
host original.

---

### Fase P3 — Infraestructura Docker local

**Objetivo:** levantar PostgreSQL y MinIO de desarrollo de forma reproducible,
sin conectar aún la aplicación.

Archivos esperados:

- `compose.yaml`
- `.env.example`
- `infra/postgres/migrations/*.sql`
- `scripts/storage/infra-health.mjs`
- documentación operativa.

Servicios mínimos:

- PostgreSQL con healthcheck y volumen nombrado.
- MinIO con healthcheck y volumen nombrado.
- Inicializador idempotente del bucket privado, si resulta necesario.

Reglas:

- puertos configurables y limitados a loopback por defecto;
- imágenes fijadas a versión/digest tras revisar licencia y mantenimiento;
- `docker compose down` no elimina volúmenes;
- no ofrecer un comando destructivo de reset como camino normal;
- credenciales de desarrollo configurables y claramente no aptas para remoto;
- ninguna credencial real en `.env.example`.

Comandos esperados:

```powershell
npm run infra:up
npm run infra:health
npm run infra:down
npm run db:migrate
```

**Cierre:** reiniciar contenedores conserva datos; healthchecks y migraciones son
idempotentes.

---

### Fase P4 — Adaptador PostgreSQL

**Objetivo:** persistir metadata sin cambiar todavía blobs.

Orden:

1. `PostgresProjectRepository`.
2. `PostgresResourceRepository`.
3. `PostgresRenderJobRepository`.

Tareas:

- [ ] Pool con límites y timeout.
- [ ] SQL siempre parametrizado.
- [ ] Transacciones para registro/revisión/transición de estado.
- [ ] Restricciones DB equivalentes a validaciones de aplicación.
- [ ] Validar JSON al escribir y leer.
- [ ] Implementar revisión optimista de proyectos.
- [ ] Implementar reserva atómica de `jobId`.
- [ ] Recuperación de jobs interrumpidos sin estado en memoria como autoridad.
- [ ] Errores estables sin DSN, credenciales ni SQL completo en logs.

**Cierre:** suites contractuales ejecutan exactamente los mismos casos contra
filesystem y PostgreSQL.

---

### Fase P5 — Adaptador S3/MinIO y materialización

**Objetivo:** mover blobs durables a MinIO manteniendo el sandbox local.

Tareas:

- [ ] `S3BlobStorage` con bucket privado.
- [ ] Upload por stream, límites y SHA-256.
- [ ] Descarga a archivo temporal dentro del job y rename atómico.
- [ ] Rechazo y limpieza del temporal ante hash/tamaño incorrecto.
- [ ] Materializador de recursos para catálogo/editor/render.
- [ ] Publicador de outputs después de FFprobe y verificación.
- [ ] Registrar artifact metadata solo después de upload confirmado.
- [ ] Política de huérfanos: detectar y reportar; no borrar automáticamente en
  la primera versión.
- [ ] Streaming de MP4 al cliente desde storage sin hacerlo público.

**Cierre:** un render puede:

1. leer proyecto/metadata desde PostgreSQL;
2. hidratar assets de MinIO;
3. renderizar localmente;
4. subir MP4/manifiestos;
5. reproducir/descargar el resultado por la API.

---

### Fase P6 — Importador filesystem → PostgreSQL/MinIO

**Objetivo:** migrar datos reales de manera idempotente y auditable.

**Estado al 2026-07-26:** implementada y verificada contra PostgreSQL/SeaweedFS
reales usando copias temporales; gate humano pendiente. `filesystem` permanece
como backend normal y P7 no está autorizado.

Comandos esperados:

```powershell
npm run storage:migrate -- --dry-run
npm run storage:migrate -- --plan=<plan.json>
npm run storage:migrate -- --plan=<plan.json> --apply
npm run storage:migrate -- --plan=<plan.json> --verify
```

Algoritmo:

1. Resolver raíces actuales y comprobar que son seguras.
2. Crear inventario inmutable con timestamp, versión y hashes.
3. Validar todos los contratos antes de escribir destino.
4. Subir blobs por clave dirigida por SHA-256.
5. Verificar cada objeto mediante tamaño y hash.
6. Insertar metadata en transacciones.
7. Registrar resultado por ítem: `planned`, `skipped`, `imported`, `verified`,
   `failed`.
8. Al repetir, saltar únicamente cuando identidad, hash y metadata coincidan.
9. Si existe mismo ID con contenido diferente, detener con conflicto explícito.
10. Comparar origen/destino y emitir reporte final.

No hacer:

- marcar éxito si faltan blobs;
- sobrescribir conflictos;
- borrar origen;
- importar temporales;
- confiar en `mtime` como identidad;
- continuar después de una incompatibilidad de schema no reconocida.

**Cierre:** dos ejecuciones consecutivas producen el mismo estado; la segunda no
duplica registros ni objetos.

---

### Fase P7 — Cutover local, rollback y operación

**Objetivo:** usar PostgreSQL/MinIO como backend normal con retorno probado.

**Estado al 2026-07-26:** implementación técnica y cutover real completados.
PostgreSQL/SeaweedFS es el arranque normal; el filesystem original permanece
intacto, el rollback fue ejecutado y existen backup/restauración verificados.
Queda pendiente la aprobación humana después del período de uso personal. P8 no
está autorizada.

Configuración conceptual:

```text
LOCAL_VIDEO_PERSISTENCE=filesystem | postgres-s3
LOCAL_VIDEO_DATABASE_URL=...
LOCAL_VIDEO_S3_ENDPOINT=...
LOCAL_VIDEO_S3_BUCKET=...
LOCAL_VIDEO_S3_ACCESS_KEY=...
LOCAL_VIDEO_S3_SECRET_KEY=...
LOCAL_VIDEO_S3_FORCE_PATH_STYLE=true
```

Tareas:

- [x] Diagnóstico de arranque que no imprima secretos.
- [x] Fallo claro si el backend elegido no está disponible.
- [x] No hacer fallback silencioso a filesystem cuando se pidió `postgres-s3`.
- [x] Backup lógico de PostgreSQL y copia/versionado del bucket.
- [x] Runbook de restauración.
- [ ] Ejecutar producción personal real durante un período acordado.
- [x] Probar rollback seleccionando filesystem sin modificar el origen.
- [ ] Solo después, definir política opcional de archivo/eliminación del origen.

**Cierre:** crear, editar, cerrar, reabrir, renderizar y recuperar un proyecto
funciona después de reiniciar aplicación y contenedores.

---

### Fase P8 — Preparación para remoto

**Objetivo:** demostrar que los adaptadores locales pueden apuntar a servicios
remotos sin cambiar contratos.

**Estado al 2026-07-26:** preparación técnica local implementada. TLS estricto,
secret mounts/credenciales ambientales, matrices, probe de latencia/costos y
worker Linux con render multiescena real están verificados. G7 sigue pendiente
hasta elegir proveedor/región, ejecutar el probe contra servicios administrados,
definir retención/presupuesto y aprobar autenticación. No se avanzó a
multiusuario.

Tareas:

- [x] Matriz de compatibilidad PostgreSQL local/administrado.
- [x] Matriz MinIO/S3/R2 y AWS S3; proveedor final pendiente del gate.
- [x] TLS y validación de certificados.
- [x] Credenciales mediante secret manager del entorno.
- [x] Runbook de backups, retención/lifecycle no destructivo y calculadora de costos; valores finales pendientes del gate.
- [x] Latencia y transferencia medidas con assets reales localmente; probe administrado pendiente.
- [x] Worker Linux que hidrata sandbox y produce resultado equivalente.
- [x] Separar artefactos/procesos de frontend/API/worker; cola distribuida queda fuera de P8.

Gate para pasar a multiusuario:

- worker Linux verificado;
- reserva concurrente de jobs;
- storage remoto probado;
- límites de recursos;
- autenticación y autorización diseñadas;
- demanda real o grupo piloto definido.

---

## 10. Estrategia de pruebas

Este trabajo es nivel 4 por arquitectura, datos durables y ruta de despliegue.

### Matriz obligatoria

| Capacidad | Filesystem | PostgreSQL/MinIO |
| --- | --- | --- |
| Crear/listar/abrir/editar/eliminar proyecto | sí | sí |
| Conflicto de revisión | sí | sí |
| Registrar/deduplicar recurso | sí | sí |
| Reinicio y recuperación de job | sí | sí |
| Render real interactivo | sí | sí |
| MP4 H.264/AAC por FFprobe | sí | sí |
| Manifiesto v2 válido | sí | sí |
| Aislamiento por `jobId` | sí | sí |
| Ruta/clave maliciosa rechazada | sí | sí |
| Hash incorrecto rechazado | sí | sí |
| Migración repetida sin duplicados | N/A | sí |
| Rollback al backend anterior | N/A | sí |

### Pruebas mínimas por fase

- Unitarias para cada contrato/adaptador.
- Casos normales, conflicto, corrupción y ausencia de servicio.
- `npm test`.
- `npm run build`.
- Render multiescena real.
- FFprobe del MP4.
- Determinismo de dos pasadas cuando el cambio alcance el pipeline.
- Reinicio de API y contenedores.
- Migración desde una copia de datos, nunca desde la única copia real.
- Escaneo de secretos y rutas absolutas en DB/manifiestos/logs.

No se aceptan mocks como única evidencia de PostgreSQL o MinIO.

---

## 11. Seguridad y operación

- PostgreSQL y MinIO escuchan solo en loopback durante desarrollo.
- Buckets privados; la API controla descargas.
- Tamaños máximos antes y durante streaming.
- MIME declarado y firma real cuando corresponda.
- SQL parametrizado y pool limitado.
- Timeouts para DB y storage.
- Reintentos solo en operaciones idempotentes y con límite.
- Logs con `jobId`, etapa y código, sin DSN ni credenciales.
- Backups probados mediante restauración, no solo creados.
- Migraciones SQL forward-only; una corrección se hace con otra migración.
- Ningún `docker compose down -v` en scripts normales.
- El importador pide `--apply`; por defecto solo inspecciona.
- La limpieza remota tendrá una política separada y no se implementará junto al
  primer importador.

---

## 12. Dependencias y decisiones pendientes

Antes de modificar `package.json`, documentar para cada candidata:

- problema que resuelve;
- por qué Node estándar no basta;
- licencia;
- mantenimiento;
- tamaño;
- compatibilidad Windows/Linux;
- efecto en contenedor;
- riesgos y sustitución.

Preferencia inicial, sujeta a revisión:

- driver PostgreSQL pequeño y mantenido, sin ORM;
- migraciones SQL propias con checksum;
- cliente S3 modular y compatible con MinIO/proveedor remoto;
- Docker Compose solo para infraestructura en P3;
- aplicación y Piper siguen en host hasta P8.

Decisiones que requieren gate humano:

1. Proveedor remoto futuro y región.
2. Qué renders históricos conservar.
3. Política de backup/retención.
4. Presupuesto mensual máximo.
5. Cuándo abandonar filesystem como backend predeterminado.
6. Cuándo incorporar usuarios y ownership.

---

## 13. Commits sugeridos

No agrupar toda la migración en un único commit.

```text
docs(storage): definir arquitectura portable y ADRs
refactor(storage): extraer contratos y adaptadores filesystem
feat(storage): exportar bundle local verificable
feat(infra): añadir PostgreSQL y MinIO de desarrollo
feat(storage): implementar repositorios PostgreSQL
feat(storage): implementar blobs S3 y materialización
feat(storage): migrar filesystem de forma idempotente
docs(storage): documentar cutover, rollback y remoto
```

No mezclar cambios de UI, Director creativo o nuevas capacidades de render con
esta etapa.

---

## 14. Gates de aprobación

| Gate | Evidencia requerida |
| --- | --- |
| G0 — Baseline | suite/build/render real verdes e inventario |
| G1 — Abstracción | filesystem mantiene paridad sin drivers remotos en núcleo |
| G2 — Bundle | exportación determinista y verificación de corrupción |
| G3 — Infra local | reinicio conserva DB/bucket; healthchecks verdes |
| G4 — Adaptadores | suite contractual idéntica en ambos backends |
| G5 — Migración | dry-run, apply, verify y segunda ejecución idempotente |
| G6 — Cutover | uso local real, reinicio y rollback probados |
| G7 — Remoto | worker Linux/storage remoto/seguridad/costos medidos |

No avanzar de G5 a G6 usando la única copia de datos del usuario.

---

## 15. Criterio final de aceptación

La etapa queda terminada únicamente cuando:

- ambos backends pasan la matriz de pruebas;
- los datos actuales fueron inventariados y migrados desde una copia;
- cada blob migrado coincide por SHA-256;
- no hay rutas absolutas persistidas;
- el render real conserva formato, duración y determinismo;
- reiniciar contenedores no pierde datos;
- repetir la migración no duplica nada;
- el origen filesystem permanece recuperable;
- rollback fue ejecutado, no solo documentado;
- secretos y volúmenes están fuera de Git;
- existe runbook de backup/restauración;
- la ruta hacia PostgreSQL/S3 remotos no exige modificar el núcleo.

---

## 16. Primer paso para el próximo hilo

El próximo hilo debe comenzar así:

1. Leer `AGENTS.md` completo.
2. Leer este documento completo.
3. Revisar `docs/ROADMAP.md`, `docs/BIBLIOTECA_LOCAL.md` y
   `docs/OPERACION_LOCAL.md`.
4. Ejecutar `git status -sb` y preservar cambios ajenos.
5. No crear todavía `compose.yaml`.
6. Ejecutar **Fase P0** y presentar:
   - inventario sin datos sensibles;
   - ADRs propuestos;
   - dependencias candidatas con licencia/impacto;
   - secuencia concreta de P1.
7. Pedir aprobación del gate G0 antes de instalar drivers o imágenes.

Prompt sugerido para iniciar el hilo:

> Lee `AGENTS.md` y
> `docs/PLAN_DE_ACCION_PERSISTENCIA_PORTABLE_2026-07-25.md`. Ejecuta la Fase P0
> completa, preserva cambios ajenos y no avances a Docker ni dependencias hasta
> presentar y aprobar el gate G0.
