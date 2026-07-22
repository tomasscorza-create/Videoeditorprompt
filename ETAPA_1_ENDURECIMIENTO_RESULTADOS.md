# Etapa 1.1 — Endurecimiento arquitectónico del núcleo local

Fecha: 22 de julio de 2026  
Estado: **COMPLETADA Y VERIFICADA**

Este documento deja el estado de la etapa para futuras sesiones de GPT/Codex. El alcance fue exclusivamente arquitectónico: portabilidad de rutas, aislamiento por `jobId`, pipeline headless, progreso estructurado y prueba de dos trabajos. No se agregaron backend, API HTTP, usuarios, base de datos, Docker, React, Electron, varias escenas ni funciones visuales nuevas.

## 1. Resultado ejecutivo

El motor ya no depende de `public/`, `output/`, `temp/` ni de una ruta absoluta escrita en el código. Cada ejecución recibe un contexto por CLI, conserva su configuración y trabaja en directorios exclusivos de su `jobId`.

El flujo completo se verificó sin iniciar Vite ni abrir un navegador:

1. preparación del trabajo;
2. TTS Piper o lectura de caché;
3. duración medida con FFprobe;
4. análisis RMS;
5. evaluación temporal compartida;
6. render de PNG;
7. codificación H.264/AAC;
8. segunda exportación determinista;
9. verificación del resultado.

Después se realizó por separado una regresión de la vista previa. La publicación opcional siguió cargando en PixiJS correctamente.

## 2. Cambios arquitectónicos

### Antes

- Runtime TTS fijado como una ruta absoluta de Windows.
- Configuración tomada directamente desde `public/scene.config.json`.
- Derivados escritos directamente en `public/generated`.
- Frames escritos en un directorio temporal global.
- Resultados escritos en `output/stage1`.
- Identidad basada en `runNumber`, sin concepto de trabajo.
- Sin contrato uniforme de progreso o error.

### Ahora

- Runtime TTS configurable mediante `--tts-root` o `LOCAL_VIDEO_TTS_ROOT`.
- `jobId` obligatorio y validado.
- Configuración, assets, trabajo, resultados y publicación recibidos por argumentos.
- Configuración copiada y congelada dentro del trabajo.
- Audio, cues, subtítulo, runtime y temporales aislados por `jobId`.
- Resultados aislados por `jobId`.
- Pipeline completo invocable como módulo o CLI.
- Progreso persistido como JSONL y último estado como JSON.
- Publicación para Vite opcional y posterior al trabajo.

## 3. Configuración de rutas

Argumentos soportados por el contexto del trabajo:

| Argumento | Obligatorio | Predeterminado de desarrollo | Responsabilidad |
|---|---|---|---|
| `--job-id` | Sí | Ninguno | Identidad estable del trabajo |
| `--config` | No | `public/scene.config.json` | Archivo de escena de entrada |
| `--assets-dir` | No | `public` | Raíz para resolver los assets relativos |
| `--work-dir` | No | `.local-video/work` | Raíz de datos de trabajo y temporales |
| `--output-dir` | No | `.local-video/output` | Raíz de resultados finales |
| `--publish-dir` | No | Sin publicación | Copia opcional consumible por Vite |
| `--tts-root` | No | Variable o fallback local | Runtime, modelos, fuente y caché Piper |

Prioridad del runtime TTS:

1. argumento `--tts-root`;
2. variable de entorno `LOCAL_VIDEO_TTS_ROOT`;
3. fallback de desarrollo construido dinámicamente en la raíz de la unidad actual con el nombre `LocalVideoTTS` en Windows, o dentro del home en otros sistemas.

No existe el literal de una ruta absoluta de Windows dentro del núcleo. Si la ruta no existe, el trabajo termina con estado `failed` y el mensaje indica que debe configurarse `--tts-root` o `LOCAL_VIDEO_TTS_ROOT`.

Ejemplo recomendado en PowerShell:

```powershell
$env:LOCAL_VIDEO_TTS_ROOT = 'D:\runtimes\local-video-tts'
node scripts/stage1/pipeline.mjs `
  --job-id=video-idea-001 `
  --config=configs\idea-001.json `
  --assets-dir=public `
  --work-dir=.local-video\work `
  --output-dir=.local-video\output
