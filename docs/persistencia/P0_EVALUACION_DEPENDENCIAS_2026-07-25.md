# P0 — Evaluación previa de dependencias e imágenes

Fecha de consulta: 25 de julio de 2026.

Estado: **propuesta para G0; nada instalado ni descargado**.

Resolución posterior: G0 fue aprobado y P4 instaló exactamente `pg@8.22.0`;
la evaluación del cliente S3 continúa sin ejecutar hasta P5.

Esta evaluación cubre problema, insuficiencia de Node estándar, licencia,
mantenimiento, tamaño/impacto, Windows/Linux, contenedor, riesgos y sustitución.
Las versiones son candidatas exactas observadas en la fecha indicada; no se usan
rangos flotantes como decisión de infraestructura.

## 1. Driver PostgreSQL

Candidato futuro: `pg@8.22.0`.

| Aspecto | Evaluación |
| --- | --- |
| Problema | protocolo PostgreSQL, pool, transacciones y consultas parametrizadas |
| Node estándar | no implementa el protocolo PostgreSQL ni negociación/pooling |
| Licencia | MIT |
| Mantenimiento | publicado el 29-06-2026; repositorio activo |
| Tamaño directo | 95.249 bytes desempaquetados |
| Dependencias directas | 6, más `pg-cloudflare` opcional; `pg-native` no es necesario |
| Compatibilidad | Node >=16; compatible con Node 24 y JavaScript puro en Windows/Linux |
| Contenedor | no requiere `libpq` si se evita `pg-native` |
| Riesgos | pool sin límites, timeouts incorrectos, filtración de DSN, coerción de tipos y SQL no parametrizado |
| Mitigación | un pool acotado, SQL parametrizado, TLS explícito y errores sin DSN |
| Sustitución | otro driver que cumpla el mismo repositorio; SQL/migraciones permanecen fuera del driver |

Decisión propuesta: **aceptar como candidato para P4**, con versión exacta y
lockfile revisado cuando P4 sea autorizado. No instalar en P0/P1.

Fuentes:

