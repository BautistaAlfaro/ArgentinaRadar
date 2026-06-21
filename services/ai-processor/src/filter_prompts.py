"""
Prompt templates for AI relevance scoring of Argentine news articles.

The system evaluates articles across five quality dimensions and returns a
structured JSON verdict (PUBLISH/DISCARD) with per-dimension scores.

Ported from services/ai-filter/src/prompts.py
"""


def build_prompt(title: str, summary: str, source: str, category: str) -> str:
    """
    Build the enhanced evaluation prompt for a news article.

    The LLM evaluates the article across five dimensions (0-10), calculates
    a combined score, and returns PUBLISH or DISCARD.

    Args:
        title: Article headline.
        summary: Article summary (max 500 chars).
        source: Source identifier (e.g. "clarin", "infobae").
        category: Article category (politica, economia, sociedad, deportes).

    Returns:
        A complete prompt string ready to send to the LLM.
    """
    return f"""Eres un asistente especializado en evaluar noticias argentinas para ArgentinaRadar, un radar de noticias que publica contenido relevante para la audiencia argentina.

Evalúa esta noticia y devuelve tu veredicto en JSON.

## Título
{title}

## Resumen
{summary}

## Fuente
{source}

## Categoría
{category}

## Criterios de evaluación (cada uno 0-10):

### 1. Relevancia política (political)
- ¿Afecta a nivel nacional? (cambios de gobierno, políticas, legislación)
- ¿Involucra figuras políticas nacionales?
- 0 = sin relevancia política, 10 = impacto político nacional mayor

### 2. Impacto económico (economic)
- ¿Afecta mercados, inflación, empleo, comercio?
- ¿Impacta el bolsillo de los argentinos?
- 0 = sin impacto económico, 10 = crisis o cambio económico significativo

### 3. Relevancia social (social)
- ¿Afecta la vida cotidiana de los argentinos?
- ¿Interés público general?
- 0 = sin relevancia social, 10 = afecta a toda la sociedad

### 4. Urgencia (urgency)
- ¿Es una noticia de último momento?
- ¿Requiere atención inmediata?
- 0 = contenido de fondo/contexto, 10 = breaking news

### 5. Calidad periodística (quality)
- ¿Está bien redactada y es factual?
- ¿Tiene fuentes claras y verificables?
- ¿Evita sensacionalismo y clickbait?
- 0 = clickbait/baja calidad, 10 = periodismo riguroso

## Reglas de decisión:

1. **Relevancia para Argentina**: priorizar noticias con impacto directo en argentinos.
2. **Importancia regional**: nacional > provincial > local.
3. **Oportunidad**: breaking > en desarrollo > contexto/fondo.
4. **RECHAR si**:
   - Es clickbait evidente o contenido sensacionalista sin sustento
   - Es duplicado de otra noticia ya evaluada
   - Es entretenimiento puro (farándula, deportes sin relevancia nacional)
   - La fuente no es confiable o el contenido es claramente falso

## Formato de respuesta JSON:

```json
{{
  "verdict": "PUBLISH",
  "political": 8,
  "economic": 6,
  "social": 7,
  "urgency": 9,
  "quality": 7,
  "relevance": 8,
  "combined": 7.5,
  "reason": "Alto impacto nacional, reforma que afecta a todas las provincias"
}}

- `verdict`: "PUBLISH" para publicar, "DISCARD" para descartar
- `political`, `economic`, `social`, `urgency`, `quality`, `relevance`: puntajes individuales 0-10
- `combined`: promedio ponderado de todos los puntajes (0-10)
- `reason`: explicación breve del veredicto en español

Threshold: combined >= 5.0 → PUBLISH (sobre 10). Responde SOLO con el JSON, sin texto adicional."""
