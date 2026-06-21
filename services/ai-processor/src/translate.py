"""
Translation module for ArgentinaRadar.

Provides automatic translation of non-Spanish news articles into Spanish
using either the free Google Translate API (no key needed) or OpenAI/OpenRouter
for higher quality.

Rate-limited to max 5 requests/second by default.
"""

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field

from src.config import OPENAI_API_KEY, OPENROUTER_API_KEY
from src.openai_client import OpenAIClient, BudgetExceededError


# ---------------------------------------------------------------------------
# Pydantic models for the translate endpoint
# ---------------------------------------------------------------------------


class TranslateRequest(BaseModel):
    text: str = Field(..., description="Text to translate into Spanish")
    source: str = Field(default="auto", description="Source language code ('auto', 'en', 'pt', etc.)")
    provider: str = Field(default="google", description="Translation provider: 'google' or 'openai'")


class TranslateResponse(BaseModel):
    translated_text: str = Field(..., description="Translated text in Spanish")
    detected_language: str = Field(default="unknown", description="Detected source language code")
    provider: str = Field(default="google", description="Provider used for translation")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GOOGLE_TRANSLATE_URL = (
    "https://translate.googleapis.com/translate_a/single"
    "?client=gtx&dt=t&sl={source}&tl=es&q={text}"
)

DEFAULT_RATE_LIMIT_RPS = 5  # max requests per second

TRANSLATION_SYSTEM_PROMPT = (
    "You are a professional translator specializing in Spanish. "
    "Translate the following text from its source language into Spanish. "
    "Preserve the original meaning, tone, and formatting. "
    "Output ONLY the translated text, nothing else."
)

# ---------------------------------------------------------------------------
# Rate Limiter
# ---------------------------------------------------------------------------


@dataclass
class RateLimiter:
    """Simple token bucket rate limiter."""

    max_per_second: int = DEFAULT_RATE_LIMIT_RPS
    _tokens: float = field(default=0.0)
    _last_refill: float = field(default_factory=time.monotonic)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def acquire(self) -> None:
        """Wait until a token is available, then consume it."""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_refill
            self._tokens = min(
                self.max_per_second,
                self._tokens + elapsed * self.max_per_second,
            )
            self._last_refill = now

            if self._tokens < 1:
                wait_time = (1 - self._tokens) / self.max_per_second
                await asyncio.sleep(wait_time)
                self._tokens = 0
                self._last_refill = time.monotonic()
            else:
                self._tokens -= 1


# ---------------------------------------------------------------------------
# Translation Result
# ---------------------------------------------------------------------------


@dataclass
class TranslationResult:
    translated_text: str
    detected_language: str
    provider: str  # 'google' or 'openai'


# ---------------------------------------------------------------------------
# Google Translate (free — no key needed)
# ---------------------------------------------------------------------------


async def _translate_google(text: str, source: str = "auto") -> TranslationResult:
    """
    Translate text using the free Google Translate API.
    No API key required for basic usage.
    """
    encoded = quote(text, safe="")
    url = GOOGLE_TRANSLATE_URL.format(source=source, text=encoded)

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()

    data = resp.json()

    # Response format: [[["translated","original",null,null,1]], null, "en", ...]
    translated = ""
    if data and isinstance(data, list) and len(data) > 0 and isinstance(data[0], list):
        for segment in data[0]:
            if isinstance(segment, list) and len(segment) > 0 and segment[0]:
                translated += segment[0]

    detected_lang = data[2] if len(data) > 2 and isinstance(data[2], str) else "unknown"

    return TranslationResult(
        translated_text=translated.strip(),
        detected_language=detected_lang,
        provider="google",
    )


# ---------------------------------------------------------------------------
# OpenAI / OpenRouter translation (higher quality)
# ---------------------------------------------------------------------------


async def _translate_openai(
    text: str,
    source: str = "auto",
    openai_client: Optional[OpenAIClient] = None,
) -> TranslationResult:
    """
    Translate text using OpenAI / OpenRouter with a dedicated prompt.
    Requires valid API keys.
    """
    source_lang = source if source != "auto" else "the source language"

    messages = [
        {"role": "system", "content": TRANSLATION_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Translate this text from {source_lang} into Spanish. "
                f"Return ONLY the translation:\n\n{text}"
            ),
        },
    ]

    if openai_client:
        # Use existing OpenAIClient (includes cost tracking + fallback)
        try:
            result = await openai_client.chat_completion(
                messages=messages,
                model="gpt-4o-mini",
                max_tokens=2048,
            )
        except BudgetExceededError:
            result = await openai_client.chat_completion(
                messages=messages,
                model="google/gemini-2.0-flash-lite-preview-02-05:free",
                max_tokens=2048,
            )
    else:
        # Direct API call to OpenAI-compatible endpoint
        api_key = OPENAI_API_KEY or OPENROUTER_API_KEY
        base_url = (
            "https://api.openai.com/v1"
            if OPENAI_API_KEY
            else "https://openrouter.ai/api/v1"
        )
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": "gpt-4o-mini" if OPENAI_API_KEY else "mistral-nemo",
            "messages": messages,
            "max_tokens": 2048,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            result = resp.json()

        translated = (
            result.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
        return TranslationResult(
            translated_text=translated,
            detected_language=source if source != "auto" else "unknown",
            provider="openai" if OPENAI_API_KEY else "openrouter",
        )

    translated = (
        result.get("choices", [{}])[0]
        .get("message", {})
        .get("content", "")
        .strip()
    )
    provider = "openai" if OPENAI_API_KEY else "openrouter"

    return TranslationResult(
        translated_text=translated,
        detected_language=source if source != "auto" else "unknown",
        provider=provider,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_rate_limiter = RateLimiter(max_per_second=DEFAULT_RATE_LIMIT_RPS)


async def translate_to_spanish(
    text: str,
    source: str = "auto",
    provider: str = "google",
    openai_client: Optional[OpenAIClient] = None,
) -> TranslationResult:
    """
    Translate text from any language into Spanish.

    Args:
        text: The text to translate.
        source: Source language code ('auto' for auto-detect) or 'en', 'pt', etc.
        provider: 'google' (free, no key) or 'openai' (better quality, needs key).
        openai_client: Optional OpenAIClient instance for cost-tracked translation.

    Returns:
        TranslationResult with translated text, detected language, and provider.

    Raises:
        httpx.HTTPError: On network/API errors.
        ValueError: On invalid input.
    """
    if not text or not text.strip():
        raise ValueError("Text to translate cannot be empty")

    # Rate limit: max 5 requests/second
    await _rate_limiter.acquire()

    if provider == "google":
        return await _translate_google(text, source)
    elif provider == "openai":
        return await _translate_openai(text, source, openai_client)
    else:
        # Fallback: try Google first, then OpenAI if available
        try:
            return await _translate_google(text, source)
        except Exception:
            if OPENAI_API_KEY or OPENROUTER_API_KEY:
                return await _translate_openai(text, source, openai_client)
            raise
