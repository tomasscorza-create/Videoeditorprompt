# Secuencias de animación coordinadas V2

## Resultado

El catálogo creativo pasa de cuatro a diez secuencias coordinadas. Una
secuencia combina presets internos existentes y se materializa como un lote de
comandos semánticos `apply-animation-preset`; no introduce código, expresiones
ni un segundo formato de keyframes.

Las seis secuencias nuevas son:

- `rise-and-settle-v2`: entrada inferior y pulso de asentamiento;
- `pop-and-wobble-v2`: aparición con rebote y balanceo;
- `jump-and-flash-v2`: salto y destello;
- `shake-and-pulse-v2`: sacudida lateral y pulso;
- `float-and-pulse-v2`: flotación suave y respiración visual;
- `exit-up-and-fade-v2`: salida ascendente con desvanecimiento.

Todas son aplicables a personajes y props porque usan únicamente parámetros de
transformación compartidos. Las secuencias articuladas anteriores continúan
exigiendo que el recurso declare la articulación correspondiente.

## Integración con Director

Las secuencias viven en
`public/assets/catalog/creative-recipes.json`. El Director recibe sus IDs,
descripciones, slots y parámetros requeridos desde ese catálogo. Al normalizar
un plan:

1. descarta IDs que no existen;
2. conserva solo secuencias recomendadas por la receta narrativa elegida;
3. resuelve elementos compatibles de forma determinista;
4. expande cada acción a comandos cerrados;
5. aplica el lote sobre el mismo proyecto editable.

Las recetas narrativas de explicación, tarjetas, revelado y antes/después ya
recomiendan subconjuntos de las secuencias nuevas.

## Reglas de seguridad

- Cada slot debe estar vinculado exactamente a un elemento compatible.
- Todos los parámetros requeridos deben tener una acción real.
- Dos acciones de una secuencia no pueden escribir la misma pista del mismo
  slot, porque la segunda reemplazaría silenciosamente a la primera.
- Una pista existente bloquea la secuencia completa; no se sobrescribe trabajo
  manual o personalizado.
- La aplicación por lote produce una sola entrada de undo/redo.
- Igual entrada, catálogo e intensidad producen exactamente los mismos
  comandos y keyframes.

## Verificación

`npm run director:test-effect-sequences` comprueba las seis secuencias contra un
proyecto editable real, valida determinismo, portabilidad, aplicación atómica y
undo. `npm run director:test-creative-contract` valida además el catálogo
completo y el rechazo de acciones duplicadas sobre una pista.
