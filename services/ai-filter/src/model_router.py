"""
OpenRouter LLM client.

Reuses the pattern from Hermes model_router.py: send a prompt to OpenRouter,
parse the structured JSON response, and handle errors / timeouts.
"""

import json
from typing import Any

import httpx

from src.config import OPENROUTER_API_KEY, MODEL_NAME, OPENROUTER_BASE_URL

_REQUEST_TIMEOUT: int = 30  # seconds
_MAX_RETRIES: int = 2


class ModelRouterError(Exception):
    """Raised when the LLM call fails or returns an unexpected response."""
    pass


async def query_llm(prompt: str, timeout: int = _REQUEST_TIMEOUT) -> dict[str, Any]:
    """
    Send a prompt to OpenRouter and return the parsed JSON response.

    Args:
        prompt: The full prompt text to send.
        timeout: Request timeout in seconds.

    Returns:
        Parsed JSON dictionary from the LLM response.
        Also injects '_tokens' key with token usage info.

    Raises:
        ModelRouterError: On HTTP errors, timeouts, or JSON parse failures.
    """
    if not OPENROUTER_API_KEY:
        raise ModelRouterError("OPENROUTER_API_KEY is not configured")

    headers: dict[str, str] = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3003",
    }

    payload: dict[str, Any] = {
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Eres un asistente que evalúa noticias argentinas. "
                    "Responde SIEMPRE con JSON válido, sin texto adicional."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 300,
    }

    last_error: Exception | None = None

    for attempt in range(_MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    OPENROUTER_BASE_URL, json=payload, headers=headers
                )
                response.raise_for_status()
                data = response.json()
        except httpx.TimeoutException as exc:
            last_error = exc
            if attempt < _MAX_RETRIES:
                continue
            raise ModelRouterError(f"OpenRouter request timed out after {_MAX_RETRIES + 1} attempts")
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            detail = exc.response.text[:200]
            last_error = exc
            if status in (429, 500, 502, 503, 504) and attempt < _MAX_RETRIES:
                continue
            raise ModelRouterError(f"OpenRouter HTTP {status}: {detail}")
        except Exception as exc:
            last_error = exc
            if attempt < _MAX_RETRIES:
                continue
            raise ModelRouterError(f"OpenRouter request failed: {exc}")

        # --- Extract token usage ---
        usage = data.get("usage", {})
        tokens: dict[str, int] = {
            "prompt": usage.get("prompt_tokens", 0),
            "completion": usage.get("completion_tokens", 0),
            "total": usage.get("total_tokens", 0),
        }

        # --- Parse response content ---
        try:
            content: str = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as exc:
            raise ModelRouterError(f"Unexpected OpenRouter response structure: {exc}")

        result = _parse_json_response(content)
        result["_tokens"] = tokens
        return result

    # Should never reach here, but satisfy the return type
    raise ModelRouterError(f"Exhausted retries: {last_error}")


def _parse_json_response(content: str) -> dict[str, Any]:
    """
    Extract a JSON object from the LLM response text.

    Handles markdown code blocks (```json ... ```) and raw JSON.
    """
    # Strip markdown code fences
    cleaned = content.strip()
    if "```json" in cleaned:
        cleaned = cleaned.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in cleaned:
        cleaned = cleaned.split("```", 1)[1].split("```", 1)[0].strip()

    # Find the outermost { … }
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ModelRouterError(
            f"No JSON object found in LLM response: {content[:200]}"
        )
    cleaned = cleaned[start : end + 1]

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ModelRouterError(
            f"Failed to parse JSON from LLM response: {exc}\nRaw: {cleaned[:200]}"
        )
