# Piloto de animación renderizable

Proyecto de dos escenas derivado de `pilots/proyecto-compilable-01`, con una
pista de animación por personaje en la primera escena:

- `presentadora`: `position.x` con el preset `enter-left` anclado al inicio de la
  escena. Entra desde fuera del cuadro y llega a su posición base en 0.6 s.
- `analista`: `opacity` con el preset `fade-in` anclado al inicio del segundo
  turno. Antes del primer keyframe el valor se sostiene, así que el personaje
  está invisible hasta que le toca hablar.

Sirve para comprobar que las pistas llegan al MP4 por los dos caminos que usa el
compositor de FFmpeg: expresión continua sobre `t` para posición y escala, y
rangos de frames para la opacidad.

```bash
node scripts/stage3a/project-pipeline.mjs --job-id=piloto-animacion-01 --project=pilots/animacion-render-01/project.json --assets-dir=public
```

La corrida completa renderiza dos veces y compara: si el manifiesto dice
`deterministic: true`, las dos pasadas produjeron los mismos frames.
