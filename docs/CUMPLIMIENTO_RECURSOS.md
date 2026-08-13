# Cumplimiento de recursos incorporados

## Objetivo

La licencia visible en una tarjeta de la biblioteca es un resumen de autoría, no
evidencia suficiente para distribuir comercialmente el producto. La fuente de
verdad para ese gate es
`public/assets/catalog/resource-licenses.json`, validada contra
`schema/resource-license-manifest.schema.json`.

El manifiesto legal es aditivo. No cambia el contrato del proyecto, el catálogo
que consume el Director ni el render. Cada recurso incorporado debe tener
exactamente un registro legal con el mismo ID y tipo que
`authoring-resources.json`.

## Estados

- `cleared`: la evidencia registrada permite el uso declarado.
- `attribution-required`: se admite el uso, pero el texto de atribución es
  obligatorio.
- `review-required`: la ficha está clasificada, pero falta una decisión o
  evidencia antes de un release comercial.
- `local-only`: el recurso puede usarse localmente y no debe distribuirse.

Los campos `commercialUse` y `redistribution` son independientes. Que un recurso
pueda aparecer en un video comercial no implica que su archivo, modelo o peso
pueda empaquetarse dentro de una biblioteca vendida.

`LicenseRef-Proprietary-Asset` identifica recursos originales de Tomás Scorza
que pueden acompañar al producto autorizado, pero no concede permiso para
extraerlos y revenderlos como un pack independiente.

## Comandos

Validar esquema, cobertura total del catálogo, tipos y avisos generados:

```powershell
npm run assets:test-licenses
```

Regenerar `THIRD_PARTY_NOTICES.md` después de un cambio intencional del
manifiesto:

```powershell
npm run assets:licenses:write
```

Comprobar si todos los recursos y dependencias están listos para distribución
comercial:

```powershell
npm run assets:licenses:release
```

El último comando debe fallar mientras quede un `review-required`, un uso
comercial dependiente del plan o una redistribución pendiente. Ese fallo es un
gate deliberado, no impide desarrollar, previsualizar o renderizar localmente.

## Alta de un recurso externo

Antes de incorporarlo al catálogo base:

1. fijar la URL del archivo o página original y la licencia exacta;
2. conservar autor o titular, expresión SPDX o `LicenseRef-*` y atribución;
3. distinguir uso comercial del video y redistribución del archivo crudo;
4. registrar modificaciones y versión o revisión cuando la fuente lo permita;
5. añadir el recurso al catálogo y al manifiesto en el mismo cambio;
6. regenerar avisos y ejecutar la auditoría;
7. no marcar `cleared` si existen derechos de imagen, marcas, procedencia o
   términos del servicio sin resolver.

Las importaciones personales que quedan como “Licencia no declarada; uso local”
no pueden convertirse automáticamente en recursos incluidos en un release.

## Pendientes iniciales detectados

- `conejo-traje-v1`: falta documentar la cadena de autoría y los términos de la
  asistencia de IA usada en su propuesta.
- `voz-claude-mx-v1`: falta cerrar la procedencia del audio base.
- Piper TTS: el runtime actual es GPL-3.0-or-later; hay que definir el mecanismo
  concreto de cumplimiento antes de distribuirlo con el producto.
- ElevenLabs: los derechos comerciales dependen del plan y de los términos
  vigentes; el producto no redistribuye sus modelos.

Este registro técnico no reemplaza una revisión jurídica previa al lanzamiento.
