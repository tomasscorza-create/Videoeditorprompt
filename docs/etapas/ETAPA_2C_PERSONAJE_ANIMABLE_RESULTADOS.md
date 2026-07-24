# Etapa 2C — Personaje animable por capas

Fecha: 22 de julio de 2026.

Estado: implementada y verificada técnicamente. Pendiente únicamente la aceptación visual del usuario.

## Resultado

El motor puede cargar un personaje reutilizable desde un manifiesto versionado y componer, en preview PixiJS y exportación FFmpeg, estas capas alineadas:

- cuerpo;
- ojos abiertos y cerrados;
- boca cerrada, media y abierta;
- brazo/mano neutral;
- brazo/mano señalando.

El piloto `piloto-personaje-mono-01` usa Piper, boca RMS, parpadeos deterministas, movimiento idle y un gesto `point` entre 2,00 y 3,50 segundos. Los trabajos anteriores continúan funcionando sin manifiesto.

No se implementaron varias escenas, dos hablantes, editor, React, Electron, director IA, lip sync fonético ni fondo animado.

## Arquitectura incorporada

`scene.config.json` puede seguir declarando las capas directamente, como antes, o incluir `characterManifest`. No puede hacer ambas cosas a la vez.

El manifiesto define:

- `version` e `id` estable;
- canvas 1080 × 1920;
- pivote común;
- rutas relativas de todas las capas;
- fuente y licencia del asset.

Durante `prepare`, el manifiesto se valida y se compila a `runtime.assets` y `runtime.characterRig`. Todas las rutas persistidas siguen siendo relativas. Preview y exportación prefieren esos assets compilados y conservan fallback a `config.assets` para trabajos antiguos.

El gesto se expresa como dato semántico:

```json
{
  "pose": "point",
  "startSeconds": 2,
  "durationSeconds": 1.5
}
```

`shared/scene-evaluator.js` devuelve `gesture: "neutral" | "point"` para cada tiempo. PixiJS y FFmpeg consumen exactamente ese estado; no mantienen timelines distintas.

## Assets del personaje

El personaje `mono-presentador-v1` es un asset vectorial original del proyecto. Las fuentes SVG se conservan junto a nueve PNG generados. Todas las capas miden 1080 × 1920 y las ocho capas del personaje tienen formato RGBA.

Procedencia registrada: creación vectorial determinista del proyecto.

Licencia registrada: asset original para uso interno del proyecto.

La regeneración usa Chrome o Edge local en modo headless porque el FFmpeg instalado reconoce `svg_pipe` pero no contiene un decodificador SVG. Esto solo afecta al script de creación del asset. El pipeline normal consume PNG y no depende del navegador. Se puede configurar otro Chromium mediante `LOCAL_VIDEO_CHROMIUM`.

## Archivos incorporados o modificados

- `schema/scene-config.schema.json`
- `schema/character-manifest.schema.json`
- `scripts/stage1/validate-scene-config.mjs`
- `shared/scene-evaluator.js`
- `shared/scene-evaluator.d.ts`
- `scripts/stage1/prepare-scene.mjs`
- `scripts/stage1/export-scene.mjs`
- `scripts/stage1/verify-stage1.mjs`
- `src/main.ts`
- `index.html`
- `package.json`
- `scripts/stage1/test-character-rig.mjs`
- `scripts/stage2c/generate-monkey-character.mjs`
- `pilots/personaje-mono-01/scene.config.json`
- `public/assets/characters/mono-presentador-v1/`
- `AGENTS.md`
- `docs/ROADMAP.md`
- `docs/PLAN_DESPUES_PILOTO_01.md`

No se agregó ninguna dependencia npm.

## Comandos principales

Generar o regenerar el personaje:

```powershell
npm run stage2c:assets
```

Validar el contrato del rig y sus límites:

```powershell
npm run stage2c:test-rig
```

Ejecutar el piloto completo:

```powershell
node scripts/stage1/pipeline.mjs `
  --job-id=piloto-personaje-mono-01 `
  --config=pilots/personaje-mono-01/scene.config.json `
  --assets-dir=public `
  --publish-dir=public/generated
```

Abrir el preview:

```text
http://localhost:5173/?job=piloto-personaje-mono-01
```

## Evidencia del piloto

- Audio medido por FFprobe: 7,465215 s.
- Frames: 224 a 30 fps.
- Render 1, generación de frames: 6,841 s.
- Render 1, codificación: 1,229 s.
- Render 1, total: 8,142 s.
- MP4: 770.150 bytes.
- Video: H.264, 1080 × 1920, 30 fps, `yuv420p`.
- Audio: AAC, mono, 22.050 Hz.
- Duración final: 7,466016 s.
- Verificaciones del piloto: 39 aprobadas, 0 fallidas.
- Dos planes temporales idénticos.
- Dos secuencias PNG con hash idéntico.
- Dos MP4 binariamente idénticos.

Parpadeos programados: 0,85; 2,590; 4,490 y 6,315 segundos. El gesto `point` ocupa exactamente 45 frames.

La inspección visual confirmó:

- pose neutral completa;
- tres bocas visibles;
- ojos abiertos y cerrados bien alineados;
- brazo señalando sin salto respecto del torso;
- gesto y parpadeo simultáneos;
- subtítulo legible;
- fondo vertical sin zonas vacías.

La prueba del preview confirmó WebGL, selección correcta del job y cambio observable a `mouth=open`, `eyes=open`, `gesture=point` a los 2,13 segundos.

## Pruebas ejecutadas

Se eligió nivel 4 porque cambiaron contrato, evaluación temporal, preview y composición FFmpeg.

- `npm run stage2c:test-rig`: 6/6.
- `npm run stage1:test-config`: 16/16.
- `npm run build`: correcto.
- pipeline completo del rig: 39/39 y determinista.
- `npm run stage1:pipeline`: 30/30 para el contrato legacy.
- `npm run stage1:test-jobs`: dos jobs aislados, ambos deterministas.
- `npm run stage2b:test-preview`: 10/10.
- FFprobe del nuevo MP4: correcto.
- Preview PixiJS real: correcto.

## Problemas encontrados

1. El intento inicial de convertir SVG con FFmpeg falló por ausencia de decodificador SVG. Se reemplazó por rasterización headless con Chromium, sin dependencia nueva.
2. Dos ejecuciones de terminal fueron detenidas por ventanas de espera demasiado cortas. Se relanzaron con el mismo `jobId`; el aislamiento y la caché permitieron continuar sin conflicto.
3. Ejecutar la regresión de `preview` lo publica como el job más reciente. Al cerrar esta etapa se vuelve a publicar `piloto-personaje-mono-01` para dejarlo como predeterminado.

## Compatibilidad y riesgos pendientes

- Los configs legacy siguen funcionando con capas directas.
- Los jobs ya publicados siguen abriendo por el fallback del preview.
- El motor sigue siendo headless; Vite no interviene en el render.
- El rig actual cubre solo `neutral` y `point`. No debe generalizarse todavía sin aprender de un segundo uso real.
- El gesto cambia de pose sin interpolación articular. Para el prototipo es suficiente; una transición más elaborada puede evaluarse cuando existan más poses.
- El fondo continúa estático.
- Todavía hay una sola voz y un solo personaje activo.
- La regeneración de fuentes SVG requiere Chromium; los PNG ya generados son portables.

## Qué debe verificar el usuario

En `http://localhost:5173/?job=piloto-personaje-mono-01`:

1. La boca debe cambiar varias veces mientras habla.
2. Los ojos deben parpadear brevemente.
3. Entre 2,00 y 3,50 s debe levantar el brazo derecho y señalar.
4. Fuera de ese intervalo debe recuperar la pose neutral.
5. El cuerpo debe entrar desde la izquierda y mantener un idle leve.
6. El selector debe permitir volver a `preview` y `piloto-monos-mundial-01`.
7. El enlace de descarga debe entregar el nuevo MP4.

## Próximo paso recomendado

Si la actuación visual queda aprobada, la siguiente etapa es 2D: diálogo temporizado con dos personajes, turnos medidos, dos voces o configuraciones diferenciadas, subtítulos por turno y boca activa solo en el hablante. Debe mantenerse en una sola escena y todavía sin editor.
