# Etapa 2A — Contrato mínimo y validación

Fecha de cierre técnico: 22 de julio de 2026.

## Resultado

La Etapa 2A quedó implementada y verificada. El pipeline de una escena ahora rechaza configuraciones inválidas antes de generar voz, analizar audio o renderizar frames. El contrato está versionado, las rutas de assets quedan confinadas a una raíz controlada, la duración real tiene límites y los fallos del pipeline se registran en un formato plano y reutilizable.

No se agregaron varias escenas, nuevas funciones visuales, editor, React, Electron, IA, backend ni proveedores adicionales.

## Alcance exacto del contrato

La fuente normativa es `schema/scene-config.schema.json`. Usa JSON Schema 2020-12 y acepta únicamente el formato que el prototipo actual puede ejecutar.

| Área | Reglas principales |
|---|---|
| Versión | `version` debe ser `1`. |
| Video | Fijo en 1080 × 1920 y 30 fps. |
| Assets | Se requieren fondo, cuerpo, dos estados de ojos y tres estados de boca. Cada ruta admite entre 1 y 512 caracteres. |
| Voz | ID seguro de modelo; texto de 1 a 1000 caracteres; `lengthScale` entre 0,5 y 3; volumen entre 0 y 2. |
| Personaje | Posición, entrada, oscilación y escala conservan los campos actuales con rangos finitos. |
| Parpadeo | Semilla entera de 32 bits; tiempos positivos y acotados. |
| Boca | Ventana de 10–100 ms; smoothing de 0–0,99; umbrales normalizados; estado mínimo de 0–1000 ms. |
| Subtítulo | Texto de 1 a 500 caracteres; inicio no negativo; fuente de 8–200 px; margen dentro del alto vertical. |
| Campos extra | Se rechazan en todos los objetos mediante `additionalProperties: false`. |

Reglas semánticas complementarias:

- El intervalo mínimo de parpadeo no puede superar al máximo.
- El umbral de silencio de la boca debe ser menor que el umbral de apertura.
- Las rutas de assets deben ser relativas y usar `/`; se rechazan rutas absolutas Windows/POSIX, URLs, `..`, barras invertidas y escapes por enlaces simbólicos.
- Cada asset debe existir, ser un archivo real y resolver dentro de `assets-dir`.
- La duración se sigue midiendo con FFprobe. Debe ser mayor que cero y no superar 120 segundos.
- El límite equivalente es 3600 frames a 30 fps.
- El subtítulo no puede comenzar después de que termina el WAV medido.

Estos límites son una política prudente para el prototipo, no una promesa definitiva del formato futuro.

## Integración con el pipeline

`createJobContext` continúa congelando una copia de la configuración dentro de cada trabajo, pero ya no intenta interpretarla antes de que exista el contexto del job. La carga y validación común se realiza con `loadAndValidateJobConfig`.

El mismo punto de validación es utilizado por:

- el pipeline completo;
- preparación/TTS;
- exportación;
- verificación;
- publicación opcional del preview.

Por lo tanto, ejecutar un comando individual no permite eludir el contrato. Una configuración inválida puede crear las carpetas aisladas del job y conservar su input para diagnóstico, pero no inicia Piper ni FFmpeg.

La validación de duración ocurre después de crear o recuperar el WAV y después de consultar FFprobe, porque la duración estimada desde el texto no es una fuente confiable.

## Formato de progreso y errores

Los eventos siguen siendo JSON Lines y conservan los estados ya aprobados. Los campos de éxito ahora usan `stage` en lugar de `phase`. Un fallo persistido tiene esta forma:

```json
{
  "version": 1,
  "jobId": "validation-pipeline-failure-20260722063458",
  "state": "failed",
  "timestamp": "2026-07-22T06:34:58.982Z",
  "stage": "validating_config",
  "code": "ASSET_PATH_INVALID",
  "message": "La ruta /assets/body debe ser relativa, portable y permanecer dentro de assets-dir.",
  "technicalDetail": "/assets/body",
  "suggestedAction": "Use una ruta relativa con barras normales, por ejemplo assets/personaje.png."
}
```

