# Etapa 2F.0–2F.1 — visión de producto y gate de calidad

Fecha: 22 de julio de 2026.

Estado de esta evidencia: **implementación técnica 2F.1 completada; pendiente de aprobación humana auditiva y visual**. Actualización posterior: 2F.2 ya fue implementada y se documenta por separado en `ETAPA_2F_PARAMETRICOS_RESULTADOS.md`.

## Resultado

Se consolidó la visión prompt → proyecto editable y se construyó un piloto de calidad de una sola escena con:

- 1080 × 1920 a 30 fps;
- 20,47356 segundos medidos mediante FFprobe;
- dos personajes visualmente distinguibles;
- dos modelos Piper españoles;
- cuatro turnos y pausas medidas;
- boca RMS estabilizada sin el retraso artificial anterior;
- gesto `point` semántico por turno;
- parpadeos, idle moderado, fondo y parallax;
- 615 frames;
- dos renders binariamente idénticos;
- preview PixiJS por `jobId` y MP4 H.264/AAC/yuv420p.

Trabajo: `piloto-calidad-dialogo-01`.

```text
Preview: http://localhost:5173/?job=piloto-calidad-dialogo-01
MP4: .local-video/output/piloto-calidad-dialogo-01/render-1.mp4
Publicación regenerable: public/generated/piloto-calidad-dialogo-01/
```

## Visión y roadmap

Se creó `docs/VISION_PRODUCTO_Y_ETAPA_2F.md` con:

- flujo de generación guiada y edición manual sobre un único proyecto;
- preguntas de IA y variantes visuales seleccionables;
- separación entre proyecto de autoría, runtime compilado y artefactos del job;
- dirección técnica para generación geométrica/paramétrica;
- rig por capas, pivotes y uniones;
- catálogo local reutilizable;
- gate de calidad antes de varias escenas;
- límites de trabajo para Codex y Claude.

Se actualizaron el roadmap, el plan posterior al piloto, el flujo de colaboración y el checklist. La Etapa 3A deja de ser el paso inmediato: primero debe aprobarse 2F.

## Segunda voz local

Se instaló fuera del repositorio y fuera de `package.json`:

| Campo | Valor |
|---|---|
| Modelo | `es_ES-davefx-medium` |
| Idioma/región | Español de España (`es_ES`) |
| Calidad declarada | medium |
| Sample rate | 22050 Hz |
| Speakers | 1 |
| Tamaño ONNX | 63.201.294 bytes |
| SHA-256 ONNX | `6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917` |
| Revisión fijada | `49a0d23f04e055f1766e5ad15ea2d121a90fa17a` |
| Carpeta local | `C:\LocalVideoTTS\models` |

Fuente:

```text
https://huggingface.co/rhasspy/piper-voices/tree/49a0d23f04e055f1766e5ad15ea2d121a90fa17a/es/es_ES/davefx/medium
```

El repositorio de voces declara licencia MIT. El model card de `davefx` identifica el dataset de origen con licencia CC0. Antes de distribuir comercialmente el producto deberá conservarse una revisión legal de la licencia del motor, los pesos y cada dataset; este registro técnico no sustituye esa revisión.

La voz anterior `es_AR-daniela-high` se conserva. No se integró una arquitectura de proveedores ni un modelo adicional al repositorio.

## Ajustes de voz

Se agregó normalización conservadora antes de Piper:

- Unicode NFC;
- espacios repetidos;
- `%` a `por ciento`;
- `&` a `y`;
- separación después de puntuación;
- puntuación final cuando falta.

El texto original sigue alimentando los subtítulos. El texto normalizado usado por TTS queda registrado como `ttsText` en el diálogo compilado.

Configuraciones del piloto:

| Personaje | Modelo | `lengthScale` | Volumen |
|---|---|---:|---:|
| presentadora | `es_AR-daniela-high` | 1,08 | 1,00 |
| analista | `es_ES-davefx-medium` | 1,04 | 1,00 |

Se eliminaron escalas excesivamente lentas como 1,65 del piloto anterior, porque contribuían a fonemas alargados.

Primera preparación, sin caché:

- tiempo Piper total de cuatro turnos: 9,1323239 s;
- duración total de voz más pausas: 20,47356 s;
- relación TTS/audio aproximada: 0,446;
- análisis RMS total: 0,0113813 s;
- sample rate del master: 22050 Hz;
- canales: 1.

Las regresiones posteriores usaron caché. El cache key incluye modelo, texto normalizado, `lengthScale` y volumen.

## Corrección de sincronización de boca

### Problema encontrado

El algoritmo anterior exigía que un estado se mantuviera durante 90 ms, pero recién aplicaba la nueva boca al finalizar esos 90 ms. Esto incorporaba retraso visible en cada apertura y cierre confirmado.

### Cambio

La transición continúa necesitando estabilidad, pero cuando se confirma se aplica retroactivamente desde el comienzo real del segmento. También:

- se descartan pulsos breves aislados;
- el cierre terminal se conserva aunque sea corto;
- se mantienen tres estados: `closed`, `medium`, `open`;
- se conserva el análisis determinista y compartido por preview/exportación.

Pruebas específicas: 4/4.

- transición confirmada sin latencia agregada;
- pulso `open` corto eliminado;
- silencio terminal cierra la boca;
- normalización de texto española.

Cues del piloto:

| Turno | Cues | Closed | Medium | Open |
|---|---:|---:|---:|---:|
| turno-01 | 25 | 4 | 10 | 11 |
| turno-02 | 16 | 4 | 6 | 6 |
| turno-03 | 18 | 2 | 8 | 8 |
| turno-04 | 23 | 3 | 10 | 10 |

