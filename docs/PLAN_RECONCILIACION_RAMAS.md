# Plan de acción: reconciliación de ramas

> Instrucción ejecutable. Origen: auditoría del 2026-07-26. Cuarto plan de la serie
> (`PLAN_ARREGLO_CARGA_LENTA.md`, `PLAN_LIMPIEZA_Y_ANTIBASURA.md`,
> `PLAN_MEJORA_DIRECTOR_IA.md`). Este es el único con **urgencia real**: la
> divergencia crece con cada commit y hay 27 commits de main sin respaldo en origin.

## Estado medido (2026-07-26)

| Rama | Estado |
|---|---|
| `agent/timeline-profesional-d1` (actual) | 14 commits sobre la base común; contiene la migración de storage (P1-P4 y P5/S3 en curso, **con trabajo sin commitear ahora mismo**) |
| `main` local | 1 solo commit propio: `a65c66a` (voces) — re-aplicación del `6a73a93` de esta rama con formato distinto |
| `origin/main` | **27 commits atrás** de main local (todo el trabajo de timeline A1-C3, director, catálogo y voces está SIN respaldo remoto) |
| `origin/agent/timeline-profesional-d1` | 14 commits atrás (su punta es la base común `c7dfdb7`) |
| `codex/desarrollo-local` | 1 commit propio (`28b8545`, base del 2026-07-22) — probablemente supersedido |
| `claude/main-branch-readme-review-96b905` | Contenida por completo en main → borrable |

**Hallazgo que define la estrategia** (verificado por comparación semántica):
el conflicto entre `a65c66a` (main) y `6a73a93` (rama) es ilusorio. Ambos hacen el
mismo reemplazo de voces; el catálogo de la rama es un **superset estricto** del de
main (voces semánticamente idénticas + personaje `conejo-traje-v1` + soporte
multi-catálogo en el compilador que main no tiene). La resolución correcta en los
22 archivos que ambos tocan es **quedarse con la versión de esta rama en todos**.
Nada de `a65c66a` se pierde.

## Estrategia

1. Fusionar `main` → esta rama **ahora** (barato: main solo aporta 1 commit
   redundante). Esto detiene el crecimiento de la divergencia hoy.
2. Congelar `main` hasta que cierre la migración.
3. Al cerrar la migración: fusionar esta rama → `main`, push de todo (el push es
   también el primer respaldo remoto de 27+ commits).
4. Limpiar ramas muertas y adoptar reglas para que no vuelva a pasar.

**Prohibido en este proceso**: `git rebase` (hay 14 commits publicables y árbol de
trabajo sucio con la migración en curso) y `git push --force` (no hace falta: los
remotos están *atrás*, no divergentes; todos los push serán fast-forward).

---

## Paso 0 — Proteger el trabajo en curso

Hay ~15 archivos modificados sin commitear (P4/P5 de la migración). Antes de tocar
nada, quien lleva la migración debe dejar el árbol limpio:

```bash
git add -A
```
```bash
git commit -m "wip(storage): avance P5 S3 antes de reconciliar ramas"
```

(Si se prefiere no commitear trabajo a medias: `git stash push -u -m "p5-en-curso"`
y `git stash pop` después del Paso 1. El commit wip es más seguro.)

## Paso 1 — Fusionar main en esta rama (hoy)

```bash
git merge main
```

Los conflictos aparecerán en (parte de) los 22 archivos del commit de voces.
Resolver TODOS a favor de esta rama:

```bash
git checkout --ours -- .
```
```bash
git add -A
```

Verificación antes de confirmar el merge — las diferencias contra main en esos
archivos deben ser solo formato JSON y el superset (conejo + multi-catálogo):

```bash
git diff main -- public/assets/catalog/authoring-resources.json scripts/stage3a/compile-video-project.mjs
```
```bash
npm test
```

Con los tests en verde:

```bash
git commit -m "merge: reconciliar main (voces a65c66a redundante; se conserva superset de la rama)"
```

## Paso 2 — Congelar main hasta el cierre de la migración

Regla temporal (comunicarla a todos los agentes/carriles): **nadie commitea
directo a `main`**. Lo urgente entra a esta rama o espera. Cada commit nuevo en
main durante la migración recrea el problema que este plan elimina.

## Paso 3 — Cierre: fusionar a main y respaldar todo (al terminar la migración)

```bash
npm test
```
```bash
git checkout main
```
```bash
git merge --no-ff agent/timeline-profesional-d1 -m "merge: migración de persistencia (P1-P5) + reconciliación de ramas"
```
```bash
npm test
```
```bash
git push origin main
```
```bash
git push origin agent/timeline-profesional-d1
```

Notas:
- El push de main sube ~42 commits que hoy viven solo en este disco — es el
  respaldo remoto pendiente más importante del proyecto.
- El push dispara el CI de GitHub (`.github/workflows/ci.yml`, windows-latest con
  FFmpeg). Verificar que quede en verde; es la primera corrida remota de todo el
  trabajo de timeline + storage.
- Opcional recomendado: `git tag pre-migracion-db c7dfdb7` antes del merge, como
  punto de retorno con nombre.

## Paso 4 — Limpieza de ramas muertas

```bash
git branch -d claude/main-branch-readme-review-96b905
```

(Está contenida en main; si git se queja por el worktree asociado, primero
eliminar el worktree — ver Fase 1 del plan anti-basura.)

Para `codex/desarrollo-local` (1 commit propio del 2026-07-22, `28b8545`
«publish validated projects for editor», con pinta de supersedido por el
stage3b que ya está en main): verificar y decidir:

```bash
git show --stat 28b8545
```

Si no aporta nada que main no tenga → `git branch -D codex/desarrollo-local`.
Si aporta algo → cherry-pick de lo útil a la rama de integración y luego borrar.

## Paso 5 — Reglas permanentes (para que no se repita)

1. **`main` es la única rama de integración.** Todo lo demás son ramas de tarea
   de vida corta (días, no semanas) que se fusionan y se borran.
2. **Push de main tras cada merge** — el remoto es el único respaldo del código;
   hoy estuvo 27 commits atrás.
3. **Nunca re-aplicar un cambio a mano en otra rama** (el origen de este lío:
   voces aplicadas dos veces con formato distinto). Si una rama necesita un
   cambio de otra: `git merge` o `git cherry-pick`, que preservan identidad.
4. **El nombre de la rama describe su contenido.** `agent/timeline-profesional-d1`
   terminó llevando la migración de base de datos; eso invisibilizó dónde vivía
   el trabajo. Después del Paso 3, borrarla y abrir ramas nuevas por tarea.
5. Los worktrees de agentes (`.claude/worktrees/`) se eliminan al terminar la
   sesión que los creó; su rama se fusiona o se descarta explícitamente.

## Criterios de éxito

1. `git log --oneline main..agent/timeline-profesional-d1` y su inverso vacíos
   tras el Paso 3 (ramas convergidas).
2. `git status -sb` en main muestra `## main...origin/main` sin `[ahead]`.
3. CI de GitHub en verde sobre origin/main.
4. `git branch -a` lista solo `main` + ramas de tarea activas con dueño claro.
