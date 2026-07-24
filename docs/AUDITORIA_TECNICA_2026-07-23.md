# Auditoría técnica y de deuda — 23 de julio de 2026

Instantánea del repositorio en `main` (working tree, con el trabajo de Etapa 4A todavía sin
commitear). No modifica código: solo inventaría problemas, deuda y riesgos.

## Cómo se hizo

Verificaciones ejecutadas en esta auditoría:

| Verificación | Resultado |
| --- | --- |
| `npx tsc --noEmit` | sin errores |
| `npm run build` (tsc + Vite) | correcto, 677 ms |
| 11 suites propias (`stage1:test-config`, `stage2f:test-parametric`, `stage3a:test-project`, `stage3a:test-compiler`, `stage3a:test-assembly`, `stage3b:test-editor`, `stage3b:test-publishing`, `director:test-plan`, `director:test-ollama`, `local:test-server`, `local:test-render-manager`) | todas pasan, 0 fallos |
| Lectura de `scripts/local-app/`, `scripts/director/`, `scripts/stage3a/`, `shared/`, `src/ui/` | ver hallazgos |

**Nada de lo listado abajo es un test que falle.** Son riesgos, huecos de contrato,
deuda de UX y problemas operativos que las pruebas actuales no cubren.

## Resumen ejecutivo

Lo que está sano: el núcleo determinista, los contratos versionados, el aislamiento por
`jobId`, la validación de rutas/assets y la separación plan semántico ↔ proyecto editable.
El typecheck, el build y las once suites pasan.

Los cinco problemas que más pesan hoy:

1. **`.local-video` ocupa 5,2 GB** sin retención ni limpieza (§2.1).
2. **El servicio local acepta peticiones sin cabecera `Origin`**: cualquier proceso del
   equipo puede lanzar renders (§1.1).
3. **El Director IA queda inaccesible si no hay un proyecto publicado**, justo en la
   primera ejecución, que es cuando más se necesita (§4.1).
4. **Las reglas del proyecto están escritas tres veces** (editor JS, validador Ajv,
   compilador) y nada detecta la deriva entre ellas (§3.1).
5. **No hay CI**: once suites que solo corren si alguien se acuerda (§6.1).

Severidad: **A** = corregir antes de seguir ampliando · **M** = planificar ·
**B** = anotar y agrupar.

---

## 1. Servicio local y seguridad

### 1.1 [A] El control de origen se puede saltar omitiendo la cabecera

`scripts/local-app/server.mjs:160` — `isAllowedOrigin` devuelve `true` cuando no hay
cabecera `Origin`. Un `curl`, un script o cualquier otra aplicación del equipo puede
hacer `POST /api/render-jobs` y ejecutar el pipeline con un proyecto arbitrario. No hay
verificación de la cabecera `Host` (protección contra DNS rebinding) ni token de sesión.
Escuchar en `127.0.0.1` limita el ataque a procesos locales, pero el contrato de AGENTS §8
(“validar toda entrada”, “límites antes de ejecución online”) pide más que eso.

**Sugerido:** exigir `Origin` permitido en todos los métodos que muten estado, validar
`Host` contra `127.0.0.1:4174`, y emitir un token en el arranque que `dev.mjs` inyecte en
la página.

### 1.2 [M] Lectura del cuerpo: acumulación en string y coste cuadrático

`server.mjs:141-150` — el cuerpo se concatena en un `String` y en **cada chunk** se
recalcula `Buffer.byteLength` sobre el total. Con cuerpos cercanos al límite de 1 MB es
O(n²), y el límite se comprueba después de haber acumulado la memoria. Tampoco hay
timeout de lectura ni validación de `content-type`: un cliente que abre la conexión y no
envía nada deja el handler colgado.

### 1.3 [M] El estado de los trabajos no sobrevive a un reinicio

`scripts/local-app/render-job-manager.mjs:22-24, 163-170` — `jobs` y `activeJobId` viven
solo en memoria. Si el servidor cae con un render activo:

