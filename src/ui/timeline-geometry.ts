// Geometría pura de la timeline (sin DOM), pensada para poder probarse en Node vía
// `ui:test-modules`. Estas funciones NO inventan tiempos: solo traducen datos que ya
// existen (duración medida, presets de transición, pausas del contrato) a posiciones
// y rótulos. Toda simulación de precisión que el motor no tiene queda prohibida.

export interface RulerTick {
  seconds: number;
  position: number; // px desde el inicio de la pista
  major: boolean; // los mayores llevan rótulo de tiempo; los menores son subdivisiones
}

// Pasos candidatos (en segundos) para las marcas mayores de la regla.
const MAJOR_STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300] as const;
// Cuántas subdivisiones por marca mayor, de más finas a más gruesas.
const SUBDIVISIONS = [10, 5, 4, 2, 1] as const;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Elige el paso mayor más chico cuya separación en pantalla llegue a `minPixels`.
export function chooseTickStep(pixelsPerSecond: number, minPixels: number): number {
  for (const step of MAJOR_STEPS) {
    if (step * pixelsPerSecond >= minPixels) return step;
  }
  return MAJOR_STEPS[MAJOR_STEPS.length - 1];
}

// Marcas regulares de tiempo para el modo medido. Los menores siempre son divisores
// exactos del mayor (así cada marca mayor cae sobre una marca real). Sin duración
// medida (<= 0) no hay marcas: nunca se dibuja una regla de tiempo sin medición.
export function rulerTicks(durationSeconds: number, pixelsPerSecond: number): RulerTick[] {
  if (!(durationSeconds > 0) || !(pixelsPerSecond > 0)) return [];
  const majorStep = chooseTickStep(pixelsPerSecond, 64);
  const majorPixels = majorStep * pixelsPerSecond;
  const subdivisions = SUBDIVISIONS.find((count) => majorPixels / count >= 9) ?? 1;
  const minorStep = majorStep / subdivisions;
  const epsilon = minorStep / 1000;
  const lastIndex = Math.floor((durationSeconds + epsilon) / minorStep);
  const ticks: RulerTick[] = [];
  for (let index = 0; index <= lastIndex; index += 1) {
    const seconds = roundTo(index * minorStep, 4);
    ticks.push({
      seconds,
      position: seconds * pixelsPerSecond,
      major: index % subdivisions === 0,
    });
  }
  return ticks;
}

// Glifo compacto para el chip de transición: tijera para el corte, rombo con duración
// para el fundido. La duración solo se muestra cuando aporta (> 0).
export function transitionGlyph(preset: string, durationSeconds: number): string {
  if (preset === 'fade') {
    return durationSeconds > 0 ? `◇ ${roundTo(durationSeconds, 2)} s` : '◇';
  }
  return '✂';
}

// Rótulo accesible del chip de transición (para title/aria-label).
export function transitionLabel(preset: string, durationSeconds: number): string {
  if (preset === 'fade') {
    return durationSeconds > 0 ? `Fundido ${roundTo(durationSeconds, 2)} s` : 'Fundido';
  }
  return 'Corte directo';
}

// Rótulo breve de una pausa entre turnos (segundos con un decimal útil).
export function pauseLabel(seconds: number): string {
  return `${roundTo(seconds, 2)} s`;
}
