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
- editor local con preview, timeline medida, inspector, undo/redo y exportación JSON;
- publicación local versionada de previews y proyectos compatibles.

Las etapas 0–2F y 3A.0–3A.2 están implementadas y verificadas. El núcleo de edición 3B.0 ya está conectado a la interfaz local. Todavía no es un editor profesional ni una aplicación web.

## Inicio rápido

### Requisitos

- Node.js `^20.19.0` o `>=22.12.0`.
- npm.
- FFmpeg y FFprobe disponibles en `PATH`.
- Para generar voces y renderizar: un runtime local de Piper configurado como se explica en [Voz y render](#voz-y-render).

Instalación:

```powershell
git clone https://github.com/tomasscorza-create/Videoeditorprompt.git
cd Videoeditorprompt
npm install
```

Publicar el proyecto piloto compatible e iniciar la interfaz:

```powershell
npm run stage3b:publish-project
npm run dev
```

Abrir la URL que informe Vite, normalmente [http://localhost:5173](http://localhost:5173).

`stage3b:publish-project` genera `public/projects/`, necesario para que la interfaz encuentre proyectos editables. Los previews de video aparecen después de publicar al menos un trabajo del pipeline.

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

- El navegador no inicia todavía el pipeline local; renderizar sigue siendo una operación CLI.
- El preview interactivo reproduce una escena seleccionada; el MP4 multiescena se ensambla en el pipeline padre.
- El compilador vigente exige exactamente dos personajes y al menos dos turnos por escena.
- Crear o eliminar escenas, elementos y turnos todavía no forma parte del contrato del editor.
- Texto, imágenes, transforms libres y articulación continua aún no están representados por el runtime.
- La boca usa una envolvente RMS, no alineación fonética.
- La integración de Piper actual contiene rutas específicas de Windows; Linux/contenedores todavía requieren adaptación y verificación.
- Faltan timeouts, cancelación y protección completa ante trabajos concurrentes antes de ofrecer el motor como servicio web.

El alcance futuro y sus gates están en [docs/ROADMAP.md](docs/ROADMAP.md).

## Documentación

| Documento | Propósito |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Constitución técnica, invariantes, seguridad y normas de cambio. |
| [Roadmap](docs/ROADMAP.md) | Dirección de producto, fases y criterios de avance. |
| [Checklist de desarrollo](docs/DEVELOPMENT_CHECKLIST.md) | Control operativo antes y después de cada cambio. |
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

Cuando un documento histórico contradiga el código vigente, prevalecen `AGENTS.md`, `ETAPA_1_ENDURECIMIENTO_RESULTADOS.md` y el código verificado.

## Licencias

El repositorio todavía no contiene una licencia general. No debe asumirse permiso de redistribución o uso comercial del código.

Los modelos, voces, fuentes y otros recursos de terceros conservan sus propias licencias y procedencia. El catálogo registra la información disponible, pero es obligatorio completar la revisión de licencias antes de distribuir o monetizar el producto.

