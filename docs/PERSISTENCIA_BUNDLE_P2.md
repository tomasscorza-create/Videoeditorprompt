# Bundle portable de datos — Fase P2

Estado: **implementada y verificada técnicamente; gate G2 pendiente**.

Fecha: 25 de julio de 2026.

## Alcance

P2 describe y transporta el estado durable actual sin Docker, base de datos ni
storage remoto. El origen se recorre en modo lectura y nunca se elimina o
modifica.

Comandos:

```powershell
npm run storage:inventory
npm run storage:export -- --output=<directorio-nuevo>
npm run storage:verify -- --bundle=<directorio>
```

Las raíces pueden sustituirse para pruebas u operación especial mediante
`--projects-root`, `--library-root`, `--jobs-root` y `--output-root`.

## Contrato

`schema/local-data-bundle.schema.json` define un manifiesto v1 con:

- fingerprint SHA-256 determinista;
- política de inclusión y exclusión explícita;
- resumen de conteos y bytes;
- entradas ordenadas por ruta;
- rol, tamaño y SHA-256 de cada archivo;
- revisión canónica de cada proyecto;
- relación entre jobs y artefactos.

El bundle contiene:

```text
manifest.json
projects/<projectId>.json
resources/library-index.json
resources/assets/<tipo>/<resourceId>/...
jobs/<jobId>/job.json
jobs/<jobId>/artifacts/...
```

No contiene rutas del host. Los mismos bytes de origen producen el mismo
manifiesto y el mismo árbol de archivos.

## Política de jobs y datos

Se incluyen:

- proyectos editables durables;
- registro de biblioteca y paquetes de assets durables;
- jobs en estado `completed` cuyo directorio de output todavía existe;
- todos los archivos finales de esos outputs, incluidos manifiestos,
  verificaciones y MP4.

Se excluyen:

- `app-input`;
- cachés;
- frames;
- publicación regenerable de biblioteca;
- temporales;
- `.work` de la biblioteca y `.local-video/work`;
- jobs fallidos, cancelados, interrumpidos o sin artefactos conservados.

Esta política interpreta «no eliminado» como la presencia verificable de al
menos un artefacto final. No migra estados cuyo resultado ya fue retenido o
eliminado.

## Exportación segura

- La salida debe ser nueva y estar fuera de todas las raíces de origen.
- Cada copia se vuelve a medir y hashear.
- El staging completo se verifica antes de publicarse.
- Si Windows bloquea transitoriamente el rename del directorio, se usa una
  copia final controlada, se verifica nuevamente y se elimina ante fallo.
- Symlinks, traversal, claves no portables y rutas absolutas se rechazan.
- El hashing usa streaming para no cargar videos completos en memoria.

## Verificación

`storage:verify` es de solo lectura y comprueba:

- JSON Schema del manifiesto;
- fingerprint, orden y unicidad;
- conjunto exacto de archivos, sin faltantes ni extras;
- tamaño y SHA-256 de cada archivo;
- JSON válido y ausencia de rutas absolutas;
- revisiones de proyectos;
- referencias del registro hacia assets administrados;
- jobs completados con al menos un artefacto;
- resumen de conteos y bytes.

## Pruebas

`npm run storage:test-bundle` cubre 21 casos:

- bundle vacío;
- bundle parcial válido;
- bundle completo;
- exportación repetida byte a byte;
- origen sin modificaciones;
- exclusión de `.work` y jobs fallidos;
- salida preexistente;
- archivo corrupto, faltante y extra;
- ruta absoluta dentro de un documento;
- referencias, conteos, tamaños y hashes.

Evidencia real de P2:

- `npm test`: 20 comandos agregados, 0 fallos;
- `npm run build`: TypeScript y Vite completados;
- `storage:test-bundle`: 21 casos, 0 fallos;

| Métrica | Resultado |
| --- | ---: |
| Proyectos | 19 |
| Recursos registrados | 7 |
| Archivos de recursos | 61 |
| Jobs completados con outputs | 12 |
| Artefactos finales | 38 |
| Total de archivos | 131 |
| Total de bytes | 50.722.998 |
| Fingerprint | `40c1ad5669463f7a75084f908e09c026c8780356dded8652733287beeed43d5b` |

El bundle regenerable usado como evidencia vive bajo
`.local-video/persistence-bundles/p2-g2-20260725` y no se versiona.

## Límites

- P2 exporta, pero todavía no importa ni aplica un bundle.
- No implementa reanudación de migración, rollback ni cutover.
- No incorpora PostgreSQL, S3-compatible, Docker o drivers.
- Un cambio real del origen cambia correctamente el fingerprint.
- La consistencia es una instantánea optimista: si un archivo cambia durante
  la copia, la exportación falla sin publicar un bundle válido.
