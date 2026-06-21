"""
Article summarizer for Bluesky publishing.

Uses a local Ollama model (qwen2.5:7b) to generate concise 2-3 sentence
summaries of Argentine news articles. Falls back gracefully if Ollama is
unavailable.
"""

import logging
from typing import Any

import httpx
from pydantic import BaseModel, Field

from src.config import LOCAL_MODELS, OLLAMA_BASE_URL

_logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class SummarizeRequest(BaseModel):
    title: str = Field(..., min_length=1, description="Article headline")
    summary: str = Field(default="", description="Original article summary or lead paragraph")
    max_chars: int = Field(default=200, ge=50, le=500, description="Maximum summary length")


class SummarizeResponse(BaseModel):
    title: str
    original_summary: str
    generated_summary: str
    max_chars: int
    model_used: str


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SUMMARIZE_SYSTEM_PROMPT: str = (
    "Resume esta noticia argentina en 2-3 oraciones concisas en español. "
    "Incluye los datos clave (qué, quién, dónde, cuándo). "
    "Máximo {max_chars} caracteres."
)

SUMMARIZE_MODEL: str = LOCAL_MODELS.get("smart", "qwen2.5:7b")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def summarize_article(
    title: str,
    summary: str,
    max_chars: int = 200,
) -> str:
    """
    Generate a concise 2-3 sentence summary for Bluesky publishing.

    Args:
        title:    Article headline.
        summary:  Original article summary or lead paragraph.
        max_chars: Maximum character length for the generated summary.

    Returns:
        Generated summary string, or the original *summary* (truncated to
        *max_chars*) if Ollama is unreachable.
    """
    system_prompt = _SUMMARIZE_SYSTEM_PROMPT.format(max_chars=max_chars)

    user_prompt = (
        f"Título: {title}\n"
        f"Resumen original: {summary}\n\n"
        "Resumen generado:"
    )

    try:
        content = await _call_ollama(system_prompt, user_prompt)

        if not content or not content.strip():
            _logger.warning("[summarizer] Empty response from Ollama — using original summary")
            return summary[:max_chars]

        result = content.strip()

        # Guard against absurdly long generations
        if len(result) > max_chars * 2:
            _logger.warning(
                "[summarizer] Response too long (%d chars) — truncating original",
                len(result),
            )
            return summary[:max_chars]

        return result

    except Exception as exc:
        _logger.warning("[summarizer] Ollama unavailable (%s) — using original summary", exc)
        return summary[:max_chars]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _call_ollama(system_prompt: str, user_prompt: str) -> str:
    """
    Send a chat completion request to the local Ollama instance.

    Uses the OpenAI-compatible endpoint exposed by ``ollama serve``.

    Raises:
        RuntimeError: If Ollama is unreachable or returns a non-2xx status.
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    url = f"{OLLAMA_BASE_URL}/chat/completions"
    payload: dict[str, Any] = {
        "model": SUMMARIZE_MODEL,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 512,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices", [])
    if not choices:
        return ""

    return choices[0].get("message", {}).get("content", "")