```

Las rutas absolutas solo existen dentro del contexto en memoria de cada proceso. `scene.config.json`, runtime, cues, métricas y manifiestos usan IDs y rutas relativas controladas.

## 4. Estructura por `jobId`

Para un trabajo llamado `video-idea-001`:

```text
<work-dir>/video-idea-001/
├── input/
│   └── scene.config.json
├── generated/
│   ├── audio/<voiceHash>.wav
│   ├── mouth/<voiceHash>.json
│   └── subtitle/<subtitleHash>.png
├── runtime/
│   ├── scene-runtime.json
│   └── preparation-metrics.json
├── temp/
│   ├── voice/
│   ├── subtitle/
│   ├── render-1/frames/
│   └── render-2/frames/
└── status/
    ├── progress.jsonl
    └── job-status.json

<output-dir>/video-idea-001/
├── frame-plan-1.json
├── frame-plan-2.json
├── export-metrics-1.json
├── export-metrics-2.json
├── render-1.mp4
├── render-2.mp4
├── verification.json
└── job-manifest.json
```

El exportador solo limpia `temp/<renderId>` dentro del trabajo actual. No utiliza ni borra una carpeta temporal compartida.

Si se vuelve a invocar un `jobId` con una configuración explícita diferente, el contexto rechaza la operación y exige un `jobId` nuevo. Esto evita cambiar silenciosamente la configuración conservada de un trabajo ya preparado.

## 5. Formato portable de configuración y runtime

Los assets de `public/scene.config.json` ahora se expresan así:

```json
{
  "assets": {
    "background": "assets/stage1/background.png",
    "body": "assets/stage1/body.png"
  }
}
```

El runtime de un trabajo usa rutas relativas a su carpeta `generated`:

```json
{
  "version": 1,
  "jobId": "preview",
  "cacheKey": "414bad...",
  "audio": {
    "path": "audio/414bad....wav",
    "durationSeconds": 4.89941
  },
  "mouthCuesPath": "mouth/414bad....json",
  "subtitlePath": "subtitle/730deb....png"
}
```

El exportador impide que un asset absoluto o una ruta que escape de `assets-dir`/`generated` sea utilizada.

## 6. Pipeline completo por CLI

### Pipeline headless recomendado

```powershell
$env:LOCAL_VIDEO_TTS_ROOT = 'D:\runtimes\local-video-tts'

node scripts/stage1/pipeline.mjs `
  --job-id=mi-trabajo-001 `
  --config=public\scene.config.json `
  --assets-dir=public `
  --work-dir=.local-video\work `
  --output-dir=.local-video\output
```

Este comando no inicia Vite y no abre un navegador. Produce dos renders para demostrar determinismo y ejecuta la verificación automáticamente.

### Atajo para el trabajo de preview

```powershell
npm run stage1:pipeline
```

El atajo usa `jobId=preview` y publica una copia en `public/generated` para mantener la vista previa actual.

### Etapas separadas

```powershell
node scripts/stage1/prepare-scene.mjs --job-id=mi-trabajo-001 --config=public\scene.config.json
node scripts/stage1/export-scene.mjs --job-id=mi-trabajo-001 --run=1
node scripts/stage1/export-scene.mjs --job-id=mi-trabajo-001 --run=2
node scripts/stage1/verify-stage1.mjs --job-id=mi-trabajo-001
```

Las etapas posteriores reutilizan la configuración congelada del trabajo. Todos los procesos externos continúan ejecutándose con arreglo de argumentos y `shell: false`.

### Publicación opcional para Vite

```powershell
node scripts/stage1/publish-preview.mjs `
  --job-id=mi-trabajo-001 `
  --publish-dir=public\generated
```

La publicación no interviene en el render ni en la verificación. Es solo un adaptador de filesystem para la interfaz actual.

## 7. Progreso y errores estructurados

Estados definidos:

- `preparing`
- `generating_voice`
- `analyzing_audio`
- `rendering_frames`
- `encoding`
- `completed`
- `failed`

Cada evento se imprime como una línea JSON por stdout y se agrega a `status/progress.jsonl`. El último evento queda en `status/job-status.json`.