- [node-postgres: repositorio, capacidades y licencia](https://github.com/brianc/node-postgres)
- [documentación oficial de pooling](https://node-postgres.com/features/pooling)
- [paquete `pg` en npm](https://www.npmjs.com/package/pg)

## 2. Cliente S3

Candidato futuro: `@aws-sdk/client-s3@3.1095.0`.

| Aspecto | Evaluación |
| --- | --- |
| Problema | firma SigV4, streaming, errores y compatibilidad con API S3 |
| Node estándar | aporta HTTP/streams, pero no SigV4 ni semántica S3 portable |
| Licencia | Apache-2.0 |
| Mantenimiento | publicado el 24-07-2026; repositorio y cadencia activos |
| Tamaño directo | 3.294.062 bytes desempaquetados |
| Dependencias directas | 11 módulos AWS/Smithy |
| Compatibilidad | Node >=20; compatible con Node 24, Windows/Linux |
| Contenedor | JavaScript; no exige binario nativo para las operaciones previstas |
| Riesgos | árbol grande, cadencia alta, retries implícitos, memoria al no usar streams y diferencias entre proveedores |
| Mitigación | cliente bare-bones, versión exacta, streaming, timeouts/límites, retries solo idempotentes y suite S3 contractual |
| Sustitución | otro cliente SigV4 detrás de `BlobStorage`; object keys y contratos no dependen del SDK |

El cliente admite `endpoint` y `forcePathStyle`, necesarios para probar un
servidor S3-compatible local sin cambiar el contrato.

Decisión propuesta: **aceptar como candidato para P5**, condicionado a medir el
impacto transitivo real antes de modificar el lockfile. No instalar en P0/P1.

Fuentes:

- [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3)
- [parámetros oficiales `endpoint` y `forcePathStyle`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-s3/Interface/ClientInputEndpointParameters/)
- [paquete `@aws-sdk/client-s3` en npm](https://www.npmjs.com/package/@aws-sdk/client-s3)

## 3. Imagen PostgreSQL

Candidato futuro:

```text
postgres:17.10-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394
```

| Aspecto | Evaluación |
| --- | --- |
| Problema | base PostgreSQL reproducible para desarrollo local |
| Mantenimiento | Docker Official Image, mantenida por PostgreSQL Docker Community |
| Licencias | empaquetado MIT; PostgreSQL bajo PostgreSQL License; base Debian con licencias propias |
| Tamaño | aproximadamente 149 MB comprimidos en `linux/amd64` |
| Compatibilidad | imagen Linux multi-arquitectura; Docker Desktop cubre host Windows |
| Persistencia | requiere volumen nombrado explícito |
| Riesgos | el tag es mutable, CVE de la base, cambio accidental de `PGDATA`, credenciales de desarrollo y exposición de puerto |
| Mitigación | tag más digest, escaneo en P3, loopback, volumen nombrado, healthcheck y migraciones forward-only |
| Sustitución | otra versión soportada de la imagen oficial después de ejecutar migraciones y pruebas |

El digest es el índice multi-plataforma observado. Debe revalidarse y escanearse
en P3 antes de crear `compose.yaml`; esta evaluación no descarga la imagen.

Decisión propuesta: **candidato aceptable para P3**, sujeto a revisión de CVE en
el momento de uso.

Fuentes:

- [tags soportados de la imagen oficial](https://github.com/docker-library/docs/blob/master/postgres/README.md)
- [imagen `17.10-bookworm` y digest](https://hub.docker.com/layers/library/postgres/17.10-bookworm/images/sha256-eb37f58646a901dc7727cf448cae36daaefaba79de33b5058dab79aa4c04aefb)
- [licencia del empaquetado oficial](https://github.com/docker-library/postgres/blob/master/LICENSE)

## 4. Imagen MinIO

Resultado: **rechazada para una nueva instalación**.

La premisa del plan quedó desactualizada:

- el repositorio comunitario fue archivado el 25-04-2026;
- la edición comunitaria pasó a distribución solo como fuente;
- los binarios históricos ya no reciben mantenimiento;
- la última release publicada pide construir una imagen desde el código fuente;
- la licencia es AGPLv3 o comercial.

Fijar hoy un digest histórico oficial congelaría una imagen sin mantenimiento y
no satisface la exigencia de seguridad/actualización del plan. Construir una
imagen propia agregaría toolchain, mantenimiento y obligaciones que P0 no
autoriza.

Decisión propuesta:

1. mantener `BlobStorage` y el ADR en términos de API S3-compatible;
2. no aprobar una imagen MinIO legacy;
3. antes de P3, evaluar servidores S3-compatible mantenidos y sus licencias;
4. modificar la mención específica a MinIO en P3 solo mediante un gate humano.

Esto no bloquea P1 ni P2 porque ambos son filesystem y no instalan drivers. Sí
bloquea la selección de infraestructura S3 de P3.

Fuentes:

- [repositorio MinIO archivado y distribución source-only](https://github.com/minio/minio)
- [última release y recomendación de construir la imagen](https://github.com/minio/minio/releases)
- [licencia AGPLv3/comercial](https://min.io/docs/minio/linux/reference/minio-mc/mc-license-info.html)

## 5. Resultado para G0

| Candidato | Resultado P0 | Fase más temprana |
| --- | --- | --- |
| `pg@8.22.0` | aceptar para evaluación contractual futura | P4 |
| `@aws-sdk/client-s3@3.1095.0` | aceptar condicionado a impacto transitivo | P5 |
| `postgres:17.10-bookworm@sha256:…` | aceptar condicionado a reescaneo | P3 |
| imagen MinIO legacy | rechazar | no usar |
| servidor S3-compatible local | decisión pendiente | antes de P3 |

No se modificó `package.json`, no se creó lockfile nuevo, no se ejecutó Docker y
no se descargó ninguna imagen.

## 6. Reevaluación autorizada para P3 — 26-07-2026

El gate G2 fue aprobado y el usuario autorizó sustituir MinIO por SeaweedFS
4.40. La elección se basó en:

- release estable publicada el 20-07-2026;
- actividad y releases frecuentes;
- licencia Apache-2.0;
- quickstart oficial S3 en Docker mediante `weed mini`;
- bucket inicializable por configuración;
- imagen multi-arquitectura fijada al digest
  `sha256:52194fba4fecd0083c842158b3a902ba6e04a63619b2b0efcd08007bdb6a4602`.

PostgreSQL 17.10 Bookworm conservó el digest candidato de P0:
`sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394`.

Docker Scout no generó el reescaneo porque requiere autenticación local. No se
agregaron credenciales ni herramientas adicionales. Esta limitación queda
documentada para repetirse antes de exponer la infraestructura fuera de
loopback.
