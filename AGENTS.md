# Normas permanentes para agentes

Este archivo rige todo el repositorio. Léelo antes de modificar código. Es una constitución técnica, no una especificación de una etapa futura.

## 1. Misión, estado y alcance

Construimos una herramienta local, dirigida por datos, para producir videos animados 2D verticales a partir de ideas o texto. Debe combinar assets reutilizables, voz local, animación determinista, subtítulos y FFmpeg con un costo de cómputo bajo. Primero se usará personalmente para publicar contenido y validar demanda; a largo plazo podrá evolucionar hacia un producto web multiusuario y comercial.

Estado vigente:

- Etapas 0, 1, 1.1, el endurecimiento de contrato 2A y el selector de previews 2B aprobados. Las Etapas 2C, 2D y 2E están implementadas y verificadas técnicamente.
- La Etapa 2F.0 está documentada y 2F.1 está implementada, pendiente de aprobación humana de calidad. Antes de 3A falta el vertical slice paramétrico/catalogado 2F.2.
- Existe un prototipo de **una escena**: 1080 × 1920, 30 fps, dos personajes reutilizables y diferenciados, diálogo medido con dos voces Piper, boca RMS estabilizada, gesto neutral/point, subtítulo por turno y fondo opcional de tres capas con cámara/parallax deterministas, equivalente en PixiJS y MP4 H.264/AAC.
- El pipeline es headless, se invoca por CLI, usa `jobId`, rutas configurables y trabajos aislados.
- `shared/scene-evaluator.js` es el evaluador temporal compartido.
- `public/generated` es solo una publicación opcional e indexada por `jobId` para el preview; no es almacenamiento del motor.

Fuera del alcance actual salvo pedido explícito: varias escenas, editor, React, Electron, director IA, llama.cpp, lip sync fonético, usuarios, backend, base de datos, API HTTP, storage remoto, colas, Docker, suscripciones y monetización.

Dirección de largo plazo: núcleo local confiable → creación dirigida por prompt → herramientas creativas open source → editor local → separación web/worker → plataforma multiusuario → optimización económica → monetización. El roadmap no autoriza implementar una fase por anticipado.

No reinterpretar sin autorización estas decisiones:

- La IA dirige planes semánticos; no genera cada frame ni cientos de keyframes.
- El render visual final es determinista y dirigido por datos.
- Local/open source/CPU es el camino predeterminado.
- Una API paga solo se usa cuando aporta una ventaja demostrable y con presupuesto, caché, métricas y sustitución local.
- No reemplazar PixiJS, FFmpeg, Piper o el pipeline vigente sin una razón probada y una tarea específica.

Cuando documentos históricos contradigan el código actual, prevalecen este archivo, `ETAPA_1_ENDURECIMIENTO_RESULTADOS.md` y el código verificado. `PROPUESTA_TECNICA.md` y los informes de Etapa 0/1 conservan decisiones e historia, pero algunos comandos y rutas ya fueron superados.

## 2. Prioridades

Ante conflictos, usar este orden:

1. Correctitud.
2. No romper funciones existentes.
3. Mantener determinismo.
4. Mantener sincronización entre preview y exportación.
5. Simplicidad.
6. Portabilidad.
7. Rendimiento.
8. Seguridad.
9. Bajo costo de cómputo.
10. Facilidad de ampliación.

No sacrificar claridad o correctitud por optimización prematura.

## 3. Invariantes arquitectónicas

