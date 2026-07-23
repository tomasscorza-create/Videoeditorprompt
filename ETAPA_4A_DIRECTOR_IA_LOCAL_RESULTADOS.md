# Etapa 4A — Director IA local y render desde la interfaz

## Resultado

Se integró un primer flujo completo y local:

```text
prompt → Ollama/qwen3:8b → plan semántico JSON → proyecto editable
       → validación → pipeline determinista → MP4 multiescena
```

La IA decide contenido editorial dentro de un vocabulario cerrado: reparto, diálogo, escenas, fondo, cámara, composición, gestos y transiciones. No genera frames, rutas, comandos ni keyframes. El normalizador determinista convierte ese plan al contrato `video-project` vigente y el pipeline existente continúa midiendo voz, evaluando frames y ensamblando el video.

## Implementación

- JSON Schema específico para el plan de la IA.
- Adaptador Ollama local con `qwen3:8b`, salida estructurada, semilla, timeout y caché.
- Validación contra el catálogo y límites de escenas, turnos, texto y duración aproximada.
- API en `127.0.0.1:4174`, sin exposición de red, con cuerpo limitado y orígenes permitidos.
- Trabajo aislado por `jobId`, proyecto congelado, `shell: false`, un render activo, timeout y cancelación.
- Panel de prompt, propuesta editable, progreso, error, reproducción y descarga en la UI.

## Evidencia real

Prompt:

> Creá un video breve y educativo donde dos monos debaten si la inteligencia artificial reemplazará a los programadores y terminan explicando que sirve para potenciar su trabajo.

Resultado verificado:

- modelo: `qwen3:8b`;
- 3 escenas y 104 palabras;
- duración medida final: 33,033333333 s;
- H.264/AAC, 1080 × 1920 y 30 fps;
- dos ensamblajes finales binariamente idénticos;
- estado visible y descarga disponible desde la interfaz;
- trabajo: `render-20260723050141-aa8e842b`.

## Límites vigentes

- Un único modelo y catálogo cerrado.
- Sin preguntas aclaratorias, comparación automática de variantes ni reparación de planes.
- Un solo render local activo.
- El preview interactivo sigue siendo de una escena; el resultado multiescena se reproduce como MP4.
- No es una API remota, un backend multiusuario ni una cola durable.