- el archivo de estado queda en `rendering` para siempre (nadie lo cierra);
- el proceso hijo del pipeline queda huérfano y sigue consumiendo CPU;
- al reiniciar, `activeJobId` es `null`, así que el candado de “un solo render” no
  impide lanzar otro sobre el mismo `work-dir`.

`GET /api/render-jobs` (lista) solo ve la memoria, mientras que `GET /api/render-jobs/:id`
cae al disco: dos fuentes de verdad con resultados distintos.

### 1.4 [M] `npm run dev` no arrastra al render al cerrar

`scripts/local-app/dev.mjs:19-25` — `stop()` mata Vite y cierra el servidor HTTP, pero no
cancela el render en curso. Ctrl+C deja un `node project-pipeline.mjs` (y sus `ffmpeg` y
`piper`) vivos. Además `app.close()` espera a que se cierren las conexiones abiertas: con
el `<video>` de la UI en streaming, el cierre se cuelga.

### 1.5 [M] `child.kill()` no mata el árbol de procesos en Windows

`render-job-manager.mjs:87, 182` — tanto el timeout de 45 min como la cancelación matan
solo al proceso Node hijo. En Windows, `ffmpeg`/`piper` lanzados por debajo sobreviven.
Hace falta grupo de procesos (`detached` + `kill(-pid)`) o `taskkill /T /F`.

### 1.6 [B] Sin límites de concurrencia ni cancelación en el Director

`server.mjs:52-68` — `POST /api/director/proposals` no tiene candado: dos pestañas
disparan dos inferencias `qwen3:8b` simultáneas en CPU. La petición puede durar hasta
240 s (`ollama-director.mjs:54`) y la UI no ofrece abortarla.

### 1.7 [B] El mapa de trabajos crece sin límite

`render-job-manager.mjs:22` — ni tope de entradas ni expiración; los `.json` de
`.local-video/app-jobs/` y las carpetas de `app-input/` tampoco se purgan.

### 1.8 [B] La API solo existe detrás del proxy de Vite

`vite.config.ts:8-10` es lo único que conecta la UI (`:5173`) con la API (`:4174`); el
servidor no emite cabeceras CORS ni responde `OPTIONS`. Un `dist/` servido como estático
muestra el panel Director completo pero inerte: todas las llamadas fallan.

---

## 2. Render, almacenamiento y coste

### 2.1 [A] 5,2 GB en `.local-video` sin política de retención

Medido hoy: `work` 5,1 GB · `output` 33 MB · `tests` 166 MB · `director-cache` 40 KB.
Cada job conserva sus frames PNG intermedios y nada los borra jamás. Es la brecha
“limpieza/retención” de AGENTS §4, ya con impacto real en disco. Un usuario que produzca
contenido a diario llena el disco en semanas.

**Sugerido:** borrar `temp/`+frames al completar un job, retención por antigüedad/tamaño
en `work/` y `app-jobs/`, y un comando `npm run local:clean` con destino validado.

### 2.2 [M] Cada render de usuario cuesta el doble

`scripts/stage3a/project-pipeline.mjs:26` — se renderiza y ensambla **dos veces**
(`render-1`, `render-2`) para comprobar determinismo por hash, y cada escena ya se
renderiza dos veces dentro de `runPipeline`. Es correcto como verificación de ingeniería,
pero no es configurable: el flujo interactivo del Director paga 2× de CPU y de tiempo en
cada video. Debería poder pedirse “un solo render” desde la app y reservar la doble
pasada para las pruebas.

### 2.3 [M] `spawnSync` sin timeout en todo el pipeline

`scripts/stage1/common.mjs:75-103` — `run()` no pasa `timeout`. Un `ffmpeg` o un `piper`
colgado bloquea el job hasta el timeout externo de 45 min, y ese timeout (§1.5) no lo mata
de verdad. Ya está anotado en AGENTS §4; sigue vigente y ahora tiene consecuencias
visibles para el usuario, no solo para la CLI.

### 2.4 [M] Cancelar no limpia nada

`render-job-manager.mjs:172-184` — se marca `cancelled` y se mata el hijo, pero el
`work-dir` del job, los frames y el `app-input/<jobId>/project.json` quedan en disco.

