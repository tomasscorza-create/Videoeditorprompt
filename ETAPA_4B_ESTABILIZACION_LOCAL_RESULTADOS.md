# Etapa 4B — Estabilización operativa del flujo local

## Resultado

Se resolvió el bloque de estabilización posterior a la auditoría del 23 de julio de
2026 sin cambiar el modelo creativo del producto.

## Contención y seguridad

- Limpieza automática de `frames` y `temp` después de completar o cancelar un render.
- Retención manual con dry-run, antigüedad y máximo de bytes.
- API mutante protegida por `Host`, `Origin` y token efímero de sesión.
- Cuerpo JSON limitado, lectura lineal, timeout y validación de `content-type`.
- Una sola inferencia del Director a la vez y cancelación desde la interfaz.

## Recuperación y UX

- Estados abandonados se recuperan como `RENDER_INTERRUPTED`.
- Cancelación del árbol de Node/Piper/FFmpeg y cierre de conexiones al detener la app.
- El Director funciona aunque no exista o falle el proyecto publicado inicial.
- Render deshabilitado hasta tener proyecto, confirmación antes de reemplazar ediciones
  y errores de transporte comprensibles.
- Duración objetivo aproximada visible antes del render.

## Contratos y rendimiento

- Catálogo de autoría validado contra JSON Schema y cacheado por identidad del archivo.
- Una única versión gobierna caché y normalización del Director.
- Corpus de compatibilidad entre validador, editor y compilador.
- Modo interactivo de una pasada para la UI; modo completo de dos pasadas preservado
  como predeterminado para CLI y pruebas.
- Timeout predeterminado para procesos externos sin shell.

## Evidencia

- `npm test`: 13 suites agregadas, todas correctas.
- `npm run build`: TypeScript y Vite correctos.
- Render interactivo `render-20260723053632-08ff2999`:
  - 2 escenas, 13,683333333 s;
  - H.264/AAC, 1080 × 1920, 30 fps;
  - una salida final verificada;
  - 145.807.889 bytes de temporales retirados automáticamente.
- Cancelación real `render-20260723054012-00e998fd`:
  - estado `cancelled`;
  - sin procesos hijos restantes;
  - 35.916.422 bytes retirados.
- Render completo `estabilizacion-full-01`:
  - 2 escenas, 13,683333333 s;
  - 11 controles finales;
  - dos MP4 con SHA-256 idéntico
    `bf4084fc6098bda8d5584335d1817842f79fde303e4348e88805adb4490b2bf9`.
- Dry-run de retención detectó 1.663.042.419 bytes recuperables en trabajos previos,
  sin borrar contenido existente.

## Pendientes deliberados

- El comando de limpieza no se aplicó sobre trabajos históricos del usuario; requiere
  revisión y `--apply`.
- Elegir una licencia general del repositorio sigue siendo decisión del propietario.
- `dist/` no es autónomo: debe servirse junto con la API y el token local.
- La compatibilidad Linux y un backend multiusuario permanecen fuera del alcance.
