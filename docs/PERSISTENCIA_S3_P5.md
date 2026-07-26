# Persistencia S3-compatible — Fase P5

Estado: **implementada y verificada técnicamente; gate G5 pendiente**.

Fecha: 26 de julio de 2026.

## Alcance

P5 implementa blobs durables sobre la API S3 privada de SeaweedFS y conserva un
sandbox filesystem para Piper, FFmpeg, catálogo y editor. No importa datos
existentes, no activa `postgres-s3` como backend normal y no modifica el origen
filesystem.

Capacidades:

- `S3BlobStorage` equivalente al adaptador filesystem;
- upload y download por streams con límites y SHA-256;
- materialización atómica dentro de un sandbox controlado;
- publicación de manifiesto y MP4 después del éxito del pipeline;
- metadata de artefactos persistida en el documento del job PostgreSQL;
- reproducción completa y por rangos desde un bucket privado mediante la API;
- reporte de objetos huérfanos sin borrado automático.

## Dependencias

Se instalaron versiones exactas:

| Paquete | Versión | Licencia | Uso |
| --- | --- | --- | --- |
| `@aws-sdk/client-s3` | 3.1095.0 | Apache-2.0 | SigV4 y operaciones S3 |
| `@smithy/node-http-handler` | 4.9.11 | Apache-2.0 | sockets y timeouts explícitos |

El cliente S3 directo ocupa 3.294.062 bytes desempaquetados y exige Node >=20.
El handler ocupa 104.875 bytes y exige Node >=18. La instalación agregó 26
paquetes y `npm audit` no reportó vulnerabilidades conocidas.

Node estándar aporta HTTP y streams, pero no SigV4 ni la semántica S3. No se
instaló `@aws-sdk/lib-storage`: P5 limita cada blob, lo prepara en un temporal
seguro y lo sube como stream con `Content-Length`, sin multipart ni buffers
completos en memoria.

La sustitución futura permanece detrás de `BlobStorage`; las claves y metadata
no dependen de SeaweedFS ni del SDK.

## Cliente y límites

Configuración:

```text
LOCAL_VIDEO_S3_ENDPOINT=http://127.0.0.1:8333
LOCAL_VIDEO_S3_BUCKET=local-video-private
LOCAL_VIDEO_S3_ACCESS_KEY=...
LOCAL_VIDEO_S3_SECRET_KEY=...
LOCAL_VIDEO_S3_REGION=us-east-1
LOCAL_VIDEO_S3_MAX_SOCKETS=8
```

El cliente usa `forcePathStyle`, dos intentos como máximo, 8 sockets, 5 s para
conectar y 120 s para request/socket. Los errores se convierten a códigos
estables sin endpoint, claves ni respuesta externa completa.

El bucket sigue privado. La API local es la única frontera de reproducción y
descarga; no se generan URLs públicas ni presignadas.

## Integridad y atomicidad

### Upload

1. La entrada se consume por stream hacia un temporal bajo `.s3-upload`.
2. Se imponen tamaño máximo y SHA-256 durante la escritura.
3. Se comprueba conflicto/idempotencia contra metadata remota.
4. `PutObject` envía stream, tamaño, MIME y SHA-256.
5. `HeadObject` confirma tamaño y hash.
6. Solo entonces se devuelve metadata registrable.

### Descarga y materialización

1. Se valida object key y destino bajo la raíz permitida.
2. `GetObject` se consume completamente hacia un archivo temporal.
3. Se comparan tamaño, hash remoto y hash esperado.
4. El archivo aparece en el sandbox solo mediante rename final.
5. Un conjunto de recursos se prepara en una carpeta temporal y se publica
   completo; cualquier fallo elimina ese conjunto parcial.

FFmpeg y Piper reciben archivos locales, nunca URLs S3.

### Artefactos de render

El manager publica:

```text
jobs/<jobId>/artifacts/project-manifest.json
jobs/<jobId>/artifacts/render-1.mp4
```

El pipeline ya verificó el resultado antes de salir correctamente. El job pasa
a `completed` con `result.artifacts` únicamente después de confirmar ambos
objetos. Si falla el segundo upload, el primero se reporta como huérfano y no se
borra automáticamente. Una tarea posterior podrá inventariar huérfanos antes de
adoptar una política destructiva.

La ruta `/api/render-jobs/<jobId>/video` abre el objeto privado desde el servidor
y admite rangos HTTP. Si no se inyecta blob storage, conserva exactamente el
flujo filesystem anterior.

## Suites y evidencia

Comandos:

```powershell
npm run storage:test-filesystem
npm run storage:test-s3
npm run storage:test-p5-flow
```

Evidencia previa a G5:

- contrato BlobStorage idéntico: filesystem 18/18, S3 18/18;
- corrupción remota rechazada sin archivo final;
- materialización de conjunto atómica;
- acceso anónimo al bucket bloqueado;
- configuración peligrosa rechazada y errores sin credenciales;
- flujo PostgreSQL → hidratación S3 → render verificado → upload → job
  PostgreSQL → streaming privado: 13/13;
- MP4 sintético comprobado por FFprobe con H.264/AAC;
- reproducción completa y rango de 16 bytes desde S3;
- huérfano detectado y reportado, con 0 borrados automáticos.
- reinicio de PostgreSQL/SeaweedFS: tres migraciones y probe S3 conservaron
  estado; SHA-256 `e4811097927615532d6e1759fcf0d8b5b5dfb6426b7883cd570f9cb50ec99642`.
- suite central: 20/20 comandos;
- build TypeScript/Vite: correcto;
- `npm audit --omit=dev`: 0 vulnerabilidades conocidas.

La suite S3 queda fuera de `npm test` porque requiere Docker. La suite central
continúa siendo reproducible sin infraestructura opcional.

Se eligió nivel 4 porque cambian almacenamiento durable, entrega del MP4 y dos
dependencias de runtime.

## Límites

- `filesystem` sigue siendo el único valor operativo de
  `LOCAL_VIDEO_PERSISTENCE`.
- P5 no importa la biblioteca ni outputs existentes.
- No hay dual-write ni fallback silencioso.
- No se implementan multipart uploads; el límite vigente es 1 GiB por blob.
- El inventario/reconciliación de huérfanos todavía no borra objetos.
- Backup, cutover y rollback pertenecen a P7.
- TLS y proveedores remotos pertenecen a P8.