### 2.5 [B] Caché TTS y `jobId` sin locking

Documentado en AGENTS §4 y sin cambios. Con un solo render activo el riesgo es bajo, pero
`stage3b:publish-project` y los pipelines CLI pueden correr en paralelo con la app.

---

## 3. Contratos y arquitectura

### 3.1 [A] Las reglas del proyecto están escritas tres veces

| Lugar | Cómo valida |
| --- | --- |
| `shared/project-editor.js:93-150` | JavaScript a mano, sin schema |
| `scripts/stage3a/validate-video-project.mjs:45-169` | Ajv + reglas semánticas |
| `scripts/stage3a/compile-video-project.mjs` | límites propios del compilador |

Las tres deben decir lo mismo (dos personajes, ≥2 turnos, ancla 0.5, rotación 0, opacidad
1, transiciones cerradas) y ninguna prueba compara sus veredictos sobre un mismo corpus.
Cuando diverjan, el síntoma será el peor posible: la UI acepta una edición, el usuario
pulsa *Renderizar* y el motor la rechaza a mitad del pipeline.

**Sugerido:** una prueba de equivalencia que pase N proyectos válidos e inválidos por los
tres validadores y exija el mismo resultado; a mediano plazo, que el editor consuma el
mismo JSON Schema.

### 3.2 [M] Revalidación repetida de catálogos en cada llamada

`validate-video-project.mjs:61-121` vuelve a leer y validar del disco el catálogo de
autoría, los catálogos de personajes y los manifiestos de fondo **en cada invocación**.
Se invoca al proponer, al validar y al crear el job (`render-job-manager.mjs:35`), y
`normalizeDirectorPlan` valida el plan dos veces (`director-plan.mjs:84` +
`ollama-director.mjs:92`). Es I/O y CPU gratis en el camino interactivo.

### 3.3 [B] El catálogo de autoría se carga sin validar

`director-plan.mjs:198-201` — `loadAuthoringCatalog` hace `JSON.parse` sin comprobar
`authoring-resource-catalog.schema.json`, y ese objeto es la fuente de los `enum` que se
le imponen al modelo (`ollama-director.mjs:129-146`). Un catálogo malformado produce un
schema silenciosamente degradado en vez de un error claro.

### 3.4 [B] Dos versiones de normalización que hay que subir a mano

`DIRECTOR_VERSION` (`ollama-director.mjs:15`, entra en la clave de caché) y
`normalizerVersion: 2` (`director-plan.mjs:88`, entra en el `semanticHash`) son constantes
independientes. Cambiar el normalizador sin tocar ambas produce hashes semánticos nuevos
con claves de caché viejas.

---

## 4. Interfaz y experiencia (carril UX/UI)

### 4.1 [A] El Director depende de que ya exista un proyecto publicado

`src/ui/index.ts:30-45` — `initProjectUi()` hace `await loadProjectStore()` y solo después
llama `initDirectorUi(store)`. Si `public/projects/index.json` no existe (equipo nuevo,
alguien no corrió `stage3b:publish-project`, borrado de regenerables), el `catch` pinta un
mensaje de error y **el panel Director nunca se inicializa**. El flujo estrella —
“escribo una idea y obtengo un video”, que no necesita ningún proyecto previo— es
inaccesible exactamente en la primera ejecución.

**Sugerido:** inicializar el Director siempre; el store del editor pasa a ser opcional y
se crea cuando llega la primera propuesta.

### 4.2 [M] “Renderizar video” está habilitado antes de tener algo que renderizar

`src/ui/director/panel.ts:30` pone `render.disabled = false` en el arranque, antes de la
comprobación de salud y antes de que exista una propuesta. Con el proyecto piloto cargado,
un clic accidental lanza un render de varios minutos que además ocupa el único slot.

### 4.3 [M] Generar una propuesta no se puede cancelar y no avisa de cuánto tarda

`panel.ts:33-61` — `setBusy(true)` deshabilita todo y el usuario ve “El Director IA está
preparando la propuesta…” hasta 4 minutos, sin barra, sin tiempo estimado y sin abortar.
El botón *Cancelar* solo actúa sobre renders (`panel.ts:85`).

