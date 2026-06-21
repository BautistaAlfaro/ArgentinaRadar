"""
Ollama Local AI client for ArgentinaRadar.

Provides direct integration with Ollama's native API (POST /api/generate)
for article classification, plus the existing OpenAI-compatible client
for chat completion and embeddings.

Key function:
  - classify_article(title, summary, source) → dict
      Classifies a news article using qwen2.5:7b (or configured model).
      Returns verdict + multi-dimension scores in v2 filter format.
      Falls back with error if Ollama is unreachable or times out (>10s).

Requires `ollama serve` running on OLLAMA_HOST (default localhost:11434).
"""

import json
from typing import Any

import httpx

from src.config import OLLAMA_EMBED_MODEL, OLLAMA_HOST, OLLAMA_MODEL

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_OLLAMA_GENERATE_URL = f"http://{OLLAMA_HOST}/api/generate"
_OLLAMA_EMBED_URL = f"http://{OLLAMA_HOST}/api/embeddings"
_CLASSIFY_TIMEOUT = 10.0  # seconds — strict timeout for classification

_SYSTEM_PROMPT = (
    "Eres un clasificador de noticias argentinas para ArgentinaRadar, "
    "un radar de noticias que publica contenido relevante para la audiencia argentina. "
    "Evalúa la noticia y devuelve un JSON con tu veredicto."
)

_CLASSIFY_PROMPT_TEMPLATE = """Eres un asistente especializado en evaluar noticias argentinas.

Evalúa esta noticia y devuelve tu veredicto en JSON.

## Título
{title}

## Resumen
{summary}

## Fuente
{source}

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
4. **RECHAZAR si**:
   - Es clickbait evidente o contenido sensacionalista sin sustento
   - Es entretenimiento puro (farándula, deportes sin relevancia nacional)
   - La fuente no es confiable o el contenido es claramente falso

## Formato de respuesta JSON:
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

Threshold: combined >= 5.0 → PUBLISH (sobre 10).
Responde SOLO con el JSON, sin texto adicional."""


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


