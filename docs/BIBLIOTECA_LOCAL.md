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

## Registrar un recurso

En el panel derecho, pulsar **Agregar recurso** y seleccionar una ficha JSON que cumpla `schema/authoring-resource-catalog.schema.json`. Puede ser la entrada directamente o un objeto `{ "entry": ... }`.

La versión 1 registra fichas compatibles de personajes, fondos, voces e imágenes. Para personajes, fondos e imágenes, los archivos referenciados deben estar instalados previamente bajo `public/` y usar rutas relativas portables. Las voces deben corresponder a un modelo Piper disponible en el runtime local. Registrar una ficha no descarga, copia ni genera esos archivos.

Antes de persistir, el servicio:

1. valida el contrato y las referencias bajo la raíz permitida;
2. rechaza conflictos de ID;
3. evita duplicados mediante un hash de la identidad del recurso;
4. escribe el índice y el catálogo publicado de forma atómica.

Después del alta, la interfaz se recarga y vuelve a validar la sesión contra el catálogo ampliado.

## API loopback

- `GET /api/library/resources`: lista recursos incluidos y locales con procedencia y hash.
- `GET /api/library/catalog`: devuelve la ruta publicada y el catálogo activo.
- `POST /api/library/resources`: registra `{ "entry": recurso }`; requiere origen permitido y token de sesión local.

La API conserva los límites y defensas del servicio local. No es un backend remoto ni multiusuario.

## Límites actuales

- No hay eliminación o modificación desde la interfaz.
- No hay importación de paquetes binarios ni generación de recursos con IA.
- No hay base de datos, sincronización remota, cuentas ni almacenamiento compartido.
- El runtime actual solo puede renderizar el subconjunto de personajes, fondos, voces y capacidades ya soportado por los contratos vigentes.

Prueba específica:

```powershell
npm run local:test-library
```
