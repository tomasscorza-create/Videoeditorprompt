# Plan de acción — 24 de julio de 2026

> Documento operativo derivado de `AUDITORIA_ESTADO_REPOSITORIO_2026-07-24.md`.
> Formato pensado para ejecución por agente (Claude Opus): tareas atómicas, con
> archivos, comandos de verificación y criterio de cierre. Ejecutar en orden de
> prioridad salvo indicación del usuario.

## Contexto mínimo (leer antes de tocar nada)

- Producto: editor local de videos 2D verticales. Flujo: prompt → plan IA local
  (`qwen3:8b` vía Ollama) → proyecto editable → render determinista (PixiJS + Piper +
  FFmpeg) → MP4.
- Reglas duras del repo: **AGENTS.md manda**. No crear un segundo modelo de proyecto;
  no calcular duración desde texto (la mide FFprobe); sin dependencias nuevas ni
  React/Electron/backend sin autorización explícita; mocks aislados del contrato real.
- Verificación estándar tras cualquier cambio de código:
  `npx tsc --noEmit` + `npm test` (16 suites) + `npm run build`. Todo debe quedar verde.
- No simular en la UI capacidades que el motor no tiene (corte/estirado temporal,
  texto libre, imágenes). La UI actual respeta esto; mantenerlo.

## Estado resumido (24-jul)

- ✅ Sano: núcleo determinista, contratos Ajv, 16 suites verdes, servidor endurecido
  (token + Host/Origin), recovery de jobs, kill de árbol en Windows, render interactivo
  de una pasada, Director con restricciones (tone/duración/sceneCount), persistencia de
  sesión, editor unificado (`src/ui/editor-workspace.ts` = fuente única).
- ⚠️ Abierto: lo que sigue.

---

## P0 — Hoy (minutos, máximo impacto)

### T1 · Push + primera ejecución real del CI
- **Qué:** commitear los docs sin trackear (`docs/AUDITORIA_TECNICA_2026-07-23.md`,
  `docs/AUDITORIA_UX_UI_Y_PROPUESTA_LAYOUT.md`, `docs/AUDITORIA_ESTADO_REPOSITORIO_2026-07-24.md`,
  este plan) y hacer `git push origin main`.
- **Por qué:** main está ~27 commits por delante de origin; sin respaldo y el workflow
  de CI jamás corrió en GitHub (auditoría §2.1).
- **Requiere confirmación del usuario:** sí para el push (acción hacia remoto).
- **Cierre:** `git status -sb` sin ahead; run del workflow CI verde en GitHub Actions.
  Si el CI falla, arreglar antes de cualquier otra tarea (las suites no usan
  Ollama/Piper reales; un fallo sería de entorno/rutas, no de modelo).

### T2 · Recuperar disco
- **Qué:** ejecutar `npm run local:clean`.
- **Por qué:** `.local-video/` pesa 5,6 GB de intermedios (auditoría §2.2).
- **Cierre:** `du -sh .local-video` reducido drásticamente; `npm test` sigue verde.

---

## P1 — Esta semana

### T3 · Retención automática (que deje de ser manual)
- **Qué:** invocar la lógica de `scripts/local-app/retention.mjs` desde el ciclo de vida
  de los jobs en `scripts/local-app/render-job-manager.mjs` (al pasar a
  `completed`/`failed`/`cancelled`) y/o al arrancar `scripts/local-app/server.mjs`.
- **Restricción:** no borrar el job recién terminado ni su MP4; solo intermedios y
  jobs antiguos según la política ya existente en `retention.mjs`.
- **Cierre:** test nuevo o ampliado en `scripts/local-app/test-retention.mjs` que
  pruebe la invocación automática; suite verde; render manual de prueba no deja
  crecer `work/` indefinidamente.

### T4 · Uso real del producto (tarea del usuario, no del agente)
- **Qué:** producir 2–3 videos reales de punta a punta y anotar cada fricción.
- **Por qué:** el ROADMAP condiciona prioridades al uso personal; hoy hay más
  infraestructura que uso registrado. Este es el gate humano de la semana 4B–4D.
- **Rol del agente:** si el usuario reporta fricciones, convertirlas en tareas
  concretas antes que cualquier feature nueva.

### T5 · Primeras pruebas de la UI (lógica pura, sin DOM, sin deps nuevas)
- **Qué:** suites `node` puras para los módulos sin DOM:
  `src/ui/editor-workspace.ts` (máquina de estados modo/superficie/medio/vigencia),
  `src/ui/project/store.ts` (comandos, undo/redo, suscripción) y los cálculos de
  layout/tiempo de `src/ui/timeline.ts` si son extraíbles.