async def classify_article(
    title: str,
    summary: str = "",
    source: str = "",
    model: str | None = None,
) -> dict[str, Any]:
    """
    Classify a news article using Ollama's /api/generate endpoint.

    Uses qwen2.5:7b (or the configured OLLAMA_MODEL) to evaluate the
    article across 6 dimensions and return a PUBLISH/DISCARD verdict.

    Args:
        title: Article headline.
        summary: Article summary or body text.
        source: Source identifier (e.g. "Clarín").
        model: Override model name (default: OLLAMA_MODEL from env).

    Returns:
        Dict with keys matching the v2 filter format:
            verdict, political, economic, social, urgency,
            quality, relevance, combined, reason.

        On error/fallback returns:
            {"verdict": "DISCARD", "reason": "<error>",
             "political": 0, "economic": 0, "social": 0,
             "urgency": 0, "quality": 0, "relevance": 0, "combined": 0.0}
    """
    model = model or OLLAMA_MODEL
    prompt = _CLASSIFY_PROMPT_TEMPLATE.format(
        title=title,
        summary=summary or "(sin resumen)",
        source=source or "(desconocida)",
    )

    payload = {
        "model": model,
        "prompt": prompt,
        "system": _SYSTEM_PROMPT,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_predict": 512,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=_CLASSIFY_TIMEOUT) as client:
            response = await client.post(_OLLAMA_GENERATE_URL, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        return _error_result("Ollama timeout (>10s) — classify_article timed out")
    except httpx.ConnectError:
        return _error_result(
            "Ollama not available — is 'ollama serve' running? "
            f"(tried {_OLLAMA_GENERATE_URL})"
        )
    except httpx.HTTPStatusError as exc:
        return _error_result(f"Ollama returned HTTP {exc.response.status_code}")
    except Exception as exc:
        return _error_result(f"Ollama request failed: {exc}")

    # Parse response text
    raw_text: str = data.get("response", "")
    if not raw_text.strip():
        return _error_result("Empty response from Ollama")

    parsed = _parse_json(raw_text)
    if parsed is None:
        return _error_result(f"Failed to parse JSON from Ollama response: {raw_text[:200]}")

    # Extract fields with defaults
    verdict = str(parsed.get("verdict", "DISCARD")).upper()
    reason = str(parsed.get("reason", ""))
    scores = {
        "political": int(parsed.get("political", 0)),
        "economic": int(parsed.get("economic", 0)),
        "social": int(parsed.get("social", 0)),
        "urgency": int(parsed.get("urgency", 0)),
        "quality": int(parsed.get("quality", 0)),
        "relevance": int(parsed.get("relevance", 0)),
    }
    combined_raw = parsed.get("combined")
    if combined_raw is not None:
        combined = float(combined_raw)
    else:
        combined = float(sum(scores.values()))

    # Normalize combined to 0-10 scale if it looks like old sum format
    if combined > 10:
        combined = combined / 4.0

    # Enforce threshold (combined >= 5.0 on 0-10 scale)
    if combined >= 5.0 and verdict != "PUBLISH":
        verdict = "PUBLISH"
        reason = reason or f"Combined score {combined:.1f} meets ≥5.0 threshold"
    elif combined < 5.0 and verdict != "DISCARD":
        verdict = "DISCARD"
        reason = reason or f"Combined score {combined:.1f} is below 5.0 threshold"

    return {
        "verdict": verdict,
        "reason": reason,
        **scores,
        "combined": round(combined, 1),
    }


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------


async def generate_embedding(
    text: str,
    model: str | None = None,
) -> list[float]:
    """
    Generate an embedding vector for the given text using Ollama.

    Uses nomic-embed-text (or configured OLLAMA_EMBED_MODEL) and returns
    a 768-dimensional embedding vector.

    Args:
        text: The text to embed.
        model: Override embedding model name.

    Returns:
        List of floats (768-dim embedding vector).

    Raises:
        RuntimeError: If Ollama is unreachable or returns an error.
    """
    model = model or OLLAMA_EMBED_MODEL

    if not text.strip():
        raise ValueError("Cannot generate embedding for empty text")

    payload = {
        "model": model,
        "prompt": text,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=_CLASSIFY_TIMEOUT) as client:
            response = await client.post(_OLLAMA_EMBED_URL, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        raise RuntimeError("Ollama timeout (>10s) — embedding generation timed out")
    except httpx.ConnectError:
        raise RuntimeError(
            "Ollama not available — is 'ollama serve' running? "
            f"(tried {_OLLAMA_EMBED_URL})"
        )
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(f"Ollama returned HTTP {exc.response.status_code}")
    except Exception as exc:
        raise RuntimeError(f"Ollama request failed: {exc}")

    # Parse embedding from response
    embedding = data.get("embedding")
    if embedding is None or not isinstance(embedding, list):
        raise RuntimeError(
            f"Ollama did not return an embedding vector. "
            f"Ensure '{model}' supports embeddings. "
            f"Response keys: {list(data.keys())}"
        )

    return embedding


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


async def check_ollama_health() -> dict[str, Any]:
    """
    Check if Ollama is running and list available models.

    Returns:
        Dict with 'available' (bool) and optionally 'models' (list of str).
    """
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"http://{OLLAMA_HOST}/api/tags")
            response.raise_for_status()
            data = response.json()
            models = [m["name"] for m in data.get("models", [])]
            return {
                "available": True,
                "models": models,
                "host": OLLAMA_HOST,
            }
    except Exception:
        return {
            "available": False,
            "models": [],
            "host": OLLAMA_HOST,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_json(text: str) -> dict[str, Any] | None:
    """Extract JSON object from LLM response text (handles ``` blocks)."""
    cleaned = text.strip()
    if "```json" in cleaned:
        cleaned = cleaned.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in cleaned:
        cleaned = cleaned.split("```", 1)[1].split("```", 1)[0].strip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    cleaned = cleaned[start : end + 1]

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None


def _error_result(reason: str) -> dict[str, Any]:
    """Return a DISCARD error result matching the v2 filter format."""
    return {
        "verdict": "DISCARD",
        "political": 0,
        "economic": 0,
        "social": 0,
        "urgency": 0,
        "quality": 0,
        "relevance": 0,
        "combined": 0.0,
        "reason": reason,
    }
