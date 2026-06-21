"""
Bluesky headline rewriter.

Uses a local Ollama model (qwen2.5:7b) to transform article headlines into
short, engaging Bluesky-friendly titles. Falls back to the original title
if Ollama is unavailable.
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


class RewriteRequest(BaseModel):
    title: str = Field(..., min_length=1, description="Original article headline")
    source: str = Field(default="", description="Source identifier (e.g. Clarín)")
    category: str = Field(default="", description="Article category (e.g. economia)")


class RewriteResponse(BaseModel):
    original_title: str
    rewritten_title: str
    source: str
    model_used: str


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_REWRITE_SYSTEM_PROMPT: str = (
    "Reescribe este titular de noticia argentina para Bluesky "
    "(máximo 150 caracteres). Hazlo atractivo, claro y conciso. "
    "Mantén el nombre del medio al final."
)

REWRITE_MODEL: str = LOCAL_MODELS.get("smart", "qwen2.5:7b")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def rewrite_headline(title: str, source: str, category: str) -> str:
    """
    Rewrite an article headline for Bluesky publishing.

    Sends the title to a local Ollama model with a Spanish system prompt,
    expecting a response in the format::

        Título reescrito | 📰 Medio

    Args:
        title:    Original article headline.
        source:   Source identifier (e.g. "Clarín", "La Nación").
        category: Article category (e.g. "economia", "politica").

    Returns:
        Rewritten headline string, or the original *title* if Ollama is
        unreachable or returns an empty response.
    """
    user_prompt = (
        f"Titular original: {title}\n"
        f"Fuente: {source}\n"
        f"Categoría: {category}\n\n"
        "Titular reescrito:"
    )

    try:
        content = await _call_ollama(user_prompt)

        if not content or not content.strip():
            _logger.warning("[rewriter] Empty response from Ollama — using original title")
            return title

        result = content.strip()

        # If the response is suspiciously long, fall back
        if len(result) > 300:
            _logger.warning("[rewriter] Response too long (%d chars) — using original title", len(result))
            return title

        return result

    except Exception as exc:
        _logger.warning("[rewriter] Ollama unavailable (%s) — using original title", exc)
        return title


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _call_ollama(user_prompt: str) -> str:
    """
    Send a chat completion request to the local Ollama instance.

    Uses the OpenAI-compatible endpoint exposed by ``ollama serve``.

    Raises:
        RuntimeError: If Ollama is unreachable or returns a non-2xx status.
    """
    messages = [
        {"role": "system", "content": _REWRITE_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    url = f"{OLLAMA_BASE_URL}/chat/completions"
    payload: dict[str, Any] = {
        "model": REWRITE_MODEL,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 256,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices", [])
    if not choices:
        return ""

    return choices[0].get("message", {}).get("content", "")
