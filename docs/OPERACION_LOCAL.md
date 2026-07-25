# Operación local segura

## Arranque

`npm run dev` inicia la API en `127.0.0.1:4174` y Vite en `127.0.0.1:5173`. El proceso
padre genera un token de sesión efímero y lo entrega a ambos componentes sin escribirlo
en archivos ni logs. Las operaciones mutantes exigen token, `Origin` y `Host` locales.

El build `dist/` no es una aplicación autónoma: debe servirse junto con la API local y
su token de sesión. Para desarrollo y uso personal, usar siempre `npm run dev`.

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