Campos obligatorios dentro de un job fallido: `version`, `jobId`, `state`, `timestamp`, `stage`, `code` y `message`. `technicalDetail`, `cause` y `suggestedAction` son opcionales y están limitados a 4000 caracteres. No se persisten stacks.

Códigos incorporados incluyen:

- `CONFIG_JSON_INVALID`
- `CONFIG_SCHEMA_INVALID`
- `CONFIG_SEMANTIC_INVALID`
- `ASSET_PATH_INVALID`
- `ASSET_NOT_FOUND`
- `ASSET_SYMLINK_ESCAPE`
- `AUDIO_DURATION_OUT_OF_RANGE`
- `FRAME_LIMIT_EXCEEDED`
- `SUBTITLE_START_AFTER_AUDIO`
- códigos específicos de inicio/salida no cero para Piper, FFmpeg y FFprobe
- `UNEXPECTED_ERROR` como último recurso para fallos internos no clasificados

## Dependencia añadida: Ajv

Se instaló `ajv@8.20.0` como única dependencia directa nueva.

- Problema resuelto: aplicar de manera estándar y auditable JSON Schema 2020-12, incluyendo campos requeridos, tipos, rangos y rechazo de propiedades desconocidas.
- Por qué no bastaba el código existente: validarlo manualmente implicaba reimplementar parcialmente un estándar, producir errores inconsistentes y aumentar el costo de mantener o consumir el contrato desde herramientas futuras.
- Estado de mantenimiento: versión 8.20.0 publicada el 24 de abril de 2026; el proyecto oficial mantiene documentación, releases y política de seguridad.
- Licencia: MIT.
- Impacto: paquete desempaquetado de 1.033.496 bytes; añadió cuatro dependencias transitivas pequeñas (`fast-deep-equal`, `fast-uri`, `json-schema-traverse` y `require-from-string`).
- Portabilidad: JavaScript para Node.js, sin binarios nativos; funciona en Windows y Linux. Ajv también puede usarse en navegador, aunque en esta etapa la validación canónica permanece en el motor Node/headless.
- Contenedor/web futuro: no acopla el contrato al filesystem ni a Windows. El esquema puede compartirse con un worker o formulario futuro.
- Seguridad: se compila únicamente un esquema estático y confiable del repositorio. La configuración del usuario sigue siendo datos y no se ejecuta como código. `npm audit --omit=dev` informó cero vulnerabilidades.
- Sustitución: `validate-scene-config.mjs` concentra el uso de Ajv; puede reemplazarse por otro validador compatible con JSON Schema 2020-12 sin cambiar el pipeline.

Fuentes oficiales consultadas:

