"""
Local LLM client using Ollama (OpenAI-compatible API at localhost:11434/v1).

Provides a drop-in replacement for paid API calls with:
  - Chat completions (NER, classification, sentiment) via local models
  - Embeddings via nomic-embed-text (768d)
  - Zero cost — all inference runs locally on GPU (RX 6700 XT)

Requires `ollama serve` to be running on the same host.
"""

from typing import Any

import httpx
from openai import APIError, AsyncOpenAI

from src.config import (
    LOCAL_MODELS,
    OLLAMA_BASE_URL,
)

# ---------------------------------------------------------------------------
# Ollama Client
# ---------------------------------------------------------------------------


class OllamaClient:
    """
    Local LLM client that talks to Ollama's OpenAI-compatible endpoint.

    Uses the `openai` Python SDK with a custom base URL pointing at
    the local Ollama instance. Supports chat completion and embeddings
    with no API key and no cost.
    """

    def __init__(self, base_url: str = OLLAMA_BASE_URL) -> None:
        self._client = AsyncOpenAI(
            api_key="ollama",  # Ollama ignores but SDK requires a value
            base_url=base_url,
            http_client=httpx.AsyncClient(timeout=120.0),
        )

    # ------------------------------------------------------------------
    # Chat Completion
    # ------------------------------------------------------------------

    async def chat_completion(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
        temperature: float = 0.1,
    ) -> dict[str, Any]:
        """
        Send a chat completion request to a local Ollama model.

        Args:
            messages: OpenAI-format message list.
            model: Local model name (default: LOCAL_MODELS["smart"]).
            temperature: Sampling temperature (default 0.1 for deterministic).

        Returns:
            Dict with 'content', 'model', 'tokens_used', 'cost' (always 0.0).
        """
        model = model or LOCAL_MODELS.get("smart", "qwen2.5:7b")

        # Estimate input tokens for the return value
        input_text = " ".join(m.get("content", "") for m in messages)
        input_tokens_est = max(1, len(input_text) // 4)

        try:
            response = await self._client.chat.completions.create(
                model=model,
                messages=messages,  # type: ignore[arg-type]
                temperature=temperature,
                max_tokens=1536,
                extra_body={"num_ctx": 8192},  # 8K context window
            )
        except APIError as exc:
            raise RuntimeError(
                f"Ollama API error (is 'ollama serve' running?): {exc}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"Ollama request failed — ensure ollama is running: {exc}"
            ) from exc

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

        return {
            "content": content,
            "model": model,
            "tokens_used": total_tokens,
            "cost": 0.0,
        }

    # ------------------------------------------------------------------
    # Embeddings
    # ------------------------------------------------------------------

    async def create_embedding(
        self,
        texts: list[str],
        model: str | None = None,
    ) -> dict[str, Any]:
        """
        Create embeddings using a local Ollama embedding model.

        Args:
            texts: List of text strings to embed.
            model: Local embedding model (default: LOCAL_MODELS["embed"]).

        Returns:
            Dict with 'embeddings', 'model', 'tokens_used', 'cost' (always 0.0).
        """
        model = model or LOCAL_MODELS.get("embed", "nomic-embed-text")

        # nomic-embed-text outputs 768d vectors (vs 1536d for text-embedding-3-small)
        try:
            response = await self._client.embeddings.create(
                model=model,
                input=texts,
            )
        except APIError as exc:
            raise RuntimeError(
                f"Ollama embedding error (is 'ollama serve' running?): {exc}"
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"Ollama request failed — ensure ollama is running: {exc}"
            ) from exc

        usage = response.usage
        total_tokens = usage.total_tokens if usage else sum(len(t) // 4 for t in texts)

        embeddings = [item.embedding for item in response.data]

        return {
            "embeddings": embeddings,
            "model": model,
            "tokens_used": total_tokens,
            "cost": 0.0,
        }
