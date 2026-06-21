"""
Manual override endpoints for Hermes bot.

Provides REST endpoints that can be called from Hermes bot_handlers.py
when a user sends /radar publish <id> or /radar skip <id>.

All overrides are logged in the override_log table for audit purposes.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src import db
from src.formatters import fmt_override_result

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class OverrideRequest(BaseModel):
    reason: str = ""


class OverrideResponse(BaseModel):
    success: bool
    formatted: str


# ---------------------------------------------------------------------------
# POST /api/override/publish/:id — Force-queue article for publishing
# ---------------------------------------------------------------------------


@router.post("/api/override/publish/{article_id}", response_model=OverrideResponse)
async def override_publish(article_id: str, req: OverrideRequest):
    """
    Force-queue an article for publishing, bypassing the AI filter.

    Updates article status to 'publish_forced' and inserts a pending
    tweet_history entry so the twitter-publisher picks it up.

    Expected Hermes mapping:
      /radar publish <id> [reason]  →  POST /api/override/publish/<id>
    """
    success = db.force_publish_article(article_id, reason=req.reason)
    formatted = fmt_override_result("publish", success, article_id, req.reason)
    return OverrideResponse(success=success, formatted=formatted)


# ---------------------------------------------------------------------------
# POST /api/override/skip/:id — Mark article as skipped
# ---------------------------------------------------------------------------


@router.post("/api/override/skip/{article_id}", response_model=OverrideResponse)
async def override_skip(article_id: str, req: OverrideRequest):
    """
    Mark an article as manually skipped.

    Updates article status to 'skipped'.

    Expected Hermes mapping:
      /radar skip <id> [reason]  →  POST /api/override/skip/<id>
    """
    success = db.skip_article(article_id, reason=req.reason)
    formatted = fmt_override_result("skip", success, article_id, req.reason)
    return OverrideResponse(success=success, formatted=formatted)
