# Etapa 4D — Timeline profesional

La timeline audiovisual fue reconstruida sobre los contratos vigentes sin modificar el render determinista.

Resultado:

- V1/A1, regla, playhead, timecode, clips y transiciones.
- Proyecto editable en modo explícito sin medir.
- Preview con turnos medidos.
- MP4 final con escenas, audio y fundidos del manifiesto.
- Seek, reproducción, mute, navegación, zoom, fit, snap, seguimiento y atajos.
- Undo/redo sobre el `ProjectStore`.

No se simularon operaciones que el núcleo todavía no soporta: corte, borrado, estirado o drag temporal.

Verificación proporcional:

- build correcto;
- gestor de render: 29 controles;
- servidor local: 26 controles;
- sin render nuevo porque no cambiaron TTS, frames, evaluador ni FFmpeg.

La auditoría detallada está en `docs/AUDITORIA_TIMELINE_PROFESIONAL_2026-07-24.md`.
