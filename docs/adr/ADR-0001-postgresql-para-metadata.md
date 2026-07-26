# ADR-0001 — PostgreSQL para metadata durable

Estado: **aceptado en G0; infraestructura P3 y adaptadores P4 implementados**.

Fecha: 25 de julio de 2026.

## Contexto

Proyectos, recursos y estados de jobs requieren revisiones, unicidad,
transiciones atómicas, consultas y una futura ruta remota. Los JSON actuales
deben conservar sus contratos y validarse al escribir y leer. Los binarios no
deben vivir en la base.

## Decisión

Usar PostgreSQL como backend de metadata seleccionable:

- documentos JSON versionados en JSONB;
- IDs y revisiones SHA-256 con restricciones;
- relaciones y estados mediante tablas/migraciones SQL forward-only;
- transacciones para guardar revisiones y transicionar jobs;
- SQL parametrizado, pool limitado y timeouts;
- ninguna ruta absoluta, credencial o blob pesado.

Filesystem permanece como backend válido y con el mismo contrato.

## Consecuencias

- se gana atomicidad y portabilidad hacia servicios administrados;
- aparecen operación, migraciones, backups y disponibilidad como obligaciones;
- el núcleo creativo no importa el driver;
- un ORM no se incorpora mientras SQL parametrizado y migraciones propias sean
  suficientes.

## Alternativas descartadas

- SQLite: útil localmente, pero no demuestra la ruta concurrente/remota elegida;
- documentos en S3: no ofrecen por sí solos transiciones ni revisiones atómicas;
- blobs en PostgreSQL: aumenta costo, backup y acoplamiento sin beneficiar al
  pipeline basado en archivos.