- **Cómo:** seguir el patrón existente de `scripts/*/test-*.mjs` (asserts + JSON de
  resultado + exit code); registrar en `scripts/test-core.mjs` para que el CI las
  herede. Nota: los `.ts` de `src/ui` no son importables directo desde Node — extraer
  la lógica pura a módulos testeables o compilar con `tsc` a un dir temporal; elegir
  lo que menos superficie cambie.
- **Cierre:** `npm test` incluye las suites nuevas y todo queda verde.

---

## P2 — Próximas dos semanas

### T6 · Higiene del repo (un solo commit)
- `git rm --cached output/stage1/*.mp4 pilots/monos-mundial-01/output/*.mp4 assets/test.wav`
  (binarios que `.gitignore` ya prohíbe; no borrar del disco).
- Mover los 15 `ETAPA_*_RESULTADOS.md` de la raíz a `docs/etapas/` y actualizar
  referencias (grep antes de mover: README, AGENTS, docs).
- Decidir destino de `task.md`, `comandos.md`, `implementation_plan.md`,
  `PROPUESTA_TECNICA.md` (mover a docs/ o archivar).
- **Cierre:** raíz con solo README, AGENTS y archivos de build; CI verde.

### T7 · Archivar legacy de Etapa 0
- **Qué:** `scripts/process.mjs`, `scripts/export-video.mjs`,
  `scripts/generate-assets.mjs`, `scripts/verify-output.mjs`, `tts-test/` y los npm
  scripts `assets`/`export`/`verify`.
- **Cómo:** confirmar con grep que nada vivo los importa; mover a `legacy/` o borrar
  (el historial de git los conserva); quitar los npm scripts.
- **Requiere confirmación del usuario:** sí antes de borrar.
- **Cierre:** `npm test` + `npm run build` verdes sin los scripts.

### T8 · Dos decisiones de una línea (del usuario; el agente solo documenta)
- **LICENSE:** elegir licencia del repo (hoy no hay ninguna; bloquea compartirlo).
- **Banners:** los raíles de "Publicidad de demostración" (`index.html:54-66`)
  contradicen el ROADMAP ("no monetizar antes de validar") sin documento que los
  explique. Decidir: experimento de layout (documentarlo en
  `ESTRUCTURA_VISUAL_CANONICA.md`) o quitarlos.

### T9 · Aclarar el reparto de carriles motor/UX
- **Qué:** el reparto escrito (motor = `shared/`+`scripts/`+`schema/`; UX = `src/ui/`+
  `index.html`+`style.css`) ya no refleja la práctica: los commits del 24-jul tocan
  ambos lados. Reescribir el acuerdo en el doc de colaboración o retirarlo.
- **Requiere:** decisión del usuario; el agente solo redacta.

---

## P3 — Después (motor; solo tras T4 y con evidencia de uso)

Ordenar según las fricciones observadas en T4. Candidatos ya declarados como deuda:

- **Reparación de planes rechazados y comparación de variantes** en el Director
  (`scripts/director/`): hoy un plan inválido se descarta; repararlo multiplica el
  valor del flujo estrella prompt→video.
- **Tiempos por turno en el manifiesto final** (`scripts/stage3a/`): permitiría a la
  timeline mostrar duración real por diálogo sin estimaciones.
- **Preview multiescena continuo** en el lienzo (hoy composición estática + MP4).
- **Crear/eliminar escenas y turnos desde el editor** (hoy solo edita los existentes).

## Qué NO hacer ahora

- No ampliar superficie de UI ni del creador de personajes antes de T4 (uso real).
- No añadir dependencias, frameworks ni un runner de tests externo (el patrón
  `scripts/test-*.mjs` + `test-core.mjs` es el estándar del repo).
- No tocar `shared/`, `schema/`, `scripts/stage*` para tareas de UI.
- No "arreglar" la doble pasada de verificación del pipeline CLI: es intencional;
  el modo interactivo de una pasada ya existe para la app.
- No borrar `.local-video-library/` (biblioteca durable del usuario, fuera del repo).

## Traza

| Tarea | Fuente en auditoría | Estado |
| --- | --- | --- |
| T1 | §2.1 | pendiente |
| T2 | §2.2 | pendiente |
| T3 | §2.2 | pendiente |
| T4 | §5.3 | pendiente |
| T5 | §2.4 | pendiente |
| T6 | §2.5, §2.7 | pendiente |
| T7 | §2.8 | pendiente |
| T8 | §2.3, §2.9 | pendiente |
| T9 | §2.10 | pendiente |