- Preview y exportación deben usar el mismo evaluador temporal. Cambios de movimiento, ojos, boca, opacidad o subtítulos requieren revisar ambos consumidores.
- La duración real proviene del WAV mediante FFprobe; nunca de una estimación de IA o texto.
- Un frame se evalúa con `frameIndex / fps`; no acumular deltas para exportar.
- Misma configuración, assets, semilla y derivados deben producir el mismo plan, frames y MP4 verificable.
- Voz, análisis, subtítulos, planes y otros derivados deben poder cachearse por hash de todas sus entradas relevantes.
- El núcleo no depende de Vite, DOM, navegador ni interfaz. El pipeline completo debe funcionar headless.
- Configuraciones, runtimes, cues y manifiestos no contienen rutas absolutas. Usar IDs y rutas relativas bajo raíces controladas.
- Procesos externos reciben ejecutable y lista de argumentos, con `shell: false`. Nunca interpolar comandos de proyecto en una shell.
- Todo render tiene `jobId` válido, configuración congelada y carpetas propias de trabajo, temporales y resultados.
- Nunca mezclar o limpiar temporales de otro trabajo. Toda eliminación debe validar el destino dentro del trabajo actual.
- TTS, IA, render y storage deben evolucionar hacia contratos reemplazables; no extender los acoplamientos actuales de Piper o filesystem.
- Progreso y errores son estructurados, vinculados a `jobId` y comprensibles por humanos y procesos.
- El código nuevo del motor no debe depender obligatoriamente de Windows. Diseñar para un worker Linux/contenedor, aunque la compatibilidad aún deba probarse.
- JSON de proyecto es datos, no código. No admitir scripts, comandos ni expresiones arbitrarias aportadas por el usuario.

## 4. Mapa del repositorio vigente

- `scripts/stage1/pipeline.mjs`: orquestador headless canónico.
- `scripts/stage1/job-context.mjs`: `jobId`, raíces y aislamiento.
- `scripts/stage1/prepare-scene.mjs`: Piper, FFprobe, RMS, subtítulo y runtime.
- `scripts/stage1/export-scene.mjs`: plan de frames, PNG y MP4.
- `scripts/stage1/verify-stage1.mjs`: integración, formatos y determinismo.
- `scripts/stage1/progress.mjs`: estados JSONL y estado final.
- `scripts/stage1/publish-preview.mjs`: adaptador opcional hacia `public/generated`.
- `public/generated/index.json`: índice local de previews publicados; cada job vive bajo su propia subcarpeta.
- `shared/scene-evaluator.js`: lógica temporal compartida.
- `src/main.ts`: preview PixiJS y selector mediante `?job=<jobId>`; no debe absorber lógica del motor y no es todavía un editor.
- `public/scene.config.json`: ejemplo vigente del contrato mínimo de una escena.
- `schema/scene-config.schema.json`: JSON Schema 2020-12 del contrato versión 1.
- `schema/scene-config-v2.schema.json`: contrato de una escena con exactamente dos personajes, diálogo secuencial medido y gesto opcional por turno.
- `schema/character-manifest.schema.json`: contrato versión 1 de un rig alineado con ojos, bocas y poses de manos.
- `scripts/stage1/validate-scene-config.mjs`: validación estructural, semántica, de rutas/assets y límites medidos.
- `pilots/personaje-mono-01/scene.config.json`: piloto vigente del personaje animable real.
- `pilots/dialogo-monos-01/scene.config.json`: piloto del contrato v2 con dos hablantes y tres turnos.
- `pilots/fondo-parallax-01/scene.config.json`: piloto v2 con tres planos, paneo, zoom y parallax.
- `scripts/stage2c/generate-monkey-character.mjs`: generador determinista de las fuentes SVG y capas PNG del mono; no forma parte del render normal.
- `scripts/*.mjs`, `assets/` y `tts-test/`: evidencia/flujo legacy de Etapa 0. No usarlos como base para funciones nuevas.
- `.local-video/`: trabajos y evidencia local regenerable; no versionar.

Comandos canónicos:

```powershell
npm run stage1:pipeline    # trabajo preview + publicación opcional
npm run stage1:test-jobs   # dos trabajos headless y determinismo
npm run stage2b:test-preview # publicación aislada e índice de previews
npm run build              # TypeScript + Vite
```

Para otros trabajos, invocar `scripts/stage1/pipeline.mjs` con `--job-id` y las raíces necesarias. Configurar Piper con `LOCAL_VIDEO_TTS_ROOT` o `--tts-root`.

### Brechas vigentes (no confundir con capacidades implementadas)

