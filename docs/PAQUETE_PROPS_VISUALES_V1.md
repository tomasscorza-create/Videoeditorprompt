# Paquete de props visuales V1

## Resultado

Se incorporan tres familias geométricas originales con dos paletas cada una:

- teléfono social claro y oscuro;
- globo de diálogo coral y azul;
- gráfico de crecimiento verde y violeta.

El catálogo de autoría pasa de un prop a siete. Las seis altas son recursos V3
compuestos por piezas, con miniatura PNG transparente, fuentes SVG regenerables
y manifest portable. Al ser definiciones originales del proyecto no dependen
de descargas ni licencias de terceros.

## Diseño y uso

- **Teléfonos:** demostraciones de aplicaciones, redes y pantallas.
- **Globos:** diálogo, reacción, comentarios o mensajes.
- **Gráficos:** datos, crecimiento, resultados y comparaciones.

Todos admiten las 16 animaciones genéricas y las seis secuencias coordinadas V2
porque usan las transformaciones compartidas de props. No declaran parámetros
articulados propios.

## Reproducibilidad

Cada familia se define una sola vez en `public/assets/resource-definitions/` y
el compilador genera sus dos variantes sustituyendo únicamente la paleta. El
catálogo V3 se fusiona sin borrar recursos existentes.

`scripts/stage2f/test-visual-prop-pack.mjs` recompila las tres familias en una
raíz temporal y compara todos los hashes con los archivos publicados. También
verifica manifests, miniaturas RGBA 1080 × 1920 y presencia en el catálogo de
autoría.

## Cumplimiento

Cada variante tiene un registro `cleared` en
`public/assets/catalog/resource-licenses.json`, con uso comercial permitido y
redistribución limitada al producto propietario. No se permite vender las
imágenes como una biblioteca de assets independiente.
