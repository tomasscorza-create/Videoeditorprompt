# Diseñador de videos local

Herramienta local y dirigida por datos para crear videos animados 2D verticales con recursos reutilizables, voces Piper, animación determinista, subtítulos, PixiJS y FFmpeg.

El proyecto busca que una idea pueda convertirse en un video editable y reproducible sin generar cada frame con IA. La IA podrá dirigir decisiones semánticas; el render final permanece validado, medido y determinista.

## Estado actual

El repositorio incluye actualmente:

- runtime de escena vertical de 1080 × 1920 a 30 fps;
- dos personajes por escena, diálogo secuencial y voces Piper;
- duración real medida desde WAV mediante FFprobe;
- boca basada en RMS, parpadeos, gestos `neutral` y `point`;
- subtítulos por turno;
- fondos de tres capas con paneo, zoom y parallax;
- personajes paramétricos compilados a assets reutilizables;
- proyectos editables de hasta ocho escenas;
- compilación de cada escena al contrato runtime v2;
- render headless por escena y ensamblado multiescena con cortes o fundidos;
- estudio local de tres columnas con composición estática, preview medido y MP4 final;
- biblioteca durable con miniaturas, tags, licencias, registro validado y catálogo unificado para Director/editor/render;
- pistas V1/A1, regla, playhead, timecode, zoom, snap, transporte, navegación y atajos conectados al preview y MP4;
- sesión editable y último render guardados localmente con revisión del catálogo;
- Director IA local con Ollama y `qwen3:8b`, plan JSON cerrado, validación y caché;
- parámetros rígidos de tono, duración objetivo y cantidad de escenas incorporados al esquema enviado a Ollama;
- creación por prompt, corrección en el mismo editor y lanzamiento del render desde la interfaz;
- servicio HTTP local limitado a loopback, progreso, cancelación y reproducción/descarga del MP4 final;
- publicación local versionada de previews y proyectos compatibles.

Las etapas 0–2F y 3A.0–3A.2 están implementadas y verificadas. El núcleo de edición 3B.0 y el primer flujo completo prompt → proyecto → MP4 ya están conectados a la interfaz local. Todavía no es un editor profesional ni una aplicación web.

## Inicio rápido

### Requisitos