Ejemplo:

```json
{
  "version": 1,
  "jobId": "video-idea-001",
  "state": "rendering_frames",
  "timestamp": "2026-07-22T04:50:20.715Z",
  "phase": "export",
  "renderId": "render-1",
  "frameCount": 144,
  "fps": 30
}
```

Ejemplo de error portable:

```json
{
  "version": 1,
  "jobId": "invalid-tts-portable",
  "state": "failed",
  "phase": "pipeline",
  "error": {
    "name": "Error",
    "message": "No existe el runtime TTS configurado. Defina una ruta válida con --tts-root o LOCAL_VIDEO_TTS_ROOT."
  }
}
```

La prueba de error devolvió código de proceso `1` y conservó el evento `failed`. No se persisten stacks con rutas locales.

## 8. Reglas anteriores conservadas

- La duración oficial continúa viniendo de FFprobe sobre el WAV del trabajo.
- El número de frames sigue siendo `ceil(duración × fps)`.
- El tiempo de frame sigue siendo `frameIndex / fps`.
- Preview y exportación siguen usando `shared/scene-evaluator.js`.
- Los parpadeos siguen teniendo semilla fija.
- Voz y subtítulo siguen usando claves SHA-256.
- El WAV cacheado se copia dentro de cada trabajo; ningún trabajo consume el WAV de otro trabajo directamente.
- FFmpeg y Piper siguen recibiendo argumentos separados con `shell: false`.
- Las dos exportaciones de cada trabajo siguen comparando plan, PNG y MP4.

## 9. Prueba secuencial de dos trabajos

Comando:

```powershell
npm run stage1:test-jobs
```

Modo: completamente headless y secuencial. No se indicó `publish-dir`.

Evidencia: `.local-video/test-results/two-jobs-latest.json`.

### Trabajo A

- `jobId`: `hardening-a-20260722045018`
- Duración FFprobe: 4,794921 s.
- Frames por render: 144.
- Cache key: `fb049944382b53fc8bdf78322eeb8dfa0c67a4c40bb0ee60ac2d3ed505c65972`.
- Verificaciones: 30 aprobadas, 0 fallos.
- SHA-256 de ambos MP4: `57e3de9cccff450f513201ed6c7eec7ac7231449f3bb67e9c996ae35bf937845`.
- Determinista: sí.

### Trabajo B

- `jobId`: `hardening-b-20260722045018`
- Duración FFprobe: 6,037188 s.
- Frames por render: 182.
- Cache key: `84c1d32f9035776c1cb01c823c7ff477ab6da581ef8e5e2b7da52fd0a8a584f4`.
- Verificaciones: 30 aprobadas, 0 fallos.
- SHA-256 de ambos MP4: `ac61e340b5e3ca28f1a22dcb087837039921a007d97505e08e89981ac9997517`.
- Determinista: sí.

### Controles de aislamiento aprobados

- `jobId` diferentes.
- Directorios de trabajo diferentes y no anidados.
- Directorios de resultados diferentes.
- Configuraciones distintas conservadas en cada trabajo.
- Cache keys diferentes.
- Archivos WAV distintos y con hashes distintos.
- Dos MP4 presentes por trabajo.
- Determinismo interno de ambos trabajos.
- Secuencia completa de estados presente en ambos logs.
- Ninguna dependencia de publicación o Vite.

Los diez controles del test devolvieron `true`.

## 10. Compatibilidad con la vista previa

`src/main.ts` carga ahora:

- `/generated/scene.config.json`;
- `/generated/scene-runtime.json`;
- audio, cues y subtítulo mediante rutas relativas al directorio publicado;
- assets relativos a la raíz pública.

Regresión real realizada después del pipeline:

- `npm run build`: correcto.
- Vite: solo iniciado para esta prueba posterior.
- Canvas: 1080 × 1920.
- Renderer: WebGL.
- Estado: `Lista`.
- Audio: reproduciendo.
- Tiempo observado: 1,12 / 4,90 s.
- Boca observada durante voz: `open`.
- Errores/advertencias de consola: 0.

El pipeline había finalizado y verificado sus MP4 antes de iniciar Vite.