Los segmentos internos confirmados respetan el mínimo configurado. Existen cierres terminales de 30–60 ms de manera deliberada para no terminar con la boca abierta.

### Límite vigente

Esto sigue siendo sincronización por energía RMS. Puede acompañar el ritmo y los silencios, pero no sabe qué fonema se pronuncia y no garantiza correspondencia exacta entre una vocal y una forma de boca. El lip sync fonético sigue fuera de alcance.

## Actuación y personajes

Se agregó `gesture` opcional a cada turno del contrato v2, limitado a `neutral` y `point`. El preset `point` se activa en la zona central del turno. Solo puede mostrarlo el hablante activo; el oyente mantiene boca cerrada y gesto neutral.

Preview y exportación cargan `handNeutral` y `handPoint` y consumen el mismo `gesture` calculado por `shared/scene-evaluator.js`.

También se redujeron amplitud y velocidad del idle y la frecuencia de parpadeo en el piloto para evitar movimiento constante.

El generador vectorial existente acepta ahora variantes cerradas:

- `presentador` → `mono-presentador-v1`;
- `analista` → `mono-analista-v1`.

La variante analista genera SVG fuente y nueve PNG transparentes con otra paleta. Es un primer paso paramétrico de apariencia, no completa 2F.2: todavía faltan una definición geométrica independiente del script, pivotes/uniones expresivos y un índice de catálogo.

## Exportación verificada

| Propiedad | Resultado |
|---|---|
| Duración WAV medida | 20,47356 s |
| Frames | 615 |
| FPS | 30 |
| Tiempo de frames, render 1 | 41,3286716 s |
| Tiempo de encoding, render 1 | 2,9037367 s |
| MP4 | 1.934.806 bytes |
| Video | H.264, 1080 × 1920, 30 fps |
| Pixel format | yuv420p |
| Audio | AAC, 22050 Hz, mono |
| Duración MP4 | 20,500000 s |
| Verificaciones | 52/52 |
| Determinismo | aprobado |

Hashes:

```text
temporalHash  8efeb2a0fda9b47f33dcd1728b69bfef923e00492e7d701d3f29cd252d5e05d9
frameHash     7fbff8572c97d06775a95965ddf5163db3124d46c1b422e619f26695a510e7f4
videoSha256   cd8951372d7d75c55f020c050949f3f8124114fd2fd78ad76d194a700b922ba8
```

## Preview comprobado

Se abrió `http://127.0.0.1:5173/?job=piloto-calidad-dialogo-01`.

Evidencia:

- trabajo seleccionado: `piloto-calidad-dialogo-01`;
- estado: completed;
- renderer: WebGLRenderer;
- duración mostrada: 20,47 s;
- 52 verificaciones y determinismo visibles;
- audio reproducido correctamente;
- a 2,45 s: `presentadora: open` y `presentadora: señala`;
- a 7,35 s: `analista: medium` y gesto neutral;
- enlace de descarga apunta al MP4 del mismo `jobId`.

La revisión de frames confirmó personajes diferenciados, gesto solo en el hablante, boca cerrada en el oyente, subtítulos legibles y fondo sin bordes vacíos.

## Regresiones

- `stage2f:test-quality`: 4/4.
- `stage2d:test-contract`: 8/8.
- `stage1:test-config`: 16/16.
- pipeline v1: 30 verificaciones, determinista.
- pipeline 2D: 44 verificaciones, determinista.
- pipeline 2E: 50 verificaciones, determinista.
- pipeline 2F.1: 52 verificaciones, determinista.
- `npm run build`: aprobado.

El mensaje `state=failed` que aparece dentro de `stage1:test-config` es un caso negativo intencional que verifica errores estructurados; la suite terminó con 16/16.

## Comandos principales

```powershell
npm run stage2f:assets
npm run stage2f:test-quality
npm run stage2d:test-contract
npm run build
npm run stage2f:pipeline
npm run stage1:test-config
npm run stage1:pipeline
npm run stage2d:pipeline
npm run stage2e:pipeline
```

Todos los procesos externos del motor continúan usando ejecutable y argumentos separados, `shell: false` y rutas por `jobId`.

## Evaluación honesta

Técnicamente el piloto es mejor que el anterior:

- elimina una latencia algorítmica real de la boca;
- usa velocidades de voz menos extremas;
- diferencia los hablantes por modelo y apariencia;
- limita los gestos al hablante y a turnos explícitos;
- reduce el movimiento ambiental de los personajes;
- conserva determinismo y equivalencia de consumidores.

Sin embargo, no corresponde declarar calidad aprobada solo por métricas. Queda pendiente que el usuario escuche:

- claridad y acento de `es_ES-davefx-medium`;
- naturalidad de `es_AR-daniela-high` con `lengthScale=1.08`;
- pausas internas y posibles fonemas estirados;
- sensación visual de la boca durante consonantes y vocales;
- brusquedad del cambio entre manos neutral/point.

Si la segunda voz no resulta aceptable, conviene descartarla o usarla solo como baseline; no construir una abstracción grande alrededor de ella. Piper sigue siendo suficiente para el prototipo mientras el contenido tolere voces sintéticas y se controle texto/ritmo, pero todavía no está probado como voz final publicable.

## Pendiente antes de 3A

1. Aprobación auditiva/visual del piloto 2F.1 por el usuario.
2. Corregir únicamente defectos observables de esa revisión.
3. Revisar la evidencia ya ejecutada de 2F.2: definición geométrica portable, joints, variantes, poses compiladas y catálogo mínimo por ID.
4. Confirmar con Claude que el recorrido manual puede editar esos conceptos sin inventar contratos.
5. Aprobar el gate conjunto y recién entonces comenzar 3A, varias escenas y transiciones.