- [Guía oficial de Ajv](https://ajv.js.org/guide/getting-started)
- [Repositorio, licencia y releases de Ajv](https://github.com/ajv-validator/ajv)

## Archivos creados

- `schema/scene-config.schema.json`
- `scripts/stage1/errors.mjs`
- `scripts/stage1/validate-scene-config.mjs`
- `scripts/stage1/test-config-validation.mjs`
- `ETAPA_2A_CONTRATO_Y_VALIDACION_RESULTADOS.md`

## Archivos modificados

- `package.json`
- `package-lock.json`
- `scripts/stage1/common.mjs`
- `scripts/stage1/job-context.mjs`
- `scripts/stage1/progress.mjs`
- `scripts/stage1/prepare-scene.mjs`
- `scripts/stage1/export-scene.mjs`
- `scripts/stage1/verify-stage1.mjs`
- `scripts/stage1/pipeline.mjs`
- `scripts/stage1/publish-preview.mjs`
- `AGENTS.md`
- `docs/ROADMAP.md`

No se modificaron el evaluador temporal compartido, la composición PixiJS, los assets visuales ni el formato de runtime/cues.

## Uso por CLI

Validación automatizada específica:

```powershell
npm run stage1:test-config
```

Pipeline habitual de preview:

```powershell
npm run stage1:pipeline
```

Trabajo headless con rutas explícitas:

```powershell
node scripts/stage1/pipeline.mjs `
  --job-id video-01 `
  --config ".\proyectos\video-01.json" `
  --assets-dir ".\public" `
  --work-dir ".\.local-video\work" `
  --output-dir ".\.local-video\output" `
  --tts-root $env:LOCAL_VIDEO_TTS_ROOT
```

Las rutas con espacios o caracteres Unicode son argumentos independientes. Los procesos externos continúan recibiendo ejecutable y array de argumentos con `shell: false`.

## Evidencia de pruebas

Se aplicó Nivel 4 porque el cambio afecta el contrato de entrada y todos los puntos del pipeline.

### 1. Suite de configuración

Comando:

```powershell
npm run stage1:test-config
```

Resultado final: 16 casos aprobados, 0 fallidos. Incluyó:

- configuración válida;
- duración medida válida y fuera de límite;
- subtítulo posterior al audio;
- campo requerido ausente;
- campo desconocido;
- resolución inválida;
- texto excesivo;
- ruta absoluta, URL y traversal;
- asset inexistente;
- intervalos de parpadeo invertidos;
- umbrales de boca incompatibles;
- JSON malformado;
- fallo real del pipeline con salida estructurada y sin iniciar TTS/render.

Evidencia regenerable: `.local-video/test-results/config-validation-latest.json`.

### 2. Build y compatibilidad del preview

Comando:

```powershell
npm run build
```

Resultado: TypeScript y Vite completaron correctamente; 710 módulos transformados. No se cambió código visual. El pipeline volvió a publicar los derivados en `public/generated`, por lo que el circuito actual del preview se conserva. No fue necesario abrir el navegador para esta etapa sin cambios visuales.

### 3. Pipeline completo

Comando:

```powershell
npm run stage1:pipeline
```

Resultado:

- duración FFprobe: 4,899410 s;
- 147 frames a 30 fps;
- dos renders: 5,481 s y 5,185 s;
- 30 verificaciones aprobadas;
- H.264, AAC, yuv420p, 1080 × 1920, 30/1 fps;
- plan temporal idéntico;
- contenido PNG idéntico;
- MP4 binariamente idénticos;
- manifest `deterministic: true`;
- publicación de preview conservada.

### 4. Dos trabajos aislados

Comando:

```powershell
npm run stage1:test-jobs
```

Resultado: los 10 controles existentes pasaron.

| Job | Duración | Verificaciones | SHA-256 MP4 | Determinista |
|---|---:|---:|---|---|
| `hardening-a-20260722063332` | 4,794921 s | 30 | `57e3de9cccff450f513201ed6c7eec7ac7231449f3bb67e9c996ae35bf937845` | Sí |
| `hardening-b-20260722063332` | 6,037188 s | 30 | `ac61e340b5e3ca28f1a22dcb087837039921a007d97505e08e89981ac9997517` | Sí |

Ambos conservaron configuración, audio, resultados, caché y carpetas independientes. La ejecución fue headless y no publicó en `public/`.

### 5. Dependencias y seguridad

```powershell
npm ls --depth=0
npm audit --omit=dev
```

Resultado: Ajv 8.20.0 instalado y cero vulnerabilidades informadas.

## Riesgos pendientes

- Este esquema no debe ampliarse directamente a varias escenas sin diseñar primero el contrato de proyecto y su migración/versionado.
- La validación canónica ocurre en Node; la vista previa no muestra todavía errores de esquema por sí sola.
- Los topes de 1000 caracteres y 120 segundos son provisionales y deberían revisarse con videos reales.
- La validación temprana confirma existencia y confinamiento de assets; dimensiones, transparencia y codecs se siguen comprobando durante la verificación integral.
- Piper todavía está acoplado en preparación a su layout actual de Windows.
- Un mismo `jobId` y la caché TTS no tienen reserva atómica para concurrencia.
- Los procesos externos aún no tienen timeout ni cancelación.
- Linux y contenedores todavía no fueron probados.

## Decisión y siguiente gate

El contrato mínimo de una escena puede considerarse aprobado técnicamente. Antes de ampliar a varias escenas conviene usar este formato en uno o dos videos reales y confirmar que los límites y mensajes de error son cómodos. El próximo cambio funcional debería seguir siendo pequeño y basado en una necesidad observada, no convertir este esquema directamente en un editor o formato general.
