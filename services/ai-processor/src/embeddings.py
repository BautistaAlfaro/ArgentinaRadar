"""
Embeddings endpoint for the AI Processor.

Generates vector embeddings for article texts using OpenAI's
text-embedding-3-small model (1536 dimensions).
"""

from pydantic import BaseModel, Field

from src.config import MAX_BATCH_SIZE
from src.openai_client import OpenAIClient


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
    client: OpenAIClient,
    texts: list[str],
    use_fallback: bool = False,
) -> dict:
    """
    Generate embeddings for a list of texts.

    Returns a dict with keys: embeddings, tokens_used, cost.
    """
    result = await client.create_embedding(texts=texts, use_fallback=use_fallback)
    return {
        "embeddings": result["embeddings"],
        "tokens_used": result["tokens_used"],
        "cost": result["cost"],
    }
