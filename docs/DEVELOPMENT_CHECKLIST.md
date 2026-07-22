# Checklist de desarrollo

Usar solo los puntos aplicables. Debe poder completarse en menos de dos minutos; las reglas completas están en `AGENTS.md`.

## Antes de comenzar

- [ ] Entendí el pedido y el resultado esperado.
- [ ] Identifiqué los módulos y contratos afectados.
- [ ] Definí qué queda fuera del alcance.
- [ ] Leí `AGENTS.md` y la documentación relevante.
- [ ] Revisé riesgos y cambios existentes del usuario.
- [ ] Elegí un nivel de pruebas proporcional (1–4).
- [ ] Busqué funciones existentes y no duplicaré capacidades.
- [ ] Si agrego una dependencia, preparé su justificación y revisión de licencia/portabilidad.

## Durante el desarrollo

- [ ] Mantengo `shared/scene-evaluator.js` como fuente temporal compartida.
- [ ] Mantengo `frameIndex / fps`, duración por FFprobe y semillas deterministas.
- [ ] No introduzco rutas absolutas en proyectos, runtimes, cues o manifiestos.
- [ ] Mantengo configuración y archivos aislados por `jobId`.
- [ ] No limpio temporales fuera del trabajo actual validado.
- [ ] Ejecuto procesos con argumentos separados y `shell: false`.
- [ ] No mezclo lógica del núcleo con Vite, DOM o la UI.
- [ ] No agrego dependencias ni abstracciones innecesarias.
- [ ] No agrego funciones fuera del pedido.
- [ ] Valido entradas, rutas y límites relevantes.
- [ ] Manejo errores/progreso de forma estructurada.
- [ ] Evito IA, APIs pagas y cómputo innecesarios; uso caché cuando corresponde.

## Antes de finalizar

- [ ] Ejecuté las pruebas específicas elegidas y un caso límite relevante.
- [ ] Ejecuté integración/pipeline solo si el cambio puede afectarlos.
- [ ] Ejecuté `npm run build` si afecté TypeScript, preview o contratos importados.
- [ ] Verifiqué FFprobe/exportación y repetición si afecté audio, frames o FFmpeg.
- [ ] Verifiqué preview y exportación si cambié evaluación temporal.
- [ ] Revisé secretos, datos sensibles y logs excesivos.
- [ ] Revisé temporales/outputs accidentales y limpieza segura.
- [ ] Registré procedencia/licencia si agregué assets, fuentes, voces o modelos.
- [ ] Actualicé solo la documentación afectada.
- [ ] Informé cambios, pruebas realizadas, suficiencia y pendientes.

## Para contratos creativos, catálogo o IA

- [ ] Separé el proyecto de autoría, el runtime compilado y los artefactos del job.
- [ ] La generación por prompt produce datos editables y validados, no frames ni keyframes exhaustivos.
- [ ] Personajes, variantes, poses, animaciones y assets se referencian por IDs estables y rutas relativas resueltas bajo raíces controladas.
- [ ] Las definiciones geométricas contienen datos permitidos, nunca código o expresiones arbitrarias.
- [ ] Preview y exportación consumen el mismo estado temporal después de compilar presets y decisiones de autoría.
- [ ] Assets, voces, fuentes y modelos incorporan procedencia, licencia y versión.

## Para cambios web futuros

- [ ] Cada trabajo está aislado por `jobId`, usuario y raíces permitidas.
- [ ] No hay estado global mutable requerido por el motor.
- [ ] Entradas, uploads y rutas están validados; no hay traversal.
- [ ] Existen límites de CPU, RAM, disco, duración, resolución y texto.
- [ ] Storage está abstraído del motor y autorizado por usuario.
- [ ] El worker y herramientas son compatibles con Linux.
- [ ] Errores/progreso tienen contratos versionados y códigos estables.
- [ ] Operaciones largas tienen timeout, cancelación e idempotencia.
- [ ] Caché y reserva de jobs son seguras ante concurrencia.
- [ ] No existe acceso cruzado entre usuarios ni secretos en logs/artefactos.