- Los contratos v1 y v2 están deliberadamente limitados a una escena; todavía no existe el contrato futuro de proyectos con varias escenas.
- El contrato de rig versión 1 solo demuestra una pose neutral y `point`; todavía no modela un catálogo general de gestos. Las múltiples instancias y los turnos pertenecen al contrato de escena v2.
- El piloto 2D reutiliza el mismo rig y modelo Piper; 2F.1 agrega dos rigs y dos voces, pero su casting visual/vocal sigue pendiente de aprobación humana.
- El fondo del piloto 2C es estático; cámara, parallax y elementos ambientales pertenecen a una etapa posterior.
- 2E implementa paneo/zoom global y parallax por capa; todavía no existen keyframes libres, loops ambientales configurables ni varias escenas.
- La boca sigue una envolvente RMS estabilizada, no fonemas; su mejora técnica no equivale a aprobación visual.
- La voz `es_ES-davefx-medium` está instalada solo en el runtime local y requiere evaluación auditiva antes de aceptarse como voz de producto.
- `prepare-scene.mjs` conoce directamente Piper, su modelo y `venv/Scripts/python.exe`; proveedor reemplazable y Linux aún son objetivos, no hechos.
- La caché TTS y un mismo `jobId` no están protegidos ante procesos concurrentes.
- Los procesos usan `spawnSync` sin timeout ni cancelación.
- Los fallos del pipeline tienen estructura plana, etapa y código estable para validación/procesos conocidos; errores internos no clasificados usan `UNEXPECTED_ERROR`.
- Los comandos npm legacy `assets`, `export` y `verify` pertenecen a Etapa 0 y usan temporales/resultados globales; no extenderlos y planificar su archivo/deprecación en una tarea específica.
- Cada subcarpeta publicada se reconstruye al republicar su job; el índice global aún no tiene locking para publicaciones concurrentes y pueden quedar archivos legacy planos de etapas anteriores.
- Compatibilidad Linux, límites de recursos, limpieza/retención y licencias completas de assets requieren trabajo antes de un servicio web.

## 5. Disciplina de alcance y protocolo de cambio

Antes de trabajar:

1. Identificar exactamente el pedido y los módulos afectados.
2. Declarar qué queda fuera.
3. Leer archivos afectados, pruebas, tipos y configuración relacionada.
4. Buscar funciones existentes antes de crear otras.
5. Explicar brevemente el cambio y luego implementarlo.

Para cambios amplios: inspeccionar arquitectura/dependencias, identificar riesgos, proponer una secuencia verificable e implementar por pasos. Para cambios mínimos, no exigir un diseño extenso.

Reglas:

- No agregar funciones no solicitadas ni ampliar “por si acaso”.
- No crear una abstracción hasta que existan dos usos reales o un límite externo ya aprobado.
- No reemplazar tecnología estable sin evidencia.
- No introducir una dependencia para un problema pequeño resuelto claramente con Node, TypeScript o código existente.
- No modificar outputs históricos para hacer pasar una prueba nueva; producir evidencia nueva por trabajo.
- Preservar cambios del usuario y evitar tocar archivos ajenos al alcance.

## 6. Pruebas proporcionales

Explicar al finalizar qué nivel se eligió y por qué.

### Nivel 1 — Cambio local pequeño

Texto, estilo, mensaje o valor de configuración:

- prueba directa o inspección del elemento;
- typecheck/build relacionado si aplica;
- revisión manual breve.

No ejecutar el pipeline completo si el cambio no puede afectarlo.

### Nivel 2 — Lógica de módulo

RMS, caché, movimiento, evaluador o subtítulos:

- prueba específica del módulo;
- caso normal y un límite relevante;
- typecheck;
- integración directa con su consumidor.

Si cambia `shared/scene-evaluator.js`, comparar preview y exportación.

### Nivel 3 — Integración

TTS, preparación, FFmpeg, exportación o trabajos:

- pipeline afectado;
- FFprobe del archivo generado;
- errores y rutas relevantes;
- repetición cuando intervenga determinismo.

### Nivel 4 — Arquitectura o pre-release

- suite completa disponible;
- build;
- exportación completa y determinismo;
- múltiples trabajos;
- revisión de seguridad, documentación y rendimiento.

No ejecutar pruebas sin relación, pero nunca omitir las que protegen el invariante cambiado.

## 7. Uso eficiente de Codex e IA

