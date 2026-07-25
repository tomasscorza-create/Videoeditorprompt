# ADR-0003 — Sandbox filesystem local por job

Estado: **propuesto para G0**.

Fecha: 25 de julio de 2026.

## Contexto

Piper, FFmpeg, FFprobe y Chromium consumen rutas locales. El pipeline vigente
obtiene determinismo y seguridad mediante carpetas aisladas por `jobId`.
Conectarlos directamente a URLs o streams remotos rompería contratos y
complicaría la verificación.

## Decisión

Mantener un sandbox filesystem efímero y validado por job:

- hidratar inputs desde `BlobStorage` dentro del trabajo actual;
- verificar clave, tamaño y SHA-256 antes de usarlos;
- ejecutar procesos con ejecutable y argumentos separados, `shell: false`;
- conservar evaluación temporal por `frameIndex / fps`;
- verificar outputs y FFprobe antes de subirlos;
- limpiar solo temporales del job mediante rutas resueltas y protegidas;
- nunca persistir rutas absolutas del sandbox como identidad.

## Consecuencias

- el render sigue siendo compatible con las herramientas actuales;
- el worker necesita presupuesto local de disco y limpieza;
- reiniciar puede requerir rehidratar inputs, pero no reconstruir identidad;
- la frontera durable/materialización queda explícita y testeable.

## Alternativas descartadas

- montar storage remoto como filesystem: semántica y fallos poco explícitos;
- pasar URLs a FFmpeg/Piper: amplía superficie de red y rompe aislamiento;
- compartir un directorio global: permite colisiones y limpieza cruzada.
