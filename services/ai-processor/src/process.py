"""
Combined processing endpoint for the AI Processor.

Runs NER and embedding in parallel on the same article and returns
a single combined response.
"""

import asyncio
from typing import Any

from pydantic import BaseModel, Field

from src.embeddings import run_embedding
from src.ner import Entity, NERRequest, run_ner
from src.openai_client import OpenAIClient


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ProcessRequest(BaseModel):
    title: str = Field(..., min_length=1, description="Article title")
    summary: str = Field(default="", description="Article summary")
    source: str = Field(default="", description="Source identifier (e.g. clarin)")


class ProcessResponse(BaseModel):
    entities: list[Entity]
    category: str
    embedding: list[float]
    tokens_used: int
    cost: float


# ---------------------------------------------------------------------------
# Service function
# ---------------------------------------------------------------------------


async def run_process(
    client: OpenAIClient,
    title: str,
    summary: str,
    source: str = "",
    use_fallback: bool = False,
) -> dict[str, Any]:
    """
    Run both NER and embedding on an article in parallel.

    The combined text for NER is "title + summary". The embedding is
    generated from the same combined text.

    Returns a dict with keys: entities, category, embedding, tokens_used, cost.
    """
    combined_text = f"{title} {summary}".strip() if summary else title

    # Run NER and embedding in parallel
    ner_task = run_ner(client, combined_text, use_fallback=use_fallback)
    embed_task = run_embedding(client, [combined_text], use_fallback=use_fallback)

    ner_result, embed_result = await asyncio.gather(ner_task, embed_task)

    total_tokens = ner_result["tokens_used"] + embed_result["tokens_used"]
    total_cost = ner_result["cost"] + embed_result["cost"]

    return {
        "entities": ner_result["entities"],
        "category": ner_result["category"],
        "embedding": embed_result["embeddings"][0]
        if embed_result.get("embeddings")
        else [],
        "tokens_used": total_tokens,
        "cost": round(total_cost, 8),
    }
