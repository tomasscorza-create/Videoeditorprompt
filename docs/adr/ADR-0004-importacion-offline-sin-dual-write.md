# ADR-0004 — Importación offline en lugar de dual-write permanente

Estado: **propuesto para G0**.

Fecha: 25 de julio de 2026.

## Contexto

Los datos actuales en filesystem son la única fuente real y deben permanecer
recuperables. Escribir indefinidamente a filesystem y PostgreSQL/S3 introduce
fallos parciales, divergencia y una semántica de reparación innecesaria para el
uso local actual.

## Decisión

Migrar mediante importación offline, idempotente y reanudable:

- inventario inmutable y `dry-run` por defecto;
- copia/bundle verificado como entrada, nunca la única copia real;
- blobs dirigidos por hash;
- conflictos de mismo ID con contenido distinto detienen la importación;
- cada ítem registra estado y verificación;
- repetir no duplica objetos ni registros;
- el origen no se borra ni modifica;
- después del cutover existe un solo backend activo;
- cualquier espejo temporal sirve solo para verificación acotada.

## Consecuencias

- el cutover requiere una ventana controlada y un reporte de comparación;
- rollback consiste en volver a seleccionar filesystem intacto;
- no hay consistencia eventual entre dos autoridades;
- la eliminación/archivo del origen queda para una política posterior y
  explícita.

## Alternativas descartadas

- dual-write permanente: agrega reconciliación y estados parciales;
- migración destructiva: elimina rollback y contradice la seguridad requerida;
- sincronizar por `mtime`: no ofrece identidad ni integridad suficiente.
