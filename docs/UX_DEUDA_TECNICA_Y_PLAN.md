# Deuda técnica de UX — plan y guía

Carril: Claude (UX/UI). Rama: `claude/trabajo`.
Fecha: 22 de julio de 2026.

Este documento prioriza la deuda técnica de UX del **preview vigente** y define qué se
resuelve ahora, qué queda fuera y cómo se verifica. No modifica el motor.

## Alcance

- **Objetivo:** resolver la deuda de UX de mayor impacto en el preview actual sin tocar
  contratos ni lógica temporal, y sembrar una base de estilo que el editor (Fase 4)
  pueda reutilizar.
- **Archivos que se tocan:** `src/style.css` (principal), `index.html` (cambios
  aditivos), `src/main.ts` (solo comportamiento mínimo de estado de UI).
- **Fuera de alcance:** `shared/scene-evaluator.js`, `schema/`, `scripts/stage1/`,
  formatos de runtime/progreso/error, dependencias nuevas, rediseño del layout del
  editor (eso es prototipo separado, otra tarea).
- **Invariante respetado:** la evaluación de escena sigue pasando por `evaluateScene`
  sin cambios; solo cambian presentación y affordances de control. Preview = export
  se conserva.
- **Coordinación con Codex:** Codex hará Etapa 2D y expondrá dos hablantes en el
  preview. Por eso todos los cambios en `index.html` son **aditivos** (no se mueven ni
  renombran nodos/IDs existentes) para que su merge sea limpio.

## Prioridad de la deuda (de mayor a menor impacto)

| # | Deuda | Por qué importa | Archivos | Estado |
|---|---|---|---|---|
| 1 | Sin sistema de tokens; CSS con valores mágicos | No escala al editor; toda decisión de color/espaciado está repetida a mano | `style.css` | A resolver |
| 2 | Botones no comunican estado (disabled/active) | El usuario no sabe qué acción es válida; "Pausar" activo sin reproducir | `main.ts`, `style.css` | A resolver |
| 3 | Sin estado de carga del canvas | Área de preview vacía sin feedback mientras cargan texturas/audio | `main.ts`, `index.html`, `style.css` | A resolver |
| 4 | Metadatos estáticos mezclados con telemetría en vivo | La `<dl>` junta datos del job y valores que cambian por frame; confunde la lectura | `index.html`, `style.css` | A resolver |
| 5 | Jerarquía tipográfica invertida | `h1` gigante en un panel de utilidad; la info útil queda en letra chica | `style.css` | A resolver |
| 6 | Accesibilidad incompleta | Falta `focus-visible`, `prefers-reduced-motion`, región `aria-live` para estado/errores | `style.css`, `index.html` | A resolver |

## Deuda diferida (necesita coordinación, no se toca ahora)

- **Cambiar de job recarga toda la página** (`window.location.assign`). Volverlo reactivo
  es un rediseño mayor de `src/main.ts` y puede chocar con la Etapa 2D de Codex. Se
  difiere hasta coordinar. No es deuda de estilo sino de arquitectura de la vista.
- **Lenguaje interno de producto** ("Etapa 2C · Personaje animable"). Se resolverá al
  definir la identidad del editor, no en el harness de diagnóstico.

## Guía de ejecución

1. Definir tokens en `:root` (color, espaciado, radios, escala tipográfica, sombras) y
   reescribir `style.css` para consumirlos. Sin cambiar la estructura visual global.
2. Añadir estados de control en `main.ts`: deshabilitar controles hasta `ready`,
   reflejar reproduciendo/pausado, marcar `aria-busy` en el escenario durante la carga.
3. Agrupar en `index.html` (aditivo) los metadatos del job separados de la telemetría
   en vivo, y marcar la telemetría como región `aria-live="polite"`.
4. Ajustar jerarquía tipográfica y foco accesible en `style.css`.
5. `npm run build` para verificar TypeScript + Vite.
6. Commits pequeños por intención en `claude/trabajo`.

## Prueba de salida

- `npm run build` pasa sin errores.
- El preview sigue cargando, reproduciendo y mostrando la telemetría igual que antes.
- Los controles reflejan su disponibilidad y el estado de reproducción.
- No se modificó ningún contrato, schema ni lógica de `evaluateScene`.
- `index.html` conserva todos los IDs previos (merge limpio con Codex).
