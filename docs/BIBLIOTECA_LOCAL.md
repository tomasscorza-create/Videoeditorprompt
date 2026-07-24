# Biblioteca local de recursos

La biblioteca local versión 1 permite registrar recursos compatibles y usarlos desde el panel **Recursos**, el Director IA, la validación y el render. Es un registro local dirigido por datos: no agrega una base de datos ni permite ejecutar código desde un recurso.

## Cómo funciona

Hay dos capas separadas:

- `.local-video-library/library-index.json` es el registro durable. Conserva el descriptor, su fecha de alta y un hash del contenido.
- `public/assets/library/authoring-resources.json` es una publicación regenerable que combina los recursos incluidos con los registrados por el usuario. El proyecto editable referencia esta ruta para que el compilador y el render consuman exactamente el mismo catálogo que la interfaz.

La raíz durable puede cambiarse antes de iniciar la aplicación:

```powershell
$env:LOCAL_VIDEO_LIBRARY_ROOT = "D:\Mi biblioteca de video"
npm run dev
```

La publicación bajo `public/assets/library/` y la raíz predeterminada son datos locales ignorados por Git.

## Agregar un fondo JPG o PNG

En el panel derecho, pulsar **Agregar fondo** y seleccionar una imagen `.jpg`, `.jpeg` o `.png`. El límite es 12 MB; se verifican la firma real del archivo, sus dimensiones y un máximo de 25 megapíxeles.

La imagen se copia a una carpeta administrada bajo `public/assets/library/backgrounds/`. Si no mide 1080 × 1920, FFmpeg la escala y recorta desde el centro para cubrir el lienzo vertical sin deformarla. El sistema genera automáticamente el manifiesto de tres capas requerido por el runtime: la imagen ocupa la capa lejana y las otras dos son transparentes. Así puede usarse de inmediato como fondo estático y conserva compatibilidad con los movimientos de cámara disponibles.

El nombre visible se obtiene del archivo. Como la interfaz todavía no pide licencia, el recurso queda marcado como **Licencia no declarada; uso local**. Esa información debe completarse antes de distribuir o monetizar el video.

La API técnica sigue permitiendo registrar fichas JSON compatibles de personajes, fondos, voces e imágenes cuando sus archivos ya están instalados bajo `public/`; la interfaz no expone ese flujo avanzado.

Antes de persistir, el servicio:

1. valida el contrato y las referencias bajo la raíz permitida;
2. inspecciona el contenido JPG/PNG y normaliza el lienzo cuando corresponde;
3. rechaza conflictos de ID;
4. evita duplicados mediante el hash del archivo;
5. escribe el índice y el catálogo publicado de forma atómica.

Después del alta, la interfaz se recarga y vuelve a validar la sesión contra el catálogo ampliado.

## API loopback

- `GET /api/library/resources`: lista recursos incluidos y locales con procedencia y hash.
- `GET /api/library/catalog`: devuelve la ruta publicada y el catálogo activo.
- `POST /api/library/resources`: registra `{ "entry": recurso }`; requiere origen permitido y token de sesión local.
- `POST /api/library/backgrounds`: recibe bytes `image/png` o `image/jpeg` y crea un fondo administrado.

La API conserva los límites y defensas del servicio local. No es un backend remoto ni multiusuario.

## Límites actuales

- No hay eliminación o modificación desde la interfaz.
- Solo se importan imágenes estáticas como fondos. Los personajes animables continúan usando rigs y manifiestos compilados.
- No hay importación general de paquetes ni generación de recursos con IA.
- No hay base de datos, sincronización remota, cuentas ni almacenamiento compartido.
- El runtime actual solo puede renderizar el subconjunto de personajes, fondos, voces y capacidades ya soportado por los contratos vigentes.

Prueba específica:

```powershell
npm run local:test-library
```
