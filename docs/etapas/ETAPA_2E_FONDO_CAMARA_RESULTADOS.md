# Etapa 2E — Fondo y cámara animables

Fecha: 22 de julio de 2026.

Estado: implementada y verificada técnicamente. Pendiente aceptación visual del usuario.

## Resultado

El contrato v2 admite opcionalmente un fondo de dos o tres capas y una cámara global que evoluciona sobre la duración real de la escena. Cada plano define escala base y factores de parallax horizontal/vertical. Preview y exportación calculan el mismo movimiento desde el evaluador compartido.

El piloto `piloto-fondo-parallax-01` usa:

- plano lejano opaco;
- plano medio RGBA;
- primer plano RGBA;
- paneo horizontal de −35 a 35;
- paneo vertical de 6 a −10;
- zoom de 1,000 a 1,035;
- parallax creciente de fondo a frente.

No se agregaron keyframes libres, loops configurables, varias escenas, editor, React, Electron ni dependencias nuevas.

## Contrato de autoría

La extensión es opcional y compatible con los configs v2 existentes:

```json
{
  "backgroundAnimation": {
    "layers": [
      {
        "id": "far",
        "asset": "assets/backgrounds/studio/far.png",
        "baseScale": 1.08,
        "parallaxX": 0.15,
        "parallaxY": 0.12
      },
      {
        "id": "front",
        "asset": "assets/backgrounds/studio/front.png",
        "baseScale": 1.18,
        "parallaxX": 1,
        "parallaxY": 0.85
      }
    ],
    "camera": {
      "fromX": -35,
      "toX": 35,
      "fromY": 6,
      "toY": -10,
      "fromZoom": 1,
      "toZoom": 1.035
    }
  }
}
```

La interpolación es `smoothstep` sobre la duración medida del WAV maestro. La UI no necesita producir keyframes por frame.

## Assets

`studio-parallax-v1` es una creación vectorial original del proyecto:

- fuentes SVG incluidas;
- PNG 1080 × 1920;
- `far.png` opaco;
- `mid.png` y `front.png` RGBA;
- manifiesto de procedencia y licencia interna.

La regeneración usa Chrome/Edge headless únicamente para rasterizar SVG. El pipeline consume PNG y no depende del navegador.

## Evidencia

- Duración de audio: 5,358413 s.
- Frames: 161 a 30 fps.
- Generación de frames: 15,148 s.
- Codificación: 0,940 s.
- Total render 1: 16,166 s.
- MP4: 820.187 bytes.
- Video: H.264, 1080 × 1920, 30 fps, `yuv420p`.
- Audio: AAC mono, 22.050 Hz.
- Duración MP4: 5,366016 s.
- Verificaciones: 49 aprobadas.
- Hash de frames: `6355bb839bf59dcd77ba637221c25b4b7c8e6824b6296133c0595fbf88c82e64`.
- SHA-256 MP4: `c815454d5e9878f9a9bc79b6fa2424a1b51a37fd57de2fe6964399fa7188de86`.

Los dos planes, secuencias PNG y MP4 fueron idénticos.

## Inspección visual

La comparación entre el primer y último frame confirmó:

- desplazamiento horizontal;
- zoom progresivo;
- primer plano moviéndose más que el fondo lejano;
- ausencia de bordes vacíos;
- personajes, boca y subtítulos conservados;
- composición vertical legible.

El preview PixiJS cargó cinco jobs, WebGL y reprodujo el piloto 2E sin errores.

Abrir:

```text
http://localhost:5173/?job=piloto-fondo-parallax-01
```

## Archivos principales

- `schema/scene-config-v2.schema.json`
- `scripts/stage1/validate-scene-config.mjs`
- `shared/scene-evaluator.js`
- `shared/scene-evaluator.d.ts`
- `scripts/stage1/prepare-dialogue.mjs`
- `scripts/stage1/export-dialogue.mjs`
- `scripts/stage1/verify-dialogue.mjs`
- `src/main.ts`
- `scripts/stage2e/generate-background-layers.mjs`
- `scripts/stage1/test-background-animation.mjs`
- `pilots/fondo-parallax-01/scene.config.json`
- `public/assets/backgrounds/studio-parallax-v1/`
- `package.json`

## Comandos

```powershell
npm run stage2e:assets
npm run stage2e:test-background
npm run stage2e:pipeline
```

## Pruebas

Se usó nivel 4 porque cambiaron contrato, evaluación temporal, composición FFmpeg y preview.

- fondo/cámara: 5/5;
- pipeline 2E: 49/49;
- contrato 2D: 8/8;
- pipeline 2D sin fondo animado: 43/43;
- validación v1: 16/16;
- pipeline v1: 30/30;
- publicación: 10/10;
- build TypeScript/Vite: correcto;
- FFprobe: correcto;
- preview real: correcto.

La prueba de dos jobs aislados no se repitió porque 2E no modifica `job-context`, raíces, caché ni publicación; esa cobertura permaneció intacta y ya había pasado en 2D.

## Problema encontrado

La primera exportación generó ambos videos correctamente, pero el verificador 2D exigía tres turnos fijos. El piloto 2E usa dos. Se corrigió para comparar contra `config.dialogue.length`; los outputs existentes pasaron 49 controles y el pipeline completo se repitió con estado `completed`.

## Handoff UX/UI

Claude puede representar esta capacidad mediante presets simples:

- fondo estático;
- paneo suave;
- zoom suave;
- parallax leve/medio/fuerte.

La edición avanzada de keyframes no está justificada todavía. Los campos técnicos pueden permanecer en una sección avanzada o derivarse de presets.

## Próximo paso

Etapa 3A: varias escenas lineales, duración compilada, cortes y fundido simple, audio/subtítulos continuos y límites pequeños. Antes de implementarla debe definirse un contrato de proyecto separado del contrato de escena v2.
