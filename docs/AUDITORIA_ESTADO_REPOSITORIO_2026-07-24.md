# Auditoría del estado del repositorio — 24 de julio de 2026

Instantánea de `main` en el working tree local. Solo auditoría: no se modificó código.
Complementa (y en gran parte actualiza) `AUDITORIA_TECNICA_2026-07-23.md` y
`AUDITORIA_UX_UI_Y_PROPUESTA_LAYOUT.md`, escritas ayer sobre un repo que hoy tiene
27 commits más.

## Cómo se hizo

| Verificación | Resultado |
| --- | --- |
| `npx tsc --noEmit` | sin errores |
| `npm test` (16 suites agregadas por `scripts/test-core.mjs`) | 16/16 pasan, 0 fallos |
| Revisión de `scripts/local-app/`, `scripts/director/`, `scripts/stage3a/`, `shared/`, `src/ui/` | ver hallazgos |
| Contraste punto por punto con las dos auditorías del 23-jul | ver §1 |
| Estado git: rama, remoto, artefactos versionados, `.gitignore` | ver §3 |

Severidad: **A** = atender antes de seguir ampliando · **M** = planificar · **B** = anotar.

---

## 1. Lo que se corrigió desde la auditoría del 23 de julio

La mayor parte de los hallazgos graves de ayer **ya está resuelta**. Conviene dejarlo
escrito porque las auditorías del 23 siguen en `docs/` y, leídas solas, describen un
repo peor del que existe:

| Hallazgo del 23-jul | Estado hoy |
| --- | --- |
| §1.1 Servidor aceptaba peticiones sin `Origin` | **Corregido**: mutaciones exigen `Origin` permitido + `Host` validado + token de sesión `x-local-video-token` (`server.mjs:51-61`) |
| §1.3 Estado de jobs solo en memoria, no sobrevivía reinicios | **Corregido**: `recoverPersistedJobs()` al arrancar; jobs `queued/rendering` huérfanos pasan a `failed` con etapa `recovery` (`render-job-manager.mjs:264`) |
| §1.5 `child.kill()` no mataba `ffmpeg`/`piper` en Windows | **Corregido**: `taskkill /pid /T /F` en Windows, grupo de procesos en el resto (`render-job-manager.mjs:349-364`) |
| §2.1 Sin política de retención | **Parcial**: existen `scripts/local-app/retention.mjs`, `npm run local:clean` y su suite; pero es manual (ver §2.2 abajo) |
| §2.2 Doble render obligatorio en el flujo interactivo | **Corregido**: `--verification-mode=interactive` renderiza una sola pasada y la app lo usa (`render-job-manager.mjs:76`) |
| §3.1 Reglas del proyecto escritas tres veces sin prueba de equivalencia | **Corregido**: `stage3b:test-contracts` pasa los mismos proyectos por validador, editor, gate de render y compilador y exige veredictos iguales |
| §4.1/B1.4 Director inaccesible sin proyecto publicado | **Corregido**: `initDirectorUi` se inicializa siempre, con store opcional que se crea con la primera propuesta (`src/ui/index.ts:55`) |
| B1.3 Recargar la página destruía propuesta y ediciones | **Corregido**: drafts durables + `restoreSession`/`persistStore` (`src/ui/project/persistence.ts`, commit `ab53442`) |
| B3 `tone`/`targetDurationSeconds`/`layoutPreset` no inyectables al Director | **Corregido**: el Director acepta restricciones y las impone como `const` en el schema del modelo (`ollama-director.mjs:154-161`) |
| §6.1 Sin CI | **Definido**: `.github/workflows` con `npm ci` + `npm test` + `npm run build` en `windows-latest` — pero nunca se ejecutó (ver §2.1) |
| §6.2 Sin `npm test` agregado | **Corregido**: `scripts/test-core.mjs` corre las 16 suites en orden |
| §6.4 Sin `engines` en `package.json` | **Corregido** |
| §7.2 Ollama/Qwen sin licencia registrada | **Corregido**: `docs/DEPENDENCIAS_IA_LOCAL.md` (Ollama MIT, Qwen3-8B Apache-2.0, con matices bien anotados) |
| B4.1 Editor entero en una columna con scroll infinito | **Reorganizado**: Etapas 4C/4D + unificación visor-timeline (`editor-workspace.ts` como fuente única de modo/medio/tiempo) |
| `src/main.ts` como hotspot de 555 líneas | **Corregido**: 111 líneas, composición mínima |

El ritmo importa para leer el resto: 26 de los 27 commits nuevos son de hoy. El repo está
en plena ola de trabajo, no estancado.

---

## 2. Problemas vigentes

### 2.1 [A] 27 commits sin push: sin respaldo y con un CI que nunca corrió

