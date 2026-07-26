# ADR-0002 — Storage S3-compatible para blobs

Estado: **aceptado en G0; infraestructura P3 y adaptador S3 P5 implementados**.

Fecha: 25 de julio de 2026.

## Contexto

PNG, JPG, WAV persistentes, rigs, manifiestos y MP4 necesitan integridad,
streaming, claves portables y una ruta de filesystem local a storage remoto. No
deben almacenarse en PostgreSQL ni exponerse como públicos.

## Decisión

Definir `BlobStorage` contra semántica S3-compatible:

- bucket privado;
- object keys relativas con `/`, IDs validados y SHA-256;
- metadata de tamaño, MIME y hash en PostgreSQL;
- upload/download por stream;
- verificación antes de publicar metadata;
- API local como única frontera de descarga;
- implementación filesystem equivalente para desarrollo y rollback.

La decisión fija el protocolo/contrato, no un servidor concreto. MinIO no queda
aprobado: su edición comunitaria fue archivada y pasó a distribución source-only
en 2026. El servidor local debe seleccionarse mediante evaluación separada antes
de P3.

Para P3 se seleccionó SeaweedFS 4.40:

- release estable y mantenida;
- licencia Apache-2.0;
- modo mononodo `weed mini` con API S3 y bucket precreado;
- imagen fijada por tag y digest multi-arquitectura;
- uso limitado a infraestructura local; el contrato no adopta APIs propias de
  SeaweedFS.

El usuario aprobó explícitamente esta sustitución el 26-07-2026.

## Consecuencias

- el mismo adaptador puede apuntar a un servidor local o proveedor remoto;
- se requieren políticas de objetos huérfanos, retries y consistencia;
- FFmpeg y Piper nunca reciben URLs S3;
- cambiar de proveedor no cambia IDs, object keys ni el núcleo.

## Alternativas descartadas

- URLs públicas persistentes: exponen datos y mezclan identidad con entrega;
- blobs PostgreSQL: empeoran tamaño de base y backups;
- API específica de un proveedor: rompe sustitución y rollback.
