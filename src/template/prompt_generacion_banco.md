# Prompt — Generación de banco de preguntas (StudySmart)

Copia el bloque siguiente en el LLM de tu preferencia, adjunta el material de estudio (apuntes, PDF, temario) y el JSON de ejemplo (`study_package.example.json`).

---

## PROMPT

Eres un experto en diseño de evaluaciones educativas. A partir del material de estudio que te proporciono, genera un banco de preguntas en formato JSON siguiendo **exactamente** el esquema descrito abajo. Devuelve **únicamente el JSON**, sin texto adicional ni bloques de código markdown.

### Estructura general

```json
{
  "schema_version": "1.0",
  "type": "study_package",
  "theory": {
    "topic": {
      "name": "<nombre del tema>",
      "description": "<descripción breve>",
      "subtopics": [
        {
          "name": "<subtema>",
          "description": "<descripción>",
          "content_html": "<contenido teórico en HTML simple: p, ul, li, strong, em>",
          "sections": [
            { "name": "<sección>", "content_html": "<contenido>" }
          ]
        }
      ]
    }
  },
  "questions": {
    "topic": "<mismo nombre del tema>",
    "items": [ /* preguntas, ver tipos abajo */ ]
  }
}
```

### Campos comunes a toda pregunta

| Campo | Obligatorio | Descripción |
|---|---|---|
| `type` | Sí | `"multiple_choice"`, `"multiple_response"` o `"matching"` |
| `subtopic` | Sí | Nombre exacto de un subtema definido en `theory` |
| `section` | No | Nombre exacto de una sección del subtema, o `null` |
| `question` | Sí | Enunciado claro y autocontenido |
| `image` | No | URL de imagen de apoyo, o `null` si no aplica |
| `image_width` | No | Ancho en píxeles (ej. 480), o `null` |
| `explanation` | Sí | Explicación de por qué la respuesta es correcta y por qué los distractores no |

No incluyas `external_id`: el sistema lo genera automáticamente.

### Tipo 1 — Opción múltiple (`multiple_choice`)

Una sola respuesta correcta entre distractores.

- `options`: mínimo 4 opciones, cada una `{ "id": "<letra>", "text": "<texto>" }` con ids `a`, `b`, `c`, `d`...
- `correct`: arreglo con **exactamente un** id, ej. `["b"]`.
- Los distractores deben ser plausibles: errores conceptuales comunes, no opciones absurdas.

### Tipo 2 — Respuesta múltiple (`multiple_response`)

Dos o más respuestas correctas seleccionadas de una lista.

- `options`: **mínimo 5 opciones**, mismo formato que opción múltiple.
- `correct`: arreglo con **2 o más** ids, ej. `["a", "c", "e"]`.
- El enunciado debe indicar explícitamente "Seleccione TODOS los que apliquen" o equivalente.

### Tipo 3 — Relacionar conceptos (`matching`)

Conectar conceptos con sus definiciones o pares equivalentes.

- `left`: lista de conceptos, cada uno `{ "id": "l1", "text": "<concepto>" }`.
- `right`: lista de definiciones, cada una `{ "id": "r1", "text": "<definición>" }`.
- `correct_pairs`: arreglo de `{ "left": "<id izq>", "right": "<id der>" }`. Cada elemento de `left` aparece exactamente una vez.
- Recomendado: 3 a 6 pares. Puedes incluir 1-2 definiciones extra en `right` como distractores (sin par asignado).
- Este tipo NO usa `options` ni `correct`.

### Reglas de calidad

1. Distribuye las preguntas entre todos los subtemas del material; no concentres todo en uno.
2. Varía la dificultad: ~30% básicas (recordar), ~50% intermedias (comprender/aplicar), ~20% avanzadas (analizar).
3. Cada `explanation` debe enseñar, no solo confirmar: menciona el concepto clave y el error de los distractores principales.
4. No repitas el mismo concepto en preguntas distintas salvo con enfoque diferente.
5. Usa `image` solo si el material incluye diagramas/figuras referenciables por URL; de lo contrario `null`.
6. El JSON debe ser válido y parseable: sin comentarios, sin comas colgantes, comillas dobles.

### Parámetros de esta solicitud

- Tema: `<COMPLETA: nombre del tema>`
- Cantidad de preguntas: `<COMPLETA: ej. 20>`
- Distribución por tipo: `<COMPLETA: ej. 12 multiple_choice, 5 multiple_response, 3 matching>`
- Idioma: español

Material de estudio a continuación:

---

## Ejemplo de referencia

Adjunta también `study_package.example.json` como ejemplo de salida esperada.