`main` está **27 commits por delante de `origin/main`**. Todo lo de hoy — estabilización
4B, biblioteca, creador de personajes, timeline profesional, la unificación del visor —
existe solo en este disco. Además, el workflow de CI está dentro de esos commits sin
push, así que **el CI jamás se ha ejecutado en GitHub**: es una promesa, no una red.
Verificado que las 16 suites no invocan Ollama real (usan `fetchImpl` falso) ni
Piper/FFmpeg, por lo que debería pasar en el runner, pero eso no se sabrá hasta pushear.

Las dos auditorías del 23-jul tampoco están commiteadas (aparecen como `??` en git).

**Sugerido:** pushear hoy, mirar la primera ejecución del workflow y commitear las
auditorías pendientes. Es el arreglo con mejor relación impacto/esfuerzo de toda esta
lista: respaldo + primera validación real del CI en un solo comando.

### 2.2 [A] `.local-video` sigue en 5,6 GB: la retención existe pero nadie la llama

La herramienta (`retention.mjs` + `local:clean` + suite propia) está construida y probada,
pero es 100 % manual: ni `server.mjs` ni `dev.mjs` ni el cierre de un job la invocan, y el
directorio pesa hoy 5,6 GB (ayer 5,2 — sigue creciendo). Una política que depende de
acordarse de correr un comando es equivalente a no tener política.

**Sugerido:** invocar la retención al completar/fallar/cancelar cada job y opcionalmente
al arrancar el servidor; y correr `npm run local:clean` una vez ahora para recuperar ~5 GB.

### 2.3 [M] Sin `LICENSE`

Sigue faltando (el README lo admite; `DEPENDENCIAS_IA_LOCAL.md:16` lo señala como decisión
pendiente del propietario). Bloquea cualquier forma de compartir el repo, incluso privada.
No urge para uso personal, pero es una decisión de una vez que desbloquea todo lo demás.

### 2.4 [M] La UI es ahora la superficie más grande del código y tiene cero pruebas

`src/ui/` ronda las 4.500 líneas (timeline 667, character-creator 590, project/panel 511,
director/panel 424, composition 315, …) y creció más de 3× esta semana. Su única
verificación es `tsc` + build. El CI protege motor y servidor; la UI — donde está
ocurriendo casi todo el trabajo nuevo — puede romperse sin que nada avise. Los módulos
con lógica pura (`editor-workspace.ts`, `project/store.ts`, cálculos de la timeline) son
testeables con `node:test` sin DOM ni dependencias nuevas; ahí está el mejor primer paso.

### 2.5 [M] Binarios versionados que el propio `.gitignore` ya prohíbe

`output/stage1/stage1-final-{1,2}.mp4`, `pilots/monos-mundial-01/output/monos-mundial-01.mp4`
y `assets/test.wav` están trackeados aunque `.gitignore` hoy excluye `output/*.mp4`. Son
contradicción declarada (README: "datos generados no deben versionarse") y peso muerto en
cada clone. `git rm --cached` + commit los saca sin tocar el disco.

### 2.6 [M] Sin lint ni formateador

Sin ESLint/Prettier ni equivalente; el estilo se sostiene por disciplina entre dos
carriles de trabajo que tocan los mismos archivos. Sin cobertura tampoco, aunque con 16
suites el hueco real es la UI (§2.4), no la métrica.

### 2.7 [B] Raíz con 26 archivos markdown

15 `ETAPA_*_RESULTADOS.md` más `task.md`, `comandos.md`, `implementation_plan.md`,
`PROPUESTA_TECNICA.md`, etc., compiten con `docs/`. Nada grave; ruido acumulado. Un
`docs/etapas/` los absorbería.

### 2.8 [B] Legacy de Etapa 0 sin plan de archivo

`scripts/process.mjs`, `export-video.mjs`, `generate-assets.mjs`, `verify-output.mjs`,
`tts-test/` y los npm scripts `assets`/`export`/`verify` siguen vivos sin uso. Ya estaba
anotado en AGENTS §4; la tarea de archivarlos sigue sin existir.

### 2.9 [B] Ambigüedad de producto: publicidad de demostración en el editor

`index.html:54-66` reserva dos raíles laterales con "Publicidad de demostración"
(commits `a0691ce`, `c7e7a0c`). El ROADMAP dice explícitamente "no avanzar a
plataforma/monetización antes de validar utilidad y demanda", y ningún documento explica
qué validan estos banners ni cuándo se quitan. Si son un experimento de layout, merecen
una línea en `ESTRUCTURA_VISUAL_CANONICA.md` que lo diga; si son intención de
monetización, contradicen el roadmap vigente.

### 2.10 [B] Ambigüedad de proceso: el reparto de carriles ya no refleja la práctica

El reparto acordado (motor = `shared/`, `scripts/`, `schema/`; UX/UI = `src/ui/`,
`index.html`, `style.css`) quedó desfasado: los commits de hoy tocan masivamente ambos
lados a la vez. No es un problema técnico — el resultado es coherente — pero el acuerdo
escrito y la realidad divergen, y eso es semilla de conflictos de merge y de
responsabilidades difusas. Vale la pena reescribir el reparto o retirarlo.

