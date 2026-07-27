# Recursos y plantillas del Director IA

## Objetivo

El Director decide qué combinar; no procesa el inventario completo ni genera
frames, rigs o animaciones desde cero. Antes de cada petición, una capa local y
determinista convierte el catálogo completo en un contexto pequeño:

`idea + restricciones → ranking local → shortlist → Director IA → validación → compilación`

El catálogo completo sigue siendo la autoridad para validar y compilar. La
shortlist solo limita el contexto que recibe el modelo y los IDs que admite su
JSON Schema para esa petición.

## Selección de recursos

`scripts/director/director-context.mjs` normaliza la idea, elimina diacríticos y
puntúa etiquetas, nombre, tipo y capacidades. También incorpora términos del tono
y las etiquetas musicales de la plantilla recomendada.

Límites predeterminados:

- 6 personajes.
- 4 voces.
- 4 fondos.
- 3 pistas musicales.
- 3 plantillas narrativas.

Los empates conservan el orden estable del catálogo. Una misma entrada y una
misma idea producen exactamente la misma shortlist. En edición contextual se
agregan, aunque excedan el límite, los recursos que el proyecto ya referencia;
así el Director nunca pierde la capacidad de conservar o modificar el proyecto
actual.

El resultado de propuesta y edición expone `context` con los IDs seleccionados,
puntajes, plantilla recomendada y relación `shortlistedEntries /
totalCatalogEntries`. Esa información también entra en la clave de caché.

## Plantillas narrativas

`public/assets/catalog/narrative-templates.json` contiene cinco plantillas:

- Explicación paso a paso.
- Contraste entre dos miradas.
- Problema y solución.
- Lista breve con progresión.
- Antes, descubrimiento y después.

Una plantilla es una secuencia de intenciones o *beats*, no un video rígido.
Sugiere hablante, ritmo, layouts y gestos. El modelo adapta esas piezas al tema y
las combina con la shortlist; no copia texto preescrito. El plan conserva la
elección en `narrativeTemplateId`. Si un proveedor omite el campo, se adopta de
forma determinista la plantilla recomendada por el ranking local.

El contrato está en `schema/narrative-template-catalog.schema.json`. Rechaza IDs
duplicados, rangos de escenas incoherentes y referencias a layouts o gestos
inexistentes.

## Cómo ampliar el sistema

Para agregar un recurso, se registra una ficha en el catálogo de autoría con:

- ID estable y tipo.
- Nombre corto y etiquetas útiles para búsqueda.
- Capacidades cerradas y compatibilidad representable.
- Procedencia y licencia.
- Referencia portable al asset o manifest.

Para agregar una estructura narrativa, se incorpora una plantilla validada. No
se modifica el prompt ni el código de selección.

Este diseño mantiene el costo del modelo acotado cuando el inventario crezca a
cientos o miles de recursos. Una futura búsqueda por embeddings puede sustituir
el ranking léxico detrás del mismo límite, pero no es necesaria para el catálogo
local actual.
