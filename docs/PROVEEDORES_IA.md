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
- **options**: `{ model, temperature, think, seed, maxOutputTokens, timeoutMs }`.
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
  config)`; `listProviderNames()`). Hoy el único registrado es `ollama`.
- Selección por petición: el servidor acepta `provider` opcional en
  `POST /api/director/proposals` y `POST /api/director/edits` (default `ollama`).
  Un valor no registrado devuelve `DIRECTOR_PROVIDER_UNKNOWN` (HTTP 400).
- `GET /api/health` reporta `providers` (salud por proveedor) y
  `registeredProviders`.

## Pendiente del usuario (decisiones de producto, NO implementadas por este plan)

Conectar una IA **web** exige decisiones que este plan deja documentadas, sin
implementar:

1. **Privacidad / local-first.** Hoy el prompt nunca sale de la máquina y la guarda
   de loopback (`normalizeLoopbackUrl`) lo garantiza por código. Sumar web = decisión
   explícita, opt-in por proveedor.
2. **Secretos.** Una API web necesita API key por variable de entorno, nunca en el
   repo ni en la UI. El repo hoy no maneja ninguna clave.
3. **No-determinismo.** Ver arriba: se declara por proveedor.
4. **Costo por uso.** Con web aparece facturación por token; conviene mostrar el
   proveedor usado en cada propuesta (la UI ya muestra `model`).

Mientras esas decisiones no estén tomadas, la guarda de loopback **no se levanta** y
no se agregan clientes de APIs externas (ni detrás de flags).
