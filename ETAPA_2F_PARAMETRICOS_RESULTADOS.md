# Etapa 2F.2 — personaje paramétrico y catálogo local

Fecha: 22 de julio de 2026.

Estado: **implementación técnica completada y verificada; pendiente de revisión humana dentro del gate 2F**.

## Resultado

Se implementó un vertical slice completo, declarativo y determinista que transforma una única definición geométrica en dos personajes reutilizables. El pipeline de escena puede seleccionarlos por IDs estables de catálogo sin guardar rutas de manifests en la configuración.

No se agregó IA, editor, React, Electron, varias escenas, dibujo libre, deformación de malla ni articulación continua.

Trabajo de evidencia: `piloto-parametrico-01`.

```text
Preview: http://localhost:5173/?job=piloto-parametrico-01
MP4: .local-video/output/piloto-parametrico-01/render-1.mp4
Definición: public/assets/character-definitions/mono-parametrico-v1.json
Catálogo: public/assets/catalog/index.json
Publicación regenerable: public/generated/piloto-parametrico-01/
```

## Flujo implementado

```text
definición geométrica JSON + variante de paleta
                    ↓
validación estructural y semántica
                    ↓
SVG declarativos y controlados
                    ↓
PNG transparentes 1080 × 1920
                    ↓
character manifest v2 + catálogo v1
                    ↓
scene config por characterAssetId
                    ↓
runtime existente → PixiJS / FFmpeg
```

La definición es datos, no código. Admite únicamente primitivas cerradas (`ellipse`, `rect`, `polygon` y `path`), tokens de paleta, opacidad y orden de capas. No admite JavaScript, comandos, filtros libres, URLs, imports ni SVG arbitrario.

## Contratos nuevos

### Definición paramétrica

`schema/parametric-character.schema.json` describe:

- canvas y pivote global;
- paleta base y variantes cerradas;
- capas semánticas de cuerpo, ojos, boca y manos;
- primitivas geométricas con límites;
- joints jerárquicos;
- poses que referencian joints y estados de manos;
- procedencia y licencia.

La validación semántica adicional comprueba IDs únicos, cobertura de tokens de paleta, un único joint raíz, padres existentes, ausencia de ciclos y referencias de pose válidas.

### Manifest de rig versión 2

`schema/character-manifest-v2.schema.json` registra:

- ID compilado estable;
- definición fuente portable;
- variante y paleta resuelta;
- capas PNG compatibles con el runtime vigente;
- miniaturas de poses;
- joints y poses compilados;
- procedencia/licencia.

El contrato v1 sigue soportado. La escena v2 puede usar un manifest directo como antes o resolver un `characterAssetId` mediante catálogo, pero no ambos a la vez.

### Catálogo local versión 1

`schema/asset-catalog.schema.json` y `public/assets/catalog/index.json` agregan dos entradas:

| ID | Variante | Poses | Boca | Joints |
|---|---|---|---|---:|
| `mono-parametrico-azul-v1` | presentador azul | neutral, point | closed, medium, open | 6 |
| `mono-parametrico-ciruela-v1` | analista ciruela | neutral, point | closed, medium, open | 6 |

Cada entrada contiene etiqueta, tags, ruta relativa al manifest, thumbnail, capacidades y procedencia. No se agregó base de datos: el índice JSON es suficiente para el alcance local.

## Assets generados

Cada variante contiene:

- ocho capas runtime PNG: cuerpo, dos ojos, tres bocas y dos manos;
- dos composiciones PNG: `pose_neutral.png` y `pose_point.png`;
- diez SVG fuente equivalentes bajo `source/`;
- `character.manifest.json` versión 2.

Todos los PNG miden 1080 × 1920 y conservan canal alfa. Los SVG y PNG son derivados regenerables de la definición JSON; no se editaron a mano.

El rig declara:

- `root`;
- `head`;
- `shoulder_left` y `shoulder_right`;
- `elbow_right`;
- `wrist_right`.

La pose `point` declara rotaciones para hombro, codo y muñeca. En el runtime actual esas rotaciones son metadatos validados: la actuación visual sigue alternando la capa `hand_neutral` o `hand_point`. Esto prepara compatibilidad futura sin introducir prematuramente transforms jerárquicos continuos.

## Integración con el pipeline

El piloto `pilots/parametric-character-01/scene.config.json` usa:

```json
{
  "assetCatalog": "assets/catalog/index.json",
  "characters": [
    { "characterAssetId": "mono-parametrico-azul-v1" },
    { "characterAssetId": "mono-parametrico-ciruela-v1" }
  ]
}
```

El validador resuelve cada ID bajo la raíz de assets, valida catálogo y manifest v2, rechaza IDs inexistentes y conserva el ID seleccionado en el runtime. Las rutas generadas permanecen relativas y portables.

Preparación, TTS, FFprobe, análisis RMS, evaluación temporal, frames, FFmpeg y verificación continúan funcionando headless. PixiJS y la exportación siguen consumiendo el evaluador temporal compartido.

## Pruebas del compilador

`npm run stage2f:test-parametric` aprobó 9/9:

1. definición válida con variantes, joints y poses;
2. rechazo de un path SVG inseguro;
3. rechazo de un joint con padre inexistente;
4. catálogo portable con dos variantes;
5. SVG, PNG, manifests y catálogo idénticos en dos compilaciones aisladas;
6. paletas diferentes producen PNG diferentes;
7. todos los PNG compilados son RGBA 1080 × 1920;
8. la escena resuelve personajes por IDs del catálogo;
9. un ID de catálogo inexistente es rechazado.

