"""
OpenAI / OpenRouter client wrapper for the AI Processor.

Provides a unified interface for:
  - Chat completions (NER, classification) via GPT-4o-mini or fallback
  - Embeddings via text-embedding-3-small
  - Cost tracking per call
  - Daily budget enforcement
  - Token-bucket rate limiting (max N requests/min)
  - Graceful fallback to Gemini Flash via OpenRouter when budget is hit
"""

import asyncio
import time
from typing import Any

import httpx
from openai import APIError, AsyncOpenAI, RateLimitError

from src.config import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    EMBEDDING_PRICE_PER_1M,
    FALLBACK_INPUT_PRICE_PER_1M,
    FALLBACK_MODEL,
    FALLBACK_OUTPUT_PRICE_PER_1M,
    MAX_BATCH_SIZE,
    NER_INPUT_PRICE_PER_1M,
    NER_MODEL,
    NER_OUTPUT_PRICE_PER_1M,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL,
    RATE_LIMIT_RPM,
)
from src.cost_tracker import CostTracker


# ---------------------------------------------------------------------------
# Token-bucket rate limiter
# ---------------------------------------------------------------------------


class TokenBucketRateLimiter:
    """
    Simple token-bucket rate limiter.

    Refills at `rate` tokens per minute. Each request consumes 1 token.
    """

    def __init__(self, rate: float, burst: int | None = None) -> None:
        self._rate = rate / 60.0  # tokens per second
        self._capacity = burst or int(rate)
        self._tokens = float(self._capacity)
        self._last_refill = time.monotonic()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        """Wait until a token is available, then consume it."""
        async with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_refill
            self._tokens = min(
                self._capacity,
                self._tokens + elapsed * self._rate,
            )
            self._last_refill = now

            if self._tokens < 1.0:
                wait = (1.0 - self._tokens) / self._rate
                await asyncio.sleep(wait)
                self._tokens = 0.0
                self._last_refill = time.monotonic()
            else:
                self._tokens -= 1.0


# ---------------------------------------------------------------------------
# Model pricing lookup
# ---------------------------------------------------------------------------


def _ner_input_cost(tokens: int) -> float:
    return (tokens / 1_000_000) * NER_INPUT_PRICE_PER_1M


def _ner_output_cost(tokens: int) -> float:
    return (tokens / 1_000_000) * NER_OUTPUT_PRICE_PER_1M


def _embedding_cost(tokens: int) -> float:
    return (tokens / 1_000_000) * EMBEDDING_PRICE_PER_1M


def _fallback_input_cost(tokens: int) -> float:
    return (tokens / 1_000_000) * FALLBACK_INPUT_PRICE_PER_1M


def _fallback_output_cost(tokens: int) -> float:
    return (tokens / 1_000_000) * FALLBACK_OUTPUT_PRICE_PER_1M


# ---------------------------------------------------------------------------
# Cost-budget state — shared across provider calls
# ---------------------------------------------------------------------------


class _BudgetState:
    """
    Shared mutable state for budget checks.

    This is intentionally NOT a lock-free hot-path; the operations are
    cheap dict lookups and the cost-tracker append is O(1). Potential race
    windows on cap_exceeded between calls are harmless — the worst case is
    a few extra tokens past the cap before the 429 fires.
    """

    def __init__(self, cost_tracker: CostTracker) -> None:
        self.cost_tracker = cost_tracker
        self._cap_reported: bool = False

    def check(self) -> None:
        if self.cost_tracker.is_cap_exceeded():
            self._cap_reported = True
            raise BudgetExceededError()

    @property
    def is_capped(self) -> bool:
        return self._cap_reported or self.cost_tracker.is_cap_exceeded()


class BudgetExceededError(Exception):
    """Raised when the daily budget cap is exceeded."""
    pass


# ---------------------------------------------------------------------------
# OpenAI client wrapper
# ---------------------------------------------------------------------------


