# Fixtures del contrato de animación V1

Documentos de animación de escena usados por la Fase 0 del plan de capacidades
creativas editables. No son proyectos renderizables: el contrato todavía vive
aislado en `schema/animation-scene.schema.json` y ningún consumidor lo lee.

- `fixtures/valid/` — cuatro documentos que el contrato debe aceptar.
- `fixtures/invalid/` — trece documentos que debe rechazar, uno por código de
  autoría comprobable desde un archivo.

Los códigos esperados de cada fixture inválido están en
`scripts/animation/test-animation-contract.mjs`. El vocabulario, los límites y
el catálogo de errores están documentados en
`docs/FASE_0_CONTRATO_ANIMACION_V1.md`.

```bash
npm run anim:test-contract
```