Las compilaciones de prueba viven bajo trabajos aislados en `.local-video/tests`; no comparten temporales ni modifican los assets publicados.

## Exportación verificada

| Propiedad | Resultado |
|---|---|
| Duración WAV medida | 10,601633 s |
| Frames | 319 |
| FPS | 30 |
| Tiempo de frames, render 1 | 24,3074947 s |
| Tiempo de encoding, render 1 | 1,6740411 s |
| MP4 | 1.104.985 bytes |
| Video | H.264, 1080 × 1920, 30 fps |
| Pixel format | yuv420p |
| Audio | AAC, 22050 Hz, mono |
| Duración MP4 | 10,633333 s |
| Verificaciones | 54/54 |
| Determinismo | aprobado |

Hashes:

```text
temporalHash  6041032115807ae4facaab87dd7cbc5fc104ceda6f6ce441d6c1ee6c41df7fa5
frameHash     19991cf9d46decd5a33eab4cb96b864f35f385841b0afaad1c10a24e6dc4d547
videoSha256   6ea6150f37e67d366ece952a4afdfa6175a5d8707134ab7e660871cd4d3ecd2e
```

Los dos MP4 generados fueron binariamente idénticos. Ambos TTS fueron cache hits; la prueba se concentró en el contrato de assets, resolución y render.

## Preview comprobado

Se abrió `http://127.0.0.1:5173/?job=piloto-parametrico-01` en el navegador local.

Evidencia:

- trabajo seleccionado: `piloto-parametrico-01`;
- estado: `completed`;
- renderer: `WebGLRenderer`;
- duración mostrada: 10,60 s;
- 54 verificaciones y determinismo visibles;
- audio reproducido correctamente;
- a 2,58 s: `presentadora: open` y `presentadora: señala`;
- enlace de descarga apunta al MP4 del mismo `jobId`.

La inspección de thumbnails y frames confirmó transparencia, diferencias de paleta, pose neutral/point, dos posiciones visibles, subtítulo legible y composición equivalente al runtime anterior.

## Regresiones

- `stage2f:test-parametric`: 9/9.
- `stage2d:test-contract`: 8/8.
- `stage1:test-config`: 16/16.
- pipeline v1: 30 verificaciones, determinista.
- pipeline 2D: 44 verificaciones, determinista.
- pipeline 2E: 50 verificaciones, determinista.
- pipeline paramétrico: 54 verificaciones, determinista.
- `npm run build`: aprobado.

El evento `state=failed` impreso por `stage1:test-config` es una prueba negativa intencional del contrato de errores; la suite terminó con 16/16.

## Comandos principales

```powershell
npm run stage2f:parametric-assets
npm run stage2f:test-parametric
npm run stage2d:test-contract
npm run build
npm run stage2f:parametric-pipeline
npm run stage1:test-config
npm run stage1:pipeline
npm run stage2d:pipeline
npm run stage2e:pipeline
```

No se construyeron comandos de proyecto mediante strings de shell. El compilador invoca el navegador con ejecutable y argumentos separados; el pipeline conserva `shell: false` para procesos externos.

## Archivos principales

- `schema/parametric-character.schema.json`
- `schema/character-manifest-v2.schema.json`
- `schema/asset-catalog.schema.json`
- `schema/scene-config-v2.schema.json`
- `scripts/stage2f/parametric-character.mjs`
- `scripts/stage2f/generate-parametric-character.mjs`
- `scripts/stage2f/test-parametric-character.mjs`
- `public/assets/character-definitions/mono-parametrico-v1.json`
- `public/assets/catalog/index.json`
- `public/assets/characters/mono-parametrico-azul-v1/`
- `public/assets/characters/mono-parametrico-ciruela-v1/`
- `pilots/parametric-character-01/scene.config.json`

También se actualizaron el validador de escena, la preparación/verificación del diálogo y los documentos de estado. No se agregaron dependencias npm.

## Riesgos y límites pendientes

- Falta aprobación humana del video de calidad 2F.1 y del aspecto del piloto 2F.2.
- Los joints todavía no transforman capas en tiempo real; solo describen el rig y las poses compiladas.
- El catálogo es un índice JSON local sin locking concurrente ni regeneración incremental.
- Solo existe un diseño geométrico con dos paletas; todavía no demuestra variedad estructural de personajes.
- La licencia registrada es de un asset original para uso interno; antes de distribuir una biblioteca deberán definirse metadatos jurídicos y atribuciones más formales.
- El rasterizado usa Chrome/Edge disponible localmente; falta comprobar equivalencia y fuentes en Linux.
- La voz y la boca siguen teniendo las limitaciones registradas en 2F.1; este incremento no las modifica.

## Decisión

La Etapa 2F.2 demuestra que un personaje puede definirse y variarse mediante datos seguros, compilarse a assets compatibles y seleccionarse por ID sin romper preview ni exportación. El contrato mínimo de recurso paramétrico y catálogo es técnicamente viable.

No corresponde comenzar automáticamente 3A. El siguiente gate es humano: revisar los pilotos 2F.1 y 2F.2, confirmar que la UX de Claude puede representar catálogo, variante y pose, y aprobar o pedir ajustes concretos.
