# Runtime flexible V1

Pilotos de autoría usados para demostrar escenas renderizables con cero, uno o
dos personajes. La duración continúa naciendo del WAV de Piper medido por
FFprobe; ningún fixture contiene segundos inventados para la escena.

- `voiceover-prop.project.json`: cero personajes, una voz fuera de campo, un
  prop v3, subtítulo y dos pistas coordinadas.
- `solo.project.json`: un personaje y un único turno hablado.
- `mixed-0-1-2.project.json`: tres escenas que combinan narración, monólogo y
  diálogo sin compartir una estructura rígida.

El proyecto se ejecuta con:

```powershell
npm run stage3a:flexible-pipeline
npm run stage3a:flexible-solo-pipeline
```

El modo completo produce dos renders y exige hashes idénticos.
