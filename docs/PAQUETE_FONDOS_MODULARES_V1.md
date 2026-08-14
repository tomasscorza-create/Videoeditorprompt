# Paquete de fondos modulares V1

## Resultado

El paquete incorpora cuatro fondos verticales originales al contrato vigente de
tres planos. Cada fondo dispone de `far`, `mid` y `front` a 1080 × 1920, fuentes
SVG y PNG deterministas consumidos por el mismo evaluador temporal de preview y
exportación.

| Recurso de autoría | Estilo | Uso sugerido |
| --- | --- | --- |
| `fondo-interior-creativo-v1` | Interior cálido con ventana, estantería y mesa | Conversaciones, tutoriales y contenido personal |
| `fondo-gradiente-editorial-v1` | Gradiente oscuro, retícula y paneles translúcidos | Datos, tecnología y piezas de marca |
| `fondo-escenario-abstracto-v1` | Escenario claro con geometría editorial | Explicaciones, listas y presentaciones |
| `fondo-ciudad-nocturna-v1` | Skyline nocturno con luna y luces | Historias, cultura urbana y aperturas dramáticas |

Todos soportan `static`, `slow-pan` y `slow-zoom`. No se añadió un contrato nuevo:
el compilador de proyectos sigue resolviendo `background.manifest.json` a las
tres capas con los presets de parallax congelados.

## Derechos y redistribución

Los diseños y sus SVG fueron creados dentro del proyecto sin material de
terceros. El manifiesto legal los registra con:

- origen `original`;
- uso comercial permitido;
- redistribución dentro del producto permitida;
- atribución no requerida;
- venta separada como paquete de assets no autorizada.

Esto evita sumar avisos de terceros o dependencias remotas. Los bloqueos legales
históricos de otros recursos permanecen visibles en la auditoría general y no
son modificados por este paquete.

## Regeneración y gate

```powershell
npm run stage2e:background-pack
npm run stage2e:test-background-pack
npm run assets:test-licenses
```

El gate recompila las doce capas en un directorio temporal, compara PNG de forma
binaria, normaliza saltos de línea al comparar SVG/JSON, valida dimensiones y
canales alfa, y compila cada fondo a configuraciones runtime v2 con paneo y zoom.

Archivos principales:

- `scripts/stage2e/background-pack.mjs`
- `scripts/stage2e/test-background-pack.mjs`
- `public/assets/backgrounds/*-v1/`
- `public/assets/catalog/authoring-resources.json`
- `public/assets/catalog/resource-licenses.json`

## Límite honesto

El paquete amplía variedad de escenarios, pero no permite todavía recolorear o
recombinar planos desde la interfaz. Esa capacidad requeriría un contrato de
variantes de fondo; no corresponde simularla mediante archivos duplicados ni
parámetros que el render actual no consume.
