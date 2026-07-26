# Persistencia P8: preparación para remoto

Estado al 2026-07-26: preparación técnica local implementada. El gate G7 sigue
pendiente hasta ejecutar el probe contra un PostgreSQL y un storage S3
administrados elegidos por el usuario, fijar región, retención y presupuesto, y
aprobar el diseño de autenticación antes de exponer la API.

P8 no convierte el servicio local en una aplicación multiusuario.

## Configuración remota

El perfil se activa con:

```text
LOCAL_VIDEO_DEPLOYMENT=remote
LOCAL_VIDEO_PERSISTENCE=postgres-s3
```

En remoto, PostgreSQL exige `verify-full`. La aplicación usa la confianza CA del
sistema o `LOCAL_VIDEO_POSTGRES_SSL_CA_FILE`. Una URL en
`LOCAL_VIDEO_DATABASE_URL` no puede incluir `sslmode`, para impedir que
sobrescriba la política.

S3 admite los perfiles `aws-s3`, `cloudflare-r2`, `s3-compatible` y
`seaweedfs`. Los endpoints explícitos remotos deben ser HTTPS. AWS S3 puede usar
el proveedor de credenciales ambiental del SDK; el resto puede usar secretos
estáticos.

Contraseñas y claves pueden llegar desde variables o archivos montados:

```text
LOCAL_VIDEO_POSTGRES_PASSWORD_FILE
LOCAL_VIDEO_S3_ACCESS_KEY_FILE
LOCAL_VIDEO_S3_SECRET_KEY_FILE
LOCAL_VIDEO_POSTGRES_SSL_CA_FILE
LOCAL_VIDEO_S3_TLS_CA_FILE
```

Las rutas de secretos deben ser absolutas, su tamaño está limitado y nunca
aparecen en diagnóstico, reportes o errores. Configurar simultáneamente valor y
archivo es un error.

PostgreSQL recomienda `verify-full` para validar CA y hostname en entornos
sensibles: <https://www.postgresql.org/docs/17/libpq-ssl.html>.

## Matriz PostgreSQL

| Destino | Estado | Condiciones |
| --- | --- | --- |
| PostgreSQL 17.10 local | Verificado | Tres migraciones, JSONB, transacciones, conflictos y reservas concurrentes. |
| PostgreSQL 17 administrado, conexión directa | Compatible por contrato; probe externo pendiente | TLS `verify-full`, hostname estable, usuario con permisos sobre `local_video` y backups del proveedor. |
| PostgreSQL detrás de pooler de transacciones | Condicional | Debe conservar transacciones, parámetros preparados y timeouts; ejecutar toda la suite contractual. |
| Otra major soportada por el proveedor | No aprobada todavía | Migrar primero una copia y ejecutar `db:migrate`, contratos, backup y restore. |

Los repositorios no usan extensiones, ORM ni rutas del host. El backup lógico P7
es portable, pero para operación remota debe complementarse con snapshots/PITR
del proveedor. PostgreSQL documenta dumps, backups físicos y archivado continuo:
<https://www.postgresql.org/docs/17/backup.html>.

## Matriz S3

El adaptador necesita `HeadBucket`, `PutObject` condicional con
`If-None-Match: *`, `HeadObject` con metadata, `GetObject` y rangos,
`ListObjectsV2` y `DeleteObject`.

| Destino | Estado | Observaciones |
| --- | --- | --- |
| SeaweedFS 4.40 local | Verificado | Contrato completo, corrupción, concurrencia, rangos y bucket privado. |
| AWS S3 general purpose | Compatible por API; probe externo pendiente | Endpoint administrado, credenciales ambientales preferidas y `forcePathStyle=false`. AWS documenta escrituras condicionales: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html>. |
| Cloudflare R2 Standard | Compatible por API; probe externo pendiente | Endpoint HTTPS, región `auto`/alias y credenciales estáticas montadas. Matriz oficial: <https://developers.cloudflare.com/r2/api/s3/api/>. |
| MinIO u otro S3 compatible | Condicional | Debe probar exactamente las operaciones anteriores y conservar metadata SHA-256. |

No se eligió proveedor ni región. Ningún resultado de SeaweedFS cuenta como
evidencia de red administrada.

## Probe remoto, latencia y transferencia

Ejecutar con el perfil remoto y credenciales del secret manager:

```powershell
npm run storage:probe-remote -- --asset=public/assets/stage1/background.png
```

El probe:

- realiza cinco consultas PostgreSQL y mide latencia;
- informa versión, migraciones y tamaño de DB;
- sube y descarga un asset real;
- verifica tamaño y SHA-256;
- mide latencia y MiB/s;
- inventaría solo namespaces administrados;
- elimina únicamente su clave aleatoria.

Evidencia local del 2026-07-26:

- PostgreSQL 17.10, 3 migraciones y 8.197.811 bytes;
- mediana PostgreSQL 1,153 ms en cinco muestras;
- 96 objetos administrados y 47.751.696 bytes;
- asset real de 10.540 bytes, SHA-256 verificado;
- upload 20,499 ms y download 16,001 ms.

Estas cifras validan el instrumento, no predicen latencia remota.

## Costos, backup y lifecycle

El probe calcula un escenario solo cuando el operador suministra todas las
tarifas:

```powershell
npm run storage:probe-remote -- `
  --database-monthly-usd=<importe> `
  --storage-gb-month-usd=<importe> `
  --egress-gb-usd=<importe> `
  --put-1000-usd=<importe> `
  --get-1000-usd=<importe> `
  --monthly-egress-bytes=<bytes> `
  --monthly-put-operations=<cantidad> `
  --monthly-get-operations=<cantidad>
```

No hay precios codificados porque dependen de proveedor, región, clase y fecha.
Como referencia para comparar, R2 publica almacenamiento, operaciones y egress
en <https://developers.cloudflare.com/r2/pricing/>. Esa referencia no implica
que R2 haya sido elegido.

Política segura hasta decisión humana:

- conservar el filesystem original;
- backup lógico P7 antes y después de cambios de schema;
- verificar offline cada backup y hacer restore drill;
- habilitar versionado/snapshots del proveedor antes de lifecycle;
- no activar expiración automática de `jobs/` ni `sha256/`;
- separar backup de cuenta/región cuando se seleccione proveedor.

Falta decidir RPO/RTO, renders históricos, días de retención y presupuesto
mensual. Por eso no se instaló una regla destructiva.

## Worker Linux

La imagen `deploy/worker/Dockerfile` está fijada por digest, usa filesystem de
solo lectura, usuario sin privilegios y no necesita ingress. El test aplica
límites de CPU, RAM, PIDs, capacidades y temporales.

```powershell
npm run worker:test-portability
npm run worker:test-linux
```

Evidencia:

- Linux amd64, Node 24.14.0 y FFmpeg 5.1.9;
- consulta real a PostgreSQL y materialización desde S3 por SHA-256;
- dos MP4 de prueba binariamente idénticos, H.264/AAC;
- pipeline real Piper → dos escenas → MP4;
- Linux: 15,1 s, 1.835.607 bytes, determinista;
- Windows: 15,0167 s de timeline, 1.814.507 bytes, determinista;
- ambos: 1080 × 1920, H.264, AAC y `yuv420p`.

La diferencia temporal de 0,0833 s proviene de derivados Piper generados en
runtimes distintos. Para igualdad binaria entre workers se deben hidratar los
mismos WAV/cache por hash, no regenerarlos en cada plataforma.

Se corrigieron dos acoplamientos:

- Piper resuelve `venv/Scripts/python.exe` en Windows y `venv/bin/python` en
  Linux, con override `LOCAL_VIDEO_PIPER_PYTHON`;
- subtítulos usan composición alpha portable. FFmpeg 5.1 de Debian sufría
  `SIGSEGV` con `drawbox` RGBA y `replace=1`.

La salida Windows confirmó alpha 183/255 en el recuadro y cero fuera de él.

La imagen instala Piper TTS 1.5.0 (`GPL-3.0-or-later`) y FFmpeg desde Debian.
Su tamaño local medido es 396.033.104 bytes. Node estándar no sustituye TTS ni
codificación multimedia; se usan las mismas herramientas del pipeline, fijadas
en una imagen Linux reproducible. El impacto es exclusivo del worker, funciona
en Docker Desktop/Linux y puede sustituirse por otra imagen que respete los
mismos contratos. Antes de distribuirla comercialmente deben conservarse
avisos/código fuente aplicable y cumplirse las obligaciones GPL; el runtime no
se incorpora al frontend. Las dependencias Python están fijadas en
`deploy/worker/requirements.lock`; su metadata declara Apache-2.0 para
FlatBuffers, MIT para ONNX Runtime/pathvalidate y BSD-3-Clause para Protobuf
(NumPy y Packaging conservan sus licencias dentro de la distribución). No se
añadieron dependencias npm.

## Separación de despliegue

Los artefactos y procesos quedan separados:

| Componente | Comando/artefacto | Red y secretos |
| --- | --- | --- |
| Frontend | `npm run deploy:frontend` → `dist/` | Estático; no contiene credenciales de DB/S3. |
| API | `npm run deploy:api` | Sigue limitada a loopback y conserva el token local. |
| Worker | `deploy/worker/Dockerfile` | Sin ingress; accede a DB/S3 y TTS mediante secretos/mounts. |

La API todavía lanza el render interactivo local. Conectar API y workers
distribuidos mediante una cola/lease durable pertenece al gate multiusuario, no
se simuló en P8.

## Diseño de autenticación previo a exposición

El token efímero actual sirve solo para loopback. Una API remota debe permanecer
cerrada hasta implementar:

1. TLS terminado por un proxy administrado.
2. OIDC Authorization Code + PKCE para el frontend.
3. JWT de corta duración con issuer, audience, expiración y scopes validados.
4. Ownership de proyectos, recursos, jobs y blobs.
5. Identidades separadas y de mínimo privilegio para API, worker y backups.
6. Rate limits, cuotas, auditoría y protección CSRF/CORS.

No se añadió un modo inseguro para escuchar públicamente.

## Gate G7

La implementación local está lista para ser ejecutada contra el proveedor
elegido. G7 requiere todavía:

- escoger PostgreSQL, S3, región y presupuesto;
- ejecutar `storage:probe-remote`, contratos, backup y restore en esos servicios;
- decidir retención y lifecycle;
- aprobar/implementar autenticación antes de exposición;
- definir demanda real o grupo piloto.
