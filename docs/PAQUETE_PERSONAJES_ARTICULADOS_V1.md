# Paquete de personajes articulados V1

## Resultado

El sistema incorpora seis personajes originales agrupados en tres siluetas, sin dependencias visuales de terceros:

| Familia | Variantes | Uso sugerido |
| --- | --- | --- |
| Presentadora modular | coral, índigo | aperturas, tutoriales y llamados a la acción |
| Analista modular | menta, mostaza | datos, comparaciones y explicaciones |
| Robot asistente | cian, lima | tecnología, automatización y acompañamiento |

No son simples recolores de un personaje previo: cada familia tiene geometría, proporciones, rostro y vestuario propios. Las dos variantes de cada familia comparten rig y cambian su dirección cromática.

## Contrato técnico

Cada personaje se compila como recurso v3 con cinco piezas jerárquicas (`legs`, `torso`, `arm_left`, `arm_right`, `head`), seis visemas, ojos abiertos/cerrados y las cinco poses canónicas. Expone los seis parámetros admitidos por el editor y el compositor:

- `armRaise` y `leftArmRaise`;
- `headTilt` y `headNod`;
- `bodyLean` y `bodyBounce`.

Las definiciones fuente viven en `public/assets/resource-definitions/`. El generador `scripts/stage2f/generate-character-pack.mjs` vuelve a producir los rigs y fusiona sus entradas en el catálogo técnico sin borrar recursos existentes.

## Derechos y redistribución

Los diseños y las geometrías son originales del proyecto. El catálogo legal los marca como `cleared`, permite uso comercial y limita la redistribución a su inclusión dentro del producto (`product-only`). No requieren atribución y no se ofrece licencia para venderlos como paquete independiente.

## Verificación

`npm run stage2f:test-character-pack` regenera las definiciones y los seis rigs en una raíz temporal, compara todos los artefactos por SHA-256, valida manifests, dimensiones RGBA, poses, visemas, parámetros, catálogo de autoría y registro legal.
