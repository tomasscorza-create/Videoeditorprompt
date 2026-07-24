# Creador local de personajes

## Dos caminos de autoría

**CREAR → Personajes** abre el diseñador dentro del visor central:

1. **Usar plantilla** conserva el flujo rápido: paleta, accesorio, sombrero y revisión de estados sobre `mono-parametrico-v1`.
2. **Crear desde cero** construye un personaje mediante piezas geométricas ordenadas por capas. Puede comenzar con un lienzo vacío o cargar una base humana mínima completamente editable.

Los diseños guardados de ambos modos pueden abrirse como base. Toda edición guarda una variante nueva para no romper proyectos que ya referencian el personaje anterior.

## Piezas semánticas

Cada pieza del modo desde cero tiene:

- ID y nombre;
- función reconocible;
- elipse o rectángulo redondeado;
- posición, ancho, alto y rotación;
- relleno, borde y grosor;
- posición dentro del orden de capas.

Funciones disponibles: cuerpo, cabeza, ojo izquierdo/derecho, boca, brazo izquierdo/derecho, pierna izquierda/derecha, ropa y accesorio.

El conjunto mínimo animable exige cuerpo, cabeza, ambos ojos, boca, ambos brazos y ambas piernas. La interfaz muestra las piezas faltantes y el backend vuelve a comprobarlas antes de compilar.

## Cómo se convierte en un personaje animable

Las etiquetas funcionales se traducen determinísticamente al contrato vigente:

- los ojos generan capas abiertas y cerradas;
- la boca genera estados `closed`, `medium` y `open`;
- el brazo derecho genera las capas `neutral` y `point`;
- las piezas restantes componen el cuerpo respetando el orden;
- los centros de cabeza y brazos generan los joints descriptivos.

El selector “Probar reconocimiento y animación” permite revisar parpadeo, boca hablando y gesto señalar antes de guardar. El compilador paramétrico produce capas PNG, miniaturas, poses y `character.manifest.json` versión 2. El resultado no es una imagen estática.

## Contratos y seguridad

`schema/local-character-design.schema.json` conserva compatibilidad con diseños de plantilla versión 1 e incorpora diseños geométricos versión 2. Solo admite formas, roles y rangos cerrados. No acepta SVG, scripts, rutas, comandos ni expresiones.

`shared/character-design-presets.js` contiene la transformación usada tanto por el visor como por el backend. El render final continúa consumiendo el rig compilado, no datos específicos de la interfaz.

## Persistencia

El paquete maestro se guarda fuera del repositorio:

- Windows: `%LOCALAPPDATA%\DisenadorVideosLocal\library\assets\characters\<id>`
- macOS: `~/Library/Application Support/DisenadorVideosLocal/library/assets/characters/<id>`
- Linux: `$XDG_DATA_HOME/disenador-videos-local/library/assets/characters/<id>`

`public/assets/library/characters` es una publicación regenerable para la UI, Director y render. El ID se deriva de un hash canónico del diseño, por lo que guardar exactamente el mismo contenido no crea duplicados.

## Colocación en una escena

La pestaña **Recursos → Personajes** muestra tanto los personajes incluidos como los creados localmente.

- Un clic en una tarjeta activa el modo de colocación; el siguiente clic en el visor sitúa allí el personaje.
- La tarjeta también puede arrastrarse y soltarse sobre el visor.
- `Escape` cancela el modo de colocación.

El runtime vigente exige exactamente dos personajes por escena. Por eso la colocación reemplaza al personaje más cercano al punto elegido y conserva la escena compilable; no añade un tercer personaje. Recurso y posición se actualizan mediante un solo comando semántico, compatible con undo/redo.

## Límites vigentes

- El modo desde cero admite elipses y rectángulos redondeados; no dibujo libre ni paths aportados por el usuario.
- Ojos, boca y gesto se generan mediante reglas cerradas, no mediante articulación continua.
- Los joints siguen siendo metadatos; el runtime alterna capas precompiladas.
- No hay importación de rigs externos, generación por IA ni eliminación de recursos.
- La biblioteca de plantillas todavía contiene una sola anatomía preconstruida.
