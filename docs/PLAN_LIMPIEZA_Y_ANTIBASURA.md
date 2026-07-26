# Plan de limpieza y sistema anti-basura

> Instrucción ejecutable, autocontenida. Origen: auditoría del 2026-07-26 (medidas
> reales sobre este repo). Complementa a `docs/PLAN_ARREGLO_CARGA_LENTA.md` (rendimiento
> de arranque): la Fase 1 de este documento es prerrequisito del paso 1 de aquel.
> Coordinar las Fases 3 y 4 con el plan de migración/base de datos si sigue en curso,
> porque tocan `.local-video/` y el ciclo de vida de jobs.

## Estado medido (2026-07-26)

| Ubicación | Peso | Archivos | Naturaleza |
|---|---|---|---|
| `.local-video/tests` | 349 MB | 15.038 | Residuos de `npm test`; nadie los limpia. `parametric-character` solo: 224 MB |
| `tts-test/` | 188 MB | 7.761 | Entorno Python (venv, .py/.pyc/DLLs) de pruebas TTS; el runtime real vive en `C:\LocalVideoTTS` |
| `.local-video/output` | 77 MB | 407 dirs | Solo ~25 `render-*` son productos reales; **~357 dirs `compile-*` vacíos** creados por el test del compilador (7 por corrida × 51 corridas) |
| `.local-video/work` | 50 MB | 451 | Intermedios de render (~6 MB/job) que esperan 30 días |
| `.local-video/persistence-bundles` | 48 MB | 132 | Exports de bundle que duplican MP4s/PNGs de `output/` |
| `dist/` | 35 MB | 397 | Build viejo (incluye copias de `public/generated`); regenerable |
| `temp/` | 16 MB | 384 | PNGs de stage1 (`temp/frames`, `temp/stage1`); nadie los borra |
| `.claude/worktrees/` | ~10 MB | 246+ | Copia completa del repo de una sesión previa de agente |

Total recuperable: **~600 MB y ~23.000 archivos** (≈90 % de los 25.578 archivos que
el watcher de Vite escanea en cada arranque).

**Qué deja cada render del Editor** (para entender el flujo):
`app-input/render-*/project.json` (entrada, 5 KB) + `app-jobs/render-*.json` (estado,
1 KB) + `work/render-*/` (intermedios ~6 MB: WAV por diálogo, PNGs, MP4 por escena,
JSONs; al completar solo se borran `frames/` y `temp/`) + `output/render-*/`
(producto final durable: `render-1.mp4` + `project-manifest.json` + `verification.json`).
Los MP4 finales y los proyectos guardados NO son basura: no tocarlos.

---

## Fase 1 — Borrado inmediato de basura (sin cambios de código)

Precondiciones: cerrar `npm run dev`, no tener renders ni tests corriendo.
Todo lo listado es regenerable; ninguno de estos paths contiene MP4 finales
ni proyectos guardados.

```powershell
# Desde la raíz del repo. Verificar cada path antes de ejecutar.
Remove-Item -Recurse -Force .\.local-video\tests
Remove-Item -Recurse -Force .\temp
Remove-Item -Recurse -Force .\dist
# Solo los dirs de test del compilador en output/ (los render-* reales se conservan):
Get-ChildItem .\.local-video\output -Directory |
  Where-Object { $_.Name -match '^compile-(conflict|run-a|run-b|one-character|initial-point-pose|unsupported-text|unsupported-rotation)-\d{14}$' } |
  Remove-Item -Recurse -Force
# Worktree de agente ya terminado (verificar que no tenga trabajo sin commitear):
# git -C .claude\worktrees\main-branch-readme-review-96b905 status
Remove-Item -Recurse -Force .\.claude\worktrees\main-branch-readme-review-96b905
```

Verificar: `Get-ChildItem .\.local-video\output -Directory | Measure-Object` debe
quedar en ~50 dirs (solo `render-*`, pilotos y `validation-smoke`); correr un
`npm test` completo después de la Fase 2 debe dejar `.local-video/tests` de nuevo
pequeño y auto-limpiado.

Opcional (decisión de producto): mover `tts-test/` fuera del repo, junto al runtime:
`Move-Item .\tts-test C:\LocalVideoTTS\tts-test-dev`. Si se mueve, actualizar las
referencias en `docs/` si las hubiera; ningún script de `package.json` lo usa.

## Fase 2 — Que los tests no dejen residuos (cambios de código)

**2a. Fix puntual del test del compilador** — es el que ensucia el `output/` real.
En `scripts/stage3a/test-project-compiler.mjs`, `contextFor()` y el caso de conflicto
llaman a `createProjectCompilationContext` sin `output-dir`, y el default es
`.local-video/output` (`scripts/stage3a/project-compilation-context.mjs:20`).
Agregar en ambas llamadas:

