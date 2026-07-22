# Flujo de colaboración entre Codex y Claude

Fecha: 22 de julio de 2026.

Estado: propuesta operativa vigente para trabajar en paralelo sin mezclar responsabilidades ni desestabilizar `main`.

## Objetivo

Usar dos ramas y dos worktrees separados para avanzar en paralelo:

- **Codex:** núcleo, contratos, pipeline y funciones creativas incorporadas de forma incremental.
- **Claude:** investigación y diseño UX/UI, flujo del editor y prototipos de interfaz.
- **`main`:** versión estable e integrable; no es un espacio de experimentación.

Esta separación no significa desarrollar dos aplicaciones. Ambos carriles deben terminar consumiendo los mismos contratos y el mismo evaluador temporal.

## Distribución actual

| Responsable | Rama | Worktree | Propósito |
|---|---|---|---|
| Codex | `codex/desarrollo-local` | `C:\Users\usuario\Desktop\Diseñador de videos LOCAL` | Motor y capacidades funcionales |
| Claude | `claude/trabajo` | `C:\Users\usuario\Desktop\Diseñador de videos LOCAL - claude` | UX/UI e interfaz |
| Integración | `main` | administrado por el usuario o una integración dedicada | Versión estable |

Cada agente debe comprobar su rama y worktree al comenzar:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
git worktree list
```

Ningún agente debe cambiar de rama dentro del worktree del otro, escribir en la otra carpeta ni usar `git reset --hard`, `push --force` o limpiezas destructivas.

## Carril de Codex: núcleo y checklist funcional

Codex puede seguir avanzando en el roadmap técnico aprobado, una capacidad verificable por vez.

### Próxima secuencia propuesta

1. **Etapa 2D — diálogo temporizado y dos hablantes**
   - turnos con `speakerId`;
   - duración real de cada voz mediante FFprobe;
   - audio compuesto de forma determinista;
   - boca activa solo en el hablante;
   - reacción neutral del otro personaje;
   - subtítulos por turno;
   - todavía una sola escena.

2. **Etapa 2E — fondo y cámara animables**
   - fondo en pocas capas;
   - paneo, zoom y parallax simples;
   - uno o dos loops ambientales;
   - mismo evaluador para preview y exportación.

3. **Etapa 3A — varias escenas lineales**
   - contrato acotado de proyecto;
   - cortes y fundidos simples;
   - audio y subtítulos continuos;
   - límites pequeños y render determinista.

Cada etapa debe mantener el patrón: contrato mínimo → prueba específica → pipeline real → FFprobe → determinismo → preview → documentación. No se incorporará una función posterior solo porque resulte conveniente durante una etapa anterior.

### Archivos normalmente propiedad de Codex

- `schema/`
- `shared/scene-evaluator.*`
- `scripts/stage1/` y scripts de nuevas etapas del motor
- pruebas de integración y determinismo
- configuraciones piloto bajo `pilots/`
- documentación de resultados `ETAPA_*.md`

`src/main.ts`, `index.html` y estilos son zona compartida: Codex solo debe tocarlos cuando una capacidad del motor necesite exposición mínima en el preview, y debe avisarlo en el handoff.

## Carril de Claude: UX/UI e interfaz

Claude puede avanzar ahora sin esperar a que termine todo el motor, siempre que diseñe contra capacidades declaradas y no invente contratos ejecutables.

### Trabajo recomendado ahora

1. Definir los flujos principales:
   - crear o abrir proyecto;
   - elegir un trabajo existente;
   - elegir fondo y personaje;
   - escribir diálogo;
   - asignar hablante y voz;
   - elegir pose o gesto desde un catálogo cerrado;
   - previsualizar;
   - exportar y revisar errores.

2. Preparar wireframes para:
   - pantalla de proyectos;
   - composición de una escena;
   - panel de personajes/assets;
   - diálogo por turnos;
   - preview vertical;
   - panel de progreso, validaciones y resultados.

3. Crear un prototipo navegable local con datos simulados, preferentemente aislado bajo una carpeta como:

```text
prototypes/editor-ui/
```

El prototipo puede usar HTML, CSS y TypeScript simples. No debe agregar React, Electron ni nuevas dependencias sin una decisión conjunta y una tarea explícita.

4. Documentar decisiones UX:
   - qué tareas son frecuentes;
   - qué información necesita el usuario;
   - qué controles pueden ser presets;
   - qué errores deben poder corregirse;
   - qué partes no necesitan timeline profesional.

5. Preparar un mapa de componentes y estados de interfaz que consuma contratos, pero sin copiar lógica temporal del motor.

### Límites del carril UX/UI

Claude no debería modificar por su cuenta:

- schemas canónicos;
- `shared/scene-evaluator.js`;
- preparación, TTS, análisis, FFmpeg o exportación;
- significado de estados y acciones;
- formato de runtime, progreso o error;
- dependencias principales.

Si el diseño necesita un dato que todavía no existe, debe registrarlo como **necesidad de contrato**, no añadirlo silenciosamente al motor.

## Contrato de coordinación

Antes de una tarea, cada agente debe registrar brevemente:

- objetivo;
- archivos o carpetas que pretende tocar;
- contratos afectados;
- qué queda fuera;
- prueba de salida.

Para comunicar una dependencia entre carriles se usará este formato en el resumen de la rama o PR:

```text
NECESIDAD DE CONTRATO
Consumidor: interfaz / motor
Dato o acción requerida:
Motivo de UX o función:
Propuesta mínima:
Etapa en la que debería resolverse:
```

Codex decide la implementación técnica del contrato junto con el usuario. Claude puede proponer la forma de consumo y validar que resulte comprensible para la interfaz.

## Archivos sensibles y reglas para evitar choques

| Zona | Regla |
|---|---|
| `shared/scene-evaluator.*` | Solo carril de motor salvo coordinación explícita |
| `schema/` | Solo motor; la UI puede leer los schemas |
| `scripts/stage1/` | Solo motor |
| `src/main.ts` | Compartido; avisar antes y evitar rediseños grandes |
| `index.html`, `src/style.css` | Preferentemente UI; Codex hace solo cambios mínimos de estado |
| `package.json`, lockfile | Coordinación obligatoria |
| `public/generated/`, `.local-video/` | Outputs regenerables; no usarlos para resolver conflictos |
| `docs/` | Dividir por tema; evitar editar simultáneamente el mismo documento |

El prototipo de Claude debe vivir separado del preview vigente mientras cambien los contratos. La implementación real del editor se integrará cuando 2D, 2E y 3A hayan estabilizado los datos que la interfaz editará.

## Política de commits

- Commits pequeños, coherentes y con una sola intención.
- No mezclar refactor, función, assets y documentación no relacionada.
- No incluir secretos ni temporales locales.
- Indicar la etapa y el área en el mensaje.

Ejemplos:

```text
feat(stage2d): compilar turnos de diálogo medidos
test(stage2d): verificar hablante activo y determinismo
docs(ux): definir flujo de diálogo por turnos
ui(prototype): agregar panel simulado de personajes
```

Cada rama debe quedar limpia después de sus commits. El responsable de una rama no debe reescribir el historial publicado de la otra.

## Proceso seguro de integración

No se deben fusionar dos ramas antiguas consecutivamente en `main` sin actualizar y probar la segunda.

### Integración recomendada por hito

1. Confirmar que `main` está limpia y sus pruebas pasan.
2. Revisar el alcance y los commits de ambas ramas.
3. Integrar primero el cambio de motor que define los contratos.
4. Ejecutar en la rama de integración:
   - pruebas específicas;
   - `npm run build`;
   - pipeline y FFprobe si cambió render/audio;
   - determinismo;
   - preview/exportación si cambió el evaluador.
5. Actualizar la rama UX/UI con ese nuevo contrato.
6. Adaptar el prototipo o interfaz; no resolver incompatibilidades copiando lógica del motor.
7. Integrar UX/UI.
8. Ejecutar nuevamente las pruebas completas y una revisión visual.
9. Fusionar a `main` solo si la integración está limpia y documentada.

Para hitos grandes conviene crear una rama temporal:

```text
integration/stage2d-ui
```

Esta rama permite resolver y probar la combinación sin romper `main`. Después de aprobarla, se fusiona una sola vez a `main`.

### Conflictos

- Resolver cada conflicto entendiendo ambas intenciones.
- Nunca aceptar automáticamente “todo Codex” o “todo Claude”.
- Si el conflicto toca un contrato, resolver primero el contrato y después sus consumidores.
- Si Git no informa conflictos, igualmente revisar conflictos lógicos: nombres de estados, rutas, eventos, tipos y supuestos de duración.
- Regenerar outputs después de integrar; no mezclar outputs producidos por ramas distintas.

## Criterios antes de incorporar a `main`

- Alcance del hito cumplido y documentado.
- Working tree limpio.
- Commits revisables y sin temporales.
- Build correcto.
- Pruebas proporcionales aprobadas.
- Pipeline y FFprobe aprobados cuando corresponda.
- Determinismo conservado.
- Preview y exportación equivalentes.
- UX no duplica lógica del motor.
- Rutas, configs y manifests siguen siendo portables.
- No se agregaron dependencias sin aprobación y justificación.

## Cadencia sugerida

- Codex completa una capacidad pequeña y entrega su contrato/evidencia.
- Claude usa ese contrato en el siguiente incremento del prototipo UX.
- Se hace una demostración conjunta por hito, no por cada archivo.
- Solo se integra a `main` cuando motor e interfaz coinciden en el flujo demostrado.

El próximo hito conjunto recomendado, después de completar técnicamente 2D, es:

- **Codex:** Etapa 2E, fondo y cámara animables dentro de una sola escena.
- **Claude:** conectar su prototipo al contrato 2D ya disponible y diseñar el flujo “crear diálogo → asignar hablantes → previsualizar → exportar”.

Así se puede avanzar en paralelo sin diseñar la interfaz a ciegas ni detener el desarrollo funcional.
