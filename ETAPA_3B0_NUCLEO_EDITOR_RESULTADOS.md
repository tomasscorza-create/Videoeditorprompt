# Etapa 3B.0 — núcleo del editor local

Fecha: 22 de julio de 2026.

Estado: implementada y verificada técnicamente.

## Objetivo

Crear el límite funcional entre la interfaz UX/UI y `video-project` v1 sin duplicar el motor ni acoplar la edición a PixiJS. Este incremento no construye otra interfaz: entrega un módulo portable que la rama visual puede consumir.

## Resultado

`shared/project-editor.js` mantiene un estado inmutable y aplica comandos semánticos cerrados. Soporta:

- seleccionar una escena;
- editar título del proyecto o escena;
- cambiar fondo y preset de cámara mediante IDs del catálogo;
- cambiar el recurso de un personaje;
- editar X, Y, escala y orden Z del personaje;
- editar texto, voz, gesto y pausa de un turno;
- elegir transición `cut` o `fade`;
- reordenar escenas;
- deshacer y rehacer con historial limitado;
- listar recursos reales por tipo;
- exportar JSON portable y estable.

El contrato de entrada está en `schema/editor-command.schema.json`. Los comandos rechazan campos arbitrarios tanto por JSON Schema como dentro del módulo; el proyecto y el catálogo se clonan y congelan para evitar mutaciones laterales.

## Integración prevista con UX/UI

La interfaz debe crear el estado una sola vez:

```js
const editor = createProjectEditor(project, catalog);
```

Cada control emite un comando y conserva el nuevo estado:

```js
state = applyProjectEditorCommand(state, {
  type: 'set-character-transform',
  sceneId: 'escena-presentacion',
  elementId: 'presentadora',
  x: 360,
  y: 1120,
  scale: 0.76
});
```

La UI representa `state.project`; PixiJS y el pipeline son consumidores, no la fuente de verdad. `shared/project-editor.d.ts` expone la superficie TypeScript para la integración.

## Compatibilidad vigente

3B.0 trabaja deliberadamente sobre el subconjunto que 3A.1 puede compilar: exactamente dos personajes, al menos dos turnos, pose/ancla/rotación/opacidad compatibles y recursos existentes. Texto e imágenes de canvas se rechazan explícitamente hasta que el runtime pueda representarlos; no se pierden silenciosamente.

## Verificación

- `npm run stage3b:test-editor`: 11/11.
- El proyecto exportado fue aceptado por el validador autoritativo 3A.
- El proyecto exportado compiló a dos escenas v2 con hash semántico `9e324ea1f17122c0383ed83912a862c999b87cdb2860f3920dc9248b22ba9a79`.
- `npm run build`: correcto.
- Sin dependencias nuevas ni cambios en `index.html`, `src/main.ts` o `src/style.css`.

Se aplicó nivel 2–3: pruebas específicas del módulo, límites de seguridad, integración con el validador y compilador reales y build. No fue necesario repetir TTS/FFmpeg porque el módulo no modifica preparación, evaluador ni exportación.

## Siguiente incremento

3B.1 debe conectar la interfaz de Claude a este módulo: cargar proyecto/catálogo, renderizar escenas y formularios desde el estado, emitir comandos, mostrar errores y descargar el JSON editado. Después, un puente local separado y seguro podrá congelar ese JSON y lanzar el pipeline headless; no debe ejecutarse una shell desde datos del navegador.

## Publicación portable para la interfaz

El adaptador `scripts/stage3b/publish-project.mjs` elimina la dependencia de `/pilots/` en el build. Valida primero con 3A y 3B.0, publica únicamente proyectos realmente abribles y genera `public/projects/index.json` versión 1.

Cada entrada contiene `projectId`, `title`, `projectPath`, `resourceCatalog`, `sceneCount`, `editorContractVersion`, hashes del proyecto/catálogo y una `revision` combinada. La UI debe usar `revision` para cache-busting; no se publica `updatedAt`, de modo que repetir la misma entrada produzca la misma revisión.

El `project.json` publicado conserva exactamente los mismos datos que el fuente validado, con serialización JSON uniforme. `proyecto-editable-01` no se lista porque demuestra elementos futuros; `proyecto-compilable-01` es el piloto operativo del editor actual.

Verificación adicional: `npm run stage3b:test-publishing`, 10/10 controles.
