# Persistencia PostgreSQL — Fase P4

Estado: **implementada, verificada y aprobada en G4**.

Fecha: 26 de julio de 2026.

## Alcance

P4 implementa repositorios de metadata para PostgreSQL sin mover blobs, importar
datos reales ni cambiar el backend normal de la aplicación. Los contratos async
son los mismos que en filesystem para proyectos, fichas de recursos y estados
de jobs de render.

SeaweedFS continúa siendo solo infraestructura de P3. Assets, WAV, manifiestos y
MP4 permanecen en filesystem hasta P5.

## Dependencia

Se instaló `pg@8.22.0` con versión exacta y lockfile:

| Aspecto | Decisión |
| --- | --- |
| Problema | protocolo PostgreSQL, pool, transacciones y parámetros |
| Alternativa nativa | Node no implementa el protocolo PostgreSQL |
| Licencia | MIT |
| Compatibilidad | Node >=16; el proyecto exige Node ^20.19 o >=22.12 |
| Tamaño directo | 95.249 bytes desempaquetados |
| Impacto | 14 paquetes instalados; 0 vulnerabilidades reportadas por npm |
| Windows/Linux | JavaScript, sin `pg-native` ni `libpq` |
| Riesgos | pools sin límite, esperas indefinidas, SQL inyectado y filtración de DSN |
| Mitigación | pool máximo 5, timeouts acotados, parámetros y errores saneados |
| Sustitución | los contratos no importan `pg`; otro driver puede reemplazarlo |

No se agregó ORM: las tres tablas y consultas acotadas no justifican esa
dependencia ni otra capa de migración.

## Modelo durable

Las migraciones forward-only `0002_metadata.sql` y
`0003_metadata_constraints.sql` crean:

- `local_video.projects`: documento JSONB, revisión SHA-256 y timestamps;
- `local_video.resources`: ficha JSONB, hash de contenido único y fecha de alta;
- `local_video.render_jobs`: estado JSONB, estado/etapa consultables y timestamps.

PostgreSQL verifica IDs portables, hashes, versión, coherencia entre columnas y
JSON, tamaños de proyecto/job, título y cantidad de escenas. La aplicación
vuelve a validar cada documento al escribirlo y al leerlo.

## Atomicidad y concurrencia

- Cada cambio de proyecto toma un bloqueo transaccional por ID, comprueba la
  revisión esperada y actualiza documento/revisión juntos.
- El registro de recursos bloquea ID y hash; IDs diferentes con el mismo
  contenido convergen en una ficha sin duplicarse.
- `jobId` es clave primaria y su reserva concurrente tiene un único ganador.
- Las transiciones usan bloqueo de fila y comparan el estado esperado.
- Un manager nuevo trata PostgreSQL como autoridad: jobs `queued` o `rendering`
  se recuperan como `failed/RENDER_INTERRUPTED`.

Todas las consultas de dominio usan parámetros. Los fallos de conexión se
traducen a códigos estables sin host, contraseña, DSN ni SQL.

## Configuración local

El pool lee:

```text
LOCAL_VIDEO_POSTGRES_HOST=127.0.0.1
LOCAL_VIDEO_POSTGRES_PORT=54329
LOCAL_VIDEO_POSTGRES_DB=local_video
LOCAL_VIDEO_POSTGRES_USER=local_video
LOCAL_VIDEO_POSTGRES_PASSWORD=...
LOCAL_VIDEO_POSTGRES_POOL_MAX=5
```

Los defaults coinciden con Compose y son únicamente de desarrollo. El pool usa
5 conexiones como máximo, 5 s para conectar, 10 s de `statement_timeout`, 12 s
de `query_timeout` y 30 s de idle.

## Operación y evidencia

```powershell
npm run infra:up
npm run db:migrate
npm run storage:test-filesystem
npm run storage:test-postgres
```

La suite `repository-contract-suite.mjs` ejecuta exactamente 24 casos de
metadata contra ambos backends. Cubre CRUD, validación, revisión optimista,
conflictos, deduplicación, filtros y carreras concurrentes.

Evidencia previa a G4:

- filesystem: 24/24 contractuales; 36/36 incluyendo blobs filesystem;
- PostgreSQL: 24/24 contractuales;
- recuperación PostgreSQL: 1/1;
- saneamiento de errores: 1/1;
- rechazo directo por restricción DB: 1/1;
- tres migraciones aplicadas; segunda pasada idempotente.
- suite central: 20/20 comandos;
- build TypeScript/Vite: correcto;
- `npm audit --omit=dev`: 0 vulnerabilidades conocidas.

Se eligió nivel 4 porque P4 cambia arquitectura durable, concurrencia y una
dependencia de runtime. La suite central conserva filesystem como default; la
suite PostgreSQL se ejecuta aparte porque requiere Docker.

## Selección y límites

`filesystem` continúa siendo el backend predeterminado y el único seleccionable
por `LOCAL_VIDEO_PERSISTENCE`. Los repositorios PostgreSQL se usan mediante
inyección explícita en P4; habilitar `postgres-s3` parcialmente sería engañoso
mientras los blobs siguen locales.

Queda fuera:

- adaptador S3 y materialización de assets (implementados después en P5);
- importación filesystem → PostgreSQL/S3 (P6);
- selección normal, cutover, backup y rollback (P7);
- TLS y servicios remotos (P8).

No existe fallback silencioso ni dual-write.