### 2.11 Deuda del motor: declarada y honesta

Sin cambios de fondo y correctamente documentada en AGENTS y en las auditorías de hoy:
el lienzo editable es composición estática (la reproducción temporal viene del último
MP4); no hay corte/estirado/arrastre temporal de clips; el compilador exige exactamente
dos personajes y ≥2 turnos; los tiempos individuales de cada turno no están en el
manifiesto final; boca por envolvente RMS, no fonemas; `prepare-scene.mjs` acoplado a
Piper en Windows (`venv/Scripts/python.exe`); compatibilidad Linux sin verificar. Lo
notable es la disciplina: la UI nueva **no simula** nada de esto (la timeline etiqueta
los tiempos estimados como estimados y no ofrece herramientas que el motor rechace).

---

## 3. Qué está más desarrollado

**El núcleo determinista y su red de contratos.** Pipeline multiescena con verificación
por hash, contratos JSON versionados validados con Ajv, prueba de equivalencia entre los
cuatro puntos de validación, 16 suites que pasan, caché TTS, aislamiento por `jobId`.
Es la parte del repo con calidad de producción real y la que hace posible todo lo demás.

**El servicio local**, tras la estabilización 4B: token de sesión, validación de
Host/Origin, recuperación de jobs tras reinicio, kill del árbol de procesos en Windows,
render interactivo de una pasada. Pasó de "prototipo con agujeros" (auditoría del 23) a
endurecido en un día.

**El editor unificado** llegó tercero pero converge rápido: una sola fuente de verdad de
modo/superficie/tiempo (`editor-workspace.ts`), timeline V/A honesta conectada a datos
medidos, persistencia de sesión, undo/redo real. Su debilidad no es el diseño sino la
ausencia total de pruebas (§2.4).

## 4. Qué es más prometedor

**El flujo prompt→video con restricciones.** Es el diferenciador del producto y ya está
completo de punta a punta: idea → plan semántico local (`qwen3:8b` con schema forzado,
ahora con tono/duración/nº de escenas como restricciones duras) → proyecto editable →
edición manual con undo → render determinista → MP4. Pocas herramientas locales cierran
ese círculo. Cada mejora aquí (reparación de planes rechazados, variantes comparadas,
preguntas aclaratorias — todo declarado como pendiente) multiplica el valor de todo el
stack de abajo.

**La dupla biblioteca durable + creador de personajes.** Recursos propios, reutilizables,
fuera del repo (`.local-video-library/`), con procedencia y licencia por recurso. Es
valor que se acumula con el uso: cada personaje creado hace la herramienta más útil para
el siguiente video. Es también la pieza más joven (hoy) y la que más merece uso real
antes de seguir ampliándola.

## 5. Orientación: próximos pasos sugeridos

En orden, cada uno independiente:

1. **Hoy: `git push` y mirar el primer run del CI.** Respaldo de 27 commits + primera
   ejecución real del workflow. Commitear también las auditorías del 23 y esta (§2.1).
2. **Hoy: `npm run local:clean`** para recuperar ~5 GB, y en la semana cablear la
   retención al ciclo de vida de los jobs para que deje de ser manual (§2.2).
3. **Usar el producto: producir 2–3 videos reales de punta a punta.** El ROADMAP dice que
   las prioridades deben surgir del uso personal, y hoy el repo tiene mucha más
   infraestructura que uso registrado. Cada fricción anotada vale más que otra feature.
   Es, además, el gate humano natural de todo lo construido esta semana.
4. **Primeras pruebas de la UI** sobre la lógica pura (`editor-workspace`, `store`,
   cálculos de timeline) con `node:test`, sin dependencias nuevas (§2.4). Sumar al
   `test-core.mjs` para que el CI las herede gratis.
5. **Higiene en un solo commit:** `git rm --cached` de los binarios (§2.5), mover
   `ETAPA_*` a `docs/etapas/` (§2.7), y crear la tarea de archivo del legacy de
   Etapa 0 (§2.8).
6. **Dos decisiones de una línea:** licencia del repo (§2.3) y qué son los banners de
   demostración (§2.9). Ambas cuestan minutos y eliminan ambigüedad permanente.
7. **Después, motor:** las líneas declaradas más valiosas según el uso — probablemente
   reparación/variantes del Director y tiempos por turno en el manifiesto final (lo que
   permitiría a la timeline mostrar duraciones reales por diálogo sin estimar).

Lo que **no** conviene hacer ahora: seguir ampliando superficie de UI o del creador de
personajes antes del punto 3. La semana produjo una ola grande de capacidades nuevas;
lo que falta no es más construcción sino verificación con uso real, respaldo y cierre
de las ambigüedades listadas.
