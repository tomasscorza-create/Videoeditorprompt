# Persistencia P7: cutover local, rollback y operación

Estado al 2026-07-26: implementación técnica terminada y datos locales migrados.
El gate operativo requiere la aprobación humana después de usar la aplicación
personal con el backend nuevo. P8 no está autorizada.

## Backend normal y rollback

El arranque normal usa PostgreSQL para metadata y el bucket S3 privado de
SeaweedFS para blobs:

```powershell
npm run infra:up
npm run db:migrate
npm run dev
```

`npm run local:server` inicia solo la API con el mismo backend. Los alias
`:postgres-s3` son explícitos y equivalentes.

El selector admite únicamente `filesystem` y `postgres-s3`. Si se elige el
segundo y PostgreSQL, las migraciones o el bucket no están disponibles, el
arranque falla con un error estructurado y saneado. Nunca hace fallback
silencioso.

Para volver temporalmente al estado filesystem original:

```powershell
npm run dev:filesystem
# o, solo API:
npm run local:server:filesystem
```

El rollback no modifica PostgreSQL/S3 ni borra el origen. Los cambios creados
después del cutover no se replican automáticamente a filesystem: al elegir el
backend anterior se ve su snapshot previo a P7. Para recuperar los datos nuevos,
volver a `npm run dev`.

No ejecutar `docker compose down -v`: `infra:down` detiene los contenedores sin
eliminar sus volúmenes.

## Diagnóstico

`GET /api/health` informa el backend seleccionado y la salud de PostgreSQL,
migraciones y bucket sin exponer URL de conexión, claves ni secretos. Para
comprobar la infraestructura fuera de la aplicación:

```powershell
npm run infra:health
npm run storage:test-cutover
```

El servicio remoto materializa los paquetes de recursos en un sandbox efímero,
mantiene metadata durable en PostgreSQL y sirve los MP4 directamente desde el
bucket privado, incluido soporte de rangos HTTP.

## Backup lógico

El backup P7 incluye todos los documentos de proyectos, recursos y jobs de
PostgreSQL y todos los objetos administrados por la aplicación bajo `jobs/` y
`sha256/`. Excluye probes de infraestructura y objetos ajenos a esos namespaces.
Cada archivo tiene tamaño y SHA-256; el manifiesto completo tiene fingerprint.

Crear y verificar:

```powershell
npm run storage:backup -- --output=.local-video/persistence-backups/mi-backup
npm run storage:backup:verify -- --backup=.local-video/persistence-backups/mi-backup
```

La salida debe ser una carpeta nueva. El verificador es offline y no modifica
el backup.

## Restauración

Primero verificar y previsualizar:

```powershell
npm run storage:backup:verify -- --backup=<directorio>
npm run storage:restore -- --backup=<directorio> --dry-run
```

Aplicar solo después de revisar el resumen:

```powershell
npm run storage:restore -- --backup=<directorio> --apply
```

La restauración es idempotente: omite identidades cuyo contenido y metadata
coinciden. Rechaza conflictos y corrupción; no sobrescribe registros ni objetos
distintos y no elimina información existente.

## Evidencia del cutover real

Antes de migrar se creó y verificó el bundle filesystem:

- ruta: `.local-video/persistence-bundles/p7-pre-cutover-20260726-0648`;
- fingerprint:
  `4e53516c2b4a61b2ad35a01b2b8dc1535c43e81b5b1715101d279abc1a061cb4`;
- 20 proyectos, 7 recursos, 13 jobs completados, 41 artefactos de jobs,
  61 archivos de recursos y 56.468.501 bytes.

El plan inmutable aplicado fue
`.local-video/persistence-plans/p7-cutover-20260726-0648.json`, fingerprint
`ba57f31769f07a8eb54842dbf53f57afc27dad91dddeedb2472b954905fc8c6a`.
Importó 20 proyectos, 7 recursos, 13 jobs y 96 blobs: 136 ítems, sin fallos. La
segunda aplicación omitió los 136 por coincidencia exacta y la verificación
posterior confirmó los 136.

Después del cutover se creó el backup lógico
`.local-video/persistence-backups/p7-post-cutover-20260726-0650`, fingerprint
`fac51f3d756e37714bee1697b592c4030b92a2957e54fee80ef6aefd4d3a1719`:
20 proyectos, 7 recursos, 13 jobs, 96 objetos y 47.751.696 bytes. Su verificación
offline pasó y un restore dry-run contra el destino vivo omitió los 136 ítems.

PostgreSQL y SeaweedFS fueron reiniciados. Tras el reinicio, la salud confirmó
PostgreSQL 17.10, tres migraciones y bucket accesible; la migración volvió a
verificar los 136 ítems. El filesystem original permanece intacto.

## Pruebas

- `storage:test-cutover`: arranque, escritura, recursos, integridad, reapertura,
  streaming privado, rollback y ausencia de fallback.
- `storage:test-backup`: creación, verificación offline, dry-run, restauración,
  idempotencia y rechazo de corrupción.
- `storage:test-p5-flow`: render H.264/AAC, publicación e hidratación completas.
- `local:test-server` y `local:test-render-manager`: contrato HTTP, recuperación,
  rangos y ciclo de vida.
- `npm test` y `npm run build`: regresión central y compilación.

## Límites

- Es operación local de un solo usuario; no añade autenticación remota, worker
  Linux, TLS administrado, colas distribuidas ni servicios cloud.
- El backup es lógico y explícito; no define todavía retención automática,
  lifecycle ni almacenamiento externo.
- El origen filesystem no se elimina. Cualquier archivo o eliminación futura
  necesita una política separada y aprobada.
- La observación de uso personal durante el período que acuerde el usuario es
  evidencia humana del gate; no se sustituye con tests automáticos.
