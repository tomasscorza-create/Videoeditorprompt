# Configuraciones guardadas V2

Una configuración guardada es una identidad creativa reutilizable del Director, no una copia de un proyecto. Fija reparto, voces, preset de animación, narrador opcional, estructura, riqueza y un único fondo global. La cámara es estática y los enlaces internos son fundidos de 0,35 segundos; no son opciones editables de la configuración.

El contrato V2 elimina `beat-variation` y los booleanos de continuidad: sus efectos son invariantes del runtime. Los recursos se comprueban antes de invocar a la IA. El listado expone `valid`, `incomplete` o `incompatible`; solo las válidas son seleccionables.

Los documentos V1 se migran explícitamente y de manera determinista. Conservan una copia V1 en `legacyPreconfiguration`; al migrar, se toma el primer fondo, se registra la advertencia de variación por beat y se completa la animación ausente con el primer preset disponible del personaje.

La API separa `POST` (crear), `PUT` (actualizar con `expectedRevision`) y `DELETE` (también con revisión). Las escrituras son serializadas y atómicas. Al iniciar Idea, la respuesta de preguntas devuelve un snapshot con ID, revisión y hash. Base y Video lo reenvían: cambios o eliminación posteriores no alteran la creación ya iniciada.

El esquema que se entrega al Director usa una alternativa cerrada por cada tupla rol/personaje/voz/animación. Por eso no puede cruzar la voz de un rol con el personaje de otro. La revisión y el hash del snapshot forman parte de la clave de caché de propuesta.
