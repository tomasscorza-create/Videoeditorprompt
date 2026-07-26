# Persistencia portable P6 — importador filesystem → PostgreSQL/S3

## Resultado

P6 incorpora un importador explícito, idempotente y auditable. Reutiliza el
inventario validado de P2, escribe metadata mediante los repositorios
PostgreSQL de P4 y almacena binarios mediante el `BlobStorage` S3 de P5.

Esta fase no cambia el backend normal de la aplicación: `filesystem` continúa
siendo la autoridad operativa. Tampoco elimina, mueve ni modifica el origen.

## Operación segura

La primera migración de datos personales debe ejecutarse desde una copia de las
raíces durables, nunca desde su única copia.

```powershell
# Solo inspecciona y emite el plan por stdout.
npm run storage:migrate -- --dry-run

# Crea un plan nuevo. Rechaza sobrescribir uno existente.
npm run storage:migrate -- --plan=.local-video/persistence-plans/migracion-01.json

# Consume el plan inmutable y requiere confirmación explícita mediante --apply.
npm run storage:migrate -- --plan=.local-video/persistence-plans/migracion-01.json --apply

# Compara nuevamente origen, plan, PostgreSQL y cada objeto S3.
npm run storage:migrate -- --plan=.local-video/persistence-plans/migracion-01.json --verify
```

Las cuatro raíces pueden sustituirse con `--projects-root`,
`--library-root`, `--jobs-root` y `--output-root`. El plan no puede contener ni
estar contenido por una de esas raíces.

`--dry-run` no abre conexiones PostgreSQL/S3. Crear un plan tampoco escribe en
el destino. `--apply` es la única operación que importa.

## Contrato del plan

`schema/storage-migration-plan.schema.json` define un JSON v1 con:

- timestamp ISO, versión y formato;
- fingerprint del inventario P2 de origen;
- política fija `PostgreSQL + S3` y claves `sha256-v1`;
- metadata esperada por proyecto, recurso y job;
- blobs únicos dirigidos por contenido;
- acción inicial `planned` para cada destino;
- fingerprint canónico del plan completo.

El plan no contiene raíces absolutas, credenciales ni DSN. Sus ítems están
ordenados y sus destinos son únicos. Cambiar el JSON sin recalcular el
fingerprint se rechaza.

Las claves de objetos siguen:

```text
sha256/<primeros-2-hex>/<sha256-completo>
```

Así, dos archivos idénticos comparten un objeto. La metadata de recursos y jobs
conserva `role`, ruta relativa de materialización, clave, tamaño, SHA-256 y MIME
en `blobStorage`. El campo es opcional y retrocompatible en el registro local
v1; no altera `contentHash`, que sigue representando la identidad semántica del
recurso.

## Apply e idempotencia

Antes de cualquier escritura, el importador:

1. repite el inventario P2;
2. valida proyectos, registro de recursos y jobs completados;
3. compara el fingerprint del origen y la transformación de todos los ítems con
   el plan;
4. inspecciona todos los IDs, documentos y blobs de destino;
5. detiene la operación completa ante cualquier conflicto.

Después sube blobs, verifica tamaño/SHA-256 y recién entonces inserta metadata.
Los proyectos usan inserción exclusiva; nunca se actualiza un proyecto
preexistente. Recursos y jobs conservan sus restricciones transaccionales y de
reserva.

Una repetición solo marca `skipped` cuando coinciden:

- ID y documento canónico para metadata;
- clave, tamaño y SHA-256 para blobs.

El reporte JSON enumera cada destino como `planned`, `skipped`, `imported`,
`verified` o `failed`. Si una falla posterior deja objetos ya importados sin
metadata, estos permanecen visibles como `imported` en el reporte; no se borran
automáticamente.

## Cobertura y evidencia

Prueba específica:

```powershell
npm run storage:test-migration
```

Evidencia de P6:

- PostgreSQL/S3 reales, no mocks: 14 controles;
- origen vacío: plan, apply y verify;
- origen parcial: proyecto solamente y plan exclusivo;
- origen completo: proyecto, recurso con asset y job con artefacto;
- segunda aplicación: `0 imported`, todos los destinos `skipped`;
- verificación completa: todos los destinos `verified`;
- cambio del origen después del plan rechazado antes de escribir;
- mismo ID con metadata diferente rechazado sin sobrescribir;
- manipulación del plan rechazada por fingerprint;
- contratos PostgreSQL: 27/27;
- bundle P2: 21/21;
- biblioteca local: 57/57;
- `npm test`: suite central completa;
- `npm run build`: correcto.

## Límites y gate

- No se ejecutó el importador sobre la única copia real de datos del usuario.
- La aplicación todavía no selecciona `postgres-s3` como backend normal.
- No hay cutover, rollback operativo, backups ni restauración de P7.
- No existe limpieza remota automática.
- Solo se importan los datos admitidos por P2: proyectos válidos, recursos
  durables y jobs `completed` con outputs finales; cachés, temporales y
  publicaciones regenerables quedan fuera.

P6 termina aquí. El gate humano debe aprobar esta evidencia antes de iniciar P7.
