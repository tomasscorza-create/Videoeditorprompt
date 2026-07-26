# Operación local segura

## Arranque

`npm run dev` inicia la API en `127.0.0.1:4174` y Vite en `127.0.0.1:5173`. El proceso
padre genera un token de sesión efímero y lo entrega a ambos componentes sin escribirlo
en archivos ni logs. Las operaciones mutantes exigen token, `Origin` y `Host` locales.

El build `dist/` no es una aplicación autónoma: debe servirse junto con la API local y
su token de sesión. Para desarrollo y uso personal, usar siempre `npm run dev`.

El backend de persistencia predeterminado es `filesystem`. Puede fijarse de forma
explícita:

```powershell
$env:LOCAL_VIDEO_PERSISTENCE = "filesystem"
npm run dev
```

No hay backend remoto instalado. Cualquier otro valor detiene el arranque con
`PERSISTENCE_BACKEND_UNSUPPORTED`; nunca se degrada silenciosamente a filesystem.

## Bundle portable

El estado durable puede inventariarse y copiarse sin modificar el origen:

```powershell
npm run storage:inventory
npm run storage:export -- --output=<directorio-nuevo>
npm run storage:verify -- --bundle=<directorio>
```

La salida debe ser una carpeta nueva y externa a las raíces durables. La
política exacta de inclusión, exclusión y verificación está documentada en
`docs/PERSISTENCIA_BUNDLE_P2.md`.

## Infraestructura local

PostgreSQL y SeaweedFS son opcionales y todavía no reemplazan filesystem:

```powershell
npm run infra:up
npm run db:migrate
npm run infra:health
npm run infra:down
```

Los puertos se publican solo en loopback. `infra:down` conserva los volúmenes;
no agregar `--volumes` salvo una decisión destructiva explícita. Configuración,
credenciales de desarrollo y evidencia están en
`docs/INFRAESTRUCTURA_LOCAL_P3.md`.

## Render y recuperación

La interfaz usa verificación `interactive`: produce una pasada por escena y valida
formato, dimensiones, fps y duración. La CLI conserva por defecto la verificación
`full`, con dos pasadas y comparación binaria.

Al reiniciar la API, los estados que quedaron `queued` o `rendering` se marcan como
`RENDER_INTERRUPTED`. Cerrar `npm run dev` cancela el render activo y termina su árbol de
procesos. Los resultados completados permanecen en `.local-video/output/<jobId>`.

## Limpieza y retención

Después de un render interactivo terminado se eliminan automáticamente solo directorios
regenerables llamados `frames` y `temp` dentro de su trabajo. Al arrancar, el servicio
también reconoce estados terminales escritos por pipelines CLI y limpia sus intermedios.
Se conservan configuración, runtime, audio derivado, métricas, estados, manifiestos y MP4.

Inspección sin borrar:

```powershell
npm run local:clean
```

Aplicar limpieza de temporales y retirar trabajos de la app mayores a 30 días:

```powershell
npm run local:clean -- --apply --max-age-days=30
```

También se puede imponer un máximo total de `work/` expresado en bytes:

```powershell
npm run local:clean -- --apply --max-age-days=30 --max-bytes=10737418240
```

El comando protege trabajos `queued` o `rendering`, valida cada `jobId`, rechaza rutas
fuera de `.local-video` y nunca usa enlaces simbólicos como objetivos. Antes de usar
`--apply`, revisar siempre la salida del modo de inspección.