- Leer primero `AGENTS.md`, documentación vigente y archivos centrales afectados.
- Usar `rg` y búsquedas específicas; no recorrer repetidamente todo el repo.
- No reanalizar archivos sin cambios ni repetir auditorías completas tras ajustes menores.
- Agrupar cambios relacionados y usar herramientas locales para medir en vez de inferir.
- Preferir scripts deterministas a razonamiento repetitivo de IA.
- No pedir a modelos cientos de keyframes ni enviar imágenes/audio grandes si un algoritmo local basta.
- No usar IA para formatos, hashes, metadata, validación o cálculos.
- Mantener prompts breves, con catálogo cerrado y salida estructurada.
- Cachear guiones, planes, voces, subtítulos y análisis cuando sus entradas no cambien.

Para una IA paga: definir tarea exacta, contexto mínimo, esquema de salida, límite de tokens, clave de caché, prevención de duplicados, consumo/costo estimado, presupuesto máximo y fallback local. Nunca usarla para tareas repetitivas y deterministas resolubles localmente.

## 8. Seguridad

- Validar tipos, rangos y referencias de toda entrada.
- Antes de aceptar contenido no confiable, imponer límites de texto, escenas, duración, resolución, tamaño de asset, frames y output.
- Resolver rutas bajo raíces permitidas y rechazar absolutas, traversal y symlinks que escapen del trabajo.
- Sanitizar `jobId` y futuros nombres de archivos.
- No ejecutar código, filtros libres, URLs o comandos procedentes del JSON.
- Mantener argumentos separados, directorios aislados y limpieza limitada al trabajo validado.
- Agregar timeouts/cancelación y límites de CPU, RAM y disco antes de ejecución online.
- No incluir claves, tokens, prompts sensibles, datos personales o secretos en código, commits, logs u outputs.
- Usar variables de entorno para configuración sensible.
- Registrar fuente, autor, licencia y atribución de modelos, voces, fuentes, música e imágenes.
- Revisar licencias antes de distribuir o monetizar assets y modelos.

## 9. Dependencias

Toda dependencia nueva debe documentar: problema, insuficiencia del código existente, mantenimiento, licencia, tamaño/impacto, Windows/Linux, efecto web/contenedor, riesgos de seguridad y sustitución posible.

Evitar paquetes masivos para funciones pequeñas. No actualizar versiones principales sin tarea explícita, lectura de notas de migración y pruebas proporcionales. Mantener el lockfile coherente.

## 10. Errores y observabilidad

El formato objetivo de fallo debe poder representar:

```json
{
  "version": 1,
  "jobId": "job-123",
  "state": "failed",
  "stage": "encoding",
  "code": "FFMPEG_EXIT_NONZERO",
  "message": "No se pudo codificar el video.",
  "technicalDetail": "detalle acotado",
  "cause": "causa conocida o encadenada",
  "suggestedAction": "acción concreta"
}
```

`jobId`, etapa, código, mensaje humano y estado final son obligatorios para errores del pipeline. Detalle, causa y acción se incluyen cuando aportan valor. No persistir stacks con rutas locales, secretos, prompts completos ni salida externa ilimitada. Los logs deben ser suficientes para diagnosticar, no ruidosos.

Estados actuales mínimos: `preparing`, `generating_voice`, `analyzing_audio`, `rendering_frames`, `encoding`, `completed`, `failed`. Si se agregan estados, versionar el contrato y actualizar consumidores.

## 11. Documentación

Actualizar documentación cuando cambien arquitectura, configuración, comandos, dependencias, variables de entorno, assets, pipeline, invariantes o restricciones. No crear un informe largo por una corrección menor.

- `AGENTS.md`: normas permanentes y estado resumido.
- `docs/ROADMAP.md`: dirección y gates; no describe trabajo ya autorizado.
- `docs/DEVELOPMENT_CHECKLIST.md`: control operativo breve.
- Informes `ETAPA_*`: evidencia histórica; no reescribirlos para ocultar evolución.

Usar comentarios de código solo para decisiones no evidentes.

## 12. Criterio de finalización

Una tarea termina cuando:

- funciona lo solicitado;
- no se rompió el comportamiento afectado;
- se ejecutaron pruebas proporcionales y se explicó su selección;
- se manejaron errores relevantes;
- no se amplió el alcance;
- no quedaron temporales accidentales ni secretos;
- se revisaron licencias si hubo assets/modelos;
- se actualizó la documentación afectada;
- se informó qué cambió, qué se probó y qué queda pendiente.
