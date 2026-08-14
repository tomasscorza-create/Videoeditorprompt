# Paquete de plantillas procedurales V1

## Resultado

La biblioteca pasa de una a cinco plantillas visuales. Las cuatro nuevas usan el
tipo cerrado `procedural-motion-card`, dibujado por el mismo módulo Canvas en el
editor, preview vivo y compositor PixiJS headless.

| Plantilla | Layout | Uso principal |
| --- | --- | --- |
| `procedural-title-reveal-v1` | `title` | Aperturas, conceptos y capítulos |
| `procedural-list-stack-v1` | `list` | Pasos, claves y secuencias breves |
| `procedural-comparison-split-v1` | `comparison` | Antes/después y contrastes |
| `procedural-cta-pulse-v1` | `cta` | Cierres y llamadas a la acción |

La plantilla histórica `procedural-word-match-cut-v1` permanece compatible. No
se duplicó con otros nombres: el parser ahora acepta dos tipos explícitos y
rechaza cualquier layout, color o campo fuera de su vocabulario.

## Contrato y determinismo

El proyecto editable conserva un solo campo de texto (`word`) de hasta 24
caracteres. Cada definición agrega únicamente datos declarativos seguros:

- uno de cuatro layouts permitidos;
- duración y FPS;
- semilla entera;
- seis colores hexadecimales;
- entre una y tres etiquetas fijas.

El movimiento se evalúa desde `frameIndex / fps`. Entrada, salida, progreso,
pulsación y aparición escalonada se recalculan directamente para cada frame; no
se acumulan deltas ni se generan cientos de keyframes.

`shared/video-template-renderer.js` funciona como fachada común. Delega la
plantilla histórica al pintor de páginas y las tarjetas nuevas a
`shared/video-template-card.js`. Los tres consumidores usan esa fachada:

- editor dedicado de plantillas;
- composición viva del proyecto;
- compositor headless que produce los PNG del MP4.

## Derechos

Código, geometría, paletas, miniaturas SVG y movimiento son originales del
proyecto. La auditoría los registra con uso comercial permitido, redistribución
dentro del producto y sin atribución obligatoria. No contienen imágenes,
fuentes empaquetadas ni material de terceros.

## Verificación

```powershell
npm run templates:test-motion-cards
npm run assets:test-licenses
npm run ui:test-modules
npm run stage3a:test-project
npm run build
```

El gate renderiza las cuatro plantillas con Chrome/PixiJS dos veces, exige PNG
RGBA de 540 × 960, compara hashes entre corridas y comprueba que los cuatro
layouts produzcan imágenes diferentes. También deja una hoja de contacto local
para inspección humana.

## Límite honesto

En esta versión se edita el texto principal; las etiquetas secundarias forman
parte del diseño versionado. Hacer cada ítem editable requiere ampliar de forma
coordinada el esquema del proyecto, comandos, Director, UI y runtime. No se
simula esa capacidad con JSON libre.
