# Piloto de secuencias coordinadas V2

Gate visual real de las seis secuencias internas agregadas en V2.

El script `scripts/compositor/test-coordinated-sequence-pilot.mjs` construye un
proyecto portable de tres escenas y aplica dos secuencias por escena mediante
el mismo expansor compartido que consumen Director y `Crear animación`.

## Cobertura

1. Entrada inferior + pulso y aparición con rebote + balanceo.
2. Salto + destello y sacudida lateral + pulso.
3. Flotación + pulso y salida superior + desvanecimiento.

El pipeline usa medición de voz real, compositor PixiJS headless, H.264/AAC y
FFmpeg. El gate comprueba por frame los rangos de posición, escala, rotación y
opacidad, y conserva el MP4 resultante bajo `.local-video/visual-gates/` para
inspección humana.

```powershell
node scripts/compositor/test-coordinated-sequence-pilot.mjs
```

La ruta exacta del último MP4 queda registrada en
`.local-video/test-results/coordinated-sequence-pilot-latest.json`.
