# Proveedores de IA del Director — contrato e integración

> Cómo sumar una IA nueva sin tocar el resto del sistema (Fase D del
> `PLAN_DE_ACCION_IA_2026-07-24.md`). Sumar un proveedor = **implementar una
> interfaz + registrarla**. Este documento es el contrato; la definición
> ejecutable vive en `scripts/director/providers/contract.mjs` y se corre en
> `npm test` (`director:test-provider-contract`).

## Interfaz `DirectorProvider`

Un proveedor es un objeto (lo devuelve una factory `create<Nombre>Provider(config)`)
con:

```
{
  name: string,
  async generatePlan({ messages, schema, options, signal }) -> { content, usage? },
  async generateCommands({ messages, schema, options, signal }) -> { content, usage? },
  async inspect({ model, timeoutMs }) -> { available, version, model, modelInstalled },
}
```

- **messages**: `[{ role, content }]` ya armados aguas arriba (system + user).
- **schema**: JSON Schema de la salida esperada. El proveedor debe pedirle al
  modelo una salida estructurada que lo cumpla (Ollama `format`; una API web usa
  tool use / `response_format` con JSON Schema).
- **options**: `{ model, temperature, think, seed, maxOutputTokens, timeoutMs,
  promptCacheKey }`.
  Son pistas agnósticas; cada proveedor las mapea a su transporte (p. ej. Ollama:
  `seed`→`options.seed`, `maxOutputTokens`→`num_predict`, `think`→`think`).
- **content**: string con el JSON del modelo. Aguas arriba se parsea y se valida
  en la cadena completa (normalizador/editor + Ajv + compilador). El proveedor no
  parsea ni normaliza: solo transporta.
- **signal**: `AbortSignal` para cancelar.

## Garantías que debe cumplir

Verificadas por `assertDirectorProviderContract`:

1. `name` es un identificador no vacío (entra en la clave de caché aguas arriba).
2. `generatePlan`/`generateCommands` devuelven `content` string parseable como JSON
   que cumple el schema pedido.
3. `inspect()` responde `{ available, version, model, modelInstalled }`.
4. Respeta `signal`: al abortar, rechaza con un `PipelineError`.
5. Propaga fallos de transporte con la taxonomía `PipelineError` (stage `directing`).

## Lo que un proveedor NO puede asumir

- **Determinismo por seed es opcional.** Ollama lo respeta; las APIs web no lo
  garantizan. Si un proveedor no es determinista, lo declara: el rótulo
  «determinista» del plan deja de aplicar a ese proveedor. La caché por hash mitiga
  (misma petición → mismo resultado guardado) pero no lo exige.
- No puede escribir el proyecto directamente: todo pasa por el embudo de validación.

## Registro y selección

- Registro: `scripts/director/providers/index.mjs` (`resolveDirectorProvider(name,
  config)`; `listProviderNames()`). Están registrados `ollama` y `openai`.
- Selección por petición: el servidor acepta `provider` opcional en
  `POST /api/director/proposals` y `POST /api/director/edits` (default `ollama`).
  Un valor no registrado devuelve `DIRECTOR_PROVIDER_UNKNOWN` (HTTP 400).
- `GET /api/health` reporta `providers` (salud por proveedor) y
  `registeredProviders`.

## OpenAI

OpenAI es opt-in y usa Responses API con salida guiada por JSON Schema. La clave:

- se lee exclusivamente desde `OPENAI_API_KEY` en el servidor;
- no se acepta en peticiones del navegador;
- no se guarda en el repositorio, proyecto, caché ni logs;
- se envía a `https://api.openai.com/v1` mediante autenticación Bearer.

En Windows, el arranque recomendado es `npm run dev:openai`. El script solicita la
clave de forma oculta, la expone solo al proceso local y la elimina del entorno al
cerrar. Después se elige el modelo OpenAI en el control `Modelo IA` del paso `Idea`.
El modelo predeterminado es `gpt-5.6-luna`; Terra y Sol quedan disponibles como
elecciones explícitas.

Para no pegar la clave en cada inicio, `npm run openai:configure` solicita una clave
nueva de forma oculta y la guarda una sola vez como variable de usuario de Windows.
Después la aplicación se inicia normalmente con `npm run dev:filesystem`. La clave
sigue fuera del repositorio y del navegador, aunque queda persistida para la cuenta
local de Windows.

Ollama continúa siendo el proveedor predeterminado y no requiere Internet. OpenAI
no garantiza determinismo por seed; la caché del Director sí conserva una respuesta
ya aceptada para la misma clave semántica.

### Consumo, caché y recuperación

- Cada respuesta normaliza `inputTokens`, `outputTokens`, `cachedInputTokens`,
  `cacheWriteTokens`, `totalTokens`, cantidad de solicitudes, intentos de transporte
  y reintentos. Los alias `promptEvalCount` y `evalCount` se conservan para Ollama y
  clientes anteriores.
- Preguntas, reparaciones, segmentos de escenas y juez se acumulan en el uso final;
  una reparación fallida ya no desaparece del total.
- OpenAI reintenta de forma acotada `408`, `409`, `429`, respuestas `5xx` y fallos
  transitorios de red. Respeta `Retry-After`, el timeout global y la cancelación.
- `prompt_cache_key` usa una huella técnica sin el prompt del usuario. Las
  instrucciones estables preceden al contenido variable para favorecer coincidencias
  de prefijo.
- La salida estructurada usa modo estricto solamente cuando todo el JSON Schema
  cumple el subconjunto estricto; los planes con propiedades opcionales conservan el
  modo compatible y siguen pasando por validación local.
- Las creaciones de cuatro a ocho escenas se reparten en bloques equilibrados de
  hasta tres escenas. Ocho escenas requieren como máximo tres solicitudes de plan,
  salvo reparaciones explícitas.
- `LOCAL_VIDEO_OPENAI_MAX_QUESTION_TOKENS` limita la capa de preguntas (default
  `5000`) y `LOCAL_VIDEO_OPENAI_MAX_PROPOSAL_TOKENS` limita la propuesta (default
  `60000`). Los límites se verifican con el uso reportado por OpenAI.
- Las cachés de preguntas y planes se escriben de forma aislada. Un JSON corrupto se
  aparta y se regenera; agregar un recurso que no entra en el contexto efectivo ya no
  invalida planes existentes.

El paso `Video` muestra estos datos dentro de un detalle plegado y conserva el último
registro asociado a la revisión exacta del proyecto. No se calcula dinero con precios
hardcodeados: las tarifas cambian y el dato confiable que conserva la aplicación es el
uso de tokens reportado por el proveedor.

La shortlist de recursos normaliza plurales, amplía sinónimos frecuentes y fuerza la
inclusión de un recurso compatible cuando el usuario menciona literalmente su ID o
etiqueta. Los empates se resuelven por ID estable, no por el orden del catálogo. El
detalle técnico informa cuántos recursos se enviaron y qué tipos siguen fuera del
contrato del Director. En particular, los SFX permanecen excluidos: el runtime vigente
no tiene todavía clips de efectos puntuales sincronizados de la misma forma en preview
y MP4, por lo que exponerlos a la IA rompería el contrato honesto de capacidades.
