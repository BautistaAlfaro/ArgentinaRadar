"""
Embedding generation for the AI Processor.

Generates vector embeddings for article texts using:
  - **Ollama** (nomic-embed-text, 768d) when no client is provided (direct mode)
  - **OpenAIClient** (text-embedding-3-small, 1536d) when a client is passed

Stores embeddings as JSON arrays in the `news_items.embedding` column (TEXT).
"""

from typing import Any

from pydantic import BaseModel, Field

from src.config import LOCAL_MODELS, MAX_BATCH_SIZE
from src.ollama_client import generate_embedding as _ollama_embed
from src.openai_client import OpenAIClient

# Local model for embeddings — nomic-embed-text (768d)
_EMBED_LOCAL_MODEL: str = LOCAL_MODELS.get("embed", "nomic-embed-text")


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class EmbeddingRequest(BaseModel):
    texts: list[str] = Field(
        ...,
        min_length=1,
        max_length=MAX_BATCH_SIZE,
        description=f"Texts to embed (1 to {MAX_BATCH_SIZE})",
    )


class EmbeddingResponse(BaseModel):
    embeddings: list[list[float]]
    tokens_used: int
    cost: float


# ---------------------------------------------------------------------------
# Service function
# ---------------------------------------------------------------------------


async def run_embedding(
    texts: list[str],
    model: str | None = None,
    client: OpenAIClient | None = None,
    use_fallback: bool = False,
) -> dict[str, Any]:
    """
    Generate embeddings for a list of texts.

    When a client is provided, uses the OpenAIClient path (paid API or
    Ollama via the client's routing). When no client is provided, uses
    Ollama's /api/generate endpoint directly.

    Args:
        texts: List of text strings to embed.
        model: Override embedding model name.
        client: Optional OpenAIClient for non-direct mode.
        use_fallback: If True and client is provided, use fallback model.

    Returns:
        Dict with keys: embeddings, tokens_used, cost.
    """
    model = model or _EMBED_LOCAL_MODEL

    # If a client is provided, use the existing OpenAIClient path
    if client is not None:
        result = await client.create_embedding(
            texts=texts,
            use_fallback=use_fallback,
            local_model=model,
        )
        return {
            "embeddings": result["embeddings"],
            "tokens_used": result["tokens_used"],
            "cost": result["cost"],
        }

    # Direct Ollama path (no client)
    embeddings: list[list[float]] = []
    for text in texts:
        emb = await _ollama_embed(text, model=model)
        embeddings.append(emb)

    total_tokens = sum(len(t) // 4 for t in texts)

    return {
        "embeddings": embeddings,
        "tokens_used": max(1, total_tokens),
        "cost": 0.0,
    }