- Node.js `^20.19.0` o `>=22.12.0`.
- npm.
- FFmpeg y FFprobe disponibles en `PATH`.
- Para generar voces y renderizar: un runtime local de Piper configurado como se explica en [Voz y render](#voz-y-render).
- Para crear proyectos desde un prompt: [Ollama](https://ollama.com/) y el modelo local `qwen3:8b`.

Instalación:

```powershell
git clone https://github.com/tomasscorza-create/Videoeditorprompt.git
cd Videoeditorprompt
npm install
ollama pull qwen3:8b
```

Publicar el proyecto piloto compatible e iniciar la interfaz:

```powershell
npm run stage3b:publish-project
npm run dev
```

Abrir la URL que informe Vite, normalmente [http://localhost:5173](http://localhost:5173).

`npm run dev` inicia tanto Vite como el servicio local en `127.0.0.1:4174`. Desde **Director IA**, escribir la idea, elegir tono, duración y escenas, y crear la propuesta. La propuesta editable se abre debajo del comando para revisar sus escenas y ajustes antes de pulsar **Renderizar video**. La galería **Videos creados** se abre desde **Archivos** en el encabezado y usa los jobs persistidos de la API local; no depende de copiar renders a `public/generated`.

El viewer central distingue tres fuentes: **Composición** proyecta el proyecto editable sin inventar tiempos; **Preview medido** reproduce una escena publicada; **MP4 final** muestra un render terminado. El proyecto actual se restaura desde `localStorage` y vuelve a validarse cuando la biblioteca agrega recursos.

El panel **Recursos** permite registrar una ficha JSON compatible mediante **Agregar recurso**. El registro durable se guarda en `.local-video-library/` (o en `LOCAL_VIDEO_LIBRARY_ROOT`) y publica un catálogo combinado para que Director, editor y render usen exactamente los mismos IDs. Véase [Biblioteca local](docs/BIBLIOTECA_LOCAL.md).

En escritorio, los separadores entre Director, visor, panel derecho y timeline permiten ajustar el espacio de trabajo. Las proporciones se conservan localmente; doble clic sobre un separador restaura el tamaño inicial.

La timeline inferior también distingue esos estados. Antes de renderizar muestra escenas y turnos como estructura editorial **sin medir**. En Preview y MP4 usa segundos reales: el preview aporta turnos medidos y el manifiesto final aporta inicio/fin de escenas, audio y fundidos. Clic, reproducción, navegación, zoom, mute y playhead actúan sobre el medio visible.

`stage3b:publish-project` genera `public/projects/`, necesario para que la interfaz encuentre proyectos editables existentes. Los previews de video aparecen después de publicar al menos un trabajo del pipeline.

## Voz y render

El pipeline vigente espera un runtime Piper local con esta estructura:

```text
<tts-root>/
├── venv/Scripts/python.exe
├── models/
│   ├── es_AR-daniela-high.onnx
│   ├── es_AR-daniela-high.onnx.json
│   ├── es_ES-davefx-medium.onnx
│   └── es_ES-davefx-medium.onnx.json
├── fonts/arial.ttf
└── cache/
```

Configurar la raíz en PowerShell:

```powershell
$env:LOCAL_VIDEO_TTS_ROOT = "C:\ruta\al\runtime-piper"
```

Generar y publicar un preview de diálogo:

```powershell
npm run stage2d:pipeline
```

Renderizar el proyecto piloto de dos escenas:

```powershell
npm run stage3a:project-pipeline
```

El pipeline también admite `--tts-root` y argumentos de rutas configurables cuando se invocan directamente los scripts.

## Comandos principales

### Interfaz y publicación

```powershell
npm run dev
npm run local:server
npm run build
npm run stage1:pipeline
npm run stage3b:publish-project
```

### Contratos y editor

```powershell
npm run stage2d:test-contract
npm run stage2f:test-parametric
npm run stage3a:test-project
npm run stage3a:test-compiler
npm run stage3a:test-assembly
npm run stage3b:test-editor
npm run stage3b:test-publishing
npm run director:test-plan
npm run director:test-ollama
npm run local:test-library
npm run local:test-server
npm run local:test-render-manager
npm run local:test-retention
npm run stage3b:test-contracts
npm test
```

### Integración y determinismo

```powershell
npm run stage1:test-jobs
npm run stage2b:test-preview
npm run stage3a:project-pipeline
```

Los comandos legacy `npm run assets`, `npm run export` y `npm run verify` pertenecen a la Etapa 0 y no deben usarse como base para funciones nuevas.

## Arquitectura resumida

```text
Prompt ──► Ollama/qwen3:8b ──► plan semántico validado
                                      │
                                      ▼
                         Proyecto editable + catálogo
                                      │
                                      ▼
                         Compilador determinista 3A
            │
            ▼
Configuración runtime v2 por escena
            │
            ├──► Preview PixiJS
            │
            └──► Frames + audio + FFmpeg
                           │
                           ▼
                 MP4 multiescena final
```

Preview y exportación comparten `shared/scene-evaluator.js`. La duración proviene del audio medido y cada frame se evalúa mediante `frameIndex / fps`.

Componentes principales:

- `src/`: interfaz, preview y controles del editor.
- `shared/`: evaluador temporal y núcleo inmutable de edición.
- `schema/`: contratos JSON Schema versionados.
- `scripts/stage1/`: preparación, render, publicación y verificación por escena.
- `scripts/stage3a/`: validación, compilación y ensamblado de proyectos.
- `scripts/stage3b/`: pruebas y publicación de proyectos para la UI.
- `scripts/director/`: contrato semántico, normalizador, caché y adaptador Ollama.
- `scripts/local-app/`: API loopback y gestor aislado de trabajos de render.
- `public/assets/`: catálogos y recursos portables.
- `pilots/`: configuraciones y proyectos de prueba.

## Datos generados

Estas carpetas son regenerables y no forman parte del almacenamiento permanente del motor:

- `.local-video/`: trabajos, temporales y evidencia local.
- `public/generated/`: previews publicados por `jobId`.
- `public/projects/`: proyectos compatibles publicados para la interfaz.
- `dist/`: build de Vite.

No deben versionarse.

## Limitaciones vigentes

- El preview interactivo reproduce una escena seleccionada; el MP4 multiescena se ensambla en el pipeline padre.
- El compilador vigente exige exactamente dos personajes y al menos dos turnos por escena.
- Crear o eliminar escenas, elementos y turnos todavía no forma parte del contrato del editor.
- Texto, imágenes, transforms libres y articulación continua aún no están representados por el runtime.
- La boca usa una envolvente RMS, no alineación fonética.
- La integración de Piper actual contiene rutas específicas de Windows; Linux/contenedores todavía requieren adaptación y verificación.
- El Director inicial usa un único modelo y catálogo cerrado; todavía no hace preguntas aclaratorias ni repara automáticamente planes rechazados.
- El gestor local admite un solo render activo, conserva cancelación y timeout, pero no es un backend multiusuario ni una cola durable.
- La interfaz usa una pasada verificada para responder más rápido; las pruebas y la CLI conservan la doble pasada determinista.
- Sigue faltando protección completa ante cachés/publicaciones concurrentes antes de ofrecer el motor como servicio web.

El alcance futuro y sus gates están en [docs/ROADMAP.md](docs/ROADMAP.md).

## Documentación

| Documento | Propósito |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Constitución técnica, invariantes, seguridad y normas de cambio. |
| [Roadmap](docs/ROADMAP.md) | Dirección de producto, fases y criterios de avance. |
| [Checklist de desarrollo](docs/DEVELOPMENT_CHECKLIST.md) | Control operativo antes y después de cada cambio. |
| [Estructura visual canónica](docs/ESTRUCTURA_VISUAL_CANONICA.md) | Distribución aprobada: encabezado, Director, visor, edición/recursos y timeline. |
| [Biblioteca local](docs/BIBLIOTECA_LOCAL.md) | Registro durable, publicación del catálogo, API, seguridad y límites. |
| [Operación local](docs/OPERACION_LOCAL.md) | Seguridad de sesión, recuperación, render interactivo y retención. |
| [Dependencias de IA](docs/DEPENDENCIAS_IA_LOCAL.md) | Procedencia y licencias declaradas de Ollama y Qwen. |
| [Visión de producto y Etapa 2F](docs/VISION_PRODUCTO_Y_ETAPA_2F.md) | Flujo creativo y dirección del producto. |
| [Flujo de colaboración](docs/FLUJO_COLABORACION_CODEX_CLAUDE.md) | Reglas usadas para integrar motor y UX/UI. |
| [Deuda técnica y plan UX](docs/UX_DEUDA_TECNICA_Y_PLAN.md) | Decisiones y pendientes de experiencia visual. |

La evidencia histórica está documentada en los informes `ETAPA_*_RESULTADOS.md`. Para el estado reciente, consultar:

- [Etapa 2F — calidad](ETAPA_2F_CALIDAD_RESULTADOS.md)
- [Etapa 2F — personajes paramétricos](ETAPA_2F_PARAMETRICOS_RESULTADOS.md)
- [Etapa 3A.0 — proyecto editable](ETAPA_3A0_PROYECTO_EDITABLE_RESULTADOS.md)
- [Etapa 3A.1 — compilador](ETAPA_3A1_COMPILADOR_PROYECTO_RESULTADOS.md)
- [Etapa 3A.2 — render multiescena](ETAPA_3A2_RENDER_MULTIESCENA_RESULTADOS.md)
- [Etapa 3B.0 — núcleo del editor](ETAPA_3B0_NUCLEO_EDITOR_RESULTADOS.md)
- [Etapa 4A — Director IA local](ETAPA_4A_DIRECTOR_IA_LOCAL_RESULTADOS.md)
- [Etapa 4B — estabilización local](ETAPA_4B_ESTABILIZACION_LOCAL_RESULTADOS.md)

Cuando un documento histórico contradiga el código vigente, prevalecen `AGENTS.md`, `ETAPA_1_ENDURECIMIENTO_RESULTADOS.md` y el código verificado.

## Licencias

El repositorio todavía no contiene una licencia general. No debe asumirse permiso de redistribución o uso comercial del código.

Los modelos, voces, fuentes y otros recursos de terceros conservan sus propias licencias y procedencia. El catálogo registra la información disponible, pero es obligatorio completar la revisión de licencias antes de distribuir o monetizar el producto.
