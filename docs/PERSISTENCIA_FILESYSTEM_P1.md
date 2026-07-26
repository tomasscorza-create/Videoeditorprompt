# Persistencia filesystem — Fase P1

Estado: **implementada y verificada técnicamente; gate G1 pendiente**.

Fecha: 25 de julio de 2026.

## Alcance

P1 separa contratos y persistencia sin cambiar dónde se guardan los datos. El
backend único implementado continúa siendo `filesystem`; no hay drivers,
contenedores, PostgreSQL ni S3.

La selección explícita es:

```powershell
$env:LOCAL_VIDEO_PERSISTENCE = "filesystem"
npm run dev
```

Si la variable no existe, `filesystem` sigue siendo el default. Solicitar otro
backend falla con `PERSISTENCE_BACKEND_UNSUPPORTED`; no existe fallback
silencioso.

## Fronteras

`scripts/storage/contracts.mjs` define las capacidades async:

- `ProjectRepository`;
- `ResourceRepository`;
- `RenderJobRepository`;
- `BlobStorage`.

Adaptadores actuales:

| Adaptador | Responsabilidad |
| --- | --- |
| `project-repository.mjs` | documentos de proyecto, revisión SHA-256 y conflicto optimista |
| `file-resource-repository.mjs` | índice durable, unicidad y deduplicación por hash |
| `file-render-job-repository.mjs` | reserva única y transiciones esperadas de estado |
| `file-blob-storage.mjs` | blobs por clave portable, streaming, límites y SHA-256 |

`server.mjs` selecciona el backend y entrega factories/repositorios a los
servicios. Los métodos de persistencia y sus consumidores HTTP son async de
extremo a extremo.

## Proyectos

Los archivos continúan en:

```text
%LOCALAPPDATA%\DisenadorVideosLocal\projects\<projectId>.json
```

El documento guardado no cambia. La revisión se calcula al leer sobre JSON
canónico y se devuelve en listados, apertura y guardado.

`PUT /api/projects/:id` admite:

```json
{
  "project": {},
  "expectedRevision": "<sha256 opcional>"
}
```

Una revisión obsoleta responde 409 con `PROJECT_REVISION_CONFLICT`. Omitirla
conserva la compatibilidad de la UI vigente.

## Recursos

`resource-library.mjs` conserva validación, compilación de personajes,
normalización de fondos y publicación. El índice durable se delega al
repositorio; la copia bajo `public/assets/library` continúa siendo
materialización regenerable.

La migración legacy no destructiva conserva el orden:

```text
legacy local → biblioteca filesystem vigente → backend futuro
```

Registrar y publicar siguen siendo dos responsabilidades distintas aunque el
servicio las coordine para mantener compatibilidad.

## Jobs

El gestor mantiene procesos, timers y buffers solo en memoria. El repositorio
recibe únicamente el estado público:

- reserva `jobId` con creación exclusiva;
- rechaza duplicados;
- aplica transiciones contra `expectedState`;
- no persiste PID, proceso, timer, ruta de proyecto ni ruta absoluta;
- recupera `queued`/`rendering` como `RENDER_INTERRUPTED`.

Las ubicaciones permanecen:

```text
.local-video/app-jobs
.local-video/app-input
.local-video/work
.local-video/output
```

## FileBlobStorage

P1 incorpora el adaptador filesystem sin conectarlo todavía al pipeline
durable. Admite bytes, stream o archivo fuente y:

- valida claves con `/`, sin `..`, `\`, drive letters o segmentos vacíos;
- limita tamaño mientras transmite;
- calcula/verifica SHA-256;
- rechaza colisiones de una misma key con contenido distinto;
- materializa únicamente dentro del sandbox configurado;
- elimina el temporal si tamaño o hash no coinciden;
- rechaza symlinks en rutas y blobs.

La integración de assets/outputs con un storage remoto pertenece a P5.

## Pruebas

```powershell
npm run storage:test-filesystem
npm run local:test-projects
npm run local:test-library
npm run local:test-render-manager
npm run local:test-server
npm run local:test-retention
```

Casos cubiertos:

- creación, lectura, listado, actualización y eliminación;
- conflicto de revisión;
- registro y deduplicación de recursos;
- reserva duplicada y conflicto de estado;
- recuperación de jobs interrumpidos;
- clave/ruta maliciosa;
- SHA-256 incorrecto en escritura y materialización;
- ausencia de publicación parcial ante corrupción;
- backend desconocido sin fallback.

Evidencia de cierre técnico:

- `npm test`: 19 comandos agregados, 0 fallos;
- `npm run build`: TypeScript y Vite completados;
- `storage:test-filesystem`: 22 casos, 0 fallos;
- render real `p1-filesystem-20260725-g1`: 2 escenas, 12
  verificaciones, determinismo entre dos pasadas;
- duración lógica 13,683333333 s y duración FFprobe 13,7 s;
- H.264/AAC, 1080 × 1920, 30 fps;
- SHA-256 del MP4:
  `bf4084fc6098bda8d5584335d1817842f79fde303e4348e88805adb4490b2bf9`,
  idéntico al corpus P0 `p0-baseline-20260725-g0`.

Los manifiestos no son comparables byte a byte porque incluyen el `jobId` y
evidencia propia de cada ejecución. El artefacto audiovisual final sí coincide
exactamente.

## Límites actuales

- La serialización de mutaciones filesystem protege una instancia del proceso;
  no pretende ser locking distribuido entre varios procesos.
- `FileBlobStorage` todavía no reemplaza las copias administradas de la
  biblioteca ni los outputs del pipeline.
- No existe backend `postgres-s3`.
- No se instalaron dependencias.
- P2 debe construir el bundle portable sobre estos contratos, sin Docker.
