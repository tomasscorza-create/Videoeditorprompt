# Creador local de personajes V1

## Alcance

El menú **CREAR → Personajes** abre un modo de autoría dentro del visor central. El panel derecho permite:

- partir de la plantilla animable `mono-parametrico-v1`;
- ajustar nombre, paleta, accesorio y sombrero;
- revisar gesto, ojos, boca y visibilidad de capas;
- guardar un rig compilado en la biblioteca local;
- abrir un diseño guardado como base y crear una variante nueva sin alterar el original.

Fondos, voces, SFX, efectos y animaciones aparecen como destinos futuros del menú, pero no forman parte de esta versión.

## Contratos y seguridad

`schema/local-character-design.schema.json` acepta únicamente valores cerrados. No admite SVG, scripts, rutas, comandos ni formas arbitrarias aportadas por la interfaz. `shared/character-design-presets.js` aplica las mismas formas predefinidas en la vista de autoría y en la compilación.

El compilador existente de personajes paramétricos produce las capas PNG, miniaturas, poses y `character.manifest.json` versión 2. Por tanto, el resultado no es una imagen estática: conserva ojos abiertos/cerrados, boca cerrada/media/abierta y manos neutral/point compatibles con el runtime actual.

## Persistencia

El paquete maestro se guarda fuera del repositorio:

- Windows: `%LOCALAPPDATA%\DisenadorVideosLocal\library\assets\characters\<id>`
- macOS: `~/Library/Application Support/DisenadorVideosLocal/library/assets/characters/<id>`
- Linux: `$XDG_DATA_HOME/disenador-videos-local/library/assets/characters/<id>`

`public/assets/library/characters` es una publicación regenerable para la UI, Director y render. Si se borra esa copia, el arranque la reconstruye desde el paquete durable.

El ID se deriva de un hash canónico del diseño. Guardar exactamente el mismo diseño no crea duplicados. Editar un personaje guardado crea una variante nueva para no romper proyectos que ya referencian el rig anterior.

## Límites vigentes

- Hay una única anatomía base.
- Accesorios disponibles: lentes e insignia; sombrero disponible: gorra.
- Los joints siguen siendo metadatos; el runtime usa capas de poses precompiladas.
- No hay dibujo libre, importación de personajes estáticos, generación por IA ni eliminación de recursos.
- Las animaciones disponibles siguen limitadas a las capacidades del rig actual.