class OpenAIClient:
    """
    Wraps OpenAI (and OpenRouter) API calls with cost tracking,
    rate limiting, and budget enforcement.

    Supports two providers:
      - **openai**: Uses OPENAI_API_KEY + OPENAI_BASE_URL.
      - **openrouter**: Uses OPENROUTER_API_KEY + OPENROUTER_BASE_URL.

    When the primary model exceeds the budget, falls back to FALLBACK_MODEL
    (Gemini Flash) via OpenRouter.
    """

    def __init__(
        self,
        cost_tracker: CostTracker,
        provider: str = "openai",
    ) -> None:
        self.budget = _BudgetState(cost_tracker)
        self.rate_limiter = TokenBucketRateLimiter(RATE_LIMIT_RPM)
        self._provider = provider

        # Primary client (OpenAI)
        self._primary_client = self._build_client(
            api_key=OPENAI_API_KEY,
            base_url=OPENAI_BASE_URL,
        )

        # Fallback client (OpenRouter)
        self._fallback_client = self._build_client(
            api_key=OPENROUTER_API_KEY,
            base_url=OPENROUTER_BASE_URL,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_client(api_key: str, base_url: str) -> AsyncOpenAI:
        return AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            http_client=httpx.AsyncClient(timeout=60.0),
        )

    def _resolve_client(self, use_fallback: bool) -> AsyncOpenAI:
        """Pick the appropriate client based on provider and fallback flag."""
        if use_fallback:
            return self._fallback_client
        if self._provider == "openrouter":
            return self._fallback_client
        return self._primary_client

    def _resolve_model(self, use_fallback: bool) -> str:
        if use_fallback:
            return FALLBACK_MODEL
        return NER_MODEL

    # ------------------------------------------------------------------
    # NER / Chat Completion
    # ------------------------------------------------------------------

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        use_fallback: bool = False,
    ) -> dict[str, Any]:
        """
        Send a chat completion request with cost tracking.

        Args:
            messages: OpenAI-format message list.
            use_fallback: If True, use the fallback model via OpenRouter.

        Returns:
            Dict with 'content', 'model', 'tokens_used', 'cost'.
        """
        self.budget.check()
        await self.rate_limiter.acquire()

        client = self._resolve_client(use_fallback)
        model = self._resolve_model(use_fallback)

        # Estimate input tokens as a best-effort count (approximate)
        input_text = " ".join(m.get("content", "") for m in messages)
        input_tokens_est = max(1, len(input_text) // 4)

        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,  # type: ignore[arg-type]
                temperature=0.1,
                max_tokens=1024,
            )
        except RateLimitError:
            raise
        except APIError as exc:
            raise RuntimeError(f"OpenAI API error: {exc}") from exc

        choice = response.choices[0]
        content: str = choice.message.content or ""
        usage = response.usage

        if usage:
            input_tokens = usage.prompt_tokens
            output_tokens = usage.completion_tokens
        else:
            input_tokens = input_tokens_est
            output_tokens = len(content) // 4

        total_tokens = input_tokens + output_tokens

        if use_fallback:
            cost = _fallback_input_cost(input_tokens) + _fallback_output_cost(output_tokens)
        else:
            cost = _ner_input_cost(input_tokens) + _ner_output_cost(output_tokens)

        self.budget.cost_tracker.log_call(
            model=model,
            tokens=total_tokens,
            cost=cost,
        )

        return {
            "content": content,
            "model": model,
            "tokens_used": total_tokens,
            "cost": round(cost, 8),
        }

    # ------------------------------------------------------------------
    # Embeddings
    # ------------------------------------------------------------------

    async def create_embedding(
        self,
        texts: list[str],
        use_fallback: bool = False,
    ) -> dict[str, Any]:
        """
        Create embeddings for a list of texts.

        Args:
            texts: List of text strings (max MAX_BATCH_SIZE).
            use_fallback: Ignored for embeddings (no fallback model).

        Returns:
            Dict with 'embeddings', 'model', 'tokens_used', 'cost'.
        """
        if len(texts) > MAX_BATCH_SIZE:
            texts = texts[:MAX_BATCH_SIZE]

        self.budget.check()
        await self.rate_limiter.acquire()

        client = self._resolve_client(use_fallback=False)

        try:
            response = await client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=texts,
                dimensions=EMBEDDING_DIMENSIONS,
            )
        except RateLimitError:
            raise
        except APIError as exc:
            raise RuntimeError(f"OpenAI API error: {exc}") from exc

        usage = response.usage
        total_tokens = usage.total_tokens if usage else sum(len(t) // 4 for t in texts)

        cost = _embedding_cost(total_tokens)

        self.budget.cost_tracker.log_call(
            model=EMBEDDING_MODEL,
            tokens=total_tokens,
            cost=cost,
        )

        embeddings = [item.embedding for item in response.data]

        return {
            "embeddings": embeddings,
            "model": EMBEDDING_MODEL,
            "tokens_used": total_tokens,
            "cost": round(cost, 8),
        }