## 11. Archivos modificados

- `public/scene.config.json`: assets convertidos a rutas relativas.
- `src/main.ts`: resolución de publicación y runtime relativo.
- `package.json`: nuevos comandos de pipeline y prueba dual.
- `.gitignore`: exclusión de `.local-video/`.
- `scripts/stage1/common.mjs`: CLI, rutas, TTS configurable y procesos.
- `scripts/stage1/generate-assets.mjs`: salida y TTS configurables.
- `scripts/stage1/prepare-scene.mjs`: preparación aislada por trabajo.
- `scripts/stage1/export-scene.mjs`: render y resultados por trabajo.
- `scripts/stage1/verify-stage1.mjs`: verificación parametrizada por trabajo.

## 12. Archivos nuevos

- `scripts/stage1/job-context.mjs`: contrato de identidad y rutas.
- `scripts/stage1/progress.mjs`: estados, JSONL y errores.
- `scripts/stage1/pipeline.mjs`: orquestador headless.
- `scripts/stage1/publish-preview.mjs`: adaptador opcional para Vite.
- `scripts/stage1/test-two-jobs.mjs`: prueba secuencial de aislamiento.
- `ETAPA_1_ENDURECIMIENTO_RESULTADOS.md`: este documento.

## 13. Problemas encontrados durante el endurecimiento

Una primera versión de la publicación opcional utilizó la copia recursiva nativa de Node. En esta instalación de Windows el proceso terminó abruptamente al copiar hacia la ruta del proyecto con `ñ`. Se reemplazó por una copia recursiva explícita de archivos con rutas resueltas. El pipeline posterior terminó correctamente y publicó la vista previa.

No se observó el mismo problema en FFmpeg, Piper ni los procesos del pipeline porque todos reciben argumentos separados y trabajan dentro de carpetas por job.

## 14. Riesgos pendientes para una futura versión multiusuario

Estos riesgos no requieren solución en la etapa local actual, pero deben considerarse antes de exponer el núcleo a solicitudes remotas:

1. **Unicidad y concurrencia de `jobId`.** El núcleo asume que dos procesos no escriben simultáneamente el mismo `jobId`. Un worker futuro deberá reservar IDs de forma atómica.
2. **Caché TTS compartida.** La voz se genera primero dentro del trabajo y luego se copia al caché, lo que reduce corrupción. Aun así, dos procesos con el mismo hash podrían intentar publicar la misma entrada al mismo tiempo; convendrá un rename atómico o lock por hash.
3. **Aislamiento de rutas suministradas.** La CLI local permite elegir raíces. Una API futura deberá imponer directorios permitidos y no aceptar rutas arbitrarias del usuario.
4. **Límites de recursos.** No existen cuotas de duración, cantidad de frames, disco, memoria o tiempo de FFmpeg.
5. **Cancelación.** Los procesos son síncronos y no existe todavía señal de cancelación cooperativa.
6. **Persistencia de progreso.** JSONL es apropiado para el prototipo y fácil de consumir por un worker, pero no reemplaza una base transaccional ni un bus de eventos.
7. **Limpieza.** No existe política automática de retención para temporales, trabajos o caché.
8. **Publicación de preview.** `public/generated` representa un único preview actual. No debe usarse como almacenamiento multiusuario; es solo un adaptador local opcional.
9. **Validación semántica del JSON.** Todavía no hay esquema formal. El endurecimiento valida identidad y límites de ruta, no todos los campos de escena.
10. **Seguridad de assets y filtros.** Antes de aceptar contenido no confiable habrá que validar tipos, dimensiones, texto y valores usados para construir filtros FFmpeg.

## 15. Decisión de cierre

El núcleo local ya puede ser invocado por un proceso externo con un contrato razonablemente parecido al que usaría un worker futuro:

- entrada explícita;
- identidad de trabajo;
- filesystem aislado;
- progreso estructurado;
- resultados deterministas;
- error serializable;
- publicación desacoplada.

No hace falta introducir backend ni infraestructura web para conservar esta compatibilidad. La siguiente etapa funcional puede construirse sobre este contexto de trabajo sin volver a acoplar el motor a la interfaz.
