"""
Article relevance filtering module.

Evaluates news articles across four dimensions (political, economic, social,
urgency) using the shared OpenAIClient, enforces a combined-score threshold,
and persists the verdict to the shared SQLite database.

Ported from services/ai-filter/src/filter.py — uses OpenAIClient instead of
the old model_router for consistency with the rest of ai-processor.
"""

import json
import sqlite3
from typing import Any

from pydantic import BaseModel, Field

from src.config import DB_PATH, LOCAL_MODELS
from src.filter_prompts import build_prompt
from src.openai_client import OpenAIClient

# Local model for article relevance filtering — classification task, fast model
_FILTER_LOCAL_MODEL: str = LOCAL_MODELS.get("fast", "gemma3:4b")


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class FilterRequest(BaseModel):
    article_id: str = Field(default="", description="Article UUID (optional for ad-hoc calls)")
    title: str = Field(..., min_length=1, description="Article title")
    summary: str = Field(default="", description="Article summary")
    source: str = Field(default="", description="Source identifier (e.g. clarin)")
    category: str = Field(default="", description="Article category")


class FilterResponse(BaseModel):
    article_id: str
    verdict: str
    reason: str
    scores: dict[str, int]
    combined: float
    tokens_used: int
    cost: float


# ---------------------------------------------------------------------------
# Service function
# ---------------------------------------------------------------------------


async def run_filter(
    client: OpenAIClient,
    article_id: str,
    title: str,
    summary: str,
    source: str = "",
    category: str = "",
    use_fallback: bool = False,
) -> dict[str, Any]:
    """
    Evaluate a single article and return the verdict.

    Builds a structured prompt, sends it through the shared LLM pipeline,
    parses the 4-dimension response, enforces the threshold, and persists
    the verdict to the shared database.

    Args:
        client: Shared OpenAIClient instance with cost tracking.
        article_id: UUID of the article (may be empty for ad-hoc calls).
        title: Article headline.
        summary: Article summary text.
        source: Source name (e.g. "clarin").
        category: Article category.
        use_fallback: If True, use OpenRouter fallback model.

    Returns:
        A dict with verdict, reason, scores, combined, tokens_used, and cost.
    """
    prompt = build_prompt(title, summary, source, category)

    messages = [
        {
            "role": "system",
            "content": (
                "Eres un asistente que evalúa noticias argentinas. "
                "Responde SIEMPRE con JSON válido, sin texto adicional."
            ),
        },
        {"role": "user", "content": prompt},
    ]

    # --- Call LLM through shared client ---
    try:
        result = await client.chat_completion(
            messages,
            use_fallback=use_fallback,
            local_model=_FILTER_LOCAL_MODEL,
        )
    except Exception as exc:
        return _build_error_result(article_id, f"LLM call failed: {exc}")

    content: str = result["content"]
    tokens_used: int = result["tokens_used"]
    cost: float = result["cost"]

    # --- Parse JSON from response ---
    parsed = _parse_json_response(content)
    if parsed is None:
        return _build_error_result(article_id, "Failed to parse JSON from LLM response")

    # --- Extract scores (v2 format with quality, relevance, combined avg) ---
    scores = {
        "political": int(parsed.get("political", 0)),
        "economic": int(parsed.get("economic", 0)),
        "social": int(parsed.get("social", 0)),
        "urgency": int(parsed.get("urgency", 0)),
        "quality": int(parsed.get("quality", 0)),
        "relevance": int(parsed.get("relevance", 0)),
    }
    # combined is now an average 0-10 (v2) — fallback to old sum for backward compat
    combined_raw = parsed.get("combined")
    if combined_raw is not None:
        combined = float(combined_raw)
    else:
        combined = float(sum(scores.values()))  # old format: sum of 4 scores (0-40)
    verdict = str(parsed.get("verdict", "DISCARD")).upper()
    reason = str(parsed.get("reason", ""))

    # --- Normalise combined to 0-10 scale if it looks like old sum format ---
    if combined > 10:
        combined = combined / 4.0  # convert old sum-of-4 to approximate average

    # --- Enforce threshold (combined >= 5.0 on 0-10 scale) ---
    if combined >= 5.0 and verdict != "PUBLISH":
        verdict = "PUBLISH"
        reason = reason or f"Combined score {combined:.1f} meets ≥5.0 threshold"
    elif combined < 5.0 and verdict != "DISCARD":
        verdict = "DISCARD"
        reason = reason or f"Combined score {combined:.1f} is below 5.0 threshold"

    # --- Persist to DB (only if article_id is provided) ---
    if article_id:
        _persist_verdict(article_id, verdict, reason, scores, combined)

    return {
        "article_id": article_id,
        "verdict": verdict,
        "reason": reason,
        "scores": scores,
        "combined": combined,
        "tokens_used": tokens_used,
        "cost": cost,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_json_response(content: str) -> dict[str, Any] | None:
    """
    Extract a JSON object from the LLM response text.

    Handles markdown code blocks (```json ... ```) and raw JSON.
    Returns None on failure.
    """
    cleaned = content.strip()
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


def _persist_verdict(
    article_id: str,
    verdict: str,
    reason: str,
    scores: dict[str, int],
    combined: int,
) -> None:
    """
    Write the AI verdict to the shared SQLite database.

    Updates the news_items row with the AI score and status so downstream
    services (event-detector, etc.) can consume it.
    """
    ai_score = json.dumps(
        {
            "publish": verdict == "PUBLISH",
            "reasoning": reason,
            "political": scores["political"],
            "economic": scores["economic"],
            "social": scores["social"],
            "urgency": scores["urgency"],
            "quality": scores.get("quality", 0),
            "relevance": scores.get("relevance", 0),
            "combined": round(combined, 1),
        },
        ensure_ascii=False,
    )
    status = "filtered" if verdict == "PUBLISH" else "discarded"

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "UPDATE news_items SET ai_score = ?, status = ? WHERE id = ?",
            (ai_score, status, article_id),
        )
        conn.commit()
    finally:
        conn.close()


def _build_error_result(article_id: str, error: str) -> dict[str, Any]:
    """Return a DISCARD result with error info."""
    return {
        "article_id": article_id,
        "verdict": "DISCARD",
        "reason": error,
        "scores": {"political": 0, "economic": 0, "social": 0, "urgency": 0, "quality": 0, "relevance": 0},
        "combined": 0.0,
        "tokens_used": 0,
        "cost": 0.0,
    }