### 4.4 [M] Una propuesta nueva descarta el trabajo manual sin preguntar

`panel.ts:45` → `store.replaceProject()` → `createProjectEditor()`
(`src/ui/project/store.ts:93-101`) reconstruye el estado desde cero: se pierden las
ediciones manuales y el historial completo de undo/redo. No hay confirmación ni forma de
volver.

### 4.5 [M] Errores del transporte se muestran como ruido técnico

`src/ui/director/api.ts:85-93` — `await response.json()` incondicional. Si el servicio
está caído o el proxy devuelve HTML (502/504), el usuario lee
`SyntaxError: Unexpected token '<'` en lugar de “el servicio local no está disponible”.
La rama que sí da buen mensaje (`panel.ts:113`) solo cubre el health inicial.

### 4.6 [M] Reordenar escenas cambia las transiciones elegidas

`shared/project-editor.js:213-219` — las transiciones se reasignan **por posición**, no
por escena: se borra `transitionToNext` de cada escena y se le vuelve a poner la que
correspondía a ese hueco. Mover una escena altera en silencio los cortes/fundidos que el
usuario había definido. Puede ser la decisión deseada, pero no está documentada, no se
avisa en la UI y no hay prueba que fije el comportamiento.

### 4.7 [B] Re-render completo del panel en cada cambio

`src/ui/project/panel.ts` reconstruye tira de escenas e inspector en cada `notify()`. Con
inputs de texto en el inspector, cada cambio de estado arriesga foco y posición del
cursor, y no hay virtualización ni diffing.

### 4.8 [B] La duración nunca se ve antes de renderizar

`panel.ts:97-99` muestra “duración pendiente” en todas las escenas. Es coherente con el
invariante (la duración la mide FFprobe, no se estima), pero deja al usuario sin ninguna
señal de longitud hasta terminar un render de varios minutos. Falta al menos una
estimación *rotulada como aproximada* a partir del conteo de palabras, que ya se calcula
en `director-plan.mjs:72`.

### 4.9 [B] Deuda de UX previa todavía vigente

De `docs/UX_DEUDA_TECNICA_Y_PLAN.md`: cambiar de job recarga la página entera
(`src/main.ts:82-86`), y el lenguaje interno de producto (“Etapa 2C · Personaje animable”)
sigue expuesto. Ese documento cubre solo el preview: no hay equivalente para el editor ni
para el Director.

---

## 5. Repositorio e higiene

### 5.1 [M] Trabajo grande sin commitear

12 archivos modificados y 12 nuevos, incluidos `scripts/local-app/` completo,
`scripts/director/` completo y `schema/ai-video-plan.schema.json`. Toda la Etapa 4A vive
solo en el working tree: sin commit, sin revisión y sin respaldo.

### 5.2 [M] Artefactos generados versionados

`output/stage1/stage1-final-1.mp4`, `stage1-final-2.mp4` y sus JSON de métricas están en
git, igual que `assets/` y `tts-test/` de Etapa 0. Contradice “Datos generados … no deben
versionarse” del README y engorda el historial con binarios.

### 5.3 [B] Código legacy de Etapa 0 sin plan de archivo

`scripts/process.mjs`, `scripts/export-video.mjs`, `scripts/generate-assets.mjs`,
`scripts/verify-output.mjs`, `tts-test/` y los scripts npm `assets` / `export` / `verify`.
`scripts/process.mjs` duplica `run()` de `scripts/stage1/common.mjs` con peores errores.
AGENTS §4 pide “planificar su archivo/deprecación en una tarea específica”; esa tarea
todavía no existe.

### 5.4 [B] Raíz saturada de documentos

15 informes `ETAPA_*_RESULTADOS.md` más `task.md`, `comandos.md`,
`implementation_plan.md` y `PROPUESTA_TECNICA.md` compiten con `docs/`. Los tres primeros
no están referenciados desde el README ni desde AGENTS.

---

## 6. Pruebas, tooling y dependencias

### 6.1 [A] Sin integración continua

