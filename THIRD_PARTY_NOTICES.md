# Avisos de terceros

Este archivo se genera de forma determinista desde `public/assets/catalog/resource-licenses.json`.
Resume la procedencia registrada y no sustituye los textos completos de cada licencia ni una revisión jurídica.

## Recursos de terceros

### voz-ald-mx-v1

- Titular o fuente: Contribuidores de Piper Voices y rmcpantoja
- Licencia registrada: `MIT AND Unlicense`
- Estado: `cleared`
- Fuente: https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_MX/ald/medium
- Licencia: https://unlicense.org/
- Nota: El MODEL_CARD declara el dataset Ald Mexican Spanish bajo Unlicense; conservar también el aviso MIT del repositorio de modelos.

### voz-claude-mx-v1

- Titular o fuente: Contribuidores de Piper Voices y HirCoir
- Licencia registrada: `MIT AND Apache-2.0`
- Estado: `review-required`
- Fuente: https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_MX/claude/high
- Licencia: https://www.apache.org/licenses/LICENSE-2.0
- Atribución: Modelo Claude de Piper Voices; dataset HirCoir Piper-TTS-Spanish, Apache-2.0.
- Nota: La licencia declarada es permisiva, pero falta cerrar la procedencia del audio base antes de distribuir o vender.

### voz-davefx-es-v1

- Titular o fuente: Contribuidores de Piper Voices y del dataset DaveFX
- Licencia registrada: `MIT AND CC0-1.0`
- Estado: `cleared`
- Fuente: https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_ES/davefx/medium
- Licencia: https://creativecommons.org/publicdomain/zero/1.0/
- Nota: Conservar el aviso MIT del repositorio; el MODEL_CARD declara el dataset de origen CC0.

### voz-sharvard-es-v1

- Titular o fuente: Contribuidores de Piper Voices y University of Edinburgh
- Licencia registrada: `MIT AND CC-BY-3.0`
- Estado: `attribution-required`
- Fuente: https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_ES/sharvard/medium
- Licencia: https://creativecommons.org/licenses/by/3.0/
- Atribución: sHarvard Spanish speech dataset, University of Edinburgh DataShare 10283/574, CC BY 3.0; modelo distribuido por Piper Voices.
- Nota: La atribución debe acompañar cualquier distribución del modelo y conservarse en los avisos del producto.

## Runtime y servicios externos

### ElevenLabs API

- Titular o fuente: ElevenLabs API
- Licencia registrada: `LicenseRef-ElevenLabs-Terms`
- Estado: `review-required`
- Fuente: https://elevenlabs.io/
- Licencia: https://elevenlabs.io/terms-of-use
- Nota: La aplicación solo referencia voces y genera outputs por API; los derechos comerciales dependen del plan y de los términos vigentes, y no se redistribuyen modelos de ElevenLabs.

### Piper TTS

- Titular o fuente: Piper TTS
- Licencia registrada: `GPL-3.0-or-later`
- Estado: `review-required`
- Fuente: https://github.com/OHF-Voice/piper1-gpl
- Licencia: https://www.gnu.org/licenses/gpl-3.0.html
- Atribución: Piper TTS, Open Home Foundation Voice, GPL-3.0-or-later.
- Nota: El uso comercial está permitido, pero antes de distribuir el runtime junto al producto debe definirse y verificar el mecanismo de cumplimiento GPL.

## Política de recursos propietarios

Los recursos originales cuyo registro usa `LicenseRef-Proprietary-Asset` pertenecen a Tomás Scorza.
Pueden distribuirse como parte del producto autorizado, pero no como una biblioteca de assets independiente salvo autorización expresa del titular.
