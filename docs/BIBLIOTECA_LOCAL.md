# Biblioteca local de recursos

La biblioteca local versión 1 permite registrar recursos compatibles y usarlos desde el panel **Recursos**, el Director IA, la validación y el render. Es un registro local dirigido por datos: no agrega una base de datos ni permite ejecutar código desde un recurso.

## Cómo funciona

Hay dos capas separadas:

- La carpeta de datos externa es la fuente durable. Conserva `library-index.json` y los paquetes bajo `assets/backgrounds/`.
- `public/assets/library/` es solo una publicación regenerable que combina los recursos incluidos con los registrados por el usuario. El proyecto editable referencia esta copia para que el compilador y el render consuman exactamente el mismo catálogo que la interfaz.

Ubicación predeterminada en Windows:

```text
%LOCALAPPDATA%\DisenadorVideosLocal\library
├── library-index.json
└── assets\backgrounds\<id-del-fondo>\
```

En macOS se usa `~/Library/Application Support/DisenadorVideosLocal/library`; en Linux, `$XDG_DATA_HOME/disenador-videos-local/library` o `~/.local/share/disenador-videos-local/library`.

Los proyectos editables se guardan aparte para no mezclar documentos de autoría con recursos:

```text
%LOCALAPPDATA%\DisenadorVideosLocal\projects\<projectId>.json
```

Puede cambiarse con `LOCAL_VIDEO_PROJECTS_ROOT`. La escritura es atómica y la API limita IDs, cantidad de escenas y tamaño del documento.

La raíz durable puede cambiarse antes de iniciar la aplicación:

```powershell
$env:LOCAL_VIDEO_LIBRARY_ROOT = "D:\Mi biblioteca de video"
npm run dev
```

`LOCAL_VIDEO_LIBRARY_ROOT` cambia tanto el índice como el almacenamiento durable de imágenes. La publicación bajo `public/assets/library/` sigue siendo una copia local ignorada por Git y puede reconstruirse al iniciar.

Al actualizar desde la versión anterior, el servicio copia automáticamente el índice de `.local-video-library/` y los fondos administrados que encuentre en `public/assets/library/`. No borra el origen durante la migración.

## Agregar un fondo JPG o PNG

En el panel derecho, pulsar **Agregar fondo** y seleccionar una imagen `.jpg`, `.jpeg` o `.png`. El límite es 12 MB; se verifican la firma real del archivo, sus dimensiones y un máximo de 25 megapíxeles.

La imagen se guarda en la carpeta durable externa. Después se publica una copia administrada bajo `public/assets/library/backgrounds/`. FFmpeg la escala y recorta desde el centro para cubrir el lienzo vertical 1080 × 1920 sin deformarla. El sistema genera automáticamente el manifiesto de tres capas requerido por el runtime: la imagen ocupa la capa lejana y las otras dos son transparentes. Así puede usarse de inmediato como fondo estático y conserva compatibilidad con los movimientos de cámara disponibles.

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
- `GET /api/projects`: enumera proyectos editables durables.
- `GET /api/projects/:id`: abre un proyecto.
- `PUT /api/projects/:id`: crea o actualiza un borrador.
- `DELETE /api/projects/:id`: elimina un proyecto confirmado por el usuario.

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