No hay `.github/workflows/` ni equivalente. Las once suites, el typecheck y el build solo
corren si alguien los invoca a mano. Con dos carriles de trabajo (motor y UX/UI) sobre el
mismo repo, es el agujero más barato de tapar y el que más regresiones evita.

### 6.2 [M] Sin runner, sin cobertura, sin lint

Cada suite es un `.mjs` que imprime su propio JSON y ajusta `process.exitCode`. Funciona,
pero: no hay informe agregado, no hay cobertura, no existe `npm test` que corra todo, y no
hay ESLint ni formateador (el estilo se sostiene por disciplina). `node:test` ya viene con
Node y no añadiría dependencias.

### 6.3 [M] Áreas sin ninguna prueba

- Todo `src/` (UI): cero pruebas; solo `tsc` y el build.
- Equivalencia entre los tres validadores (§3.1).
- Comportamiento ante caída/reinicio del servidor con render activo (§1.3).
- Cancelación real de procesos externos en Windows (§1.5).

### 6.4 [B] `package.json` sin `engines`

El README fija Node `^20.19.0` o `>=22.12.0`; `package.json` no lo declara y aquí se está
ejecutando Node 24.14.0. Nada avisaría en una versión no soportada.

### 6.5 [B] Dependencias en versiones mayores muy recientes

`typescript ^7.0.2`, `vite ^8.1.5`, `pixi.js ^8.19.0`, `ajv ^8.20.0`, con rango `^` que
admite saltos menores automáticos. AGENTS §9 exige documentar y probar cada actualización
mayor; no hay registro de esas decisiones.

---

## 7. Licencias y distribución

### 7.1 [M] Sin `LICENSE` en el repositorio

Confirmado por el propio README: no hay permiso de redistribución ni de uso comercial.
Bloquea cualquier publicación, incluso privada compartida.

### 7.2 [M] Nueva dependencia de modelo sin licencia registrada

`public/assets/catalog/authoring-resources.json` sí registra licencias de voces y assets
(Piper GPL-3.0-or-later, dataset CC BY-SA 4.0, repositorio MIT/CC0). **Ollama y `qwen3:8b`
no aparecen en ningún registro de licencias**, pese a ser ahora parte del flujo principal.
AGENTS §8 lo exige antes de distribuir o monetizar.

---

## 8. Deuda ya declarada en AGENTS.md que sigue abierta

Confirmada, no duplicada aquí: runtime limitado a una escena (sin preview multiescena
continuo); el editor no crea ni elimina escenas, elementos o turnos; el Director no hace
preguntas aclaratorias, no compara variantes ni repara planes rechazados; compilador
restringido a exactamente dos personajes y ≥2 turnos; texto, imágenes y transforms libres
rechazados; joints del rig v2 son metadatos sin articulación continua; boca por envolvente
RMS y no fonemas; `prepare-scene.mjs` acoplado a Piper y a `venv/Scripts/python.exe`;
compatibilidad Linux sin verificar.

---

## 9. Orden sugerido

Cada bloque es independiente y verificable por separado.

**Bloque 1 — contención operativa (más impacto por esfuerzo)**
1. Retención y limpieza de `.local-video` + comando de purga (§2.1).
2. Exigir `Origin` y validar `Host` en las rutas que mutan estado (§1.1).
3. CI mínima: typecheck + build + las once suites (§6.1).

**Bloque 2 — que el flujo principal no se rompa**
4. Desacoplar el Director del proyecto publicado (§4.1).
5. Estado de render recuperable tras reinicio + matar el árbol de procesos (§1.3, §1.5).
6. Errores de transporte legibles en la UI (§4.5).

**Bloque 3 — evitar la deriva de contratos**
7. Prueba de equivalencia entre los tres validadores (§3.1).
8. Render simple opcional para el flujo interactivo (§2.2).

**Bloque 4 — pulido y orden**
9. Confirmación antes de descartar ediciones (§4.4), habilitación correcta de botones
   (§4.2), cancelación de propuestas (§4.3).
10. `LICENSE`, licencia de qwen3/Ollama (§7), `engines` (§6.4), archivo del legacy de
    Etapa 0 (§5.3).