```js
'output-dir': path.join(testRoot, 'output'),
```

**2b. Limpieza al final de cada test.** Regla general para `scripts/**/test-*.mjs`:
todo lo que un test escribe va bajo `.local-video/tests/<nombre>/<stamp>/` (varios ya
lo hacen) y el propio test lo borra en un `finally` cuando todas las aserciones
pasaron. Conservar el dir SOLO si el test falló (evidencia para depurar). Patrón:

```js
let passed = false;
try {
  // ... aserciones ...
  passed = true;
} finally {
  if (passed) rmSync(testRoot, { recursive: true, force: true });
}
```

Aplicarlo con prioridad a los que más pesan: `stage2f:test-parametric` (224 MB de
PNGs/SVGs por acumulación), `stage3a:test-compiler`, `stage3a:test-assembly`,
`local:test-render-manager`, `storage:test-bundle`.

**2c. Red de seguridad en el runner.** En `scripts/test-core.mjs`, al terminar la
corrida completa con éxito, borrar los subdirectorios de `.local-video/tests` con
más de 7 días. Así, aunque un test nuevo olvide su `finally`, la basura no
sobrevive más de una semana.

Verificación de la fase: correr `npm test` dos veces seguidas y comprobar que
`.local-video/tests` no crece entre corridas y que `.local-video/output` no gana
ningún dir `compile-*`.

## Fase 3 — Ciclo de vida del render sin residuos (⚠ coordinar con la migración)

**3a. Borrar `work/<job>` completo al verificar.** Hoy
`scripts/local-app/render-job-manager.mjs:242` llama a `cleanupCompletedJob`, que
solo elimina `frames/` y `temp/` y deja ~6 MB por render durante 30 días. Una vez
escrito y verificado `output/render-*/verification.json`, eliminar todo
`work/<jobId>` (el proyecto editable permite re-renderizar; los intermedios no
aportan). Conservar únicamente el estado en `app-jobs/`. Mantener la garantía
existente: nunca tocar jobs activos ni MP4 finales.

**3b. Extender la retención de arranque.** En `scripts/local-app/retention.mjs`,
`cleanLocalVideo` hoy solo barre `work/`. Extender con la misma política
(edad + tope de bytes, jamás lanzar) a:
- `.local-video/tests` (por si la Fase 2 falla en algún caso),
- `.local-video/persistence-bundles` → conservar los últimos N bundles (sugerido N=3),
- dirs vacíos huérfanos en `.local-video/output` (dir sin `render-*.mp4` ni
  `verification.json` y con más de 7 días).

**3c. Entradas duplicadas.** `app-input/render-*/project.json` se conserva hoy para
siempre. Aplicarle la misma edad que al job: cuando el job sale de `app-jobs/` por
retención, borrar su `app-input/` correspondiente.

Verificación: renderizar un video de prueba desde el Editor y comprobar que al
completar solo quedan `output/render-*/` (3 archivos) y `app-jobs/render-*.json`.

## Fase 4 — Scripts de stage y temporales

- Los scripts de stage1 escriben en `temp/frames` y `temp/stage1` y no borran.
  Cambiarlos para usar un subdirectorio de `.local-video/work/<job>/temp/` (que ya
  tiene limpieza) o borrar `temp/` al final de cada corrida exitosa.
- `dist/` solo debe existir tras un `npm run build` intencional. No commitearlo ni
  conservarlo entre sesiones; ya está en `.gitignore`, basta con borrarlo (Fase 1)
  y no regenerarlo por costumbre.

## Fase 5 — Rendimiento de arranque

Aplicar `docs/PLAN_ARREGLO_CARGA_LENTA.md` (watcher de Vite, migración de voces,
preview legacy, FOUC, exclusión de Defender). Con las Fases 1-4 de este documento
hechas, el `server.watch.ignored` de aquel plan pasa de mitigación a garantía:
el árbol queda chico y se mantiene chico.

## Criterios de éxito

1. Tras `npm test`: `.local-video/tests` vacío (o solo dirs de tests fallados) y
   cero dirs `compile-*` en `.local-video/output`.
2. Tras un render: residuo total nuevo ≤ 3 archivos fuera de `output/render-*/`.
3. Conteo de archivos del árbol (sin `node_modules/.git`) estable en el tiempo:
   `~2.500` archivos en lugar de los 25.578 actuales. Medir con:
   ```powershell
   (Get-ChildItem -Recurse -File | Where-Object FullName -notmatch 'node_modules|\.git\\').Count
   ```
4. Arranque en frío de `npm run dev` < 10 s (ver medición en
   `docs/PLAN_ARREGLO_CARGA_LENTA.md`).
