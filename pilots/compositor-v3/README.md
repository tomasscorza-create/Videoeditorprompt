# Frames dorados del compositor headless

`golden/frame_0000.png`, `0001` y `0002` son el recurso v3 articulado
(`mono-articulado-azul-v1`) compuesto con `armRaise` en 0, 0.5 y 1, en 1080×1920
con fondo transparente.

Los produce y los compara el mismo recorrido:

```bash
npm run compositor:test-headless
```

La comparación es por **SSIM con tolerancia** (mínimo 0.995) y no por bytes.
Chrome sin GPU dibuja con SwiftShader, que es determinista dentro de una misma
máquina y versión de navegador —la prueba lo verifica componiendo dos veces y
comparando los hashes— pero no está garantizado entre máquinas distintas.

Cuando el compositor cambia a propósito, los dorados se regeneran, se miran y se
commitean:

```bash
npm run compositor:golden
```

Nunca se regeneran automáticamente al fallar la comparación: eso convertiría la
prueba en un espejo de lo que sea que el compositor esté haciendo hoy.
