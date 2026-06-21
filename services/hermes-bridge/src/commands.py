"""
Command handlers for Hermes Telegram bot integration.

These endpoints provide the data that Hermes bot would call when a user
sends /radar commands. The bridge exposes them as REST endpoints so
Hermes bot_handlers.py can forward them without running Python imports.

Expected Hermes integration (to be done in Hermes repo):
  bot_handlers.py would call:
    GET http://localhost:3005/api/status      → /radar status
    GET http://localhost:3005/api/news?limit=5 → /radar news 5
    GET http://localhost:3005/api/stats         → /radar stats
"""

from typing import Any

from fastapi import APIRouter, Query

from src import db
from src.config import SERVICE_URLS
from src.formatters import fmt_news_list, fmt_status, fmt_stats

import httpx

router = APIRouter()


# ---------------------------------------------------------------------------
# /api/status — Service health, quota, counts
# ---------------------------------------------------------------------------


@router.get("/api/status")
async def cmd_status():
    """Return full status: service health, Twitter quota, AI cost, article counts."""
    async with httpx.AsyncClient(timeout=5) as client:
        health_results: dict[str, Any] = {}
        for name, url in SERVICE_URLS.items():
            try:
                resp = await client.get(f"{url}/health")
                if resp.status_code == 200:
                    health_results[name] = {"status": "ok"}
                else:
                    health_results[name] = {"status": "error", "code": resp.status_code}
            except httpx.RequestError as exc:
                health_results[name] = {"status": "offline", "error": str(exc)}

    # Also get sources status from DB
    sources_status = db.get_service_status()

    quota = db.get_twitter_quota()
    ai_cost = db.get_ai_filter_cost()
    counts = db.get_article_counts()

    combined_services = {
        "health": health_results,
        "sources": sources_status.get("sources", []),
    }

    return {
        "raw": {
            "services": combined_services,
            "quota": quota,
            "ai_cost": ai_cost,
            "counts": counts,
        },
        "formatted": fmt_status(combined_services, quota, ai_cost, counts),
    }


# ---------------------------------------------------------------------------
# /api/news — Latest articles
# ---------------------------------------------------------------------------


@router.get("/api/news")
async def cmd_news(limit: int = Query(default=5, ge=1, le=50)):
    """Return the latest N articles with formatted response."""
    articles = db.get_latest_articles(limit=limit)
    return {
        "raw": {"articles": articles, "count": len(articles)},
        "formatted": fmt_news_list(articles, limit),
    }


# ---------------------------------------------------------------------------
# /api/stats — Daily and weekly statistics
# ---------------------------------------------------------------------------


@router.get("/api/stats")
async def cmd_stats():
    """Return daily and weekly aggregation stats."""
    stats = db.get_daily_weekly_stats()
    return {
        "raw": stats,
        "formatted": fmt_stats(stats),
    }
