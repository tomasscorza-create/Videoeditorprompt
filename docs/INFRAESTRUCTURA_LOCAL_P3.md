# Infraestructura local — Fase P3

Estado: **implementada, verificada y aprobada en G3**.

Fecha: 26 de julio de 2026.

## Alcance

P3 incorpora infraestructura reproducible para desarrollo, sin conectar aún la
aplicación a PostgreSQL o S3. El backend operativo de la aplicación continúa
siendo `filesystem`.

Servicios:

| Servicio | Versión | Licencia | Uso |
| --- | --- | --- | --- |
| PostgreSQL | 17.10 Bookworm | PostgreSQL License; empaquetado MIT | metadata futura |
| SeaweedFS | 4.40 | Apache-2.0 | API S3-compatible local |

MinIO no se usa porque su distribución comunitaria histórica quedó archivada.
SeaweedFS 4.40 fue aprobado explícitamente por el usuario como sustituto antes
de implementar P3.

## Imágenes fijadas

```text
postgres:17.10-bookworm
sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394

chrislusf/seaweedfs:4.40
sha256:52194fba4fecd0083c842158b3a902ba6e04a63619b2b0efcd08007bdb6a4602
```

Los digests de los índices multi-arquitectura se comprobaron mediante Docker
Buildx y Docker Hub el 26-07-2026. Para `linux/amd64`, Docker resolvió las
variantes correspondientes sin usar tags flotantes.

Docker Scout 1.20.3 se intentó ejecutar sobre ambas imágenes, pero la
instalación local exige autenticación con Docker ID y no produjo un informe.
No se agregaron credenciales ni un scanner transitorio. El riesgo queda acotado
a servicios de desarrollo expuestos solo en loopback y debe repetirse el
escaneo autenticado antes de otro entorno.

## Configuración

Copiar `.env.example` a `.env` solo cuando sea necesario cambiar defaults:

```powershell
Copy-Item .env.example .env
```

`.env` está ignorado por Git. Los valores del ejemplo son placeholders y los
defaults de Compose están marcados como desarrollo local. No reutilizarlos en
redes compartidas o despliegues remotos.

Puertos predeterminados:

- PostgreSQL: `127.0.0.1:54329`;
- S3: `127.0.0.1:8333`.

Solo esos dos puertos se publican. Las interfaces administrativas de SeaweedFS
permanecen dentro de la red de Compose.

## Operación

```powershell
npm run infra:up
npm run db:migrate
npm run infra:health
npm run infra:down
```

`infra:up` espera los healthchecks. `infra:down` elimina contenedores y red,
pero no incluye `--volumes` y conserva:

```text
local-video-infra_local_video_postgres_data
local-video-infra_local_video_seaweed_data
```

No existe un comando normal de reset destructivo.

## Migraciones

Las migraciones viven en `infra/postgres/migrations` y usan nombre:

```text
NNNN_nombre_portable.sql
```

`db:migrate`:

- crea el ledger `public.local_video_schema_migrations`;
- aplica archivos en orden estable dentro de transacciones;
- guarda SHA-256 de cada migración;
- salta versiones ya aplicadas con el mismo hash;
- rechaza versiones duplicadas o una migración histórica modificada;
- no requiere instalar un driver Node.

P3 creó únicamente el esquema `local_video`. P4 agregó después las tablas de
proyectos, recursos y jobs mediante migraciones nuevas, sin reescribir la
migración histórica.

## Salud y persistencia

`infra:health` comprueba:

- ambos servicios ejecutándose;
- consulta real a PostgreSQL;
- existencia del ledger y cantidad de migraciones;
- petición SigV4 real `HEAD` al bucket privado.

La firma S3 de esta prueba usa `node:crypto`; no es el adaptador de producción
de P5.

Evidencia ejecutada:

- `infra:test-config`: 11 casos, 0 fallos;
- primera migración: 1 aplicada;
- segunda ejecución: 0 aplicadas y 1 omitida;
- PostgreSQL reportó `17.10`;
- bucket privado `local-video-private` accesible mediante SigV4;
- probe S3:
  `e4811097927615532d6e1759fcf0d8b5b5dfb6426b7883cd570f9cb50ec99642`;
- `docker compose restart`: DB y objeto conservados;
- `infra:down` seguido de `infra:up`: ambos volúmenes, DB y objeto conservados.

## Límites al cierre de P3

- La aplicación todavía no leía ni escribía PostgreSQL/SeaweedFS.
- No se había instalado `pg` ni AWS SDK.

P4 instaló luego `pg` y los repositorios de metadata; SeaweedFS continúa sin
adaptador hasta P5.
- No existen tablas de dominio ni importador.
- No se validó aún un worker Linux separado.
- Las credenciales por defecto son únicamente para desarrollo local.
- Un cambio de digest requiere nueva revisión de mantenimiento, licencia,
  vulnerabilidades y persistencia.
